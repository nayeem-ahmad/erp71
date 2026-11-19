import { Injectable } from '@nestjs/common';
import { Prisma } from '@erp71/database';
import { DatabaseService } from '../database/database.service';
import { percent, type DateWindowQuery } from '../common/dashboard-window';
import { startOfZonedToday, zonedDateString, zonedDayStart } from '../common/tenant-time.util';
import { LeadStatus } from '../crm-leads/crm-leads.dto';

const DEFAULT_MONTHS = 12;
const MAX_MONTHS = 36;

export type FunnelRow = {
    /** `YYYY-MM` — the month these leads arrived. */
    month: string;
    arrived: number;
    new: number;
    contacted: number;
    qualified: number;
    converted: number;
    lost: number;
    /** Still in the pipeline: new + contacted + qualified. */
    open: number;
    conversion_pct: number | null;
};

export type LeadFunnelReport = {
    months: string[];
    rows: FunnelRow[];
    totals: {
        arrived: number;
        converted: number;
        lost: number;
        open: number;
        conversion_pct: number | null;
    };
};

function monthOf(day: string): string {
    return day.slice(0, 7);
}

/** The `YYYY-MM` a month step lands on, without leaning on Date arithmetic. */
function shiftMonth(month: string, delta: number): string {
    const [year, monthNumber] = month.split('-').map(Number);
    const index = year * 12 + (monthNumber - 1) + delta;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

function monthsBetween(from: string, to: string): string[] {
    const months: string[] = [];
    for (let month = from; month <= to; month = shiftMonth(month, 1)) {
        months.push(month);
    }
    return months;
}

/**
 * Lead funnel by arrival month.
 *
 * Each row is a **cohort**: the leads that arrived in that month, counted by
 * where they are now. That is deliberately not the same as "what changed this
 * month" — a cohort view answers whether later months are converting better or
 * worse, while a flow view answers how much moved. The dashboard already
 * reports the flows; this is the other half.
 *
 * The caveat that follows from the data model: `Lead` keeps only its *current*
 * status, so a lead that passed through Qualified and then converted shows as
 * Converted only. The rows therefore read "reached or passed this stage"
 * rather than "sat at this stage", which is what lets the stages add up to the
 * cohort instead of overlapping.
 */
@Injectable()
export class CrmLeadFunnelService {
    constructor(private readonly db: DatabaseService) {}

    async report(
        tenantId: string,
        timezone: string,
        query?: DateWindowQuery,
        ownerId?: string,
    ): Promise<LeadFunnelReport> {
        const todayStart = startOfZonedToday(timezone);
        const today = zonedDateString(todayStart, timezone);

        // Default: this month and the eleven before it. Months are the unit, so
        // the bounds are always whole ones — a `from` mid-month only decides
        // which month it falls in.
        const endMonth = query?.to ? monthOf(query.to.slice(0, 10)) : monthOf(today);
        const startMonth = query?.from
            ? monthOf(query.from.slice(0, 10))
            : shiftMonth(endMonth, -(DEFAULT_MONTHS - 1));

        let months = monthsBetween(startMonth, endMonth);
        if (months.length === 0) months = [endMonth];
        if (months.length > MAX_MONTHS) {
            // Keep the most recent: an over-long window loses its oldest months,
            // as `clampWindow` does.
            months = months.slice(months.length - MAX_MONTHS);
        }

        // The end is the last instant of the final month: the first of the next
        // month, minus a millisecond.
        const fromDate = zonedDayStart(`${months[0]}-01`, timezone) as Date;
        const afterLast = zonedDayStart(`${shiftMonth(months[months.length - 1], 1)}-01`, timezone) as Date;
        const toDate = new Date(afterLast.getTime() - 1);

        const where: Prisma.LeadWhereInput = {
            tenant_id: tenantId,
            created_at: { gte: fromDate, lte: toDate },
        };
        if (ownerId) where.assigned_to = ownerId;

        const leads = await this.db.lead.findMany({
            where,
            select: { status: true, created_at: true },
        });

        const emptyRow = (month: string): FunnelRow => ({
            month,
            arrived: 0,
            new: 0,
            contacted: 0,
            qualified: 0,
            converted: 0,
            lost: 0,
            open: 0,
            conversion_pct: null,
        });

        const byMonth = new Map<string, FunnelRow>();
        for (const month of months) byMonth.set(month, emptyRow(month));

        for (const lead of leads) {
            const month = monthOf(zonedDateString(lead.created_at, timezone));
            const row = byMonth.get(month);
            // A lead from outside the window (the boundary months are whole, so
            // this is only a rounding edge) is not silently added to a row that
            // does not exist.
            if (!row) continue;

            row.arrived++;
            switch (lead.status) {
                case LeadStatus.NEW: row.new++; break;
                case LeadStatus.CONTACTED: row.contacted++; break;
                case LeadStatus.QUALIFIED: row.qualified++; break;
                case LeadStatus.CONVERTED: row.converted++; break;
                case LeadStatus.LOST: row.lost++; break;
                default: break;
            }
            row.open = row.new + row.contacted + row.qualified;
        }

        const rows = months.map((month) => {
            const row = byMonth.get(month)!;
            return { ...row, conversion_pct: percent(row.converted, row.arrived) };
        });

        let arrived = 0;
        let converted = 0;
        let lost = 0;
        let open = 0;
        for (const row of rows) {
            arrived += row.arrived;
            converted += row.converted;
            lost += row.lost;
            open += row.open;
        }

        return {
            months,
            rows,
            totals: {
                arrived,
                converted,
                lost,
                open,
                conversion_pct: percent(converted, arrived),
            },
        };
    }
}
