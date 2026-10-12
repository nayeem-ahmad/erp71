import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../cache/redis.service';
import { SalesDashboardService } from '../sales-dashboard/sales-dashboard.service';
import { money, resolveDateWindow } from '../common/dashboard-window';
import { addCalendarDays, startOfZonedToday, zonedDateString } from '../common/tenant-time.util';
import { TENDER_LABELS, tenderKey, type TenderKey } from './tender-key';

/** Long enough to absorb a pull-to-refresh storm, short enough to read as live. */
const CACHE_TTL_SECONDS = 60;
const TREND_DAYS = 7;

type DaySales = Awaited<ReturnType<SalesDashboardService['getSales']>> & { date: string };

export type MobilePulse = {
    store_id: string | null;
    date: string;
    generated_at: string;
    today: DaySales;
    yesterday: DaySales;
    /** The same weekday a week ago: a Friday compared with a Friday. */
    last_week: DaySales;
    change: { vs_yesterday_pct: number | null; vs_last_week_pct: number | null };
    margin: Awaited<ReturnType<SalesDashboardService['getMargin']>>;
    tenders: { key: TenderKey; label: string; amount: number }[];
    trend: { date: string; net_sales: number; orders: number }[];
    receivables: Awaited<ReturnType<SalesDashboardService['getReceivables']>>;
    /** Null for a caller who may not read purchasing. */
    payables: { outstanding: number; suppliers_owing: number } | null;
};

/**
 * One compact payload for the phone's home screen: how today is going against
 * yesterday and the same weekday last week, how it was paid, and what is owed.
 *
 * Built from `SalesDashboardService` rather than beside it, so "net sales" on
 * the phone and on Sales › Overview are the same query and cannot drift. The
 * web overview itself is too heavy to reuse whole: it carries ranked product,
 * category and customer tables a glance has no room for.
 */
@Injectable()
export class MobilePulseService {
    constructor(
        private readonly db: DatabaseService,
        private readonly redis: RedisService,
        private readonly sales: SalesDashboardService,
    ) {}

    /**
     * `storeId` is the branch the controller resolved (`undefined` = the whole
     * tenant). The cached copy always carries payables; whether this caller
     * sees them is decided per request, so one member's access never leaks
     * into another's answer through the cache.
     */
    async getPulse(
        tenantId: string,
        storeId: string | undefined,
        timezone: string,
        opts: { includePayables: boolean },
    ): Promise<MobilePulse> {
        const key = `mobile:pulse:${tenantId}:${storeId ?? 'all'}`;
        let pulse = await this.redis.get<MobilePulse>(key);
        if (!pulse) {
            pulse = await this.build(tenantId, storeId, timezone);
            // Only a fresh build is stored: re-storing a cached copy would
            // restart its TTL, and a phone refreshing every minute would then
            // read the same figures forever.
            await this.redis.set(key, pulse, CACHE_TTL_SECONDS);
        }
        return opts.includePayables ? pulse : { ...pulse, payables: null };
    }

    private async build(tenantId: string, storeId: string | undefined, timezone: string): Promise<MobilePulse> {
        const today = zonedDateString(startOfZonedToday(timezone), timezone);
        const day = (date: string) => resolveDateWindow({ from: date, to: date }, timezone);
        const todayWindow = day(today);
        const yesterday = addCalendarDays(today, -1);
        const lastWeek = addCalendarDays(today, -7);

        const [todaySales, yesterdaySales, lastWeekSales, margin, tenders, trend, receivables, payables] =
            await Promise.all([
                this.sales.getSales(tenantId, todayWindow, storeId),
                this.sales.getSales(tenantId, day(yesterday), storeId),
                this.sales.getSales(tenantId, day(lastWeek), storeId),
                this.sales.getMargin(tenantId, todayWindow, storeId),
                this.getTenders(tenantId, todayWindow, storeId),
                this.sales.getTrends(
                    tenantId,
                    { from: addCalendarDays(today, -(TREND_DAYS - 1)), to: today, storeId },
                    timezone,
                ),
                this.sales.getReceivables(tenantId),
                this.getPayables(tenantId),
            ]);

        return {
            store_id: storeId ?? null,
            date: today,
            generated_at: new Date().toISOString(),
            today: { ...todaySales, date: today },
            yesterday: { ...yesterdaySales, date: yesterday },
            last_week: { ...lastWeekSales, date: lastWeek },
            change: {
                vs_yesterday_pct: percentChange(todaySales.net, yesterdaySales.net),
                vs_last_week_pct: percentChange(todaySales.net, lastWeekSales.net),
            },
            margin,
            tenders,
            trend: trend.points.map(({ date, net_sales, orders }) => ({ date, net_sales, orders })),
            receivables,
            payables,
        };
    }

    /**
     * What today's completed sales were paid with, before refunds — a refund
     * goes back as cash whatever the sale was paid with, so netting it here
     * would subtract it from the wrong tender.
     */
    private async getTenders(
        tenantId: string,
        window: ReturnType<typeof resolveDateWindow>,
        storeId: string | undefined,
    ) {
        const grouped = await this.db.paymentRecord.groupBy({
            by: ['payment_method'],
            where: { sale: this.sales.saleWhere(tenantId, window, storeId) },
            _sum: { amount: true },
        });

        const totals = new Map<TenderKey, number>();
        for (const row of grouped) {
            const key = tenderKey(row.payment_method);
            totals.set(key, (totals.get(key) ?? 0) + Number(row._sum.amount ?? 0));
        }

        return [...totals.entries()]
            .filter(([, amount]) => amount !== 0)
            .map(([key, amount]) => ({ key, label: TENDER_LABELS[key], amount: money(amount) }))
            .sort((a, b) => b.amount - a.amount);
    }

    /** A balance across the whole book, like receivables. */
    private async getPayables(tenantId: string) {
        const [total, owing] = await Promise.all([
            this.db.supplier.aggregate({
                where: { tenant_id: tenantId, deleted_at: null },
                _sum: { due_balance: true },
            }),
            this.db.supplier.count({
                where: { tenant_id: tenantId, deleted_at: null, due_balance: { gt: 0 } },
            }),
        ]);
        return { outstanding: money(Number(total._sum.due_balance ?? 0)), suppliers_owing: owing };
    }
}

/**
 * Percent change to one decimal, or null with nothing to compare against: a
 * first sale after an empty day is not "+∞%", and saying 0% would be wrong too.
 */
export function percentChange(current: number, base: number): number | null {
    if (base <= 0) return null;
    return Math.round(((current - base) / base) * 1000) / 10;
}
