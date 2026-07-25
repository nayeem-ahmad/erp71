import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { GetInventoryValuationDto, GetReorderSuggestionsDto, GetShrinkageSummaryDto, GetStockAgingDto } from './inventory-reports.dto';

/** Buckets stock is sorted into by how long it has sat without moving. */
const AGING_BUCKETS = [
    { key: 'days_0_30', label: '0-30 days', maxDays: 30 },
    { key: 'days_31_60', label: '31-60 days', maxDays: 60 },
    { key: 'days_61_90', label: '61-90 days', maxDays: 90 },
    { key: 'days_91_180', label: '91-180 days', maxDays: 180 },
    { key: 'days_180_plus', label: 'Over 180 days', maxDays: Number.POSITIVE_INFINITY },
] as const;

@Injectable()
export class InventoryReportsService {
    constructor(private db: DatabaseService) {}

    async getReorderSuggestions(tenantId: string, query: GetReorderSuggestionsDto) {
        const settings = await this.db.inventorySettings.findUnique({
            where: { tenant_id: tenantId },
        });

        const products = await this.db.product.findMany({
            where: {
                tenant_id: tenantId,
                ...(query.groupId ? { group_id: query.groupId } : {}),
                ...(query.subgroupId ? { subgroup_id: query.subgroupId } : {}),
            },
            include: {
                group: true,
                subgroup: true,
                stocks: {
                    where: query.warehouseId ? { warehouse_id: query.warehouseId } : undefined,
                    include: { warehouse: true },
                },
            },
            orderBy: { name: 'asc' },
        });

        const inTransitItems = await this.db.warehouseTransferItem.findMany({
            where: {
                transfer: {
                    tenant_id: tenantId,
                    status: { in: ['SENT', 'PARTIALLY_RECEIVED'] },
                    ...(query.warehouseId ? { destination_warehouse_id: query.warehouseId } : {}),
                },
            },
            include: {
                transfer: {
                    include: { destinationWarehouse: true },
                },
            },
        });

        const inTransitByProduct = new Map<string, number>();
        for (const item of inTransitItems) {
            const outstanding = item.quantity_sent - item.quantity_received;
            if (outstanding <= 0) continue;
            inTransitByProduct.set(item.product_id, (inTransitByProduct.get(item.product_id) ?? 0) + outstanding);
        }

        return products
            .map((product) => {
                const reorderLevel = product.reorder_level ?? settings?.default_reorder_level ?? null;
                const safetyStock = product.safety_stock ?? settings?.default_safety_stock ?? null;
                const leadTimeDays = product.lead_time_days ?? settings?.default_lead_time_days ?? null;
                const onHand = product.stocks.reduce((sum, stock) => sum + stock.quantity, 0);
                const inTransit = inTransitByProduct.get(product.id) ?? 0;

                if (reorderLevel === null || safetyStock === null) {
                    return {
                        product,
                        onHand,
                        inTransit,
                        targetStock: null,
                        suggestedQuantity: 0,
                        shortageReason: 'Missing stock policy configuration',
                        configSource: 'UNCONFIGURED',
                        leadTimeDays,
                    };
                }

                const targetStock = reorderLevel + safetyStock;
                const suggestedQuantity = Math.max(0, targetStock - (onHand + inTransit));
                return {
                    product,
                    onHand,
                    inTransit,
                    targetStock,
                    suggestedQuantity,
                    shortageReason:
                        suggestedQuantity > 0
                            ? `On hand ${onHand} + in transit ${inTransit} is below target ${targetStock}`
                            : 'Stock is currently above threshold',
                    configSource:
                        product.reorder_level !== null || product.safety_stock !== null || product.lead_time_days !== null
                            ? 'PRODUCT'
                            : 'DEFAULT',
                    leadTimeDays,
                };
            })
            .filter((row) => row.suggestedQuantity > 0 || row.configSource === 'UNCONFIGURED');
    }

    async getInventoryValuation(tenantId: string, query: GetInventoryValuationDto) {
        const products = await this.db.product.findMany({
            where: {
                tenant_id: tenantId,
                ...(query.groupId ? { group_id: query.groupId } : {}),
                ...(query.subgroupId ? { subgroup_id: query.subgroupId } : {}),
            },
            include: {
                group: true,
                subgroup: true,
                stocks: {
                    where: query.warehouseId ? { warehouse_id: query.warehouseId } : undefined,
                    include: { warehouse: true },
                },
            },
            orderBy: { name: 'asc' },
        });

        const rows = products.map((product) => {
            const quantity = product.stocks.reduce((sum, stock) => sum + stock.quantity, 0);
            const unitValue = Number(product.price || 0);
            const stockValue = quantity * unitValue;
            return {
                product,
                quantity,
                unitValue,
                stockValue,
            };
        });

        const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
        const totalStockValue = rows.reduce((sum, row) => sum + row.stockValue, 0);
        const productCount = rows.filter((row) => row.quantity > 0).length;

        return {
            summary: {
                totalQuantity,
                totalStockValue,
                productCount,
                averageUnitValue: productCount > 0 ? totalStockValue / Math.max(totalQuantity, 1) : 0,
            },
            rows,
        };
    }

