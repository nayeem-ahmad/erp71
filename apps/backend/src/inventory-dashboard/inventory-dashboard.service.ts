import { Injectable } from '@nestjs/common';
import { hasPlanEntitlement } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { PlanEntitlementsService } from '../subscription-plans/plan-entitlements.service';
import {
    emptyDailyBuckets,
    money,
    resolveDateWindow,
    type DateWindow,
} from '../common/dashboard-window';
import { InventoryDashboardQueryDto } from './inventory-dashboard.dto';

/** Ranked panels show a handful of rows; the rest is noise on a dashboard. */
const RANK_LIMIT = 6;

/**
 * How long stock may sit without a movement before each bucket claims it.
 * Mirrors `InventoryReportsService`'s buckets so the dashboard and the aging
 * report never disagree about what "91-180 days" means.
 */
const AGING_BUCKETS = [
    { key: 'days_0_30', maxDays: 30 },
    { key: 'days_31_60', maxDays: 60 },
    { key: 'days_61_90', maxDays: 90 },
    { key: 'days_91_180', maxDays: 180 },
    { key: 'days_180_plus', maxDays: Number.POSITIVE_INFINITY },
] as const;

type ProductStockRow = {
    id: string;
    name: string;
    sku: string | null;
    price: unknown;
    reorder_level: number | null;
    group_id: string | null;
    group: { id: string; name: string } | null;
    stocks: Array<{ quantity: number }>;
};

function onHandOf(product: { stocks: Array<{ quantity: number }> }): number {
    return product.stocks.reduce((sum, stock) => sum + stock.quantity, 0);
}

/**
 * Aggregates for the Inventory dashboard: what is on the shelf, what is about to
 * run out, and what moved.
 *
 * One service rather than more methods on `InventoryReportsService` because the
 * payload spans products, movements, shrinkage, stock takes and transfers, and
 * the Overview must paint in one round trip rather than five.
 */
@Injectable()
export class InventoryDashboardService {
    constructor(
        private readonly db: DatabaseService,
        private readonly entitlements: PlanEntitlementsService,
    ) {}

    async getOverview(tenantId: string, query: InventoryDashboardQueryDto, timezone: string) {
        const window = resolveDateWindow(query, timezone);

        const [features, settings, products] = await Promise.all([
            this.entitlements.getFeaturesForTenant(tenantId),
            this.db.inventorySettings.findUnique({ where: { tenant_id: tenantId } }),
            this.db.product.findMany({
                where: { tenant_id: tenantId, deleted_at: null },
                select: {
                    id: true,
                    name: true,
                    sku: true,
                    price: true,
                    reorder_level: true,
                    group_id: true,
                    group: { select: { id: true, name: true } },
                    stocks: { select: { quantity: true } },
                },
            }),
        ]);

        // Valuation and aging are the premium half of inventory reporting. A plan
        // without it gets the counts and a null here, not a refused request.
        const canValue = hasPlanEntitlement(features, 'premiumInventoryReports');
        const defaultReorderLevel = settings?.default_reorder_level ?? null;

        const [movement, shrinkage, stockTakes, inTransit, aging] = await Promise.all([
            this.getMovement(tenantId, window),
            this.getShrinkage(tenantId, window),
            this.getStockTakes(tenantId, window),
            this.getInTransit(tenantId),
            canValue ? this.getAging(tenantId, products as ProductStockRow[]) : Promise.resolve(null),
        ]);

        return {
            filters: { from: window.from, to: window.to },
            // Stock is a stock, not a flow: these count the whole book and ignore
            // the window, the same way the CRM pipeline's stage counts do.
            stock: this.getStockPosition(products as ProductStockRow[], defaultReorderLevel, canValue),
            movement,
            shrinkage,
            stock_takes: stockTakes,
            transfers: { in_transit_units: inTransit },
            aging,
            low_stock: this.getLowStock(products as ProductStockRow[], defaultReorderLevel),
            top_value: canValue ? this.getTopValue(products as ProductStockRow[]) : [],
            categories: canValue ? this.getCategories(products as ProductStockRow[]) : [],
            can_value: canValue,
        };
    }

