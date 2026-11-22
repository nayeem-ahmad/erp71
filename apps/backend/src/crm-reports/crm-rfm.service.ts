import { Injectable } from '@nestjs/common';
import { Prisma } from '@erp71/database';
import { DatabaseService } from '../database/database.service';
import { calendarDaysBetween, money, percent } from '../common/dashboard-window';
import { startOfZonedToday, zonedDateString } from '../common/tenant-time.util';

export type RfmSegment = 'champion' | 'loyal' | 'new' | 'at_risk' | 'hibernating' | 'needs_attention';

export type RfmRow = {
    customer_id: string;
    name: string;
    orders: number;
    revenue: number;
    /** Days since their last purchase, on the tenant calendar. */
    recency_days: number;
    /** Each score is 1–5; 5 is best for all three. */
    recency: number;
    frequency: number;
    monetary: number;
    /** The three scores concatenated, the usual way an RFM grid is read. */
    code: string;
    segment: RfmSegment;
};

export type RfmSegmentRow = {
    segment: RfmSegment;
    customers: number;
    revenue: number;
    share_pct: number | null;
};

export type RfmReport = {
    as_of: string;
    rows: RfmRow[];
    by_segment: RfmSegmentRow[];
    totals: { customers: number; revenue: number; repeat: number };
};

/**
 * Scores 1–5 for money, against the average of this shop's own book.
 *
 * Relative to the mean rather than to a ranking: a taka total means nothing
 * without knowing the shop, and a ranking falls apart on a book of five
 * customers, where the lowest spender scores 1 for no reason other than being
 * last in a short list. Against the mean, the same customer reads as "average"
 * however few of them there are.
 */
function monetaryScoreOf(revenues: number[]): (revenue: number) => number {
    if (revenues.length === 0) return () => 3;
    const mean = revenues.reduce((sum, value) => sum + value, 0) / revenues.length;
    if (mean <= 0) return () => 3;

    return (revenue: number) => {
        const ratio = revenue / mean;
        if (ratio >= 2) return 5;
        if (ratio >= 1.25) return 4;
        if (ratio >= 0.75) return 3;
        if (ratio >= 0.4) return 2;
        return 1;
    };
}

/** Days since the last purchase. Fewer is better, so the bands run backwards. */
function recencyScore(days: number): number {
    if (days <= 7) return 5;
    if (days <= 30) return 4;
    if (days <= 60) return 3;
    if (days <= 120) return 2;
    return 1;
}

/** How many purchases. A count is a count in every shop, so these are fixed. */
function frequencyScore(orders: number): number {
    if (orders >= 10) return 5;
    if (orders >= 6) return 4;
    if (orders >= 3) return 3;
    if (orders >= 2) return 2;
    return 1;
}

/**
 * Which segment the scores describe.
 *
 * Ordered by what the business would do, not by score: a customer who used to
 * spend and has stopped is worth a call, while one who never spent much and
 * never came back is not. Recency decides first; frequency and money split the
 * rest.
 */
function segmentOf(r: number, f: number, m: number): RfmSegment {
    const value = (f + m) / 2;
    if (r >= 4 && value >= 4) return 'champion';
    if (r >= 4 && value >= 3) return 'loyal';
    // Recent, but the relationship has not built yet — a first order or two.
    if (r >= 4 && f <= 2) return 'new';
    if (r <= 2 && f >= 3) return 'at_risk';
    if (r <= 2) return 'hibernating';
    return 'needs_attention';
}

/**
 * RFM — who is worth what, and who is slipping.
 *
 * The same population as **Customers going cold** (repeat buyers with completed
 * sales) scored rather than flagged: that report answers "who has gone quiet",
 * this one answers "who matters and how are they doing". Both read
 * `Sale.total_amount` where `status = 'COMPLETED'`, before returns.
 *
 * Recency is counted on the **tenant calendar day**, so a purchase at 20:00 UTC
 * that lands on the 15th in Dhaka counts as today.
 */