    /**
     * Stock that is not selling: quantity on hand paired with how long it has
     * been since anything left the shelf.
     *
     * "Days since last sold" comes from the inventory movement ledger rather
     * than sale rows, so a warehouse filter actually narrows it — a product can
     * be selling briskly in one branch while the same units sit dead in another,
     * and a tenant-wide last-sold date would hide exactly that.
     *
     * Products that have never had an outbound movement report `null` days and
     * are counted separately; treating "never sold" as a very large number would
     * bury genuinely stale stock underneath brand-new arrivals.
     */
    async getStockAging(tenantId: string, query: GetStockAgingDto) {
        const slowMovingAfterDays = query.slowMovingAfterDays ?? 60;
        const now = Date.now();

        const products = await this.db.product.findMany({
            where: {
                tenant_id: tenantId,
                deleted_at: null,
                ...(query.groupId ? { group_id: query.groupId } : {}),
                ...(query.subgroupId ? { subgroup_id: query.subgroupId } : {}),
            },
            select: {
                id: true,
                name: true,
                sku: true,
                price: true,
                group: { select: { id: true, name: true } },
                stocks: {
                    where: query.warehouseId ? { warehouse_id: query.warehouseId } : undefined,
                    select: { quantity: true },
                },
            },
        });

        const inStock = products
            .map((product) => ({
                product,
                quantity: product.stocks.reduce((sum, stock) => sum + stock.quantity, 0),
            }))
            .filter((row) => row.quantity > 0);

        // One grouped query for the whole catalogue rather than a query per
        // product: a mid-sized shop has thousands of SKUs and the per-product
        // version turns this report into a timeout.
        const lastOutbound = await this.db.inventoryMovement.groupBy({
            by: ['product_id'],
            where: {
                tenant_id: tenantId,
                movement_type: 'SALE',
                ...(query.warehouseId ? { warehouse_id: query.warehouseId } : {}),
                product_id: { in: inStock.map((row) => row.product.id) },
            },
            _max: { created_at: true },
        });

        const lastSoldAt = new Map<string, Date>();
        for (const row of lastOutbound) {
            if (row._max.created_at) lastSoldAt.set(row.product_id, row._max.created_at);
        }

        const rows = inStock.map(({ product, quantity }) => {
            const lastSold = lastSoldAt.get(product.id) ?? null;
            const daysSinceLastSale = lastSold
                ? Math.max(0, Math.floor((now - lastSold.getTime()) / (24 * 60 * 60 * 1000)))
                : null;
            const unitValue = Number(product.price || 0);
            const bucket =
                daysSinceLastSale === null
                    ? 'never_sold'
                    : (AGING_BUCKETS.find((b) => daysSinceLastSale <= b.maxDays)?.key ?? 'days_180_plus');

            return {
                product: {
                    id: product.id,
                    name: product.name,
                    sku: product.sku,
                    group: product.group ? { id: product.group.id, name: product.group.name } : null,
                },
                quantity,
                unitValue,
                stockValue: quantity * unitValue,
                lastSoldAt: lastSold ? lastSold.toISOString().slice(0, 10) : null,
                daysSinceLastSale,
                bucket,
                isSlowMoving: daysSinceLastSale === null || daysSinceLastSale >= slowMovingAfterDays,
            };
        });

        const bucketTotals = [...AGING_BUCKETS.map((b) => ({ key: b.key, label: b.label })), { key: 'never_sold', label: 'Never sold' }]
            .map(({ key, label }) => {
                const inBucket = rows.filter((row) => row.bucket === key);
                return {
                    bucket: key,
                    label,
                    productCount: inBucket.length,
                    quantity: inBucket.reduce((sum, row) => sum + row.quantity, 0),
                    stockValue: inBucket.reduce((sum, row) => sum + row.stockValue, 0),
                };
            });

        const slowMoving = rows.filter((row) => row.isSlowMoving);
        const totalStockValue = rows.reduce((sum, row) => sum + row.stockValue, 0);
        const slowMovingValue = slowMoving.reduce((sum, row) => sum + row.stockValue, 0);

        return {
            summary: {
                slowMovingAfterDays,
                productsInStock: rows.length,
                totalStockValue,
                slowMovingProducts: slowMoving.length,
                slowMovingValue,
                slowMovingShareOfValuePct: totalStockValue > 0 ? (slowMovingValue / totalStockValue) * 100 : 0,
                neverSoldProducts: rows.filter((row) => row.daysSinceLastSale === null).length,
                valuationBasis: 'CURRENT_SELLING_PRICE',
            },
            buckets: bucketTotals,
            rows: rows.sort((a, b) => {
                // Stalest first, with never-sold stock at the very top — that is
                // the capital most at risk, and it is what the report is for.
                const aDays = a.daysSinceLastSale ?? Number.POSITIVE_INFINITY;
                const bDays = b.daysSinceLastSale ?? Number.POSITIVE_INFINITY;
                if (aDays !== bDays) return bDays - aDays;
                return b.stockValue - a.stockValue;
            }),
        };
    }