    private getStockPosition(products: ProductStockRow[], defaultReorderLevel: number | null, canValue: boolean) {
        let totalValue = 0;
        let totalUnits = 0;
        let outOfStock = 0;
        let belowReorder = 0;
        let negative = 0;
        let unconfigured = 0;

        for (const product of products) {
            const onHand = onHandOf(product);
            totalUnits += onHand;
            totalValue += onHand * Number(product.price ?? 0);

            if (onHand < 0) negative += 1;
            else if (onHand === 0) outOfStock += 1;

            const reorderLevel = product.reorder_level ?? defaultReorderLevel;
            if (reorderLevel === null) unconfigured += 1;
            else if (onHand > 0 && onHand <= reorderLevel) belowReorder += 1;
        }

        return {
            // Null rather than 0: a plan that cannot see valuation has no figure
            // here, and 0 would read as "your stock is worthless".
            total_value: canValue ? money(totalValue) : null,
            total_units: totalUnits,
            active_skus: products.length,
            out_of_stock: outOfStock,
            below_reorder: belowReorder,
            negative_stock: negative,
            unconfigured_policy: unconfigured,
        };
    }

    private async getMovement(tenantId: string, window: DateWindow) {
        const movements = await this.db.inventoryMovement.findMany({
            where: {
                tenant_id: tenantId,
                created_at: { gte: window.fromDate, lte: window.toDate },
            },
            select: { product_id: true, quantity_delta: true },
        });

        let inUnits = 0;
        let outUnits = 0;
        const touched = new Set<string>();
        for (const row of movements) {
            if (row.quantity_delta > 0) inUnits += row.quantity_delta;
            else outUnits += Math.abs(row.quantity_delta);
            touched.add(row.product_id);
        }

        return {
            in_units: inUnits,
            out_units: outUnits,
            movements_logged: movements.length,
            products_touched: touched.size,
        };
    }

    private async getShrinkage(tenantId: string, window: DateWindow) {
        const rows = await this.db.inventoryShrinkage.findMany({
            where: {
                tenant_id: tenantId,
                created_at: { gte: window.fromDate, lte: window.toDate },
            },
            select: { items: { select: { quantity: true, unit_cost: true } } },
        });

        let units = 0;
        let value = 0;
        for (const row of rows) {
            for (const item of row.items) {
                units += item.quantity;
                value += item.quantity * Number(item.unit_cost ?? 0);
            }
        }

        return { events: rows.length, units, value: money(value) };
    }

    private async getStockTakes(tenantId: string, window: DateWindow) {
        const [open, posted] = await Promise.all([
            this.db.stockTakeSession.count({
                where: { tenant_id: tenantId, status: { in: ['DRAFT', 'COUNTING'] } },
            }),
            this.db.stockTakeSession.count({
                where: {
                    tenant_id: tenantId,
                    posted_at: { gte: window.fromDate, lte: window.toDate },
                },
            }),
        ]);
        return { open, posted_in_period: posted };
    }

    /** Units sent but not yet received — stock the shelf count cannot see. */
    private async getInTransit(tenantId: string) {
        const items = await this.db.warehouseTransferItem.findMany({
            where: {
                transfer: {
                    tenant_id: tenantId,
                    status: { in: ['SENT', 'PARTIALLY_RECEIVED'] },
                },
            },
            select: { quantity_sent: true, quantity_received: true },
        });

        return items.reduce((sum, item) => sum + Math.max(0, item.quantity_sent - item.quantity_received), 0);
    }

