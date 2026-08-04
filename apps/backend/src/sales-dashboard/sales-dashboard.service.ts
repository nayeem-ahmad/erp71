import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
    emptyDailyBuckets,
    formatDate,
    money,
    percent,
    resolveDateWindow,
    startOfDay,
    type DateWindow,
} from '../common/dashboard-window';
import { SalesDashboardQueryDto } from './sales-dashboard.dto';

/** Ranked panels show a handful of rows; the rest is noise on a dashboard. */
const RANK_LIMIT = 6;
const RECENT_SALES = 5;

/** A quote this close to its validity date is worth chasing. */
const EXPIRING_WITHIN_DAYS = 7;

/** Orders raised but not yet delivered. */
const OPEN_ORDER_STATUSES = ['DRAFT', 'CONFIRMED', 'PROCESSING'];
/** Quotes still in play — everything before the terminal states. */
const OPEN_QUOTE_STATUSES = ['DRAFT', 'SENT'];
/** Deliveries that have not landed. */
const OPEN_DELIVERY_STATUSES = ['PENDING', 'ASSIGNED', 'IN_TRANSIT'];

/**
 * Aggregates for the Sales dashboard: what sold, what it earned, and what is
 * still owed or undelivered.
 *
 * Sized deliberately so `RetailDashboard` can move onto it later — that page
 * currently fires eight requests to paint the same picture. Until it does, this
 * serves Sales > Overview alone.
 */
@Injectable()
export class SalesDashboardService {
    constructor(private readonly db: DatabaseService) {}

    async getOverview(tenantId: string, query: SalesDashboardQueryDto) {
        const window = resolveDateWindow(query);

        const [sales, margin, receivables, fulfilment, products, customers, recent] = await Promise.all([
            this.getSales(tenantId, window),
            this.getMargin(tenantId, window),
            this.getReceivables(tenantId),
            this.getFulfilment(tenantId),
            this.getTopProducts(tenantId, window),
            this.getTopCustomers(tenantId, window),
            this.getRecent(tenantId),
        ]);

        return {
            filters: { from: window.from, to: window.to },
            sales,
            margin,
            receivables,
            fulfilment,
            products: products.rows,
            categories: products.categories,
            customers,
            recent,
        };
    }

    private saleWhere(tenantId: string, window: DateWindow) {
        return {
            tenant_id: tenantId,
            status: 'COMPLETED',
            sale_date: { gte: window.fromDate, lte: window.toDate },
        };
    }

    private async getSales(tenantId: string, window: DateWindow) {
        const [sold, returned] = await Promise.all([
            this.db.sale.aggregate({
                where: this.saleWhere(tenantId, window),
                _sum: { total_amount: true },
                _count: { _all: true },
            }),
            this.db.salesReturn.aggregate({
                where: {
                    tenant_id: tenantId,
                    created_at: { gte: window.fromDate, lte: window.toDate },
                },
                _sum: { total_refund: true },
                _count: { _all: true },
            }),
        ]);

        const gross = Number(sold._sum.total_amount ?? 0);
        const refunds = Number(returned._sum.total_refund ?? 0);
        const count = sold._count._all;

        return {
            gross: money(gross),
            returns: money(refunds),
            net: money(gross - refunds),
            count,
            returns_count: returned._count._all,
            // Null rather than 0: no sales means no average ticket, and 0 would
            // read as "your customers spent nothing".
            avg_ticket: count > 0 ? money(gross / count) : null,
        };
    }

