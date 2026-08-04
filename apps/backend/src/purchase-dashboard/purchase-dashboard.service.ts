import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
    emptyDailyBuckets,
    formatDate,
    money,
    resolveDateWindow,
    startOfDay,
    type DateWindow,
} from '../common/dashboard-window';
import { PurchaseDashboardQueryDto } from './purchase-dashboard.dto';

/** Ranked panels show a handful of rows; the rest is noise on a dashboard. */
const RANK_LIMIT = 6;
const RECENT_PURCHASES = 5;

/** A quotation this close to its validity date is worth chasing. */
const EXPIRING_WITHIN_DAYS = 7;

/** Purchase orders that have been raised but not yet received. */
const OPEN_PO_STATUSES = ['DRAFT', 'SENT'];
/** RFQs still in play — everything before the terminal states. */
const OPEN_RFQ_STATUSES = ['DRAFT', 'SENT', 'RECEIVED', 'ACCEPTED'];

/**
 * Aggregates for the Purchases dashboard: what was bought, what is owed, and
 * what has been ordered but not yet arrived.
 *
 * A dedicated service rather than more methods on `PurchaseReportsService`
 * because the payload spans purchases, orders, quotations, returns and supplier
 * balances, and the Overview must paint in one round trip rather than five.
 */
@Injectable()
export class PurchaseDashboardService {
    constructor(private readonly db: DatabaseService) {}

    async getOverview(tenantId: string, query: PurchaseDashboardQueryDto) {
        const window = resolveDateWindow(query);

        const [spend, payables, orders, quotations, suppliers, products, recent] = await Promise.all([
            this.getSpend(tenantId, window),
            this.getPayables(tenantId),
            this.getOrders(tenantId, window),
            this.getQuotations(tenantId),
            this.getTopSuppliers(tenantId, window),
            this.getTopProducts(tenantId, window),
            this.getRecent(tenantId),
        ]);

        return {
            filters: { from: window.from, to: window.to },
            spend,
            payables,
            orders,
            quotations,
            suppliers,
            products,
            recent,
        };
    }

    private async getSpend(tenantId: string, window: DateWindow) {
        const inWindow = { gte: window.fromDate, lte: window.toDate };

        const [purchases, returns] = await Promise.all([
            this.db.purchase.aggregate({
                where: { tenant_id: tenantId, created_at: inWindow },
                _sum: { total_amount: true },
                _count: { _all: true },
            }),
            this.db.purchaseReturn.aggregate({
                where: { tenant_id: tenantId, created_at: inWindow },
                _sum: { total_amount: true },
                _count: { _all: true },
            }),
        ]);

        const total = Number(purchases._sum.total_amount ?? 0);
        const count = purchases._count._all;

        return {
            total: money(total),
            purchases: count,
            // Null rather than 0: no purchases means no average, and 0 would read
            // as "your average bill was nothing".
            avg_value: count > 0 ? money(total / count) : null,
            returns_value: money(Number(returns._sum.total_amount ?? 0)),
            returns_count: returns._count._all,
        };
    }

    /**
     * What is owed, across the whole book. Payables are a balance, not a flow —
     * windowing them would answer a question nobody asked.
     */
    private async getPayables(tenantId: string) {
        const [outstanding, unpaid, partial] = await Promise.all([
            this.db.supplier.aggregate({
                where: { tenant_id: tenantId, deleted_at: null },
                _sum: { due_balance: true },
            }),
            this.db.purchase.count({ where: { tenant_id: tenantId, payment_status: 'UNPAID' } }),
            this.db.purchase.count({ where: { tenant_id: tenantId, payment_status: 'PARTIAL' } }),
        ]);

        return {
            outstanding: money(Number(outstanding._sum.due_balance ?? 0)),
            unpaid_purchases: unpaid,
            partial_purchases: partial,
        };
    }

    private async getOrders(tenantId: string, window: DateWindow) {
        const now = new Date();

        const [awaiting, draft, overdue, received] = await Promise.all([
            this.db.purchaseOrder.count({
                where: { tenant_id: tenantId, status: 'SENT', received_at: null },
            }),
            this.db.purchaseOrder.count({ where: { tenant_id: tenantId, status: 'DRAFT' } }),
            // Past its expected date and still not here. A PO with no expected
            // date cannot be late — it never promised anything.
            this.db.purchaseOrder.count({
                where: {
                    tenant_id: tenantId,
                    status: { in: OPEN_PO_STATUSES },
                    received_at: null,
                    expected_date: { lt: now },
                },
            }),
            this.db.purchaseOrder.count({
                where: {
                    tenant_id: tenantId,
                    received_at: { gte: window.fromDate, lte: window.toDate },
                },
            }),
        ]);

        return { awaiting_receipt: awaiting, draft, overdue_expected: overdue, received_in_period: received };
    }

