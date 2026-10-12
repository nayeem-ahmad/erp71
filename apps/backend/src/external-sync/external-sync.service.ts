import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { recordCostAdjustment } from '../database/product-cost.utils';
import { EncryptionService } from '../common/encryption.service';
import { codeForNewRecord } from '../common/code-series.util';
import { assertValidBaseUrl } from './express-retail.client';
import {
    DateWindow,
    MappedCustomer,
    MappedPayment,
    MappedPurchase,
    MappedPurchaseReturn,
    MappedQuotation,
    MappedSale,
    MappedSaleReturn,
    MappedSupplier,
    OpeningPositions,
    PaymentParty,
    SkippedRecord,
    SyncWarning,
    creditTransactionType,
    toDateString,
} from './external-sync.mapper';
import { capWarnings, countWarningCodes, describeWriteError, freeDocumentNumber, partyLabel } from './skipped-records';
import {
    DEFAULT_PROVIDER,
    EXPRESS_MAPPERS,
    ProviderClient,
    ProviderMappers,
    getProviderDefinition,
    isKnownProvider,
    listProviderDefinitions,
} from './provider-adapter';
import {
    applyPaymentImpacts,
    applyPurchaseImpacts,
    applyPurchaseReturnCredit,
    applyPurchaseReturnImpacts,
    postPurchasePaid,
    applySaleImpacts,
    applySaleOverpayment,
    applySaleReturnCredit,
    applySaleReturnImpacts,
    applyOpeningBalance,
    applyOpeningStock,
    isAlreadyPosted,
    openingBalanceNote,
    OPENING_STOCK_REFERENCE,
} from './external-sync.impacts';
import { resolveWarehouseId } from '../database/inventory.utils';
import { postingIdempotencyKey } from '../accounting/posting.utils';
import {
    ListExternalSyncRunsQueryDto,
    RunExternalSyncDto,
    TestExternalSyncConnectionDto,
    UpsertExternalSyncConnectionDto,
} from './external-sync.dto';
import { resolveSyncWindow } from './snapshot/window';
import { ExternalSyncSnapshotService } from './snapshot/snapshot.service';
import { clientForRun } from './snapshot/client-for-run';
import { SnapshotClient } from './snapshot/snapshot-client';
import { normalizePhone } from './match/normalize';
import { customerBranchId } from '../customers/customer-branch.util';
import { supplierBranchId } from '../suppliers/supplier-branch.util';

type EntityType =
    | 'PRODUCT'
    | 'CUSTOMER'
    | 'SUPPLIER'
    | 'SALE'
    | 'PURCHASE'
    | 'CUSTOMER_PAYMENT'
    | 'SUPPLIER_PAYMENT'
    | 'SALE_RETURN'
    | 'QUOTATION'
    | 'PURCHASE_RETURN';

interface EntityTally {
    created: number;
    updated: number;
    skipped: number;
}

type SyncStats = Record<
    | 'products'
    | 'customers'
    | 'suppliers'
    | 'sales'
    | 'purchases'
    | 'customerPayments'
    | 'supplierPayments'
    | 'saleReturns'
    | 'quotations'
    | 'purchaseReturns',
    EntityTally
>;

/** What the document steps read off the connection row. */
interface DocumentConnection {
    id: string;
    tenant_id: string;
    store_id: string;
    provider: string;
    document_prefix: string;
    post_impacts: boolean;
}

/** An imported product whose provider row carried a buying rate. */
interface OpeningCostCandidate {
    productId: string;
    rate: number;
    /** How a warning names the product: its provider SKU, else its name. */
    label: string;
    externalId: string;
}


/**
 * The import is divided into steps so it can be run a piece at a time — a
 * failed sales pull can be retried without re-fetching 1,200 products, and a
 * first migration can be walked through one step at a time instead of being one
 * opaque operation.
 *
 * Steps are independent because every cross-reference is resolved through the
 * mapping table rather than through whatever the current run happened to
 * import: running SALES alone still resolves products and customers imported by
 * an earlier MASTERS run.
 */
export const SYNC_STEPS = [
    'MASTERS',
    // Purchases precede sales: a replay starts from no stock, so a sale
    // processed first would be short of the receipt that supplies it.
    'PURCHASES',
    'SALES',
    // Quotations move no stock and no money, so they could sit anywhere after
    // MASTERS; beside sales keeps the customer-facing documents together.
    'QUOTATIONS',
    'CUSTOMER_PAYMENTS',
    'SUPPLIER_PAYMENTS',
    'SALE_RETURNS',
    // Last for the same reason as sale returns: a return's purchase may sit in
    // any earlier chunk of the run.
    'PURCHASE_RETURNS',
] as const;

export type SyncStep = (typeof SYNC_STEPS)[number];

/** How often the run row is rewritten while working, in chunks. */
const PROGRESS_EVERY_CHUNK = 1;

/** Thrown to unwind a run that the operator stopped; not a failure. */
class RunCancelledError extends Error {
    constructor() {
        super('Run cancelled');
    }
}

/**
 * Platform-admin driven import of sales/purchase history from a third-party
 * ERP into one of our tenants.
 *
 * What an import *does* depends on the connection's `post_impacts` flag, and
 * the two modes are each internally consistent.
 *
 * Off (the default) it writes documents and master data only. No stock
 * movements, no ledger postings, no due-balance changes — for any document
 * type. That is a coherent position rather than an unfinished one: the tenant's
 * own opening balances carry the money, and imported documents are history you
 * can look up. It is also why imported payments must not move `due_balance`
 * either — imported sales never raised it, so letting payments lower it would
 * drive every party negative by its own payment history.
 *
 * On, every imported document produces what a natively entered one would:
 * stock movements, party due balances and dated ledger vouchers, all stamped
 * with the document's own date so a replayed history lands in the right
 * periods. See external-sync.impacts.ts.
 *
 * Turning it on double-counts unless the tenant has no opening balances
 * covering the imported range, so it is a deliberate per-connection decision.
 * It also makes posted documents immutable: a later re-pull will not rewrite a
 * document whose voucher and stock movement have already landed, and says so
 * in the run warnings instead.
 */

/**
 * Adoption links an imported record to one the tenant already has, writes a
 * mapping for it and then bills every document the import creates against it —
 * permanently, since `isImmutablyPosted` refuses to rewrite a posted document.
 *
 * Each builder therefore returns `null` rather than guessing when it has no key
 * it can trust, leaving the caller to create a fresh record instead of adopting
 * an arbitrary one.
 */
export function productAdoptionWhere(tenantId: string, sku: string | null) {
    // `sku` is nullable on Product, so a null or blank one is not an identity:
    // matching on it would adopt whichever untagged product came back first.
    if (!sku) return null;
    return { tenant_id: tenantId, sku, deleted_at: null };
}

export function customerAdoptionWhere(
    tenantId: string,
    // The phone as the provider sent it. `Customer.phone` stores raw input, so
    // this lookup must be raw too — normalizing here would miss every row saved
    // in a different format. Normalization belongs to candidate matching, which
    // compares in memory with both sides normalized.
    phone: string | null,
    // Accepted so call sites read naturally, and to document that the code is
    // deliberately unused: it is the provider's code with a `-2` added on a
    // repeat, or none at all, so it says nothing about who the party is.
    _customerCode: string | null,
) {
    // A number that is not a phone ("01", "32", "415" — what shops type when
    // they have none) is not identity either: matching on it welded unrelated
    // customers who happened to share the same junk.
    if (!phone || !normalizePhone(phone)) return null;
    return { tenant_id: tenantId, phone, deleted_at: null };
}

export function supplierAdoptionWhere(tenantId: string, name: string) {
    // `deleted_at: null` keeps a provider supplier out of a tombstone it would
    // otherwise be mapped to permanently, billing purchases to a supplier no
    // picker and no list will ever show (TODO.md:357).
    if (!name) return null;
    return { tenant_id: tenantId, name, deleted_at: null };
}

/** What the skipped-records report needs about a document the run could not import. */
function skippedDocument(
    number: string,
    date: Date,
    externalPartyId: string | null,
    embeddedParty: unknown,
    amount: number,
    lines: number | null,
    error?: unknown,
): SkippedRecord {
    return {
        number,
        date: toDateString(date),
        party: partyLabel(externalPartyId, embeddedParty),
        amount,
        lines,
        ...(error === undefined ? {} : { error: describeWriteError(error) }),
    };
}

@Injectable()
export class ExternalSyncService {
    private readonly logger = new Logger(ExternalSyncService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly encryption: EncryptionService,
        private readonly snapshots: ExternalSyncSnapshotService,
    ) {}

    // ---------------------------------------------------------------- config

    /** Validates a provider key, defaulting to Express Retail Pro when omitted. */
    private resolveProviderKey(provider?: string | null): string {
        const key = provider ?? DEFAULT_PROVIDER;
        if (!isKnownProvider(key)) {
            throw new BadRequestException(`Unknown external-sync provider: ${key}`);
        }
        return key;
    }

    /** The providers a connection can be created against, for the UI selector. */
    listProviders() {
        return listProviderDefinitions().map((def) => ({
            provider: def.provider,
            label: def.label,
            defaultBaseUrl: def.defaultBaseUrl,
            defaultDocumentPrefix: def.defaultDocumentPrefix,
        }));
    }

    async getConnection(tenantId: string, provider: string = DEFAULT_PROVIDER) {
        const providerKey = this.resolveProviderKey(provider);
        const connection = await this.db.externalSyncConnection.findUnique({
            where: { tenant_id_provider: { tenant_id: tenantId, provider: providerKey } },
            include: { store: { select: { id: true, name: true } } },
        });

        if (!connection) return null;
        return this.toPublicConnection(connection);
    }

    async upsertConnection(tenantId: string, dto: UpsertExternalSyncConnectionDto, adminUserId?: string) {
        const tenant = await this.db.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
        if (!tenant) throw new NotFoundException('Tenant not found');

        const store = await this.db.store.findFirst({
            where: { id: dto.storeId, tenant_id: tenantId },
            select: { id: true },
        });
        if (!store) throw new BadRequestException('Store not found for this tenant');

        const def = getProviderDefinition(this.resolveProviderKey(dto.provider));
        const baseUrl = assertValidBaseUrl(dto.baseUrl);
        const existing = await this.db.externalSyncConnection.findUnique({
            where: { tenant_id_provider: { tenant_id: tenantId, provider: def.provider } },
        });

        if (!existing && !dto.password) {
            throw new BadRequestException('A password is required when creating a connection');
        }

        const data = {
            base_url: baseUrl,
            username: dto.username.trim(),
            store_id: dto.storeId,
            document_prefix: dto.documentPrefix ?? existing?.document_prefix ?? def.defaultDocumentPrefix,
            enabled: dto.enabled ?? existing?.enabled ?? false,
            post_impacts: dto.postImpacts ?? existing?.post_impacts ?? false,
            window_days: dto.windowDays ?? existing?.window_days ?? 90,
            history_start_date: dto.historyStartDate
                ? new Date(dto.historyStartDate)
                : existing?.history_start_date ?? null,
            ...(dto.password ? { password_encrypted: this.encryption.encrypt(dto.password) } : {}),
        };

        const saved = existing
            ? await this.db.externalSyncConnection.update({
                  where: { id: existing.id },
                  data,
                  include: { store: { select: { id: true, name: true } } },
              })
            : await this.db.externalSyncConnection.create({
                  data: {
                      tenant_id: tenantId,
                      provider: def.provider,
                      password_encrypted: this.encryption.encrypt(dto.password as string),
                      created_by: adminUserId ?? null,
                      ...data,
                  },
                  include: { store: { select: { id: true, name: true } } },
              });

        return this.toPublicConnection(saved);
    }

