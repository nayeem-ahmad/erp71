import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EncryptionService } from '../common/encryption.service';
import {
    EXPRESS_RETAIL_PROVIDER,
    ExpressRetailClient,
    assertValidBaseUrl,
} from './express-retail.client';
import {
    DateWindow,
    MappedPurchase,
    MappedSale,
    SyncWarning,
    groupBy,
    mapCustomer,
    mapProduct,
    mapPurchase,
    mapSale,
    mapSupplier,
    splitIntoMonthlyWindows,
    toDateString,
} from './external-sync.mapper';
import {
    ListExternalSyncRunsQueryDto,
    RunExternalSyncDto,
    TestExternalSyncConnectionDto,
    UpsertExternalSyncConnectionDto,
} from './external-sync.dto';

type EntityType = 'PRODUCT' | 'CUSTOMER' | 'SUPPLIER' | 'SALE' | 'PURCHASE';

interface EntityTally {
    created: number;
    updated: number;
    skipped: number;
}

type SyncStats = Record<'products' | 'customers' | 'suppliers' | 'sales' | 'purchases', EntityTally>;

/** Warnings are stored on the run row; cap them so one bad import cannot bloat it. */
const MAX_STORED_WARNINGS = 500;

/**
 * Platform-admin driven import of sales/purchase history from a third-party
 * ERP into one of our tenants.
 *
 * Deliberate scope limits — an import writes documents and master data only:
 *
 *  - No inventory movements or stock adjustments. Replaying historical sales
 *    as stock movements would fight whatever opening stock the tenant sets up,
 *    and there is no way to reconcile the two automatically. Stock is a
 *    separate opening-balance exercise.
 *  - No accounting journal entries and no PaymentRecord rows. Purchases and
 *    sales carry their paid amounts, but posting them to the ledger would
 *    double-count against the tenant's own opening balances.
 *  - No customer/supplier due-balance recomputation, for the same reason.
 */
@Injectable()
export class ExternalSyncService {
    private readonly logger = new Logger(ExternalSyncService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly encryption: EncryptionService,
    ) {}

    // ---------------------------------------------------------------- config

    async getConnection(tenantId: string) {
        const connection = await this.db.externalSyncConnection.findUnique({
            where: { tenant_id_provider: { tenant_id: tenantId, provider: EXPRESS_RETAIL_PROVIDER } },
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

        const baseUrl = assertValidBaseUrl(dto.baseUrl);
        const existing = await this.db.externalSyncConnection.findUnique({
            where: { tenant_id_provider: { tenant_id: tenantId, provider: EXPRESS_RETAIL_PROVIDER } },
        });

        if (!existing && !dto.password) {
            throw new BadRequestException('A password is required when creating a connection');
        }

        const data = {
            base_url: baseUrl,
            username: dto.username.trim(),
            store_id: dto.storeId,
            document_prefix: dto.documentPrefix ?? existing?.document_prefix ?? 'XR-',
            enabled: dto.enabled ?? existing?.enabled ?? false,
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
                      provider: EXPRESS_RETAIL_PROVIDER,
                      password_encrypted: this.encryption.encrypt(dto.password as string),
                      created_by: adminUserId ?? null,
                      ...data,
                  },
                  include: { store: { select: { id: true, name: true } } },
              });

        return this.toPublicConnection(saved);
    }