    private async getQuotations(tenantId: string) {
        const now = new Date();
        const soon = new Date(now);
        soon.setDate(soon.getDate() + EXPIRING_WITHIN_DAYS);

        const [open, expiring, expired] = await Promise.all([
            this.db.purchaseQuotation.count({
                where: { tenant_id: tenantId, status: { in: OPEN_RFQ_STATUSES } },
            }),
            this.db.purchaseQuotation.count({
                where: {
                    tenant_id: tenantId,
                    status: { in: OPEN_RFQ_STATUSES },
                    valid_until: { gte: now, lte: soon },
                },
            }),
            this.db.purchaseQuotation.count({
                where: {
                    tenant_id: tenantId,
                    status: { in: OPEN_RFQ_STATUSES },
                    valid_until: { lt: now },
                },
            }),
        ]);

        return { open, expiring, expired };
    }

    private async getTopSuppliers(tenantId: string, window: DateWindow) {
        const grouped = await this.db.purchase.groupBy({
            by: ['supplier_id'],
            where: { tenant_id: tenantId, created_at: { gte: window.fromDate, lte: window.toDate } },
            _sum: { total_amount: true },
            _count: { _all: true },
        });

        const ranked = grouped
            .map((row) => ({
                supplier_id: row.supplier_id,
                spend: Number(row._sum.total_amount ?? 0),
                purchases: row._count._all,
            }))
            .sort((a, b) => b.spend - a.spend)
            .slice(0, RANK_LIMIT);

        const named = await this.db.supplier.findMany({
            where: { id: { in: ranked.map((row) => row.supplier_id).filter((id): id is string => Boolean(id)) } },
            select: { id: true, name: true, due_balance: true },
        });
        const byId = new Map(named.map((supplier) => [supplier.id, supplier]));

        return ranked.map((row) => ({
            id: row.supplier_id,
            // A purchase with no supplier is a real row in this table, not a bug.
            name: row.supplier_id ? (byId.get(row.supplier_id)?.name ?? 'Unknown supplier') : 'No supplier',
            spend: money(row.spend),
            purchases: row.purchases,
            outstanding: money(Number(byId.get(row.supplier_id ?? '')?.due_balance ?? 0)),
        }));
    }

    private async getTopProducts(tenantId: string, window: DateWindow) {
        const grouped = await this.db.purchaseItem.groupBy({
            by: ['product_id'],
            where: {
                purchase: { tenant_id: tenantId, created_at: { gte: window.fromDate, lte: window.toDate } },
            },
            _sum: { quantity: true, line_total: true },
        });

        const ranked = grouped
            .map((row) => ({
                id: row.product_id,
                units: row._sum.quantity ?? 0,
                spend: Number(row._sum.line_total ?? 0),
            }))
            .sort((a, b) => b.spend - a.spend)
            .slice(0, RANK_LIMIT);

        const named = await this.db.product.findMany({
            where: { id: { in: ranked.map((row) => row.id) } },
            select: { id: true, name: true },
        });
        const byId = new Map(named.map((product) => [product.id, product.name]));

        return ranked.map((row) => ({ ...row, name: byId.get(row.id) ?? 'Unknown product', spend: money(row.spend) }));
    }

    private async getRecent(tenantId: string) {
        const rows = await this.db.purchase.findMany({
            where: { tenant_id: tenantId },
            orderBy: { created_at: 'desc' },
            take: RECENT_PURCHASES,
            select: {
                id: true,
                purchase_number: true,
                total_amount: true,
                payment_status: true,
                created_at: true,
                supplier: { select: { name: true } },
            },
        });

        return rows.map((row) => ({
            id: row.id,
            purchase_number: row.purchase_number,
            supplier_name: row.supplier?.name ?? null,
            total: money(Number(row.total_amount)),
            payment_status: row.payment_status,
            created_at: row.created_at,
        }));
    }

    /** Daily spend and purchase count, feeding the KPI sparklines. */
    async getTrends(tenantId: string, query: PurchaseDashboardQueryDto) {
        const window = resolveDateWindow(query);

        const purchases = await this.db.purchase.findMany({
            where: { tenant_id: tenantId, created_at: { gte: window.fromDate, lte: window.toDate } },
            select: { created_at: true, total_amount: true },
        });

        const buckets = emptyDailyBuckets(window, () => ({ spend: 0, purchases: 0 }));

        for (const row of purchases) {
            const bucket = buckets.get(formatDate(startOfDay(row.created_at)));
            if (!bucket) continue;
            bucket.spend += Number(row.total_amount);
            bucket.purchases += 1;
        }

        return {
            points: [...buckets.entries()].map(([date, values]) => ({
                date,
                spend: money(values.spend),
                purchases: values.purchases,
            })),
        };
    }
}