    /**
     * Gross profit from the cost captured on each line at the time of sale.
     *
     * Lines with no `unit_cost_at_sale` are counted and reported rather than
     * treated as free stock: a margin computed over half the lines is not a
     * margin, and the caller needs to know how much of the basket it covers.
     */
    private async getMargin(tenantId: string, window: DateWindow) {
        const items = await this.db.saleItem.findMany({
            where: { sale: this.saleWhere(tenantId, window) },
            select: { quantity: true, price_at_sale: true, unit_cost_at_sale: true },
        });

        let revenue = 0;
        let cost = 0;
        let costed = 0;
        let uncosted = 0;
        let units = 0;

        for (const item of items) {
            units += item.quantity;
            if (item.unit_cost_at_sale == null) {
                uncosted += 1;
                continue;
            }
            costed += 1;
            revenue += Number(item.price_at_sale) * item.quantity;
            cost += Number(item.unit_cost_at_sale) * item.quantity;
        }

        const hasBasis = costed > 0;
        return {
            gross_profit: hasBasis ? money(revenue - cost) : null,
            margin_pct: hasBasis ? percent(revenue - cost, revenue) : null,
            costed_items: costed,
            uncosted_items: uncosted,
            units,
        };
    }

    /** A balance across the whole book — windowing it would answer nothing. */
    private async getReceivables(tenantId: string) {
        const [total, owing] = await Promise.all([
            this.db.customer.aggregate({
                where: { tenant_id: tenantId, deleted_at: null },
                _sum: { due_balance: true },
            }),
            this.db.customer.count({
                where: { tenant_id: tenantId, deleted_at: null, due_balance: { gt: 0 } },
            }),
        ]);

        return {
            outstanding: money(Number(total._sum.due_balance ?? 0)),
            customers_owing: owing,
        };
    }

    private async getFulfilment(tenantId: string) {
        const now = new Date();
        const soon = new Date(now);
        soon.setDate(soon.getDate() + EXPIRING_WITHIN_DAYS);

        const [openOrders, overdueOrders, pendingDeliveries, openQuotes, expiringQuotes] = await Promise.all([
            this.db.salesOrder.count({
                where: { tenant_id: tenantId, status: { in: OPEN_ORDER_STATUSES } },
            }),
            // Past its promised delivery date and still not delivered. An order
            // with no delivery date promised nothing and cannot be late.
            this.db.salesOrder.count({
                where: {
                    tenant_id: tenantId,
                    status: { in: OPEN_ORDER_STATUSES },
                    delivery_date: { lt: now },
                },
            }),
            this.db.deliveryOrder.count({
                where: { tenantId, status: { in: OPEN_DELIVERY_STATUSES } },
            }),
            this.db.quotation.count({
                where: { tenant_id: tenantId, status: { in: OPEN_QUOTE_STATUSES } },
            }),
            this.db.quotation.count({
                where: {
                    tenant_id: tenantId,
                    status: { in: OPEN_QUOTE_STATUSES },
                    valid_until: { gte: now, lte: soon },
                },
            }),
        ]);

        return {
            open_orders: openOrders,
            overdue_orders: overdueOrders,
            pending_deliveries: pendingDeliveries,
            open_quotes: openQuotes,
            expiring_quotes: expiringQuotes,
        };
    }