@Injectable()
export class CrmRfmService {
    constructor(private readonly db: DatabaseService) {}

    async report(tenantId: string, timezone: string = 'Asia/Dhaka'): Promise<RfmReport> {
        const todayStart = startOfZonedToday(timezone);
        const asOf = zonedDateString(todayStart, timezone);

        // Exchanges are `SalesExchange` rows against the original sale, never a
        // `Sale` row of their own, so completed sales are the whole population —
        // the same filter `getCustomerRetention` uses.
        const where: Prisma.SaleWhereInput = {
            tenant_id: tenantId,
            status: 'COMPLETED',
            customer_id: { not: null },
        };

        const grouped = await this.db.sale.groupBy({
            where,
            by: ['customer_id'],
            _count: { _all: true },
            _min: { sale_date: true },
            _max: { sale_date: true },
            _sum: { total_amount: true },
        });

        type Scored = {
            customer_id: string;
            orders: number;
            revenue: number;
            recency_days: number;
        };

        const base: Scored[] = [];
        for (const group of grouped) {
            if (!group.customer_id || !group._max.sale_date) continue;
            const lastDay = zonedDateString(group._max.sale_date, timezone);
            base.push({
                customer_id: group.customer_id,
                orders: group._count._all,
                revenue: money(Number(group._sum.total_amount ?? 0)),
                recency_days: Math.max(0, calendarDaysBetween(lastDay, asOf)),
            });
        }

        const monetaryScore = monetaryScoreOf(base.map((r) => r.revenue));

        const userIds = base.map((row) => row.customer_id);
        const customers = userIds.length
            ? await this.db.customer.findMany({
                where: { tenant_id: tenantId, id: { in: userIds } },
                select: { id: true, name: true },
            })
            : [];
        const names = new Map<string, string>();
        for (const customer of customers) names.set(customer.id, customer.name);

        const rows: RfmRow[] = base.map((row) => {
            const recency = recencyScore(row.recency_days);
            const frequency = frequencyScore(row.orders);
            const monetary = monetaryScore(row.revenue);
            return {
                customer_id: row.customer_id,
                name: names.get(row.customer_id) ?? '—',
                orders: row.orders,
                revenue: row.revenue,
                recency_days: row.recency_days,
                recency,
                frequency,
                monetary,
                code: `${recency}${frequency}${monetary}`,
                segment: segmentOf(recency, frequency, monetary),
            };
        });

        rows.sort((a, b) => b.revenue - a.revenue || a.recency_days - b.recency_days);

        const SEGMENTS: RfmSegment[] = [
            'champion', 'loyal', 'new', 'needs_attention', 'at_risk', 'hibernating',
        ];
        const segmentTotals = new Map<RfmSegment, { customers: number; revenue: number }>();
        for (const segment of SEGMENTS) segmentTotals.set(segment, { customers: 0, revenue: 0 });

        let revenue = 0;
        let repeat = 0;
        for (const row of rows) {
            const totals = segmentTotals.get(row.segment)!;
            totals.customers += 1;
            totals.revenue += row.revenue;
            revenue += row.revenue;
            if (row.orders > 1) repeat += 1;
        }

        // Only segments that hold somebody: a zero row for a segment nobody is in
        // reads as a broken grid.
        const by_segment: RfmSegmentRow[] = SEGMENTS
            .filter((segment) => (segmentTotals.get(segment)?.customers ?? 0) > 0)
            .map((segment) => {
                const totals = segmentTotals.get(segment)!;
                return {
                    segment,
                    customers: totals.customers,
                    revenue: money(totals.revenue),
                    share_pct: percent(totals.revenue, revenue),
                };
            });

        return {
            as_of: asOf,
            rows,
            by_segment,
            totals: {
                customers: rows.length,
                revenue: money(revenue),
                repeat,
            },
        };
    }
}