    async deleteConnection(tenantId: string, provider: string = DEFAULT_PROVIDER) {
        const def = getProviderDefinition(this.resolveProviderKey(provider));
        const existing = await this.db.externalSyncConnection.findUnique({
            where: { tenant_id_provider: { tenant_id: tenantId, provider: def.provider } },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException(`No ${def.label} connection configured for this tenant`);

        // Mappings and runs cascade; snapshot rows cascade too. The gzip files
        // do not — drop them first. Imported documents stay; deleting a
        // connection must not delete a tenant's sales.
        await this.snapshots.removeFilesForConnection(tenantId, existing.id);
        await this.db.externalSyncConnection.delete({ where: { id: existing.id } });
        return { deleted: true };
    }

    /** Verifies credentials without importing anything. */
    async testConnection(tenantId: string, dto: TestExternalSyncConnectionDto) {
        const def = getProviderDefinition(this.resolveProviderKey(dto.provider));
        let password = dto.password;
        if (!password) {
            const existing = await this.db.externalSyncConnection.findUnique({
                where: { tenant_id_provider: { tenant_id: tenantId, provider: def.provider } },
                select: { password_encrypted: true },
            });
            if (!existing) {
                throw new BadRequestException('No stored password — supply one to test');
            }
            password = this.encryption.decrypt(existing.password_encrypted);
        }

        const client = def.createClient({ baseUrl: dto.baseUrl, username: dto.username, password });
        const session = await client.login();

        return {
            ok: true,
            provider: def.provider,
            organizationId: session.organizationId,
            user: session.user,
        };
    }

    // ------------------------------------------------------------------ runs

    async listRuns(tenantId: string, query: ListExternalSyncRunsQueryDto) {
        return this.db.externalSyncRun.findMany({
            where: { tenant_id: tenantId },
            orderBy: { started_at: 'desc' },
            take: query.limit ?? 20,
        });
    }

    /**
     * Starts an import. The HTTP caller gets the run row immediately; the
     * import itself continues in the background and updates that row, because
     * a full history pull takes minutes.
     */
    async startRun(tenantId: string, dto: RunExternalSyncDto, trigger: 'MANUAL' | 'SCHEDULED', userId?: string) {
        const def = getProviderDefinition(this.resolveProviderKey(dto.provider));
        const connection = await this.db.externalSyncConnection.findUnique({
            where: { tenant_id_provider: { tenant_id: tenantId, provider: def.provider } },
        });
        if (!connection) throw new NotFoundException(`No ${def.label} connection configured for this tenant`);

        if (trigger === 'MANUAL' && !dto.snapshotId) {
            throw new BadRequestException('Manual imports run from a snapshot. Extract or upload one first.');
        }

        await this.snapshots.assertNoInFlight(connection.id);

        let from: Date;
        let to: Date;
        let snapshotId: string | null = null;

        if (trigger === 'MANUAL' && dto.snapshotId) {
            const snapshot = await this.db.externalSyncSnapshot.findFirst({
                where: {
                    id: dto.snapshotId,
                    tenant_id: tenantId,
                    connection_id: connection.id,
                    status: 'READY',
                },
            });
            if (!snapshot) {
                throw new BadRequestException('Snapshot is not READY or was not found for this connection');
            }
            from = snapshot.window_from;
            to = snapshot.window_to;
            snapshotId = snapshot.id;
        } else {
            ({ from, to } = resolveSyncWindow(connection, dto));
        }

        const steps = this.resolveSteps(dto.steps);

        const run = await this.db.externalSyncRun.create({
            data: {
                tenant_id: tenantId,
                connection_id: connection.id,
                trigger,
                status: 'RUNNING',
                phase: 'Starting',
                steps: steps as any,
                window_from: from,
                window_to: to,
                dry_run: dto.dryRun ?? false,
                triggered_by: userId ?? null,
                snapshot_id: snapshotId,
            },
        });

        // Intentionally not awaited — the run row is the progress channel.
        void this.executeRun(run.id, connection.id, { from, to }, dto.dryRun ?? false, steps, snapshotId).catch(
            (error) => {
                this.logger.error(`External sync run ${run.id} crashed: ${error?.message ?? error}`, error?.stack);
            },
        );

        return run;
    }

    /** Defaults to the whole import; rejects anything not a known step. */
    private resolveSteps(requested?: string[]): SyncStep[] {
        if (!requested?.length) return [...SYNC_STEPS];

        const unknown = requested.filter((step) => !SYNC_STEPS.includes(step as SyncStep));
        if (unknown.length) {
            throw new BadRequestException(`Unknown import step(s): ${unknown.join(', ')}`);
        }
        // Keep canonical order regardless of how they were listed — returns
        // must still run after sales.
        return SYNC_STEPS.filter((step) => requested.includes(step));
    }

    // ------------------------------------------------------------- execution

    async executeRun(
        runId: string,
        connectionId: string,
        window: { from: Date; to: Date },
        dryRun: boolean,
        steps: SyncStep[],
        snapshotId: string | null = null,
    ) {
        const stats: SyncStats = {
            products: emptyTally(),
            customers: emptyTally(),
            suppliers: emptyTally(),
            sales: emptyTally(),
            purchases: emptyTally(),
            customerPayments: emptyTally(),
            supplierPayments: emptyTally(),
            saleReturns: emptyTally(),
            quotations: emptyTally(),
            purchaseReturns: emptyTally(),
        };
        const warnings: SyncWarning[] = [];

        const connection = await this.db.externalSyncConnection.findUnique({ where: { id: connectionId } });
        if (!connection) return;

        await this.db.externalSyncConnection.update({
            where: { id: connectionId },
            data: { last_run_at: new Date() },
        });

        try {
            const def = getProviderDefinition(connection.provider);
            const mappers = def.mappers;
            const client = await clientForRun({
                snapshotId,
                tenantId: connection.tenant_id,
                connection,
                decrypt: (cipher) => this.encryption.decrypt(cipher),
                createLiveClient: (creds) => def.createClient(creds),
            });
            const session = await client.login();

            // A snapshot holds the provider's current balances and stock beside
            // every document it covers, so a provider with no opening figures
            // of its own (Dizi) can have them worked out from it.
            const openings: OpeningPositions | null =
                client instanceof SnapshotClient && mappers.openingPositions
                    ? mappers.openingPositions(client.getDocument())
                    : null;

            // A provider may offer no quotations, and a step that can do
            // nothing should not count toward progress.
            const supportsQuotations = Boolean(client.fetchQuotationDocuments && mappers.quotation);
            if (!supportsQuotations) steps = steps.filter((step) => step !== 'QUOTATIONS');
            const supportsPurchaseReturns = Boolean(client.fetchPurchaseReturnDocuments && mappers.purchaseReturn);
            if (!supportsPurchaseReturns) steps = steps.filter((step) => step !== 'PURCHASE_RETURNS');

            // Guard against a mis-typed credential pointing at another
            // company's data landing in this tenant.
            if (connection.external_org_id && connection.external_org_id !== session.organizationId) {
                throw new ConflictException(
                    `Provider organization changed (expected ${connection.external_org_id}, got ${session.organizationId}). ` +
                        'Refusing to import — reset the connection if this is intentional.',
                );
            }
            if (!connection.external_org_id) {
                await this.db.externalSyncConnection.update({
                    where: { id: connectionId },
                    data: { external_org_id: session.organizationId },
                });
            }

            const chunks = snapshotId
                ? [{ from: toDateString(window.from), to: toDateString(window.to) }]
                : def.planWindows(window.from, window.to);
            const windowedSteps = steps.filter((step) => step !== 'MASTERS');
            // One unit of work per master step plus one per chunk of each
            // windowed step, so the progress fraction means something.
            const totalUnits = (steps.includes('MASTERS') ? 1 : 0) + windowedSteps.length * chunks.length;
            let doneUnits = 0;

            const tick = async (phase: string) => {
                doneUnits += PROGRESS_EVERY_CHUNK;
                await this.writeProgress(runId, phase, stats, warnings, doneUnits, totalUnits);
            };

            if (steps.includes('MASTERS')) {
                await this.writeProgress(runId, 'Products, customers and suppliers', stats, warnings, doneUnits, totalUnits);
                // Opening balances and stock are stamped at the start of the
                // imported range so they sit before every document that follows.
                await this.syncProducts(connection, client, stats, warnings, dryRun, mappers, openings?.stock, window.from);
                await this.syncCustomers(connection, client, stats, warnings, dryRun, window.from, mappers, openings?.customers);
                await this.syncSuppliers(connection, client, stats, warnings, dryRun, window.from, mappers, openings?.suppliers);
                await tick('Products, customers and suppliers');
            }

            // Cross-references come from the mapping table, not from this run,
            // so a step works whether or not MASTERS ran alongside it.
            const productMap = await this.loadMappings(connection.id, 'PRODUCT');
            const customerMap = await this.loadMappings(connection.id, 'CUSTOMER');
            const supplierMap = await this.loadMappings(connection.id, 'SUPPLIER');

            for (const chunk of chunks) {
                const label = `${chunk.from.slice(0, 7)}`;

                // Purchases before sales, every chunk: a replay starts from no
                // stock, so selling a product before its receipt is imported
                // would leave the sale short. (Posting made that fatal — the
                // document was dropped while its payments still landed.)
                if (steps.includes('PURCHASES')) {
                    await this.assertNotCancelled(runId);
                    await this.syncPurchasesWindow(connection, client, chunk, productMap, supplierMap, stats, warnings, dryRun, mappers, window.from);
                    await tick(`Purchases ${label}`);
                }
                if (steps.includes('SALES')) {
                    await this.assertNotCancelled(runId);
                    await this.syncSalesWindow(connection, client, chunk, productMap, customerMap, stats, warnings, dryRun, mappers, window.from);
                    await tick(`Sales ${label}`);
                }
                if (steps.includes('QUOTATIONS')) {
                    await this.assertNotCancelled(runId);
                    await this.syncQuotationsWindow(connection, client, chunk, productMap, customerMap, stats, warnings, dryRun, mappers, window.from);
                    await tick(`Quotations ${label}`);
                }
                if (steps.includes('CUSTOMER_PAYMENTS')) {
                    await this.assertNotCancelled(runId);
                    await this.syncPaymentsWindow(connection, client, chunk, 'CUSTOMER', customerMap, stats, warnings, dryRun, mappers, window.from);
                    await tick(`Customer payments ${label}`);
                }
                if (steps.includes('SUPPLIER_PAYMENTS')) {
                    await this.assertNotCancelled(runId);
                    await this.syncPaymentsWindow(connection, client, chunk, 'SUPPLIER', supplierMap, stats, warnings, dryRun, mappers, window.from);
                    await tick(`Supplier payments ${label}`);
                }
            }

            // Returns run only once every sale in the range exists, because a
            // return's parent is usually months older than the return itself
            // and may live in an earlier chunk of this same run.
            if (steps.includes('SALE_RETURNS')) {
                const saleMap = await this.loadMappings(connection.id, 'SALE');
                for (const chunk of chunks) {
                    await this.assertNotCancelled(runId);
                    await this.syncSaleReturnsWindow(connection, client, chunk, productMap, saleMap, customerMap, stats, warnings, dryRun, mappers);
                    await tick(`Sale returns ${chunk.from.slice(0, 7)}`);
                }
            }

            if (steps.includes('PURCHASE_RETURNS')) {
                const purchaseMap = await this.loadMappings(connection.id, 'PURCHASE');
                for (const chunk of chunks) {
                    await this.assertNotCancelled(runId);
                    await this.syncPurchaseReturnsWindow(connection, client, chunk, productMap, purchaseMap, supplierMap, stats, warnings, dryRun, mappers, window.from);
                    await tick(`Purchase returns ${chunk.from.slice(0, 7)}`);
                }
            }

            const status = warnings.length > 0 ? 'PARTIAL' : 'SUCCESS';
            await this.db.externalSyncRun.update({
                where: { id: runId },
                data: {
                    status,
                    phase: null,
                    progress: { done: totalUnits, total: totalUnits, warnings: warnings.length, codes: countWarningCodes(warnings) } as any,
                    stats: stats as any,
                    warnings: capWarnings(warnings) as any,
                    finished_at: new Date(),
                },
            });
            if (!dryRun) {
                await this.db.externalSyncConnection.update({
                    where: { id: connectionId },
                    data: { last_success_at: new Date() },
                });
            }
        } catch (error: any) {
            const cancelled = error instanceof RunCancelledError;
            await this.db.externalSyncRun.update({
                where: { id: runId },
                data: {
                    status: cancelled ? 'CANCELLED' : 'FAILED',
                    phase: null,
                    // Whatever completed before the stop is real and worth
                    // keeping — the mapping table already holds those rows.
                    stats: stats as any,
                    warnings: capWarnings(warnings) as any,
                    ...(cancelled ? {} : { error_message: String(error?.message ?? error).slice(0, 2000) }),
                    finished_at: new Date(),
                },
            });
        }
    }

    /**
     * Rewrites the run row mid-flight. The admin page polls this row, so
     * without it a multi-minute import shows nothing until it ends — and a
     * crash would take its counters with it.
     */
    private async writeProgress(
        runId: string,
        phase: string,
        stats: SyncStats,
        warnings: SyncWarning[],
        done: number,
        total: number,
    ) {
        await this.db.externalSyncRun.update({
            where: { id: runId },
            data: {
                phase,
                progress: { done, total, warnings: warnings.length, codes: countWarningCodes(warnings) } as any,
                stats: stats as any,
                warnings: capWarnings(warnings) as any,
            },
        });
    }

    /** Checked between chunks so a long run can be stopped without a restart. */
    private async assertNotCancelled(runId: string) {
        const run = await this.db.externalSyncRun.findUnique({
            where: { id: runId },
            select: { cancel_requested: true },
        });
        if (run?.cancel_requested) throw new RunCancelledError();
    }

    async cancelRun(tenantId: string, runId: string) {
        const run = await this.db.externalSyncRun.findFirst({
            where: { id: runId, tenant_id: tenantId },
            select: { id: true, status: true },
        });
        if (!run) throw new NotFoundException('Run not found');
        if (run.status !== 'RUNNING') {
            throw new BadRequestException(`Run is already ${run.status.toLowerCase()}`);
        }

        await this.db.externalSyncRun.update({
            where: { id: runId },
            data: { cancel_requested: true },
        });
        return { cancelling: true };
    }

    // --------------------------------------------------------- master data

    private async syncProducts(
        connection: { id: string; tenant_id: string; store_id: string; provider: string; post_impacts: boolean },
        client: ProviderClient,
        stats: SyncStats,
        warnings: SyncWarning[],
        dryRun: boolean,
        mappers: ProviderMappers = EXPRESS_MAPPERS,
        stockOpenings?: Map<string, number>,
        openingAsOf?: Date,
    ): Promise<Map<string, string>> {
        const rows = await client.fetchProducts();
        const claimedSkus = new Set<string>();
        const map = await this.loadMappings(connection.id, 'PRODUCT');
        const costCandidates: OpeningCostCandidate[] = [];
        const buyingRates = new Map<string, number>();

        for (const row of rows) {
            const mapped = mappers.product(row, claimedSkus);
            buyingRates.set(mapped.externalId, mapped.purchaseRate);
            const productLabel = mapped.sku ?? mapped.name;
            const noteCost = (productId: string) => {
                if (!mapped.isService && mapped.purchaseRate > 0) {
                    costCandidates.push({ productId, rate: mapped.purchaseRate, label: productLabel, externalId: mapped.externalId });
                }
            };
            // One unimportable row must not abandon the rest of the batch;
            // the document loops already behave this way.
            try {
                const existingId = map.get(mapped.externalId);

                if (dryRun) {
                    existingId ? stats.products.updated++ : stats.products.created++;
                    continue;
                }

                if (existingId) {
                    // updateMany, not update: it returns a count instead of
                    // throwing when the mapped row has since been deleted, and it
                    // scopes the write to this tenant.
                    const { count } = await this.db.product.updateMany({
                        where: { id: existingId, tenant_id: connection.tenant_id },
                        data: { name: mapped.name, price: mapped.price, vat_rate: mapped.vatRate, reorder_level: mapped.reorderLevel },
                    });
                    if (count > 0) {
                        stats.products.updated++;
                        noteCost(existingId);
                        continue;
                    }
                    await this.forgetStaleMapping(connection.id, 'PRODUCT', mapped.externalId, map, warnings, `Product ${productLabel}`);
                }

                // Adopt a product the tenant already has under the same SKU rather
                // than colliding with the [tenant_id, sku] unique index.
                const productWhere = productAdoptionWhere(connection.tenant_id, mapped.sku);
                const adopted = productWhere
                    ? await this.db.product.findFirst({ where: productWhere, select: { id: true } })
                    : null;

                // The provider's SKU when it has a readable one no other product
                // holds; else the next in the tenant's PRD- series.
                const productId =
                    adopted?.id ??
                    (
                        await codeForNewRecord(this.db, 'Product', connection.tenant_id, mapped.sku, (sku) =>
                            this.db.product.create({
                                data: {
                                    tenant_id: connection.tenant_id,
                                    name: mapped.name,
                                    sku,
                                    type: mapped.isService ? 'SERVICE' : 'GOODS',
                                    price: mapped.price,
                                    vat_rate: mapped.vatRate,
                                    reorder_level: mapped.reorderLevel,
                                },
                                select: { id: true },
                            }),
                        )
                    ).id;

                if (adopted) {
                    warnings.push({
                        entity: 'PRODUCT',
                        externalId: mapped.externalId,
                        code: 'ADOPTED_EXISTING',
                        message: `Linked provider product ${productLabel} to the tenant's existing product with the same SKU instead of creating a duplicate`,
                    });
                    stats.products.skipped++;
                } else {
                    stats.products.created++;
                }

                await this.writeMapping(connection, 'PRODUCT', mapped.externalId, productId, mapped.externalUpdatedAt);
                map.set(mapped.externalId, productId);
                noteCost(productId);
            } catch (error: any) {
                stats.products.skipped++;
                warnings.push({
                    entity: 'PRODUCT',
                    externalId: mapped.externalId,
                    code: 'WRITE_FAILED',
                    message: `Product ${productLabel} could not be imported: ${describeWriteError(error)}`,
                    skipped: { number: productLabel, date: null, party: null, amount: mapped.price, lines: null, error: describeWriteError(error) },
                });
            }
        }

        if (!dryRun) {
            await this.seedOpeningCosts(connection.tenant_id, costCandidates, warnings);
        }
        if (!dryRun && stockOpenings && openingAsOf && connection.post_impacts) {
            await this.seedOpeningStock(connection, stockOpenings, map, buyingRates, warnings, openingAsOf);
        }

        return map;
    }

    /**
     * Each product's opening stock (see OpeningPositions), as a backdated
     * movement into the branch's warehouse.
     *
     * Only for a product with nothing in that warehouse from before the range
     * and no opening from this connection yet. That is every product on a
     * first import or after the branch was cleared, and a product whose
     * history the range covers whole, so a run from a newer snapshot never
     * adds a second opening or counts history the warehouse already holds.
     */
    private async seedOpeningStock(
        connection: { id: string; tenant_id: string; store_id: string; provider: string },
        openings: Map<string, number>,
        productMap: Map<string, string>,
        buyingRates: Map<string, number>,
        warnings: SyncWarning[],
        asOf: Date,
    ) {
        const warehouseId = await resolveWarehouseId(this.db, connection.tenant_id, connection.store_id);
        const tally = { products: 0, units: 0, negative: 0, kept: 0 };

        for (const [externalId, quantity] of openings) {
            const productId = productMap.get(externalId);
            if (!productId) continue;
            try {
                const blocked = await this.db.inventoryMovement.findFirst({
                    where: {
                        tenant_id: connection.tenant_id,
                        product_id: productId,
                        warehouse_id: warehouseId,
                        OR: [
                            { reference_type: OPENING_STOCK_REFERENCE, reference_id: connection.id },
                            { created_at: { lt: asOf } },
                        ],
                    },
                    select: { id: true },
                });
                if (blocked) {
                    tally.kept++;
                    continue;
                }
                await this.db.$transaction((tx) =>
                    applyOpeningStock({
                        tx,
                        tenantId: connection.tenant_id,
                        storeId: connection.store_id,
                        connectionId: connection.id,
                        productId,
                        quantity,
                        unitCost: buyingRates.get(externalId) ?? 0,
                        asOf,
                        label: connection.provider,
                    }),
                );
                tally.products++;
                tally.units += quantity;
                if (quantity < 0) tally.negative++;
            } catch (error: any) {
                warnings.push({
                    entity: 'PRODUCT',
                    externalId,
                    code: 'OPENING_STOCK_FAILED',
                    message: `Opening stock of ${quantity} for provider product ${externalId} could not be recorded: ${describeWriteError(error)}`,
                });
            }
        }

        if (tally.products > 0) {
            warnings.push({
                entity: 'PRODUCT',
                externalId: '',
                code: 'OPENING_FROM_PROVIDER',
                message:
                    `${tally.products} product${tally.products === 1 ? '' : 's'} start with opening stock (${tally.units} units in all): ` +
                    `what ${connection.provider} holds beyond the movements of the documents imported` +
                    (tally.negative > 0 ? `. ${tally.negative} of them open below zero, mostly goods returned to suppliers that the import cannot read yet` : ''),
            });
        }
    }

    /**
     * Give each imported product with no cost on file the provider's buying
     * rate as its opening cost.
     *
     * The rate came with every product row and used to be dropped, so stock
     * brought over from another system arrived with no cost basis at all:
     * imported purchases replay as quantity-only `PURCHASE` movements, which by
     * design never revalue the pool, so nothing else would ever cost them. Every
     * sale of such a product then booked no COGS.
     *
     * Only ever fills a gap. A product with a pool or a price-list cost keeps
     * it — a real average from bills entered here outranks the other system's
     * figure — so re-running the sync is safe, and it is also how a tenant who
     * imported before this existed gets their costs: the next product sync fills
     * every product that is still uncosted. One transaction per product, so one
     * refusal costs that product its opening cost and nothing else.
     */
    private async seedOpeningCosts(tenantId: string, candidates: OpeningCostCandidate[], warnings: SyncWarning[]) {
        if (candidates.length === 0) return;

        const ids = [...new Set(candidates.map((candidate) => candidate.productId))];
        const [pools, priced] = await Promise.all([
            this.db.productCost.findMany({
                where: { tenant_id: tenantId, product_id: { in: ids } },
                select: { product_id: true },
            }),
            this.db.productPrice.findMany({
                where: { tenant_id: tenantId, product_id: { in: ids }, cost: { not: null } },
                select: { product_id: true },
            }),
        ]);
        const hasBasis = new Set([...pools, ...priced].map((row) => row.product_id));

        for (const candidate of candidates) {
            // Also skips a second provider row adopted onto the same product.
            if (hasBasis.has(candidate.productId)) continue;
            hasBasis.add(candidate.productId);
            try {
                await this.db.$transaction((tx) =>
                    recordCostAdjustment(tx, {
                        tenantId,
                        productId: candidate.productId,
                        newCost: candidate.rate,
                        note: 'Buying rate from the imported product list',
                    }),
                );
            } catch (error: any) {
                warnings.push({
                    entity: 'PRODUCT',
                    externalId: candidate.externalId,
                    code: 'COST_NOT_SET',
                    message: `Product ${candidate.label} has no cost on file, and its buying rate ${candidate.rate} could not be set as one: ${error?.message ?? error}`,
                });
            }
        }
    }

    private async syncCustomers(
        connection: { id: string; tenant_id: string; store_id: string; provider: string; post_impacts: boolean },
        client: ProviderClient,
        stats: SyncStats,
        warnings: SyncWarning[],
        dryRun: boolean,
        openingAsOf: Date,
        mappers: ProviderMappers = EXPRESS_MAPPERS,
        openings?: Map<string, number>,
    ): Promise<Map<string, string>> {
        const rows = await client.fetchCustomers();
        const claimedCodes = new Set<string>();
        const map = await this.loadMappings(connection.id, 'CUSTOMER');
        const opened = { parties: 0, amount: 0 };

        for (const row of rows) {
            const mapped = mappers.customer(row, claimedCodes);
            // A provider with no opening figure of its own gets the one worked
            // out from the snapshot.
            if (openings) mapped.previousDue = openings.get(mapped.externalId) ?? 0;
            const customerLabel = mapped.customerCode ?? mapped.name;
            // One unimportable row must not abandon the rest of the batch;
            // the document loops already behave this way.
            try {
                const existingId = map.get(mapped.externalId);

                if (dryRun) {
                    existingId ? stats.customers.updated++ : stats.customers.created++;
                    continue;
                }

                if (existingId) {
                    const { count } = await this.db.customer.updateMany({
                        where: { id: existingId, tenant_id: connection.tenant_id },
                        data: {
                            name: mapped.name,
                            owner_name: mapped.ownerName,
                            email: mapped.email,
                            address: mapped.address,
                            credit_limit: mapped.creditLimit,
                        },
                    });
                    if (count > 0) {
                        stats.customers.updated++;
                        if (await this.openExistingParty(connection, 'CUSTOMER', existingId, mapped.previousDue, openingAsOf)) {
                            opened.parties++;
                            opened.amount += mapped.previousDue;
                        }
                        continue;
                    }
                    await this.forgetStaleMapping(connection.id, 'CUSTOMER', mapped.externalId, map, warnings, `Customer ${customerLabel}`);
                }

                const { id: customerId, adopted } = await this.createOrAdoptCustomer(connection, mapped, openingAsOf);

                if (adopted) {
                    warnings.push({
                        entity: 'CUSTOMER',
                        externalId: mapped.externalId,
                        code: 'ADOPTED_EXISTING',
                        message: `Linked provider customer ${customerLabel} to an existing tenant customer with the same phone or code`,
                    });
                    stats.customers.skipped++;
                } else {
                    stats.customers.created++;
                    if (connection.post_impacts && mapped.previousDue !== 0) {
                        opened.parties++;
                        opened.amount += mapped.previousDue;
                    }
                }

                await this.writeMapping(connection, 'CUSTOMER', mapped.externalId, customerId, mapped.externalUpdatedAt);
                map.set(mapped.externalId, customerId);
            } catch (error: any) {
                stats.customers.skipped++;
                warnings.push({
                    entity: 'CUSTOMER',
                    externalId: mapped.externalId,
                    code: 'WRITE_FAILED',
                    message: `Customer ${customerLabel} could not be imported: ${describeWriteError(error)}`,
                    skipped: { number: mapped.customerCode, date: null, party: mapped.name, amount: null, lines: null, error: describeWriteError(error) },
                });
            }
        }

        this.noteOpenings(warnings, 'CUSTOMER', connection.provider, opened);
        return map;
    }

    private async syncSuppliers(
        connection: { id: string; tenant_id: string; store_id: string; provider: string; post_impacts: boolean },
        client: ProviderClient,
        stats: SyncStats,
        warnings: SyncWarning[],
        dryRun: boolean,
        openingAsOf: Date,
        mappers: ProviderMappers = EXPRESS_MAPPERS,
        openings?: Map<string, number>,
    ): Promise<Map<string, string>> {
        const rows = await client.fetchSuppliers();
        const claimedNames = new Set<string>();
        const claimedCodes = new Set<string>();
        const map = await this.loadMappings(connection.id, 'SUPPLIER');
        const opened = { parties: 0, amount: 0 };

        for (const row of rows) {
            const mapped = mappers.supplier(row, claimedNames, claimedCodes);
            if (openings) mapped.previousDue = openings.get(mapped.externalId) ?? 0;
            // One unimportable row must not abandon the rest of the batch;
            // the document loops already behave this way.
            try {
                const existingId = map.get(mapped.externalId);

                if (dryRun) {
                    existingId ? stats.suppliers.updated++ : stats.suppliers.created++;
                    continue;
                }

                if (existingId) {
                    const { count } = await this.db.supplier.updateMany({
                        where: { id: existingId, tenant_id: connection.tenant_id },
                        data: { phone: mapped.phone, email: mapped.email, address: mapped.address },
                    });
                    if (count > 0) {
                        stats.suppliers.updated++;
                        if (await this.openExistingParty(connection, 'SUPPLIER', existingId, mapped.previousDue, openingAsOf)) {
                            opened.parties++;
                            opened.amount += mapped.previousDue;
                        }
                        continue;
                    }
                    await this.forgetStaleMapping(connection.id, 'SUPPLIER', mapped.externalId, map, warnings, `Supplier ${mapped.name}`);
                }

                const { id: supplierId, adopted } = await this.createOrAdoptSupplier(connection, mapped, openingAsOf);

                if (adopted) {
                    warnings.push({
                        entity: 'SUPPLIER',
                        externalId: mapped.externalId,
                        code: 'ADOPTED_EXISTING',
                        message: `Linked provider supplier "${mapped.name}" to the tenant's existing supplier of the same name`,
                    });
                    stats.suppliers.skipped++;
                } else {
                    stats.suppliers.created++;
                    if (connection.post_impacts && mapped.previousDue !== 0) {
                        opened.parties++;
                        opened.amount += mapped.previousDue;
                    }
                }

                await this.writeMapping(connection, 'SUPPLIER', mapped.externalId, supplierId, mapped.externalUpdatedAt);
                map.set(mapped.externalId, supplierId);
            } catch (error: any) {
                stats.suppliers.skipped++;
                warnings.push({
                    entity: 'SUPPLIER',
                    externalId: mapped.externalId,
                    code: 'WRITE_FAILED',
                    message: `Supplier ${mapped.name} could not be imported: ${describeWriteError(error)}`,
                    skipped: { number: mapped.supplierCode, date: null, party: mapped.name, amount: null, lines: null, error: describeWriteError(error) },
                });
            }
        }

        this.noteOpenings(warnings, 'SUPPLIER', connection.provider, opened);
        return map;
    }

    /**
     * The opening due of a party the tenant already has: Express's
     * `previous_due`, or one worked out from a snapshot (see OpeningPositions).
     * A re-import used to write it only for a party it created, so a party
     * kept through a clear lost theirs for good.
     *
     * Only when the party has no opening from this provider yet, nothing on
     * their account from before the range, and no balance typed in by hand:
     * then the range covers their whole history and the opening is exactly
     * what it leaves out. A run from a newer, shorter snapshot finds earlier
     * rows and leaves them alone, and a party set up here with their balance
     * keeps it, as one adopted on creation always has.
     */
    private async openExistingParty(
        connection: { tenant_id: string; provider: string; post_impacts: boolean },
        party: PaymentParty,
        partyId: string,
        amount: number,
        asOf: Date,
    ): Promise<boolean> {
        if (!connection.post_impacts || Math.abs(amount) < 0.005) return false;

        const isCustomer = party === 'CUSTOMER';
        const where = {
            tenant_id: connection.tenant_id,
            OR: [
                { notes: openingBalanceNote(connection.provider) },
                { created_at: { lt: asOf } },
                {
                    type: 'ADJUSTMENT',
                    reference_type: null,
                    OR: [{ notes: null }, { NOT: { notes: { startsWith: openingBalanceNote('') } } }],
                },
            ],
        };
        const blocked = isCustomer
            ? await this.db.customerCreditTransaction.findFirst({ where: { ...where, customer_id: partyId }, select: { id: true } })
            : await this.db.supplierCreditTransaction.findFirst({ where: { ...where, supplier_id: partyId }, select: { id: true } });
        if (blocked) return false;

        await this.db.$transaction((tx) =>
            applyOpeningBalance({ tx, tenantId: connection.tenant_id, party, partyId, amount, asOf, label: connection.provider }),
        );
        return true;
    }

    /** One run note for the worked-out opening dues a step recorded. */
    private noteOpenings(
        warnings: SyncWarning[],
        party: PaymentParty,
        provider: string,
        opened: { parties: number; amount: number },
    ) {
        if (opened.parties === 0) return;
        const noun = party === 'CUSTOMER' ? 'customer' : 'supplier';
        warnings.push({
            entity: party,
            externalId: '',
            code: 'OPENING_FROM_PROVIDER',
            message:
                `${opened.parties} ${noun}${opened.parties === 1 ? '' : 's'} start with an opening due from ${provider} (net ${Math.round(opened.amount * 100) / 100})`,
        });
    }

    /**
     * A new customer for a provider row, or the tenant's existing one with the
     * same phone or code. Shared by the customer list and by documents naming
     * a customer the list leaves out.
     */
    private async createOrAdoptCustomer(
        connection: { tenant_id: string; store_id: string; provider: string; post_impacts: boolean },
        mapped: MappedCustomer,
        openingAsOf: Date,
    ): Promise<{ id: string; adopted: boolean }> {
        // Phone is the only identity a customer carries. `customer_code`
        // is generated per provider row, so it used to adopt unrelated
        // parties that happened to collide on it.
        //
        // The raw phone goes to the database, not the normalized one:
        // `Customer.phone` stores exactly what was typed, so a lookup
        // for "+8801712345678" would miss a row saved as "01712345678"
        // and silently create a duplicate. Normalization is for
        // in-memory candidate matching, where both sides get it.
        const customerWhere = customerAdoptionWhere(
            connection.tenant_id,
            mapped.phone,
            mapped.customerCode,
        );
        const adopted = customerWhere
            ? await this.db.customer.findFirst({ where: customerWhere, select: { id: true } })
            : null;

        // The provider's code when it has a readable one no other
        // customer holds; else the next in the tenant's CUST- series.
        const customerId =
            adopted?.id ??
            (
                await codeForNewRecord(this.db, 'Customer', connection.tenant_id, mapped.customerCode, (customerCode) =>
                    this.db.customer.create({
                        data: {
                            tenant_id: connection.tenant_id,
                            // Everything an import brings in belongs to the
                            // import's branch; an adopted customer keeps theirs.
                            store_id: connection.store_id,
                            customer_code: customerCode,
                            name: mapped.name,
                            owner_name: mapped.ownerName,
                            // Only a real number: a phone is unique per tenant,
                            // and two shops that both typed "01" are not one.
                            phone: normalizePhone(mapped.phone) ? mapped.phone : null,
                            email: mapped.email,
                            address: mapped.address,
                            credit_limit: mapped.creditLimit,
                        },
                        select: { id: true },
                    }),
                )
            ).id;

        // Only on a party we created: adopting an existing customer
        // means the tenant already has their balance.
        if (!adopted && connection.post_impacts && mapped.previousDue !== 0) {
            await this.db.$transaction((tx) =>
                applyOpeningBalance({
                    tx,
                    tenantId: connection.tenant_id,
                    party: 'CUSTOMER',
                    partyId: customerId,
                    amount: mapped.previousDue,
                    asOf: openingAsOf,
                    label: connection.provider,
                }),
            );
        }
        return { id: customerId, adopted: Boolean(adopted) };
    }

    /** As {@link createOrAdoptCustomer}, for suppliers: adopted by name. */
    private async createOrAdoptSupplier(
        connection: { tenant_id: string; store_id: string; provider: string; post_impacts: boolean },
        mapped: MappedSupplier,
        openingAsOf: Date,
    ): Promise<{ id: string; adopted: boolean }> {
        const supplierWhere = supplierAdoptionWhere(connection.tenant_id, mapped.name);
        const adopted = supplierWhere
            ? await this.db.supplier.findFirst({ where: supplierWhere, select: { id: true } })
            : null;

        // The provider's code when it has a readable one no other
        // supplier holds; else the next in the tenant's SUP- series.
        const supplierId =
            adopted?.id ??
            (
                await codeForNewRecord(this.db, 'Supplier', connection.tenant_id, mapped.supplierCode, (supplierCode) =>
                    this.db.supplier.create({
                        data: {
                            tenant_id: connection.tenant_id,
                            // The import's branch; an adopted supplier keeps theirs.
                            store_id: connection.store_id,
                            supplier_code: supplierCode,
                            name: mapped.name,
                            phone: mapped.phone,
                            email: mapped.email,
                            address: mapped.address,
                        },
                        select: { id: true },
                    }),
                )
            ).id;

        if (!adopted && connection.post_impacts && mapped.previousDue !== 0) {
            await this.db.$transaction((tx) =>
                applyOpeningBalance({
                    tx,
                    tenantId: connection.tenant_id,
                    party: 'SUPPLIER',
                    partyId: supplierId,
                    amount: mapped.previousDue,
                    asOf: openingAsOf,
                    label: connection.provider,
                }),
            );
        }
        return { id: supplierId, adopted: Boolean(adopted) };
    }

    // ------------------------------------------------------------ documents

    private async syncSalesWindow(
        connection: DocumentConnection,
        client: ProviderClient,
        window: DateWindow,
        productMap: Map<string, string>,
        customerMap: Map<string, string>,
        stats: SyncStats,
        warnings: SyncWarning[],
        dryRun: boolean,
        mappers: ProviderMappers = EXPRESS_MAPPERS,
        openingAsOf?: Date,
    ) {
        const docs = await client.fetchSaleDocuments(window);
        const saleMap = await this.loadMappings(connection.id, 'SALE');

        for (const doc of docs) {
            const mapped = mappers.sale(doc, connection.document_prefix, warnings);
            if (dryRun) {
                saleMap.has(mapped.externalId) ? stats.sales.updated++ : stats.sales.created++;
                continue;
            }

            await this.resolveDocumentParty(connection, 'CUSTOMER', mapped.externalCustomerId, mapped.embeddedCustomer, customerMap, {
                mappers, stats, warnings, openingAsOf, documentLabel: `invoice ${mapped.referenceNumber ?? mapped.serialNumber}`,
            });

            try {
                const created = await this.writeSale(connection, mapped, productMap, customerMap, saleMap, warnings);
                if (created === null) {
                    stats.sales.skipped++;
                } else {
                    created ? stats.sales.created++ : stats.sales.updated++;
                }
            } catch (error: any) {
                stats.sales.skipped++;
                warnings.push({
                    entity: 'SALE',
                    externalId: mapped.externalId,
                    code: 'WRITE_FAILED',
                    message: `Invoice ${mapped.referenceNumber ?? mapped.serialNumber} could not be imported: ${describeWriteError(error)}`,
                    skipped: skippedDocument(mapped.referenceNumber ?? mapped.serialNumber, mapped.saleDate, mapped.externalCustomerId, mapped.embeddedCustomer, mapped.totalAmount, mapped.items.length, error),
                });
            }
        }
    }

    /**
     * Quotations import as history: written with the provider's own number,
     * date and status, and never posted, since a quotation moves neither stock
     * nor money.
     *
     * A provider that refuses quotations costs only the quotations — the run
     * warns and carries on, because nothing downstream depends on them.
     */
    private async syncQuotationsWindow(
        connection: DocumentConnection,
        client: ProviderClient,
        window: DateWindow,
        productMap: Map<string, string>,
        customerMap: Map<string, string>,
        stats: SyncStats,
        warnings: SyncWarning[],
        dryRun: boolean,
        mappers: ProviderMappers,
        openingAsOf?: Date,
    ) {
        if (!client.fetchQuotationDocuments || !mappers.quotation) return;

        let docs: unknown[];
        try {
            docs = await client.fetchQuotationDocuments(window);
        } catch (error: any) {
            warnings.push({
                entity: 'QUOTATION',
                externalId: '',
                code: 'QUOTATIONS_UNAVAILABLE',
                message: `Quotations were not imported — ${error?.message ?? error}. Everything else in this run is unaffected.`,
            });
            return;
        }
        const quotationMap = await this.loadMappings(connection.id, 'QUOTATION');

        for (const doc of docs) {
            const mapped = mappers.quotation(doc, connection.document_prefix, warnings);
            if (dryRun) {
                quotationMap.has(mapped.externalId) ? stats.quotations.updated++ : stats.quotations.created++;
                continue;
            }

            await this.resolveDocumentParty(connection, 'CUSTOMER', mapped.externalCustomerId, mapped.embeddedCustomer, customerMap, {
                mappers, stats, warnings, openingAsOf, documentLabel: `quotation ${mapped.referenceNumber ?? mapped.quoteNumber}`,
            });

            try {
                const created = await this.writeQuotation(connection, mapped, productMap, customerMap, quotationMap, warnings);
                if (created === null) {
                    stats.quotations.skipped++;
                } else {
                    created ? stats.quotations.created++ : stats.quotations.updated++;
                }
            } catch (error: any) {
                stats.quotations.skipped++;
                warnings.push({
                    entity: 'QUOTATION',
                    externalId: mapped.externalId,
                    code: 'WRITE_FAILED',
                    message: `Quotation ${mapped.referenceNumber ?? mapped.quoteNumber} could not be imported: ${describeWriteError(error)}`,
                    skipped: skippedDocument(mapped.referenceNumber ?? mapped.quoteNumber, mapped.quoteDate, mapped.externalCustomerId, mapped.embeddedCustomer, mapped.totalAmount, mapped.items.length, error),
                });
            }
        }
    }

    /** Returns null when the quotation was left as the tenant has it. */
    private async writeQuotation(
        connection: { id: string; tenant_id: string; store_id: string },
        mapped: MappedQuotation,
        productMap: Map<string, string>,
        customerMap: Map<string, string>,
        quotationMap: Map<string, string>,
        warnings: SyncWarning[],
    ): Promise<boolean | null> {
        const customerId = mapped.externalCustomerId ? customerMap.get(mapped.externalCustomerId) ?? null : null;
        if (mapped.externalCustomerId && !customerId) {
            warnings.push({
                entity: 'QUOTATION',
                externalId: mapped.externalId,
                code: 'CUSTOMER_UNRESOLVED',
                message: `Quotation ${mapped.quoteNumber} references provider customer ${mapped.externalCustomerId}, which is not in the customer list — imported without a customer`,
            });
        }

        const items = this.resolveDocumentItems(
            mapped.items,
            productMap,
            warnings,
            'QUOTATION',
            mapped.externalId,
            mapped.quoteNumber,
        ).map((item) => ({
            product_id: item.productId,
            quantity: item.source.quantity,
            unit_price: item.source.unitPrice,
        }));

        const header = {
            customer_id: customerId,
            total_amount: mapped.totalAmount,
            status: mapped.status,
            valid_until: mapped.validUntil,
            notes: mapped.notes,
        };

        const existingId = quotationMap.get(mapped.externalId);

        if (existingId) {
            const current = await this.db.quotation.findFirst({
                where: { id: existingId, tenant_id: connection.tenant_id },
                select: { status: true },
            });
            if (!current) {
                await this.forgetStaleMapping(connection.id, 'QUOTATION', mapped.externalId, quotationMap, warnings, `Quotation ${mapped.quoteNumber}`);
                return this.writeQuotation(connection, mapped, productMap, customerMap, quotationMap, warnings);
            }

            // The same rule the quotation screen applies: once converted or
            // revised here, the tenant's version is the one that counts.
            if (current.status === 'CONVERTED' || current.status === 'REVISED') {
                if (current.status !== mapped.status) {
                    warnings.push({
                        entity: 'QUOTATION',
                        externalId: mapped.externalId,
                        code: 'QUOTATION_LOCKED',
                        message: `Quotation ${mapped.quoteNumber} is ${current.status.toLowerCase()} here — upstream changes were not applied`,
                    });
                }
                return null;
            }

            await this.db.$transaction(async (tx) => {
                await tx.quotation.update({ where: { id: existingId }, data: header });
                await tx.quotationItem.deleteMany({ where: { quotation_id: existingId } });
                if (items.length > 0) {
                    await tx.quotationItem.createMany({
                        data: items.map((item) => ({ ...item, quotation_id: existingId })),
                    });
                }
            });
            return false;
        }

        const quoteNumber = await this.claimDocumentNumber(
            mapped.quoteNumber,
            (candidate) => this.isTaken(this.db.quotation, { tenant_id: connection.tenant_id, quote_number: candidate }),
            'QUOTATION',
            mapped.externalId,
            warnings,
        );
        const created = await this.db.quotation.create({
            data: {
                tenant_id: connection.tenant_id,
                store_id: connection.store_id,
                quote_number: quoteNumber,
                created_at: mapped.quoteDate,
                ...header,
                items: { create: items },
            },
            select: { id: true },
        });

        await this.writeMapping(connection, 'QUOTATION', mapped.externalId, created.id, mapped.externalUpdatedAt);
        quotationMap.set(mapped.externalId, created.id);
        return true;
    }

    /**
     * Sale returns, which unlike sales carry their line items inline.
     *
     * A return is meaningless without its parent: `SalesReturn.sale_id` is
     * required and each line points at a specific `SaleItem`, not just a
     * product. Both have to resolve or the return is skipped whole — a return
     * whose header total no longer matches its lines would misstate refunds
     * more quietly than a skip does.
     *
     * Parents routinely fall outside the window (returns here run 1–3 months
     * behind their sale), so on a rolling window some returns will always skip
     * until a full-history resync has imported their sale.
     */
    private async syncSaleReturnsWindow(
        connection: { id: string; tenant_id: string; store_id: string; document_prefix: string; post_impacts: boolean },
        client: ProviderClient,
        window: DateWindow,
        productMap: Map<string, string>,
        saleMap: Map<string, string>,
        customerMap: Map<string, string>,
        stats: SyncStats,
        warnings: SyncWarning[],
        dryRun: boolean,
        mappers: ProviderMappers = EXPRESS_MAPPERS,
    ) {
        const docs = await client.fetchSaleReturnDocuments(window);
        const returnMap = await this.loadMappings(connection.id, 'SALE_RETURN');

        for (const doc of docs) {
            const mapped = mappers.saleReturn(doc, connection.document_prefix, warnings);

            // A missing parent no longer costs us the return: SalesReturn.sale_id
            // is optional, so it imports standalone and still restocks and
            // refunds. Recorded as a warning because a return that cannot be
            // tied back to its sale is worth an operator's eye.
            const saleId = mapped.externalSaleId ? saleMap.get(mapped.externalSaleId) ?? null : null;
            if (!saleId) {
                warnings.push({
                    entity: 'SALE_RETURN',
                    externalId: mapped.externalId,
                    code: 'PARENT_SALE_UNRESOLVED',
                    message:
                        `Return ${mapped.referenceNumber ?? mapped.returnNumber} belongs to sale ${mapped.externalSaleId ?? '(none)'}, which is not in the ` +
                        'imported range — imported without a linked sale',
                });
            }

            if (dryRun) {
                returnMap.has(mapped.externalId) ? stats.saleReturns.updated++ : stats.saleReturns.created++;
                continue;
            }

            try {
                // A credited return lands on its sale's customer, or failing
                // that on the customer the provider files it under.
                const customerId = mapped.dueCredit
                    ? (saleId
                          ? (await this.db.sale.findUnique({ where: { id: saleId }, select: { customer_id: true } }))?.customer_id
                          : null) ?? (mapped.externalCustomerId ? customerMap.get(mapped.externalCustomerId) ?? null : null)
                    : null;
                const created = await this.writeSaleReturn(connection, mapped, saleId, customerId, productMap, returnMap, warnings);
                if (created === null) {
                    stats.saleReturns.skipped++;
                } else {
                    created ? stats.saleReturns.created++ : stats.saleReturns.updated++;
                }
            } catch (error: any) {
                stats.saleReturns.skipped++;
                warnings.push({
                    entity: 'SALE_RETURN',
                    externalId: mapped.externalId,
                    code: 'WRITE_FAILED',
                    message: `Return ${mapped.referenceNumber ?? mapped.returnNumber} could not be imported: ${describeWriteError(error)}`,
                    skipped: skippedDocument(mapped.referenceNumber ?? mapped.returnNumber, mapped.returnDate, null, null, mapped.totalRefund, mapped.items.length, error),
                });
            }
        }
    }

    /**
     * Goods sent back to a supplier. Like sale returns these run after every
     * chunk, since a return's purchase may be months older. A return whose
     * purchase was not imported still comes across, unlinked, as one entered
     * by hand without a purchase would.
     */
    private async syncPurchaseReturnsWindow(
        connection: DocumentConnection,
        client: ProviderClient,
        window: DateWindow,
        productMap: Map<string, string>,
        purchaseMap: Map<string, string>,
        supplierMap: Map<string, string>,
        stats: SyncStats,
        warnings: SyncWarning[],
        dryRun: boolean,
        mappers: ProviderMappers,
        openingAsOf?: Date,
    ) {
        if (!client.fetchPurchaseReturnDocuments || !mappers.purchaseReturn) return;
        const docs = await client.fetchPurchaseReturnDocuments(window);
        const returnMap = await this.loadMappings(connection.id, 'PURCHASE_RETURN');

        for (const doc of docs) {
            const mapped = mappers.purchaseReturn(doc, connection.document_prefix, warnings);
            if (dryRun) {
                returnMap.has(mapped.externalId) ? stats.purchaseReturns.updated++ : stats.purchaseReturns.created++;
                continue;
            }

            const supplierId = await this.resolveDocumentParty(connection, 'SUPPLIER', mapped.externalSupplierId, mapped.embeddedSupplier, supplierMap, {
                mappers, stats, warnings, openingAsOf, documentLabel: `purchase return ${mapped.referenceNumber ?? mapped.returnNumber}`,
            });
            const purchaseId = mapped.externalPurchaseId ? purchaseMap.get(mapped.externalPurchaseId) ?? null : null;
            if (!purchaseId) {
                warnings.push({
                    entity: 'PURCHASE_RETURN',
                    externalId: mapped.externalId,
                    code: 'PARENT_PURCHASE_UNRESOLVED',
                    message:
                        `Purchase return ${mapped.referenceNumber ?? mapped.returnNumber} belongs to purchase ${mapped.externalPurchaseId ?? '(none)'}, ` +
                        'which has not been imported — imported without a linked purchase',
                });
            }

            try {
                const created = await this.writePurchaseReturn(connection, mapped, purchaseId, supplierId, productMap, returnMap, warnings);
                if (created === null) {
                    stats.purchaseReturns.skipped++;
                } else {
                    created ? stats.purchaseReturns.created++ : stats.purchaseReturns.updated++;
                }
            } catch (error: any) {
                stats.purchaseReturns.skipped++;
                warnings.push({
                    entity: 'PURCHASE_RETURN',
                    externalId: mapped.externalId,
                    code: 'WRITE_FAILED',
                    message: `Purchase return ${mapped.referenceNumber ?? mapped.returnNumber} could not be imported: ${describeWriteError(error)}`,
                    skipped: skippedDocument(mapped.referenceNumber ?? mapped.returnNumber, mapped.returnDate, mapped.externalSupplierId, mapped.embeddedSupplier, mapped.totalAmount, mapped.items.length, error),
                });
            }
        }
    }

    /** Returns null when the return was skipped, or left as it is because it has posted. */
    private async writePurchaseReturn(
        connection: DocumentConnection,
        mapped: MappedPurchaseReturn,
        purchaseId: string | null,
        supplierId: string | null,
        productMap: Map<string, string>,
        returnMap: Map<string, string>,
        warnings: SyncWarning[],
    ): Promise<boolean | null> {
        // Each line names a line of the purchase where there is one, matched on
        // product and consumed once, as sale returns do.
        const purchaseItems = purchaseId
            ? await this.db.purchaseItem.findMany({ where: { purchase_id: purchaseId }, select: { id: true, product_id: true } })
            : [];
        const available = new Map<string, string[]>();
        for (const item of purchaseItems) available.set(item.product_id, [...(available.get(item.product_id) ?? []), item.id]);

        const items: Array<{ purchase_item_id: string | null; product_id: string; quantity: number; unit_cost: number; line_total: number }> = [];
        for (const line of mapped.items) {
            const productId = productMap.get(line.externalProductId);
            if (!productId) {
                warnings.push({
                    entity: 'PURCHASE_RETURN',
                    externalId: mapped.externalId,
                    code: 'RETURN_LINE_UNMATCHED',
                    message:
                        `Purchase return ${mapped.referenceNumber ?? mapped.returnNumber}: provider product ${line.externalProductId} has not been imported ` +
                        '— the whole return was skipped rather than import one whose lines do not add up',
                    skipped: skippedDocument(mapped.referenceNumber ?? mapped.returnNumber, mapped.returnDate, mapped.externalSupplierId, mapped.embeddedSupplier, mapped.totalAmount, mapped.items.length),
                });
                return null;
            }
            items.push({
                purchase_item_id: available.get(productId)?.shift() ?? null,
                product_id: productId,
                quantity: line.quantity,
                unit_cost: line.unitCost,
                line_total: line.lineTotal,
            });
        }

        const header = {
            purchase_id: purchaseId,
            supplier_id: supplierId,
            reference_number: mapped.referenceNumber,
            total_amount: mapped.totalAmount,
            notes: mapped.notes,
        };
        const existingId = returnMap.get(mapped.externalId);

        if (existingId && !(await this.mappedRowExists(this.db.purchaseReturn, connection.tenant_id, existingId))) {
            await this.forgetStaleMapping(connection.id, 'PURCHASE_RETURN', mapped.externalId, returnMap, warnings, `Purchase return ${mapped.returnNumber}`);
            return this.writePurchaseReturn(connection, mapped, purchaseId, supplierId, productMap, returnMap, warnings);
        }

        // A return imported under the old cap gets the rest of its credit; its
        // voucher already carries the whole return.
        const settleCredit = (existingId: string) =>
            connection.post_impacts && supplierId && mapped.dueCredit !== undefined
                ? this.db.$transaction((tx) =>
                      applyPurchaseReturnCredit({
                          tx,
                          tenantId: connection.tenant_id,
                          supplierId,
                          returnId: existingId,
                          returnNumber: mapped.returnNumber,
                          returnDate: mapped.returnDate,
                          dueCredit: mapped.dueCredit!,
                      }),
                  )
                : Promise.resolve(false);

        if (existingId) {
            if (await this.isImmutablyPosted(connection, 'purchase_return', existingId)) {
                if (await settleCredit(existingId)) return false;
                warnings.push({
                    entity: 'PURCHASE_RETURN',
                    externalId: mapped.externalId,
                    code: 'POSTED_IMMUTABLE',
                    message:
                        `Purchase return ${mapped.returnNumber} has already posted to the ledger — upstream changes were not applied. ` +
                        'Rewriting it would leave its voucher and stock movement describing different figures.',
                });
                return null;
            }
            await this.db.$transaction(async (tx) => {
                await tx.purchaseReturn.update({ where: { id: existingId }, data: header });
                await tx.purchaseReturnItem.deleteMany({ where: { return_id: existingId } });
                if (items.length > 0) {
                    await tx.purchaseReturnItem.createMany({ data: items.map((item) => ({ ...item, return_id: existingId })) });
                }
            });
            await settleCredit(existingId);
            return false;
        }

        // Express gives a return its purchase's number, so a purchase returned
        // to twice repeats it.
        const returnNumber = await this.claimDocumentNumber(
            mapped.returnNumber,
            (candidate) => this.isTaken(this.db.purchaseReturn, { tenant_id: connection.tenant_id, return_number: candidate }),
            'PURCHASE_RETURN',
            mapped.externalId,
            warnings,
        );
        const created = await this.db.$transaction(async (tx) => {
            const row = await tx.purchaseReturn.create({
                data: {
                    tenant_id: connection.tenant_id,
                    store_id: connection.store_id,
                    ...header,
                    return_number: returnNumber,
                    status: 'RECORDED',
                    created_at: mapped.returnDate,
                    items: { create: items },
                },
                select: { id: true },
            });

            if (connection.post_impacts) {
                await applyPurchaseReturnImpacts({
                    tx,
                    tenantId: connection.tenant_id,
                    storeId: connection.store_id,
                    returnId: row.id,
                    returnNumber,
                    supplierId,
                    totalAmount: mapped.totalAmount,
                    returnDate: mapped.returnDate,
                    items,
                    dueCredit: mapped.dueCredit,
                });
            }
            return row;
        });

        await this.writeMapping(connection, 'PURCHASE_RETURN', mapped.externalId, created.id, mapped.externalUpdatedAt);
        returnMap.set(mapped.externalId, created.id);
        return true;
    }

    /** Returns null when the return had to be skipped for integrity reasons. */
    private async writeSaleReturn(
        connection: { id: string; tenant_id: string; store_id: string; post_impacts: boolean },
        mapped: MappedSaleReturn,
        saleId: string | null,
        customerId: string | null,
        productMap: Map<string, string>,
        returnMap: Map<string, string>,
        warnings: SyncWarning[],
    ): Promise<boolean | null> {
        // Each return line names a line of the parent sale where there is one,
        // matched on product and drawn down by quantity. Dizi can split what
        // comes back from one sale line over several return lines (6 and then
        // 1 of the same nebulizer), and pairing line to line dropped the whole
        // return when the second found its sale line taken.
        const saleItems = saleId
            ? await this.db.saleItem.findMany({
                  where: { sale_id: saleId },
                  select: { id: true, product_id: true, quantity: true },
              })
            : [];
        const remainingByProduct = new Map<string, Array<{ id: string; left: number }>>();
        for (const item of saleItems) {
            const list = remainingByProduct.get(item.product_id) ?? [];
            list.push({ id: item.id, left: Number(item.quantity) });
            remainingByProduct.set(item.product_id, list);
        }
        // The first line with room for the whole quantity, else the one with most left.
        const takeSaleLine = (productId: string, quantity: number): string | null => {
            const lines = remainingByProduct.get(productId);
            if (!lines?.length) return null;
            const line = lines.find((l) => l.left >= quantity) ?? lines.reduce((a, b) => (b.left > a.left ? b : a));
            line.left -= quantity;
            return line.id;
        };

        const items: Array<{ sale_item_id: string | null; product_id: string; quantity: number; refund_amount: number }> = [];
        for (const line of mapped.items) {
            const productId = productMap.get(line.externalProductId);
            if (!productId) {
                warnings.push({
                    entity: 'SALE_RETURN',
                    externalId: mapped.externalId,
                    code: 'RETURN_LINE_UNMATCHED',
                    message:
                        `Return ${mapped.returnNumber}: provider product ${line.externalProductId} has not been imported ` +
                        '— the whole return was skipped rather than import a refund whose lines do not add up',
                });
                return null;
            }

            const saleItemId = saleId ? takeSaleLine(productId, line.quantity) : null;
            if (saleId && !saleItemId) {
                warnings.push({
                    entity: 'SALE_RETURN',
                    externalId: mapped.externalId,
                    code: 'RETURN_LINE_UNMATCHED',
                    message:
                        `Return ${mapped.returnNumber}: provider product ${line.externalProductId} is not on the parent sale ` +
                        '— the whole return was skipped rather than import a refund whose lines do not add up',
                });
                return null;
            }

            items.push({
                sale_item_id: saleItemId,
                product_id: productId,
                quantity: line.quantity,
                refund_amount: line.refundAmount,
            });
        }

        const header = {
            reference_number: mapped.referenceNumber,
            total_refund: mapped.totalRefund,
            reason: mapped.reason,
        };

        const existingId = returnMap.get(mapped.externalId);

        if (existingId && !(await this.mappedRowExists(this.db.salesReturn, connection.tenant_id, existingId))) {
            await this.forgetStaleMapping(connection.id, 'SALE_RETURN', mapped.externalId, returnMap, warnings, `Return ${mapped.returnNumber}`);
            return this.writeSaleReturn(connection, mapped, saleId, customerId, productMap, returnMap, warnings);
        }

        if (existingId) {
            if (await this.isImmutablyPosted(connection, 'sale_return', existingId)) {
                warnings.push({
                    entity: 'SALE_RETURN',
                    externalId: mapped.externalId,
                    code: 'POSTED_IMMUTABLE',
                    message:
                        `Return ${mapped.returnNumber} has already posted to the ledger — upstream changes were not applied. ` +
                        'Rewriting a posted return would leave its voucher and restock movement describing different figures.',
                });
                return null;
            }

            await this.db.$transaction(async (tx) => {
                await tx.salesReturn.update({ where: { id: existingId }, data: header });
                await tx.salesReturnItem.deleteMany({ where: { return_id: existingId } });
                if (items.length > 0) {
                    await tx.salesReturnItem.createMany({
                        data: items.map((item) => ({ ...item, return_id: existingId })),
                    });
                }
                // A return imported before credits were booked gets its credit
                // now; one that has it is left as it is.
                if (connection.post_impacts && customerId && (mapped.dueCredit ?? 0) > 0.005) {
                    await applySaleReturnCredit({
                        tx,
                        tenantId: connection.tenant_id,
                        storeId: connection.store_id,
                        returnId: existingId,
                        returnNumber: mapped.returnNumber,
                        totalRefund: mapped.totalRefund,
                        returnDate: mapped.returnDate,
                        customerId,
                        dueCredit: mapped.dueCredit!,
                    });
                }
            });
            return false;
        }

        const created = await this.db.$transaction(async (tx) => {
            const row = await tx.salesReturn.create({
                data: {
                    tenant_id: connection.tenant_id,
                    store_id: connection.store_id,
                    sale_id: saleId,
                    return_number: mapped.returnNumber,
                    status: 'COMPLETED',
                    created_at: mapped.returnDate,
                    ...header,
                    items: { create: items },
                },
                select: { id: true },
            });

            if (connection.post_impacts) {
                await applySaleReturnImpacts({
                    tx,
                    tenantId: connection.tenant_id,
                    storeId: connection.store_id,
                    returnId: row.id,
                    returnNumber: mapped.returnNumber,
                    totalRefund: mapped.totalRefund,
                    returnDate: mapped.returnDate,
                    items,
                    customerId,
                    dueCredit: mapped.dueCredit,
                });
            }

            return row;
        });

        await this.writeMapping(connection, 'SALE_RETURN', mapped.externalId, created.id, mapped.externalUpdatedAt);
        returnMap.set(mapped.externalId, created.id);
        return true;
    }

    /**
     * Customer and supplier payments share one path — the two provider
     * endpoints, our two credit-transaction models and the party lookups differ
     * only by which side we are on.
     */
    private async syncPaymentsWindow(
        connection: DocumentConnection,
        client: ProviderClient,
        window: DateWindow,
        party: PaymentParty,
        partyMap: Map<string, string>,
        stats: SyncStats,
        warnings: SyncWarning[],
        dryRun: boolean,
        mappers: ProviderMappers = EXPRESS_MAPPERS,
        openingAsOf?: Date,
    ) {
        const isCustomer = party === 'CUSTOMER';
        const entity: EntityType = isCustomer ? 'CUSTOMER_PAYMENT' : 'SUPPLIER_PAYMENT';
        const tally = isCustomer ? stats.customerPayments : stats.supplierPayments;

        const rows = await client.fetchPayments(window, party);
        const paymentMap = await this.loadMappings(connection.id, entity);

        for (const row of rows) {
            const mapped = mappers.payment(row, party, connection.document_prefix, warnings);
            if (!mapped) {
                tally.skipped++;
                continue;
            }

            // A credit transaction cannot exist without its party, so an
            // unresolved id is a skip rather than a partial write.
            //
            // A dry run writes no masters, so `partyMap` is empty however
            // healthy the data is — every payment would "fail" this lookup and
            // bury the run's real findings under thousands of false skips. A
            // row carrying no party id at all is still unresolvable in any
            // run, so that case keeps its warning.
            const partyId =
                (mapped.externalPartyId ? partyMap.get(mapped.externalPartyId) : undefined) ??
                (dryRun
                    ? undefined
                    : (await this.resolveDocumentParty(connection, party, mapped.externalPartyId, mapped.embeddedParty, partyMap, {
                          mappers, stats, warnings, openingAsOf, documentLabel: `payment ${mapped.referenceNumber ?? mapped.paymentNumber}`,
                      })) ?? undefined);
            const unresolvable = !mapped.externalPartyId || !dryRun;
            if (!partyId && unresolvable) {
                tally.skipped++;
                warnings.push({
                    entity,
                    externalId: mapped.externalId,
                    code: 'PARTY_UNRESOLVED',
                    message: `Payment ${mapped.referenceNumber ?? mapped.paymentNumber} references ${party.toLowerCase()} ${partyLabel(mapped.externalPartyId, mapped.embeddedParty) ?? '(none)'}, which is not in the imported list and could not be created from the payment — skipped`,
                    skipped: skippedDocument(mapped.referenceNumber ?? mapped.paymentNumber, mapped.date, mapped.externalPartyId, mapped.embeddedParty, mapped.amount, null),
                });
                continue;
            }

            if (dryRun) {
                paymentMap.has(mapped.externalId) ? tally.updated++ : tally.created++;
                continue;
            }

            if (!partyId) continue;

            try {
                const created = await this.writePayment(connection, party, mapped, partyId, paymentMap, warnings);
                if (created === null) {
                    tally.skipped++;
                } else {
                    created ? tally.created++ : tally.updated++;
                }
            } catch (error: any) {
                tally.skipped++;
                warnings.push({
                    entity,
                    externalId: mapped.externalId,
                    code: 'WRITE_FAILED',
                    message: `Payment ${mapped.referenceNumber ?? mapped.paymentNumber} could not be imported: ${describeWriteError(error)}`,
                    skipped: skippedDocument(mapped.referenceNumber ?? mapped.paymentNumber, mapped.date, mapped.externalPartyId, mapped.embeddedParty, mapped.amount, null, error),
                });
            }
        }
    }

    private async writePayment(
        connection: { id: string; tenant_id: string; provider: string; post_impacts: boolean },
        party: PaymentParty,
        mapped: MappedPayment,
        partyId: string,
        paymentMap: Map<string, string>,
        warnings: SyncWarning[],
    ): Promise<boolean | null> {
        const isCustomer = party === 'CUSTOMER';
        const entity: EntityType = isCustomer ? 'CUSTOMER_PAYMENT' : 'SUPPLIER_PAYMENT';
        const type = creditTransactionType(party, mapped.direction);

        // `balance_after` is required, but this importer does not maintain
        // due_balance (see the scope limits on the class), so there is no running
        // balance of ours to record. Where the provider tells us the party's due
        // before the payment we carry its own figure forward; otherwise — every
        // supplier row, which has no previous_due — we store 0 rather than invent
        // a number. Either way it is the source system's view, not ours.
        const balanceAfter = mapped.previousDue != null
            ? (type === 'PAYMENT' ? mapped.previousDue - mapped.amount : mapped.previousDue + mapped.amount)
            : 0;

        const data = {
            type,
            amount: mapped.amount,
            balance_after: balanceAfter,
            payment_number: mapped.paymentNumber,
            notes: mapped.note,
            created_at: mapped.date,
        };

        const existingId = paymentMap.get(mapped.externalId);
        const eventType = isCustomer ? 'customer_payment' : 'supplier_payment';
        const creditTable: any = isCustomer ? this.db.customerCreditTransaction : this.db.supplierCreditTransaction;

        if (existingId && !(await this.mappedRowExists(creditTable, connection.tenant_id, existingId))) {
            await this.forgetStaleMapping(connection.id, entity, mapped.externalId, paymentMap, warnings, `Payment ${mapped.paymentNumber}`);
            return this.writePayment(connection, party, mapped, partyId, paymentMap, warnings);
        }

        if (existingId) {
            if (await this.isImmutablyPosted(connection, eventType, existingId)) {
                warnings.push({
                    entity,
                    externalId: mapped.externalId,
                    code: 'POSTED_IMMUTABLE',
                    message:
                        `Payment ${mapped.paymentNumber} has already posted to the ledger — upstream changes were not applied. ` +
                        'Rewriting it would leave the voucher and the party balance describing different figures.',
                });
                return null;
            }

            const table: any = isCustomer ? this.db.customerCreditTransaction : this.db.supplierCreditTransaction;
            await table.update({ where: { id: existingId }, data });
            return false;
        }

        const paymentNumber = await this.claimDocumentNumber(
            mapped.paymentNumber,
            (candidate) => this.isTaken(creditTable, { tenant_id: connection.tenant_id, payment_number: candidate }),
            entity,
            mapped.externalId,
            warnings,
        );
        const created = await this.db.$transaction(async (tx) => {
            // A credit row lives under its party's branch, like every other
            // ledger row since branch-attached parties. The table is `any`
            // (two models, one path), so the compiler cannot say when a
            // required column is missing — this one was, and every imported
            // payment failed on it.
            const storeId = isCustomer ? await customerBranchId(tx, partyId) : await supplierBranchId(tx, partyId);
            const table: any = isCustomer ? tx.customerCreditTransaction : tx.supplierCreditTransaction;
            const row = await table.create({
                data: {
                    ...data,
                    payment_number: paymentNumber,
                    tenant_id: connection.tenant_id,
                    store_id: storeId,
                    ...(isCustomer ? { customer_id: partyId } : { supplier_id: partyId }),
                },
                select: { id: true },
            });

            if (connection.post_impacts) {
                await applyPaymentImpacts({
                    tx,
                    tenantId: connection.tenant_id,
                    party,
                    partyId,
                    storeId,
                    transactionId: row.id,
                    paymentNumber,
                    type,
                    amount: mapped.amount,
                    method: mapped.method ?? 'cash',
                    date: mapped.date,
                });
            }

            return row;
        });

        await this.writeMapping(connection, entity, mapped.externalId, created.id, mapped.externalUpdatedAt);
        paymentMap.set(mapped.externalId, created.id);
        return true;
    }

    private async writeSale(
        connection: { id: string; tenant_id: string; store_id: string; post_impacts: boolean },
        mapped: MappedSale,
        productMap: Map<string, string>,
        customerMap: Map<string, string>,
        saleMap: Map<string, string>,
        warnings: SyncWarning[],
    ): Promise<boolean | null> {
        const customerId = mapped.externalCustomerId ? customerMap.get(mapped.externalCustomerId) ?? null : null;
        if (mapped.externalCustomerId && !customerId) {
            warnings.push({
                entity: 'SALE',
                externalId: mapped.externalId,
                code: 'CUSTOMER_UNRESOLVED',
                message: `Sale ${mapped.serialNumber} references provider customer ${mapped.externalCustomerId}, which is not in the customer list — imported as a walk-in sale`,
            });
        }

        const items = this.resolveDocumentItems(
            mapped.items,
            productMap,
            warnings,
            'SALE',
            mapped.externalId,
            mapped.serialNumber,
        ).map((item) => ({
            product_id: item.productId,
            quantity: item.source.quantity,
            price_at_sale: item.source.priceAtSale,
            unit_cost_at_sale: item.source.unitCostAtSale,
        }));

        const existingId = saleMap.get(mapped.externalId);
        const referenceNumber = await this.resolveSaleReference(
            connection.tenant_id,
            mapped,
            existingId ?? null,
            warnings,
        );

        if (existingId && !(await this.mappedRowExists(this.db.sale, connection.tenant_id, existingId))) {
            await this.forgetStaleMapping(connection.id, 'SALE', mapped.externalId, saleMap, warnings, `Sale ${mapped.serialNumber}`);
            return this.writeSale(connection, mapped, productMap, customerMap, saleMap, warnings);
        }

        if (existingId) {
            if (await this.isImmutablyPosted(connection, 'sale', existingId)) {
                if (await this.settleSaleOverpayment(connection, existingId, mapped)) return false;
                warnings.push({
                    entity: 'SALE',
                    externalId: mapped.externalId,
                    code: 'POSTED_IMMUTABLE',
                    message:
                        `Sale ${mapped.serialNumber} has already posted to the ledger — upstream changes were not applied. ` +
                        'Rewriting a posted document would leave its voucher and stock movement describing different figures.',
                });
                return null;
            }

            await this.db.$transaction(async (tx) => {
                await tx.sale.update({
                    where: { id: existingId },
                    data: {
                        total_amount: mapped.totalAmount,
                        amount_paid: mapped.amountPaid,
                        sale_date: mapped.saleDate,
                        note: mapped.note,
                        customer_id: customerId,
                        reference_number: referenceNumber,
                    },
                });

                // Rewriting lines is only safe when nothing references them.
                const referenced = await tx.salesReturnItem.count({
                    where: { sale_item: { sale_id: existingId } },
                });
                if (referenced > 0) {
                    warnings.push({
                        entity: 'SALE',
                        externalId: mapped.externalId,
                        code: 'ITEMS_LOCKED',
                        message: `Sale ${mapped.serialNumber} has recorded returns — header updated but line items left untouched`,
                    });
                    return;
                }

                await tx.saleItem.deleteMany({ where: { sale_id: existingId } });
                if (items.length > 0) {
                    await tx.saleItem.createMany({ data: items.map((item) => ({ ...item, sale_id: existingId })) });
                }
            });
            await this.settleSaleOverpayment(connection, existingId, mapped);
            return false;
        }

        const serialNumber = await this.claimDocumentNumber(
            mapped.serialNumber,
            (candidate) => this.isTaken(this.db.sale, { tenant_id: connection.tenant_id, serial_number: candidate }),
            'SALE',
            mapped.externalId,
            warnings,
        );
        const sale = await this.db.$transaction(async (tx) => {
            const created = await tx.sale.create({
                data: {
                    tenant_id: connection.tenant_id,
                    store_id: connection.store_id,
                    serial_number: serialNumber,
                    reference_number: referenceNumber,
                    total_amount: mapped.totalAmount,
                    amount_paid: mapped.amountPaid,
                    status: 'COMPLETED',
                    sale_date: mapped.saleDate,
                    note: mapped.note,
                    customer_id: customerId,
                    items: { create: items },
                },
                select: { id: true },
            });

            if (connection.post_impacts) {
                await applySaleImpacts({
                    tx,
                    tenantId: connection.tenant_id,
                    storeId: connection.store_id,
                    saleId: created.id,
                    serialNumber,
                    customerId,
                    totalAmount: mapped.totalAmount,
                    amountPaid: mapped.amountPaid,
                    paymentMode: mapped.paymentMode,
                    saleDate: mapped.saleDate,
                    items,
                });
            }

            return created;
        });

        await this.writeMapping(connection, 'SALE', mapped.externalId, sale.id, mapped.externalUpdatedAt);
        saleMap.set(mapped.externalId, sale.id);
        return true;
    }

    /**
     * Books what was paid above an imported sale's total (see
     * applySaleOverpayment) for a sale imported before that was booked. Only
     * a payment is added, so a posted sale gets it too; its own figures and
     * voucher are left alone. Returns whether anything was written.
     */
    private async settleSaleOverpayment(
        connection: { tenant_id: string; store_id: string; post_impacts: boolean },
        saleId: string,
        mapped: MappedSale,
    ): Promise<boolean> {
        const excess = mapped.amountPaid - mapped.totalAmount;
        if (!connection.post_impacts || excess <= 0.005) return false;

        const sale = await this.db.sale.findFirst({
            where: { id: saleId, tenant_id: connection.tenant_id },
            select: { customer_id: true, total_amount: true, serial_number: true },
        });
        if (!sale?.customer_id || Math.abs(Number(sale.total_amount) - mapped.totalAmount) > 0.005) return false;

        return this.db.$transaction((tx) =>
            applySaleOverpayment({
                tx,
                tenantId: connection.tenant_id,
                storeId: connection.store_id,
                saleId,
                serialNumber: sale.serial_number,
                customerId: sale.customer_id!,
                excess,
                paymentMode: mapped.paymentMode,
                saleDate: mapped.saleDate,
            }),
        );
    }

    /**
     * The provider's transaction number goes into `reference_number` so the
     * original number stays searchable, while `serial_number` keeps its import
     * prefix and can never collide with our own numbering.
     *
     * `Sale.reference_number` is unique per tenant though, and the provider's
     * number can already be in use by a natively entered sale. That must not
     * fail the run, so a clash drops the reference and warns instead. (The
     * check is not race-proof against a sale created in the same instant, but
     * only one import runs per connection at a time and these are historical
     * documents.)
     */
    private async resolveSaleReference(
        tenantId: string,
        mapped: MappedSale,
        existingSaleId: string | null,
        warnings: SyncWarning[],
    ): Promise<string | null> {
        if (!mapped.referenceNumber) return null;

        const clash = await this.db.sale.findFirst({
            where: {
                tenant_id: tenantId,
                reference_number: mapped.referenceNumber,
                ...(existingSaleId ? { id: { not: existingSaleId } } : {}),
            },
            select: { id: true },
        });
        if (!clash) return mapped.referenceNumber;

        warnings.push({
            entity: 'SALE',
            externalId: mapped.externalId,
            code: 'REFERENCE_TAKEN',
            message: `Sale ${mapped.serialNumber}: reference ${mapped.referenceNumber} is already used by another sale — imported without a reference`,
        });
        return null;
    }

    private async syncPurchasesWindow(
        connection: DocumentConnection,
        client: ProviderClient,
        window: DateWindow,
        productMap: Map<string, string>,
        supplierMap: Map<string, string>,
        stats: SyncStats,
        warnings: SyncWarning[],
        dryRun: boolean,
        mappers: ProviderMappers = EXPRESS_MAPPERS,
        openingAsOf?: Date,
    ) {
        const docs = await client.fetchPurchaseDocuments(window);
        const purchaseMap = await this.loadMappings(connection.id, 'PURCHASE');

        for (const doc of docs) {
            const mapped = mappers.purchase(doc, connection.document_prefix, warnings);
            if (dryRun) {
                purchaseMap.has(mapped.externalId) ? stats.purchases.updated++ : stats.purchases.created++;
                continue;
            }

            await this.resolveDocumentParty(connection, 'SUPPLIER', mapped.externalSupplierId, mapped.embeddedSupplier, supplierMap, {
                mappers, stats, warnings, openingAsOf, documentLabel: `purchase ${mapped.referenceNumber ?? mapped.purchaseNumber}`,
            });

            try {
                const created = await this.writePurchase(connection, mapped, productMap, supplierMap, purchaseMap, warnings);
                if (created === null) {
                    stats.purchases.skipped++;
                } else {
                    created ? stats.purchases.created++ : stats.purchases.updated++;
                }
            } catch (error: any) {
                stats.purchases.skipped++;
                warnings.push({
                    entity: 'PURCHASE',
                    externalId: mapped.externalId,
                    code: 'WRITE_FAILED',
                    message: `Purchase ${mapped.referenceNumber ?? mapped.purchaseNumber} could not be imported: ${describeWriteError(error)}`,
                    skipped: skippedDocument(mapped.referenceNumber ?? mapped.purchaseNumber, mapped.purchaseDate, mapped.externalSupplierId, mapped.embeddedSupplier, mapped.totalAmount, mapped.items.length, error),
                });
            }
        }
    }

    private async writePurchase(
        connection: { id: string; tenant_id: string; store_id: string; post_impacts: boolean },
        mapped: MappedPurchase,
        productMap: Map<string, string>,
        supplierMap: Map<string, string>,
        purchaseMap: Map<string, string>,
        warnings: SyncWarning[],
    ): Promise<boolean | null> {
        const supplierId = mapped.externalSupplierId ? supplierMap.get(mapped.externalSupplierId) ?? null : null;
        if (mapped.externalSupplierId && !supplierId) {
            warnings.push({
                entity: 'PURCHASE',
                externalId: mapped.externalId,
                code: 'SUPPLIER_UNRESOLVED',
                message: `Purchase ${mapped.purchaseNumber} references provider supplier ${mapped.externalSupplierId}, which is not in the supplier list — imported without a supplier`,
            });
        }

        const items = this.resolveDocumentItems(
            mapped.items,
            productMap,
            warnings,
            'PURCHASE',
            mapped.externalId,
            mapped.purchaseNumber,
        ).map((item) => ({
            product_id: item.productId,
            quantity: item.source.quantity,
            unit_cost: item.source.unitCost,
            line_total: item.source.lineTotal,
        }));

        const header = {
            reference_number: mapped.referenceNumber,
            subtotal_amount: mapped.subtotalAmount,
            tax_amount: mapped.taxAmount,
            discount_amount: mapped.discountAmount,
            freight_amount: mapped.freightAmount,
            total_amount: mapped.totalAmount,
            paid_amount: mapped.paidAmount,
            payment_status: mapped.paymentStatus,
            notes: mapped.notes,
            supplier_id: supplierId,
        };

        const existingId = purchaseMap.get(mapped.externalId);

        if (existingId && !(await this.mappedRowExists(this.db.purchase, connection.tenant_id, existingId))) {
            await this.forgetStaleMapping(connection.id, 'PURCHASE', mapped.externalId, purchaseMap, warnings, `Purchase ${mapped.purchaseNumber}`);
            return this.writePurchase(connection, mapped, productMap, supplierMap, purchaseMap, warnings);
        }

        if (existingId) {
            if (await this.isImmutablyPosted(connection, 'purchase', existingId)) {
                // The voucher books the whole total as a credit purchase
                // whatever was paid, so what was paid is the one figure a
                // posted purchase can still take from upstream.
                const settled = await this.db.$transaction((tx) => this.settlePurchasePaid(tx, connection, existingId, mapped, true));
                const paidPosted = await this.postExistingPurchasePaid(connection, existingId, mapped, warnings);
                if (settled || paidPosted) return false;
                warnings.push({
                    entity: 'PURCHASE',
                    externalId: mapped.externalId,
                    code: 'POSTED_IMMUTABLE',
                    message:
                        `Purchase ${mapped.purchaseNumber} has already posted to the ledger — upstream changes were not applied. ` +
                        'Rewriting a posted document would leave its voucher and stock movement describing different figures.',
                });
                return null;
            }

            await this.db.$transaction(async (tx) => {
                await this.settlePurchasePaid(tx, connection, existingId, mapped, false);
                await tx.purchase.update({ where: { id: existingId }, data: header });

                const referenced = await tx.purchaseReturnItem.count({
                    where: { purchaseItem: { purchase_id: existingId } },
                });
                if (referenced > 0) {
                    warnings.push({
                        entity: 'PURCHASE',
                        externalId: mapped.externalId,
                        code: 'ITEMS_LOCKED',
                        message: `Purchase ${mapped.purchaseNumber} has recorded returns — header updated but line items left untouched`,
                    });
                    return;
                }

                await tx.purchaseItem.deleteMany({ where: { purchase_id: existingId } });
                if (items.length > 0) {
                    await tx.purchaseItem.createMany({
                        data: items.map((item) => ({ ...item, purchase_id: existingId })),
                    });
                }
            });
            return false;
        }

        const purchaseNumber = await this.claimDocumentNumber(
            mapped.purchaseNumber,
            (candidate) => this.isTaken(this.db.purchase, { tenant_id: connection.tenant_id, purchase_number: candidate }),
            'PURCHASE',
            mapped.externalId,
            warnings,
        );
        const purchase = await this.db.$transaction(async (tx) => {
            const created = await tx.purchase.create({
                data: {
                    tenant_id: connection.tenant_id,
                    store_id: connection.store_id,
                    purchase_number: purchaseNumber,
                    created_at: mapped.purchaseDate,
                    ...header,
                    items: { create: items },
                },
                select: { id: true },
            });

            if (connection.post_impacts) {
                await applyPurchaseImpacts({
                    tx,
                    tenantId: connection.tenant_id,
                    storeId: connection.store_id,
                    purchaseId: created.id,
                    purchaseNumber,
                    supplierId,
                    totalAmount: mapped.totalAmount,
                    paidAmount: mapped.paidAmount,
                    purchaseDate: mapped.purchaseDate,
                    items,
                });
            }

            return created;
        });

        await this.writeMapping(connection, 'PURCHASE', mapped.externalId, purchase.id, mapped.externalUpdatedAt);
        purchaseMap.set(mapped.externalId, purchase.id);
        return true;
    }

    /**
     * Posts what was paid with the goods (see postPurchasePaid) for a posted
     * purchase imported before that was posted. Reads the purchase as saved,
     * so a paid amount just corrected is the one posted. Returns whether it
     * posted; a refusal (a locked period) is a note, not a failed purchase.
     */
    private async postExistingPurchasePaid(
        connection: { tenant_id: string; store_id: string; post_impacts: boolean },
        purchaseId: string,
        mapped: MappedPurchase,
        warnings: SyncWarning[],
    ): Promise<boolean> {
        if (!connection.post_impacts) return false;
        const purchase = await this.db.purchase.findFirst({
            where: { id: purchaseId, tenant_id: connection.tenant_id },
            select: { total_amount: true, paid_amount: true, supplier_id: true, purchase_number: true, created_at: true },
        });
        const paid = purchase ? Math.min(Number(purchase.paid_amount), Number(purchase.total_amount)) : 0;
        if (!purchase || paid <= 0.005) return false;

        const event = await this.db.postingEvent.findUnique({
            where: {
                tenant_id_idempotency_key: {
                    tenant_id: connection.tenant_id,
                    idempotency_key: postingIdempotencyKey(connection.tenant_id, 'supplier_payment', purchaseId, 'paid'),
                },
            },
            select: { status: true },
        });
        if (event?.status === 'posted') return false;

        try {
            const posting = await this.db.$transaction((tx) =>
                postPurchasePaid({
                    tx,
                    tenantId: connection.tenant_id,
                    storeId: connection.store_id,
                    purchaseId,
                    purchaseNumber: purchase.purchase_number,
                    supplierId: purchase.supplier_id,
                    paid,
                    purchaseDate: purchase.created_at,
                }),
            );
            return posting.postingStatus === 'posted';
        } catch (error: any) {
            warnings.push({
                entity: 'PURCHASE',
                externalId: mapped.externalId,
                code: 'PAID_NOT_POSTED',
                message: `Purchase ${mapped.purchaseNumber}: what was paid with the goods could not be posted — ${describeWriteError(error)}`,
            });
            return false;
        }
    }

    /**
     * Brings an imported purchase's paid amount, and the due it left on the
     * supplier's account, to what the provider now says, when the total
     * itself has not changed. The CREDIT_PURCHASE row the import wrote for the
     * unpaid part (or writes now, if it was all paid) moves with it, so the
     * bill, the supplier's due and their ledger keep agreeing.
     *
     * With `writePaid` it also saves the new paid amount and status; the
     * ordinary update path saves them with the rest of the header. Returns
     * whether anything changed.
     */
    private async settlePurchasePaid(
        tx: Prisma.TransactionClient,
        connection: { tenant_id: string; post_impacts: boolean },
        purchaseId: string,
        mapped: MappedPurchase,
        writePaid: boolean,
    ): Promise<boolean> {
        const current = await tx.purchase.findFirst({
            where: { id: purchaseId, tenant_id: connection.tenant_id },
            select: { total_amount: true, paid_amount: true, supplier_id: true, created_at: true },
        });
        if (!current) return false;
        const total = Number(current.total_amount);
        const paid = Number(current.paid_amount);
        if (Math.abs(total - mapped.totalAmount) > 0.005 || Math.abs(paid - mapped.paidAmount) <= 0.005) return false;

        if (writePaid) {
            await tx.purchase.update({
                where: { id: purchaseId },
                data: { paid_amount: mapped.paidAmount, payment_status: mapped.paymentStatus },
            });
        }

        const dueChange = Math.max(0, total - mapped.paidAmount) - Math.max(0, total - paid);
        if (!connection.post_impacts || !current.supplier_id || Math.abs(dueChange) <= 0.005) return true;

        const supplier = await tx.supplier.findUnique({
            where: { id: current.supplier_id },
            select: { due_balance: true, store_id: true },
        });
        const balanceAfter = Number(supplier?.due_balance ?? 0) + dueChange;
        const row = await tx.supplierCreditTransaction.findFirst({
            where: { tenant_id: connection.tenant_id, supplier_id: current.supplier_id, type: 'CREDIT_PURCHASE', reference_type: 'PURCHASE', reference_id: purchaseId },
            select: { id: true },
        });
        if (row) {
            await tx.supplierCreditTransaction.update({ where: { id: row.id }, data: { amount: { increment: dueChange } } });
        } else {
            await tx.supplierCreditTransaction.create({
                data: {
                    tenant_id: connection.tenant_id,
                    supplier_id: current.supplier_id,
                    // A credit row belongs to its supplier's branch.
                    store_id: supplier!.store_id,
                    type: 'CREDIT_PURCHASE',
                    amount: dueChange,
                    balance_after: balanceAfter,
                    reference_type: 'PURCHASE',
                    reference_id: purchaseId,
                    created_at: current.created_at,
                },
            });
        }
        await tx.supplier.update({ where: { id: current.supplier_id }, data: { due_balance: balanceAfter } });
        return true;
    }

    /**
     * The tenant's id for the customer or supplier a document names. When the
     * provider's own list left that party out — Express drops deleted customers
     * from `/get-customer` but keeps them on their old invoices and payments —
     * it is created (or linked) from the copy the document embeds, so the
     * document keeps its party instead of losing it or being skipped. Null when
     * the party is unknown and cannot be made; the caller decides what that
     * costs the document. Never called on a dry run, which writes nothing.
     */
    private async resolveDocumentParty(
        connection: DocumentConnection,
        party: PaymentParty,
        externalId: string | null,
        embedded: unknown,
        map: Map<string, string>,
        context: {
            mappers: ProviderMappers;
            stats: SyncStats;
            warnings: SyncWarning[];
            openingAsOf?: Date;
            documentLabel: string;
        },
    ): Promise<string | null> {
        if (!externalId) return null;
        const known = map.get(externalId);
        if (known) return known;
        if (!embedded || typeof embedded !== 'object' || !context.openingAsOf) return null;

        const isCustomer = party === 'CUSTOMER';
        const entity: EntityType = isCustomer ? 'CUSTOMER' : 'SUPPLIER';
        const noun = isCustomer ? 'Customer' : 'Supplier';
        const label = partyLabel(externalId, embedded);
        const row = { ...(embedded as Record<string, unknown>), id: externalId };

        try {
            const mapped = isCustomer ? context.mappers.customer(row, new Set()) : context.mappers.supplier(row, new Set(), new Set());
            const { id, adopted } = isCustomer
                ? await this.createOrAdoptCustomer(connection, mapped as MappedCustomer, context.openingAsOf)
                : await this.createOrAdoptSupplier(connection, mapped as MappedSupplier, context.openingAsOf);

            await this.writeMapping(connection, entity, externalId, id, mapped.externalUpdatedAt);
            map.set(externalId, id);
            const tally = isCustomer ? context.stats.customers : context.stats.suppliers;
            if (adopted) tally.skipped++;
            else tally.created++;

            const deleted = Boolean((embedded as { deleted_at?: unknown }).deleted_at);
            context.warnings.push({
                entity,
                externalId,
                code: 'PARTY_FROM_DOCUMENT',
                message:
                    `${noun} ${label} is not in the provider's ${isCustomer ? 'customer' : 'supplier'} list${deleted ? ' (deleted there)' : ''} — ` +
                    `${adopted ? `linked to the existing ${isCustomer ? 'customer with the same phone or code' : 'supplier of the same name'}` : 'created'} from ${context.documentLabel}`,
            });
            return id;
        } catch (error) {
            context.warnings.push({
                entity,
                externalId,
                code: 'WRITE_FAILED',
                message: `${noun} ${label}, named on ${context.documentLabel}, could not be created: ${describeWriteError(error)}`,
            });
            return null;
        }
    }

    /**
     * The document's number, or the first free suffixed one when the tenant
     * already holds it. A provider can hand one number out twice — Express did,
     * to quotations created minutes apart — and the second used to fail whole.
     */
    private async claimDocumentNumber(
        base: string,
        isTaken: (candidate: string) => Promise<boolean>,
        entity: EntityType,
        externalId: string,
        warnings: SyncWarning[],
    ): Promise<string> {
        const number = await freeDocumentNumber(base, isTaken);
        if (number !== base) {
            warnings.push({
                entity,
                externalId,
                code: 'NUMBER_TAKEN',
                message: `${base} is already used by another record here — imported as ${number}`,
            });
        }
        return number;
    }

    private async isTaken(model: any, where: Record<string, unknown>): Promise<boolean> {
        return (await model.findFirst({ where, select: { id: true } })) != null;
    }

    /**
     * Drops lines whose product is unknown to us (the provider omits deleted
     * products from its product list but still references them on old
     * documents) and records why. The document header keeps the provider's own
     * totals, so a dropped line shows up as a header/line mismatch rather than
     * a silently wrong total.
     */
    private resolveDocumentItems<T extends { externalProductId: string; quantity: number }>(
        items: T[],
        productMap: Map<string, string>,
        warnings: SyncWarning[],
        entity: EntityType,
        externalId: string,
        documentNumber: string,
    ): Array<{ productId: string; source: T }> {
        const resolved: Array<{ productId: string; source: T }> = [];

        // A line of nothing moves no stock, and posting refuses a zero
        // movement — which used to cost the whole document. The header keeps
        // the provider's totals, so dropping it changes no figure.
        const zero = items.filter((item) => item.quantity === 0).length;
        if (zero > 0) {
            warnings.push({
                entity,
                externalId,
                code: 'ZERO_QUANTITY_DROPPED',
                message: `${documentNumber}: ${zero} line${zero === 1 ? '' : 's'} with quantity 0 dropped — nothing was bought or sold on ${zero === 1 ? 'it' : 'them'}`,
            });
        }

        for (const source of items) {
            if (source.quantity === 0) continue;
            const productId = productMap.get(source.externalProductId);
            if (!productId) {
                warnings.push({
                    entity,
                    externalId,
                    code: 'PRODUCT_UNRESOLVED',
                    message: `${documentNumber}: line for provider product ${source.externalProductId} was dropped — that product is not in the provider's product list (likely deleted upstream)`,
                });
                continue;
            }
            resolved.push({ productId, source });
        }

        return resolved;
    }

    // ------------------------------------------------------------- mappings

    /**
     * Posted documents are immutable to the importer. Only meaningful when the
     * connection posts at all — an inert import has nothing to protect, so the
     * lookup is skipped entirely rather than run per document.
     */
    private async isImmutablyPosted(
        connection: { tenant_id: string; post_impacts: boolean },
        eventType: string,
        sourceId: string,
    ): Promise<boolean> {
        if (!connection.post_impacts) return false;
        return isAlreadyPosted(this.db, connection.tenant_id, eventType, sourceId);
    }

    /**
     * `ExternalSyncMapping.internal_id` carries no foreign key — it names rows
     * in five different tables — so nothing stops a mapping from outliving the
     * row it points at. A purged product or a deleted sale leaves a mapping
     * that makes the next run die on "Record to update not found".
     *
     * Rather than fail, drop the dangling link so the caller can import the
     * record again as if it were new.
     */
    private async forgetStaleMapping(
        connectionId: string,
        entityType: EntityType,
        externalId: string,
        map: Map<string, string>,
        warnings: SyncWarning[],
        label: string,
    ) {
        await this.db.externalSyncMapping.deleteMany({
            where: { connection_id: connectionId, entity_type: entityType, external_id: externalId },
        });
        map.delete(externalId);
        warnings.push({
            entity: entityType,
            externalId,
            code: 'STALE_MAPPING_REPAIRED',
            message: `${label} was linked to a record that no longer exists — the link was dropped and the record re-imported`,
        });
    }

    /** Tenant-scoped, so a mapping can never reach across tenants either. */
    private async mappedRowExists(model: any, tenantId: string, id: string): Promise<boolean> {
        const row = await model.findFirst({ where: { id, tenant_id: tenantId }, select: { id: true } });
        return Boolean(row);
    }

    private async loadMappings(connectionId: string, entityType: EntityType): Promise<Map<string, string>> {
        const rows = await this.db.externalSyncMapping.findMany({
            where: { connection_id: connectionId, entity_type: entityType },
            select: { external_id: true, internal_id: true },
        });
        return new Map(rows.map((row) => [row.external_id, row.internal_id]));
    }

    private async writeMapping(
        connection: { id: string; tenant_id: string },
        entityType: EntityType,
        externalId: string,
        internalId: string,
        externalUpdatedAt: Date | null,
    ) {
        await this.db.externalSyncMapping.upsert({
            where: {
                connection_id_entity_type_external_id: {
                    connection_id: connection.id,
                    entity_type: entityType,
                    external_id: externalId,
                },
            },
            create: {
                tenant_id: connection.tenant_id,
                connection_id: connection.id,
                entity_type: entityType,
                external_id: externalId,
                internal_id: internalId,
                external_updated_at: externalUpdatedAt,
            },
            update: { internal_id: internalId, external_updated_at: externalUpdatedAt },
        });
    }

    /** Never let the stored credential leave the service. */
    private toPublicConnection(connection: any) {
        const { password_encrypted, ...rest } = connection;
        return {
            ...rest,
            hasPassword: Boolean(password_encrypted),
            nextWindowFrom: toDateString(
                new Date(Date.now() - connection.window_days * 24 * 60 * 60 * 1000),
            ),
        };
    }
}

function emptyTally(): EntityTally {
    return { created: 0, updated: 0, skipped: 0 };
}