    async getShrinkageSummary(tenantId: string, query: GetShrinkageSummaryDto) {
        const rows = await this.db.inventoryShrinkage.findMany({
            where: {
                tenant_id: tenantId,
                ...(query.warehouseId ? { warehouse_id: query.warehouseId } : {}),
                ...(query.reasonId ? { reason_id: query.reasonId } : {}),
                ...buildDateWindow(query.from, query.to),
                ...(query.productId || query.groupId || query.subgroupId
                    ? {
                          items: {
                              some: {
                                  ...(query.productId ? { product_id: query.productId } : {}),
                                  ...(query.groupId || query.subgroupId
                                      ? {
                                            product: {
                                                ...(query.groupId ? { group_id: query.groupId } : {}),
                                                ...(query.subgroupId ? { subgroup_id: query.subgroupId } : {}),
                                            },
                                        }
                                      : {}),
                              },
                          },
                      }
                    : {}),
            },
            include: {
                warehouse: true,
                reason: true,
                items: {
                    include: {
                        product: {
                            include: { group: true, subgroup: true },
                        },
                    },
                },
            },
            orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        });

        const detailRows = rows.flatMap((record) =>
            record.items
                .filter((item) => {
                    if (query.productId && item.product_id !== query.productId) return false;
                    if (query.groupId && item.product.group_id !== query.groupId) return false;
                    if (query.subgroupId && item.product.subgroup_id !== query.subgroupId) return false;
                    return true;
                })
                .map((item) => ({
                    shrinkageId: record.id,
                    referenceNumber: record.reference_number,
                    createdAt: record.created_at,
                    warehouse: record.warehouse,
                    reason: record.reason,
                    product: item.product,
                    quantity: item.quantity,
                    unitCost: Number(item.unit_cost ?? item.product.price ?? 0),
                    estimatedValue: item.quantity * Number(item.unit_cost ?? item.product.price ?? 0),
                })),
        );

        const totalQuantity = detailRows.reduce((sum, row) => sum + row.quantity, 0);
        const totalValue = detailRows.reduce((sum, row) => sum + row.estimatedValue, 0);
        const grouped = new Map<string, { warehouseName: string; reasonLabel: string; quantity: number; value: number }>();

        for (const row of detailRows) {
            const key = `${row.warehouse.id}:${row.reason.id}`;
            const current = grouped.get(key) ?? {
                warehouseName: row.warehouse.name,
                reasonLabel: row.reason.label,
                quantity: 0,
                value: 0,
            };
            current.quantity += row.quantity;
            current.value += row.estimatedValue;
            grouped.set(key, current);
        }

        const groupedRows = Array.from(grouped.values()).sort((left, right) => right.value - left.value);

        return {
            summary: {
                totalQuantity,
                totalValue,
                costingMethod: 'CURRENT_SELLING_PRICE',
                topReasons: groupedRows.slice(0, 5),
            },
            rows: groupedRows,
            detailRows,
        };
    }
}

function buildDateWindow(from?: string, to?: string) {
    const where: Record<string, any> = {};
    if (from || to) {
        where.created_at = {};
        if (from) {
            const date = new Date(from);
            if (!Number.isNaN(date.getTime())) where.created_at.gte = date;
        }
        if (to) {
            // A bare YYYY-MM-DD upper bound covers the whole day; parsed as-is it
            // would be midnight and drop everything recorded on the last day.
            const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(to.trim());
            const date = new Date(dateOnly ? `${to.trim()}T23:59:59.999Z` : to);
            if (!Number.isNaN(date.getTime())) where.created_at.lte = date;
        }
    }
    return where;
}