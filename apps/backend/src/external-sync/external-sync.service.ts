import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EncryptionService } from '../common/encryption.service';
import { assertValidBaseUrl } from './express-retail.client';
import {
    DateWindow,
    MappedPayment,
    MappedPurchase,
    MappedSale,
    MappedSaleReturn,
    PaymentParty,
    SyncWarning,
    creditTransactionType,
    toDateString,
} from './external-sync.mapper';
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
    applySaleImpacts,
    applySaleReturnImpacts,
    applyOpeningBalance,
    isAlreadyPosted,
} from './external-sync.impacts';
import {
    ListExternalSyncRunsQueryDto,
    RunExternalSyncDto,
    TestExternalSyncConnectionDto,
    UpsertExternalSyncConnectionDto,
} from './external-sync.dto';

type EntityType =
    | 'PRODUCT'
    | 'CUSTOMER'
    | 'SUPPLIER'
    | 'SALE'
    | 'PURCHASE'
    | 'CUSTOMER_PAYMENT'
    | 'SUPPLIER_PAYMENT'
    | 'SALE_RETURN';

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
    | 'saleReturns',
    EntityTally
>;

/** Warnings are stored on the run row; cap them so one bad import cannot bloat it. */
const MAX_STORED_WARNINGS = 500;

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
    'CUSTOMER_PAYMENTS',
    'SUPPLIER_PAYMENTS',
    'SALE_RETURNS',
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
@Injectable()
export class ExternalSyncService {
    private readonly logger = new Logger(ExternalSyncService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly encryption: EncryptionService,
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

        // Mappings and runs cascade; the imported documents themselves are left
        // in place deliberately — deleting a connection must not delete a
        // tenant's sales.
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

        const inFlight = await this.db.externalSyncRun.findFirst({
            where: { connection_id: connection.id, status: 'RUNNING' },
            select: { id: true, started_at: true },
        });
        if (inFlight) {
            throw new ConflictException(`An import is already running (started ${inFlight.started_at.toISOString()})`);
        }

        const { from, to } = this.resolveWindow(connection, dto);
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
            },
        });

        // Intentionally not awaited — the run row is the progress channel.
        void this.executeRun(run.id, connection.id, { from, to }, dto.dryRun ?? false, steps).catch((error) => {
            this.logger.error(`External sync run ${run.id} crashed: ${error?.message ?? error}`, error?.stack);
        });

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

    private resolveWindow(
        connection: { window_days: number; history_start_date: Date | null },
        dto: RunExternalSyncDto,
    ): { from: Date; to: Date } {
        const today = new Date();
        const to = dto.dateTo ? new Date(dto.dateTo) : today;

        let from: Date;
        if (dto.dateFrom) {
            from = new Date(dto.dateFrom);
        } else if (dto.fullResync) {
            // Full history: back to the configured start, or five years as a
            // bounded fallback so we never ask for an open-ended range.
            from = connection.history_start_date ?? new Date(to.getTime() - 5 * 365 * 24 * 60 * 60 * 1000);
        } else {
            from = new Date(to.getTime() - connection.window_days * 24 * 60 * 60 * 1000);
        }

        if (connection.history_start_date && from < connection.history_start_date) {
            from = connection.history_start_date;
        }
        if (from > to) {
            throw new BadRequestException('dateFrom must not be after dateTo');
        }
        return { from, to };
    }

    // ------------------------------------------------------------- execution

    private async executeRun(
        runId: string,
        connectionId: string,
        window: { from: Date; to: Date },
        dryRun: boolean,
        steps: SyncStep[],
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
            const client = def.createClient({
                baseUrl: connection.base_url,
                username: connection.username,
                password: this.encryption.decrypt(connection.password_encrypted),
            });
            const session = await client.login();

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

            const chunks = def.planWindows(window.from, window.to);
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
                await this.syncProducts(connection, client, stats, warnings, dryRun, mappers);
                // Opening balances are stamped at the start of the imported
                // range so they sit before every document that follows.
                await this.syncCustomers(connection, client, stats, warnings, dryRun, window.from, mappers);
                await this.syncSuppliers(connection, client, stats, warnings, dryRun, window.from, mappers);
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
                    await this.syncPurchasesWindow(connection, client, chunk, productMap, supplierMap, stats, warnings, dryRun, mappers);
                    await tick(`Purchases ${label}`);
                }
                if (steps.includes('SALES')) {
                    await this.assertNotCancelled(runId);
                    await this.syncSalesWindow(connection, client, chunk, productMap, customerMap, stats, warnings, dryRun, mappers);
                    await tick(`Sales ${label}`);
                }
                if (steps.includes('CUSTOMER_PAYMENTS')) {
                    await this.assertNotCancelled(runId);
                    await this.syncPaymentsWindow(connection, client, chunk, 'CUSTOMER', customerMap, stats, warnings, dryRun, mappers);
                    await tick(`Customer payments ${label}`);
                }
                if (steps.includes('SUPPLIER_PAYMENTS')) {
                    await this.assertNotCancelled(runId);
                    await this.syncPaymentsWindow(connection, client, chunk, 'SUPPLIER', supplierMap, stats, warnings, dryRun, mappers);
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
                    await this.syncSaleReturnsWindow(connection, client, chunk, productMap, saleMap, stats, warnings, dryRun, mappers);
                    await tick(`Sale returns ${chunk.from.slice(0, 7)}`);
                }
            }

            const status = warnings.length > 0 ? 'PARTIAL' : 'SUCCESS';
            await this.db.externalSyncRun.update({
                where: { id: runId },
                data: {
                    status,
                    phase: null,
                    stats: stats as any,
                    warnings: warnings.slice(0, MAX_STORED_WARNINGS) as any,
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
                    warnings: warnings.slice(0, MAX_STORED_WARNINGS) as any,
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
                progress: { done, total, warnings: warnings.length } as any,
                stats: stats as any,
                warnings: warnings.slice(0, MAX_STORED_WARNINGS) as any,
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
        connection: { id: string; tenant_id: string },
        client: ProviderClient,
        stats: SyncStats,
        warnings: SyncWarning[],
        dryRun: boolean,
        mappers: ProviderMappers = EXPRESS_MAPPERS,
    ): Promise<Map<string, string>> {
        const rows = await client.fetchProducts();
        const claimedSkus = new Set<string>();
        const map = await this.loadMappings(connection.id, 'PRODUCT');

        for (const row of rows) {
            const mapped = mappers.product(row, claimedSkus);
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
                        continue;
                    }
                    await this.forgetStaleMapping(connection.id, 'PRODUCT', mapped.externalId, map, warnings, `Product ${mapped.sku}`);
                }

                // Adopt a product the tenant already has under the same SKU rather
                // than colliding with the [tenant_id, sku] unique index.
                const adopted = await this.db.product.findFirst({
                    where: { tenant_id: connection.tenant_id, sku: mapped.sku },
                    select: { id: true },
                });

                const productId =
                    adopted?.id ??
                    (
                        await this.db.product.create({
                            data: {
                                tenant_id: connection.tenant_id,
                                name: mapped.name,
                                sku: mapped.sku,
                                type: mapped.isService ? 'SERVICE' : 'GOODS',
                                price: mapped.price,
                                vat_rate: mapped.vatRate,
                                reorder_level: mapped.reorderLevel,
                            },
                            select: { id: true },
                        })
                    ).id;

                if (adopted) {
                    warnings.push({
                        entity: 'PRODUCT',
                        externalId: mapped.externalId,
                        code: 'ADOPTED_EXISTING',
                        message: `Linked provider product ${mapped.sku} to the tenant's existing product with the same SKU instead of creating a duplicate`,
                    });
                    stats.products.skipped++;
                } else {
                    stats.products.created++;
                }

                await this.writeMapping(connection, 'PRODUCT', mapped.externalId, productId, mapped.externalUpdatedAt);
                map.set(mapped.externalId, productId);
            } catch (error: any) {
                stats.products.skipped++;
                warnings.push({
                    entity: 'PRODUCT',
                    externalId: mapped.externalId,
                    code: 'WRITE_FAILED',
                    message: `Product ${mapped.sku} could not be imported: ${error?.message ?? error}`,
                });
            }
        }

        return map;
    }

    private async syncCustomers(
        connection: { id: string; tenant_id: string; provider: string; post_impacts: boolean },
        client: ProviderClient,
        stats: SyncStats,
        warnings: SyncWarning[],
        dryRun: boolean,
        openingAsOf: Date,
        mappers: ProviderMappers = EXPRESS_MAPPERS,
    ): Promise<Map<string, string>> {
        const rows = await client.fetchCustomers();
        const claimedCodes = new Set<string>();
        const map = await this.loadMappings(connection.id, 'CUSTOMER');

        for (const row of rows) {
            const mapped = mappers.customer(row, claimedCodes);
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
                        continue;
                    }
                    await this.forgetStaleMapping(connection.id, 'CUSTOMER', mapped.externalId, map, warnings, `Customer ${mapped.customerCode}`);
                }

                // [tenant_id, phone] and [tenant_id, customer_code] are both unique.
                const adopted = await this.db.customer.findFirst({
                    where: {
                        tenant_id: connection.tenant_id,
                        OR: [
                            ...(mapped.phone ? [{ phone: mapped.phone }] : []),
                            { customer_code: mapped.customerCode },
                        ],
                    },
                    select: { id: true },
                });

                const customerId =
                    adopted?.id ??
                    (
                        await this.db.customer.create({
                            data: {
                                tenant_id: connection.tenant_id,
                                customer_code: mapped.customerCode,
                                name: mapped.name,
                                owner_name: mapped.ownerName,
                                phone: mapped.phone,
                                email: mapped.email,
                                address: mapped.address,
                                credit_limit: mapped.creditLimit,
                            },
                            select: { id: true },
                        })
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

                if (adopted) {
                    warnings.push({
                        entity: 'CUSTOMER',
                        externalId: mapped.externalId,
                        code: 'ADOPTED_EXISTING',
                        message: `Linked provider customer ${mapped.customerCode} to an existing tenant customer with the same phone or code`,
                    });
                    stats.customers.skipped++;
                } else {
                    stats.customers.created++;
                }

                await this.writeMapping(connection, 'CUSTOMER', mapped.externalId, customerId, mapped.externalUpdatedAt);
                map.set(mapped.externalId, customerId);
            } catch (error: any) {
                stats.customers.skipped++;
                warnings.push({
                    entity: 'CUSTOMER',
                    externalId: mapped.externalId,
                    code: 'WRITE_FAILED',
                    message: `Customer ${mapped.customerCode} could not be imported: ${error?.message ?? error}`,
                });
            }
        }

        return map;
    }

    private async syncSuppliers(
        connection: { id: string; tenant_id: string; provider: string; post_impacts: boolean },
        client: ProviderClient,
        stats: SyncStats,
        warnings: SyncWarning[],
        dryRun: boolean,
        openingAsOf: Date,
        mappers: ProviderMappers = EXPRESS_MAPPERS,
    ): Promise<Map<string, string>> {
        const rows = await client.fetchSuppliers();
        const claimedNames = new Set<string>();
        const map = await this.loadMappings(connection.id, 'SUPPLIER');

        for (const row of rows) {
            const mapped = mappers.supplier(row, claimedNames);
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
                        continue;
                    }
                    await this.forgetStaleMapping(connection.id, 'SUPPLIER', mapped.externalId, map, warnings, `Supplier ${mapped.name}`);
                }

                const adopted = await this.db.supplier.findFirst({
                    where: { tenant_id: connection.tenant_id, name: mapped.name },
                    select: { id: true },
                });

                const supplierId =
                    adopted?.id ??
                    (
                        await this.db.supplier.create({
                            data: {
                                tenant_id: connection.tenant_id,
                                name: mapped.name,
                                phone: mapped.phone,
                                email: mapped.email,
                                address: mapped.address,
                            },
                            select: { id: true },
                        })
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
                }

                await this.writeMapping(connection, 'SUPPLIER', mapped.externalId, supplierId, mapped.externalUpdatedAt);
                map.set(mapped.externalId, supplierId);
            } catch (error: any) {
                stats.suppliers.skipped++;
                warnings.push({
                    entity: 'SUPPLIER',
                    externalId: mapped.externalId,
                    code: 'WRITE_FAILED',
                    message: `Supplier ${mapped.name} could not be imported: ${error?.message ?? error}`,
                });
            }
        }

        return map;
    }

    // ------------------------------------------------------------ documents

    private async syncSalesWindow(
        connection: { id: string; tenant_id: string; store_id: string; document_prefix: string; post_impacts: boolean },
        client: ProviderClient,
        window: DateWindow,
        productMap: Map<string, string>,
        customerMap: Map<string, string>,
        stats: SyncStats,
        warnings: SyncWarning[],
        dryRun: boolean,
        mappers: ProviderMappers = EXPRESS_MAPPERS,
    ) {
        const docs = await client.fetchSaleDocuments(window);
        const saleMap = await this.loadMappings(connection.id, 'SALE');

        for (const doc of docs) {
            const mapped = mappers.sale(doc, connection.document_prefix, warnings);
            if (dryRun) {
                saleMap.has(mapped.externalId) ? stats.sales.updated++ : stats.sales.created++;
                continue;
            }

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
                    message: `Invoice ${mapped.referenceNumber ?? mapped.serialNumber} could not be imported: ${error?.message ?? error}`,
                });
            }
        }
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
                const created = await this.writeSaleReturn(connection, mapped, saleId, productMap, returnMap, warnings);
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
                    message: `Return ${mapped.referenceNumber ?? mapped.returnNumber} could not be imported: ${error?.message ?? error}`,
                });
            }
        }
    }

    /** Returns null when the return had to be skipped for integrity reasons. */
    private async writeSaleReturn(
        connection: { id: string; tenant_id: string; store_id: string; post_impacts: boolean },
        mapped: MappedSaleReturn,
        saleId: string | null,
        productMap: Map<string, string>,
        returnMap: Map<string, string>,
        warnings: SyncWarning[],
    ): Promise<boolean | null> {
        // Each return line names a line of the parent sale where there is one.
        // Match on product, consuming each sale line once so two return lines
        // for the same product cannot both claim it.
        const saleItems = saleId
            ? await this.db.saleItem.findMany({
                  where: { sale_id: saleId },
                  select: { id: true, product_id: true },
              })
            : [];
        const availableByProduct = new Map<string, string[]>();
        for (const item of saleItems) {
            const list = availableByProduct.get(item.product_id) ?? [];
            list.push(item.id);
            availableByProduct.set(item.product_id, list);
        }

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

            const saleItemId = saleId ? availableByProduct.get(productId)?.shift() ?? null : null;
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
            return this.writeSaleReturn(connection, mapped, saleId, productMap, returnMap, warnings);
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
        connection: { id: string; tenant_id: string; provider: string; document_prefix: string; post_impacts: boolean },
        client: ProviderClient,
        window: DateWindow,
        party: PaymentParty,
        partyMap: Map<string, string>,
        stats: SyncStats,
        warnings: SyncWarning[],
        dryRun: boolean,
        mappers: ProviderMappers = EXPRESS_MAPPERS,
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
            const partyId = mapped.externalPartyId ? partyMap.get(mapped.externalPartyId) : undefined;
            if (!partyId) {
                tally.skipped++;
                warnings.push({
                    entity,
                    externalId: mapped.externalId,
                    code: 'PARTY_UNRESOLVED',
                    message: `Payment ${mapped.referenceNumber ?? mapped.paymentNumber} references ${party.toLowerCase()} ${mapped.externalPartyId ?? '(none)'}, which is not in the imported list — skipped`,
                });
                continue;
            }

            if (dryRun) {
                paymentMap.has(mapped.externalId) ? tally.updated++ : tally.created++;
                continue;
            }

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
                    message: `Payment ${mapped.referenceNumber ?? mapped.paymentNumber} could not be imported: ${error?.message ?? error}`,
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

        const created = await this.db.$transaction(async (tx) => {
            const table: any = isCustomer ? tx.customerCreditTransaction : tx.supplierCreditTransaction;
            const row = await table.create({
                data: {
                    ...data,
                    tenant_id: connection.tenant_id,
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
                    transactionId: row.id,
                    paymentNumber: mapped.paymentNumber,
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
            return false;
        }

        const sale = await this.db.$transaction(async (tx) => {
            const created = await tx.sale.create({
                data: {
                    tenant_id: connection.tenant_id,
                    store_id: connection.store_id,
                    serial_number: mapped.serialNumber,
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
                    serialNumber: mapped.serialNumber,
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
        connection: { id: string; tenant_id: string; store_id: string; document_prefix: string; post_impacts: boolean },
        client: ProviderClient,
        window: DateWindow,
        productMap: Map<string, string>,
        supplierMap: Map<string, string>,
        stats: SyncStats,
        warnings: SyncWarning[],
        dryRun: boolean,
        mappers: ProviderMappers = EXPRESS_MAPPERS,
    ) {
        const docs = await client.fetchPurchaseDocuments(window);
        const purchaseMap = await this.loadMappings(connection.id, 'PURCHASE');

        for (const doc of docs) {
            const mapped = mappers.purchase(doc, connection.document_prefix, warnings);
            if (dryRun) {
                purchaseMap.has(mapped.externalId) ? stats.purchases.updated++ : stats.purchases.created++;
                continue;
            }

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
                    message: `Purchase ${mapped.referenceNumber ?? mapped.purchaseNumber} could not be imported: ${error?.message ?? error}`,
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

        const purchase = await this.db.$transaction(async (tx) => {
            const created = await tx.purchase.create({
                data: {
                    tenant_id: connection.tenant_id,
                    store_id: connection.store_id,
                    purchase_number: mapped.purchaseNumber,
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
                    purchaseNumber: mapped.purchaseNumber,
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
     * Drops lines whose product is unknown to us (the provider omits deleted
     * products from its product list but still references them on old
     * documents) and records why. The document header keeps the provider's own
     * totals, so a dropped line shows up as a header/line mismatch rather than
     * a silently wrong total.
     */
    private resolveDocumentItems<T extends { externalProductId: string }>(
        items: T[],
        productMap: Map<string, string>,
        warnings: SyncWarning[],
        entity: EntityType,
        externalId: string,
        documentNumber: string,
    ): Array<{ productId: string; source: T }> {
        const resolved: Array<{ productId: string; source: T }> = [];

        for (const source of items) {
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
