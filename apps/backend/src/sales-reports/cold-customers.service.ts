import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { GetColdCustomersDto } from './sales-reports.dto';
import { calendarDaysBetween, money } from '../common/dashboard-window';
import { startOfZonedToday, zonedDateString } from '../common/tenant-time.util';

export type ColdCustomerRow = {
    customer_id: string;
    name: string;
    phone: string | null;
    customer_code: string | null;
    segment: string;
    orders: number;
    lifetime_spend: number;
    avg_gap_days: number;
    days_since_last: number;
    overdue_days: number;
    last_purchase_date: string;
    last_contacted_at: string | null;
    has_open_follow_up: boolean;
};

export type ColdCustomersReport = {
    as_of: string;
    store_id: string | null;
    factor: number;
    min_gap_days: number;
    rows: ColdCustomerRow[];
    total: number;
    truncated: boolean;
};

const ROW_CAP = 2000;
const DEFAULT_FACTOR = 2;
const DEFAULT_MIN_GAP_DAYS = 7;

@Injectable()
export class ColdCustomersService {
    constructor(private readonly db: DatabaseService) {}

    async report(
        tenantId: string,
        query: GetColdCustomersDto,
        timezone: string,
    ): Promise<ColdCustomersReport> {
        const factor = query.factor ?? DEFAULT_FACTOR;
        const minGapDays = query.minGapDays ?? DEFAULT_MIN_GAP_DAYS;

        const todayStart = startOfZonedToday(timezone);
        const asOfDate = zonedDateString(todayStart, timezone);

        const where: any = {
            tenant_id: tenantId,
            status: 'COMPLETED',
            is_exchange: false,
            customer_id: { not: null },
        };
        if (query.storeId) {
            where.store_id = query.storeId;
        }

        const salesGrouped = await this.db.sale.groupBy({
            by: ['customer_id'],
            where,
            having: {
                customer_id: { _count: { gt: 1 } },
            },
            _count: { _all: true },
            _min: { sale_date: true },
            _max: { sale_date: true },
            _sum: { total_amount: true },
        });

        type IntermediateCold = {
            customer_id: string;
            orders: number;
            lifetime_spend: number;
            avg_gap_days: number;
            days_since_last: number;
            overdue_days: number;
            last_purchase_date: string;
        };

        const coldList: IntermediateCold[] = [];

        for (const group of salesGrouped) {
            if (!group.customer_id) continue;
            const orders = group._count._all;
            if (orders < 2 || !group._min.sale_date || !group._max.sale_date) continue;

            const firstSaleDay = zonedDateString(group._min.sale_date, timezone);
            const lastSaleDay = zonedDateString(group._max.sale_date, timezone);

            const daysBetween = calendarDaysBetween(firstSaleDay, lastSaleDay);
            const usualGap = daysBetween / (orders - 1);
            const expectedGap = Math.max(usualGap, minGapDays);

            const daysSinceLast = calendarDaysBetween(lastSaleDay, asOfDate);

            if (daysSinceLast > expectedGap * factor) {
                const overdueDays = daysSinceLast - Math.round(expectedGap);
                coldList.push({
                    customer_id: group.customer_id,
                    orders,
                    lifetime_spend: money(Number(group._sum.total_amount ?? 0)),
                    avg_gap_days: Math.round(usualGap * 10) / 10,
                    days_since_last: daysSinceLast,
                    overdue_days: overdueDays,
                    last_purchase_date: lastSaleDay,
                });
            }
        }

        coldList.sort((a, b) => b.lifetime_spend - a.lifetime_spend);

        const total = coldList.length;
        const truncated = total > ROW_CAP;
        const topItems = coldList.slice(0, ROW_CAP);
        const topCustomerIds = topItems.map((c) => c.customer_id);

        const [customers, openActivities] = await Promise.all([
            topCustomerIds.length
                ? this.db.customer.findMany({
                    where: {
                        tenant_id: tenantId,
                        id: { in: topCustomerIds },
                    },
                    select: {
                        id: true,
                        name: true,
                        phone: true,
                        customer_code: true,
                        segment_category: true,
                        last_contacted_at: true,
                    },
                })
                : [],
            topCustomerIds.length
                ? this.db.crmActivity.findMany({
                    where: {
                        tenant_id: tenantId,
                        status: 'PLANNED',
                        customer_id: { in: topCustomerIds },
                    },
                    select: { customer_id: true },
                    distinct: ['customer_id'],
                })
                : [],
        ]);

        const customerMap = new Map<string, (typeof customers)[number]>();
        for (const c of customers) {
            customerMap.set(c.id, c);
        }

        const openFollowUpSet = new Set<string>();
        for (const a of openActivities) {
            if (a.customer_id) {
                openFollowUpSet.add(a.customer_id);
            }
        }

        const rows: ColdCustomerRow[] = topItems.map((item) => {
            const c = customerMap.get(item.customer_id);
            return {
                customer_id: item.customer_id,
                name: c?.name ?? '—',
                phone: c?.phone ?? null,
                customer_code: c?.customer_code ?? null,
                segment: c?.segment_category ?? 'Regular',
                orders: item.orders,
                lifetime_spend: item.lifetime_spend,
                avg_gap_days: item.avg_gap_days,
                days_since_last: item.days_since_last,
                overdue_days: item.overdue_days,
                last_purchase_date: item.last_purchase_date,
                last_contacted_at: c?.last_contacted_at ? c.last_contacted_at.toISOString() : null,
                has_open_follow_up: openFollowUpSet.has(item.customer_id),
            };
        });

        return {
            as_of: asOfDate,
            store_id: query.storeId ?? null,
            factor,
            min_gap_days: minGapDays,
            rows,
            total,
            truncated,
        };
    }
}