    async deleteConnection(tenantId: string) {
        const existing = await this.db.externalSyncConnection.findUnique({
            where: { tenant_id_provider: { tenant_id: tenantId, provider: EXPRESS_RETAIL_PROVIDER } },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('No Express Retail Pro connection configured for this tenant');

        // Mappings and runs cascade; the imported documents themselves are left
        // in place deliberately — deleting a connection must not delete a
        // tenant's sales.
        await this.db.externalSyncConnection.delete({ where: { id: existing.id } });
        return { deleted: true };
    }

    /** Verifies credentials without importing anything. */
    async testConnection(tenantId: string, dto: TestExternalSyncConnectionDto) {
        let password = dto.password;
        if (!password) {
            const existing = await this.db.externalSyncConnection.findUnique({
                where: { tenant_id_provider: { tenant_id: tenantId, provider: EXPRESS_RETAIL_PROVIDER } },
                select: { password_encrypted: true },
            });
            if (!existing) {
                throw new BadRequestException('No stored password — supply one to test');
            }
            password = this.encryption.decrypt(existing.password_encrypted);
        }

        const client = new ExpressRetailClient({ baseUrl: dto.baseUrl, username: dto.username, password });
        const session = await client.login();

        return {
            ok: true,
            organizationId: session.organizationId,
            user: { name: session.name, username: session.username, role: session.role },
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
        const connection = await this.db.externalSyncConnection.findUnique({
            where: { tenant_id_provider: { tenant_id: tenantId, provider: EXPRESS_RETAIL_PROVIDER } },
        });
        if (!connection) throw new NotFoundException('No Express Retail Pro connection configured for this tenant');

        const inFlight = await this.db.externalSyncRun.findFirst({
            where: { connection_id: connection.id, status: 'RUNNING' },
            select: { id: true, started_at: true },
        });
        if (inFlight) {
            throw new ConflictException(`An import is already running (started ${inFlight.started_at.toISOString()})`);
        }

        const { from, to } = this.resolveWindow(connection, dto);

        const run = await this.db.externalSyncRun.create({
            data: {
                tenant_id: tenantId,
                connection_id: connection.id,
                trigger,
                status: 'RUNNING',
                window_from: from,
                window_to: to,
                dry_run: dto.dryRun ?? false,
                triggered_by: userId ?? null,
            },
        });

        // Intentionally not awaited — the run row is the progress channel.
        void this.executeRun(run.id, connection.id, { from, to }, dto.dryRun ?? false).catch((error) => {
            this.logger.error(`External sync run ${run.id} crashed: ${error?.message ?? error}`, error?.stack);
        });

        return run;
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

    private async executeRun(runId: string, connectionId: string, window: { from: Date; to: Date }, dryRun: boolean) {
        const stats: SyncStats = {
            products: emptyTally(),
            customers: emptyTally(),
            suppliers: emptyTally(),
            sales: emptyTally(),
            purchases: emptyTally(),
        };
        const warnings: SyncWarning[] = [];

        const connection = await this.db.externalSyncConnection.findUnique({ where: { id: connectionId } });
        if (!connection) return;

        await this.db.externalSyncConnection.update({
            where: { id: connectionId },
            data: { last_run_at: new Date() },
        });

        try {
            const client = new ExpressRetailClient({
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

            const productMap = await this.syncProducts(connection, client, stats, warnings, dryRun);
            const customerMap = await this.syncCustomers(connection, client, stats, warnings, dryRun);
            const supplierMap = await this.syncSuppliers(connection, client, stats, warnings, dryRun);

            for (const chunk of splitIntoMonthlyWindows(window.from, window.to)) {
                await this.syncSalesWindow(connection, client, chunk, productMap, customerMap, stats, warnings, dryRun);
                await this.syncPurchasesWindow(connection, client, chunk, productMap, supplierMap, stats, warnings, dryRun);
            }

            const status = warnings.length > 0 ? 'PARTIAL' : 'SUCCESS';
            await this.db.externalSyncRun.update({
                where: { id: runId },
                data: {
                    status,
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
            await this.db.externalSyncRun.update({
                where: { id: runId },
                data: {
                    status: 'FAILED',
                    stats: stats as any,
                    warnings: warnings.slice(0, MAX_STORED_WARNINGS) as any,
                    error_message: String(error?.message ?? error).slice(0, 2000),
                    finished_at: new Date(),
                },
            });
        }
    }

    // --------------------------------------------------------- master data

    private async syncProducts(
        connection: { id: string; tenant_id: string },
        client: ExpressRetailClient,
        stats: SyncStats,
        warnings: SyncWarning[],
        dryRun: boolean,
    ): Promise<Map<string, string>> {
        const rows = await client.fetchProducts();
        const claimedSkus = new Set<string>();
        const map = await this.loadMappings(connection.id, 'PRODUCT');

        for (const row of rows) {
            const mapped = mapProduct(row, claimedSkus);
            const existingId = map.get(mapped.externalId);

            if (dryRun) {
                existingId ? stats.products.updated++ : stats.products.created++;
                continue;
            }

            if (existingId) {
                await this.db.product.update({
                    where: { id: existingId },
                    data: { name: mapped.name, price: mapped.price, vat_rate: mapped.vatRate, reorder_level: mapped.reorderLevel },
                });
                stats.products.updated++;
                continue;
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
        }

        return map;
    }

    private async syncCustomers(
        connection: { id: string; tenant_id: string },
        client: ExpressRetailClient,
        stats: SyncStats,
        warnings: SyncWarning[],
        dryRun: boolean,
    ): Promise<Map<string, string>> {
        const rows = await client.fetchCustomers();
        const claimedCodes = new Set<string>();
        const map = await this.loadMappings(connection.id, 'CUSTOMER');

        for (const row of rows) {
            const mapped = mapCustomer(row, claimedCodes);
            const existingId = map.get(mapped.externalId);

            if (dryRun) {
                existingId ? stats.customers.updated++ : stats.customers.created++;
                continue;
            }

            if (existingId) {
                await this.db.customer.update({
                    where: { id: existingId },
                    data: {
                        name: mapped.name,
                        owner_name: mapped.ownerName,
                        email: mapped.email,
                        address: mapped.address,
                        credit_limit: mapped.creditLimit,
                    },
                });
                stats.customers.updated++;
                continue;
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
        }

        return map;
    }

    private async syncSuppliers(
        connection: { id: string; tenant_id: string },
        client: ExpressRetailClient,
        stats: SyncStats,
        warnings: SyncWarning[],
        dryRun: boolean,
    ): Promise<Map<string, string>> {
        const rows = await client.fetchSuppliers();
        const claimedNames = new Set<string>();
        const map = await this.loadMappings(connection.id, 'SUPPLIER');

        for (const row of rows) {
            const mapped = mapSupplier(row, claimedNames);
            const existingId = map.get(mapped.externalId);

            if (dryRun) {
                existingId ? stats.suppliers.updated++ : stats.suppliers.created++;
                continue;
            }

            if (existingId) {
                await this.db.supplier.update({
                    where: { id: existingId },
                    data: { phone: mapped.phone, email: mapped.email, address: mapped.address },
                });
                stats.suppliers.updated++;
                continue;
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
        }

        return map;
    }

    // ------------------------------------------------------------ documents

    private async syncSalesWindow(
        connection: { id: string; tenant_id: string; store_id: string; document_prefix: string },
        client: ExpressRetailClient,
        window: DateWindow,
        productMap: Map<string, string>,
        customerMap: Map<string, string>,
        stats: SyncStats,
        warnings: SyncWarning[],
        dryRun: boolean,
    ) {
        const [headers, lines] = await Promise.all([client.fetchSales(window), client.fetchSaleLines(window)]);
        const linesBySale = groupBy(lines, (line) => String(line.sale_id));
        const saleMap = await this.loadMappings(connection.id, 'SALE');

        for (const header of headers) {
            const mapped = mapSale(header, linesBySale.get(String(header.id)) ?? [], connection.document_prefix, warnings);
            if (dryRun) {
                saleMap.has(mapped.externalId) ? stats.sales.updated++ : stats.sales.created++;
                continue;
            }

            try {
                const created = await this.writeSale(connection, mapped, productMap, customerMap, saleMap, warnings);
                created ? stats.sales.created++ : stats.sales.updated++;
            } catch (error: any) {
                stats.sales.skipped++;
                warnings.push({
                    entity: 'SALE',
                    externalId: mapped.externalId,
                    code: 'WRITE_FAILED',
                    message: `Invoice ${header.invoice} could not be imported: ${error?.message ?? error}`,
                });
            }
        }
    }

    private async writeSale(
        connection: { id: string; tenant_id: string; store_id: string },
        mapped: MappedSale,
        productMap: Map<string, string>,
        customerMap: Map<string, string>,
        saleMap: Map<string, string>,
        warnings: SyncWarning[],
    ): Promise<boolean> {
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

        if (existingId) {
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

        const sale = await this.db.sale.create({
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
        connection: { id: string; tenant_id: string; store_id: string; document_prefix: string },
        client: ExpressRetailClient,
        window: DateWindow,
        productMap: Map<string, string>,
        supplierMap: Map<string, string>,
        stats: SyncStats,
        warnings: SyncWarning[],
        dryRun: boolean,
    ) {
        const [headers, lines] = await Promise.all([client.fetchPurchases(window), client.fetchPurchaseLines(window)]);
        const linesByPurchase = groupBy(lines, (line) => String(line.purchase_id));
        const purchaseMap = await this.loadMappings(connection.id, 'PURCHASE');

        for (const header of headers) {
            const mapped = mapPurchase(
                header,
                linesByPurchase.get(String(header.id)) ?? [],
                connection.document_prefix,
                warnings,
            );
            if (dryRun) {
                purchaseMap.has(mapped.externalId) ? stats.purchases.updated++ : stats.purchases.created++;
                continue;
            }

            try {
                const created = await this.writePurchase(connection, mapped, productMap, supplierMap, purchaseMap, warnings);
                created ? stats.purchases.created++ : stats.purchases.updated++;
            } catch (error: any) {
                stats.purchases.skipped++;
                warnings.push({
                    entity: 'PURCHASE',
                    externalId: mapped.externalId,
                    code: 'WRITE_FAILED',
                    message: `Purchase ${header.invoice} could not be imported: ${error?.message ?? error}`,
                });
            }
        }
    }

    private async writePurchase(
        connection: { id: string; tenant_id: string; store_id: string },
        mapped: MappedPurchase,
        productMap: Map<string, string>,
        supplierMap: Map<string, string>,
        purchaseMap: Map<string, string>,
        warnings: SyncWarning[],
    ): Promise<boolean> {
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

        if (existingId) {
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

        const purchase = await this.db.purchase.create({
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