    /**
     * Buckets stock by how long since its product last moved. A product that has
     * never moved is aged from the oldest bucket — it has been sitting there
     * since before the ledger started, which is not "fresh".
     */
    private async getAging(tenantId: string, products: ProductStockRow[]) {
        const lastMoved = await this.db.inventoryMovement.groupBy({
            by: ['product_id'],
            where: { tenant_id: tenantId },
            _max: { created_at: true },
        });
        const lastMovedAt = new Map(lastMoved.map((row) => [row.product_id, row._max.created_at]));

        const buckets = AGING_BUCKETS.map((bucket) => ({ key: bucket.key, units: 0, value: 0 }));
        const now = Date.now();

        for (const product of products) {
            const onHand = onHandOf(product);
            if (onHand <= 0) continue;

            const movedAt = lastMovedAt.get(product.id);
            const days = movedAt ? Math.floor((now - movedAt.getTime()) / 86_400_000) : Number.POSITIVE_INFINITY;
            const index = AGING_BUCKETS.findIndex((bucket) => days <= bucket.maxDays);
            const bucket = buckets[index === -1 ? buckets.length - 1 : index];
            bucket.units += onHand;
            bucket.value += onHand * Number(product.price ?? 0);
        }

        return buckets.map((bucket) => ({ ...bucket, value: money(bucket.value) }));
    }

    /**
     * What to reorder. Ordered by how far below the line each product has fallen,
     * not by name — a product one unit short is not as urgent as one at zero.
     */
    private getLowStock(products: ProductStockRow[], defaultReorderLevel: number | null) {
        return products
            .map((product) => {
                const onHand = onHandOf(product);
                const reorderLevel = product.reorder_level ?? defaultReorderLevel;
                return { product, onHand, reorderLevel };
            })
            .filter((row) => row.reorderLevel !== null && row.onHand <= (row.reorderLevel as number))
            .sort((a, b) => (a.onHand - (a.reorderLevel as number)) - (b.onHand - (b.reorderLevel as number)))
            .slice(0, RANK_LIMIT)
            .map((row) => ({
                id: row.product.id,
                name: row.product.name,
                sku: row.product.sku,
                on_hand: row.onHand,
                reorder_level: row.reorderLevel as number,
                shortfall: Math.max(0, (row.reorderLevel as number) - row.onHand),
            }));
    }

    private getTopValue(products: ProductStockRow[]) {
        return products
            .map((product) => {
                const onHand = onHandOf(product);
                return {
                    id: product.id,
                    name: product.name,
                    sku: product.sku,
                    units: onHand,
                    value: money(onHand * Number(product.price ?? 0)),
                };
            })
            .filter((row) => row.value > 0)
            .sort((a, b) => b.value - a.value)
            .slice(0, RANK_LIMIT);
    }

    private getCategories(products: ProductStockRow[]) {
        const byGroup = new Map<string, { id: string | null; name: string; units: number; value: number }>();

        for (const product of products) {
            const onHand = onHandOf(product);
            if (onHand <= 0) continue;
            const key = product.group?.id ?? 'ungrouped';
            const entry = byGroup.get(key) ?? {
                id: product.group?.id ?? null,
                name: product.group?.name ?? 'Ungrouped',
                units: 0,
                value: 0,
            };
            entry.units += onHand;
            entry.value += onHand * Number(product.price ?? 0);
            byGroup.set(key, entry);
        }

        return [...byGroup.values()]
            .map((entry) => ({ ...entry, value: money(entry.value) }))
            .sort((a, b) => b.value - a.value)
            .slice(0, RANK_LIMIT);
    }

    /** Daily in/out units, feeding the KPI sparklines. */
    async getTrends(tenantId: string, query: InventoryDashboardQueryDto, timezone: string) {
        const window = resolveDateWindow(query, timezone);

        const movements = await this.db.inventoryMovement.findMany({
            where: {
                tenant_id: tenantId,
                created_at: { gte: window.fromDate, lte: window.toDate },
            },
            select: { created_at: true, quantity_delta: true },
        });

        const buckets = emptyDailyBuckets(window, () => ({ units_in: 0, units_out: 0, movements: 0 }));

        for (const row of movements) {
            const bucket = buckets.get(window.dayOf(row.created_at));
            if (!bucket) continue;
            if (row.quantity_delta > 0) bucket.units_in += row.quantity_delta;
            else bucket.units_out += Math.abs(row.quantity_delta);
            bucket.movements += 1;
        }

        return {
            points: [...buckets.entries()].map(([date, values]) => ({ date, ...values })),
        };
    }
}