    /**
     * Top products and the category mix, from one groupBy — the category rollup
     * is the same rows re-bucketed, and asking the database twice for that would
     * be two scans of the same items.
     */
    private async getTopProducts(tenantId: string, window: DateWindow) {
        const grouped = await this.db.saleItem.groupBy({
            by: ['product_id'],
            where: { sale: this.saleWhere(tenantId, window) },
            _sum: { quantity: true },
        });

        const productIds = grouped.map((row) => row.product_id);
        const products = await this.db.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true, price: true, group: { select: { id: true, name: true } } },
        });
        const byId = new Map(products.map((product) => [product.id, product]));

        const rows = grouped.map((row) => {
            const product = byId.get(row.product_id);
            const units = row._sum.quantity ?? 0;
            return {
                id: row.product_id,
                name: product?.name ?? 'Unknown product',
                units,
                revenue: money(units * Number(product?.price ?? 0)),
                groupId: product?.group?.id ?? null,
                groupName: product?.group?.name ?? 'Ungrouped',
            };
        });

        const byCategory = new Map<string, { id: string | null; name: string; revenue: number; units: number }>();
        for (const row of rows) {
            const key = row.groupId ?? 'ungrouped';
            const entry = byCategory.get(key) ?? { id: row.groupId, name: row.groupName, revenue: 0, units: 0 };
            entry.revenue += row.revenue;
            entry.units += row.units;
            byCategory.set(key, entry);
        }

        return {
            rows: rows
                .sort((a, b) => b.revenue - a.revenue)
                .slice(0, RANK_LIMIT)
                .map(({ groupId, groupName, ...rest }) => rest),
            categories: [...byCategory.values()]
                .map((entry) => ({ ...entry, revenue: money(entry.revenue) }))
                .sort((a, b) => b.revenue - a.revenue)
                .slice(0, RANK_LIMIT),
        };
    }

    private async getTopCustomers(tenantId: string, window: DateWindow) {
        const grouped = await this.db.sale.groupBy({
            by: ['customer_id'],
            where: this.saleWhere(tenantId, window),
            _sum: { total_amount: true },
            _count: { _all: true },
        });

        const ranked = grouped
            .map((row) => ({
                id: row.customer_id,
                revenue: Number(row._sum.total_amount ?? 0),
                orders: row._count._all,
            }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, RANK_LIMIT);

        const named = await this.db.customer.findMany({
            where: { id: { in: ranked.map((row) => row.id).filter((id): id is string => Boolean(id)) } },
            select: { id: true, name: true, due_balance: true },
        });
        const byId = new Map(named.map((customer) => [customer.id, customer]));

        return ranked.map((row) => ({
            id: row.id,
            // A walk-in sale has no customer; it is a real row, not a gap.
            name: row.id ? (byId.get(row.id)?.name ?? 'Unknown customer') : 'Walk-in',
            revenue: money(row.revenue),
            orders: row.orders,
            owed: money(Number(byId.get(row.id ?? '')?.due_balance ?? 0)),
        }));
    }

    private async getRecent(tenantId: string) {
        const rows = await this.db.sale.findMany({
            where: { tenant_id: tenantId, status: 'COMPLETED' },
            orderBy: { sale_date: 'desc' },
            take: RECENT_SALES,
            select: {
                id: true,
                serial_number: true,
                total_amount: true,
                amount_paid: true,
                sale_date: true,
                customer: { select: { name: true } },
            },
        });

        return rows.map((row) => ({
            id: row.id,
            serial_number: row.serial_number,
            customer_name: row.customer?.name ?? null,
            total: money(Number(row.total_amount)),
            due: money(Number(row.total_amount) - Number(row.amount_paid)),
            sale_date: row.sale_date,
        }));
    }

    /** Daily net sales and order count, feeding the KPI sparklines. */
    async getTrends(tenantId: string, query: SalesDashboardQueryDto) {
        const window = resolveDateWindow(query);

        const [sales, returns] = await Promise.all([
            this.db.sale.findMany({
                where: this.saleWhere(tenantId, window),
                select: { sale_date: true, total_amount: true },
            }),
            this.db.salesReturn.findMany({
                where: {
                    tenant_id: tenantId,
                    created_at: { gte: window.fromDate, lte: window.toDate },
                },
                select: { created_at: true, total_refund: true },
            }),
        ]);

        const buckets = emptyDailyBuckets(window, () => ({ net_sales: 0, orders: 0, returns: 0 }));

        for (const sale of sales) {
            // Local calendar day, not `toISOString()` — the sales *reports* still
            // bucket by UTC, which files every Dhaka evening under the day before.
            const bucket = buckets.get(formatDate(startOfDay(sale.sale_date)));
            if (!bucket) continue;
            bucket.net_sales += Number(sale.total_amount);
            bucket.orders += 1;
        }

        for (const refund of returns) {
            const bucket = buckets.get(formatDate(startOfDay(refund.created_at)));
            if (!bucket) continue;
            bucket.net_sales -= Number(refund.total_refund);
            bucket.returns += Number(refund.total_refund);
        }

        return {
            points: [...buckets.entries()].map(([date, values]) => ({
                date,
                net_sales: money(values.net_sales),
                orders: values.orders,
                returns: money(values.returns),
            })),
        };
    }
}
