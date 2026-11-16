import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CrmDashboardQueryDto } from '../crm-dashboard/crm-dashboard.dto';
import { resolveDateWindow, percent, money, calendarDaysBetween } from '../common/dashboard-window';
import { LeadStatus, OPEN_LEAD_STATUSES } from '../crm-leads/crm-leads.dto';
import { revenueByConvertedLead, ConvertedLeadRef } from './converted-revenue.util';

export type LeadSourceRow = {
    source_id: string | null;
    name: string | null;
    leads: number;
    contacted: number;
    contacted_pct: number | null;
    open: number;
    converted: number;
    lost: number;
    conversion_pct: number | null;
    win_rate_pct: number | null;
    median_days_to_convert: number | null;
    revenue: number;
    revenue_per_lead: number | null;
};

export type LeadSourceReport = {
    filters: { from: string; to: string; mine: boolean };
    rows: LeadSourceRow[];
    totals: Omit<LeadSourceRow, 'source_id' | 'name'>;
};



function computeMedian(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) {
        return sorted[mid];
    }
    return Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
}

@Injectable()
export class LeadSourceReportService {
    constructor(private readonly db: DatabaseService) {}

    async report(
        tenantId: string,
        query: CrmDashboardQueryDto,
        timezone: string,
        ownerId?: string,
    ): Promise<LeadSourceReport> {
        const window = resolveDateWindow(query, timezone);

        const where: any = {
            tenant_id: tenantId,
            created_at: {
                gte: window.fromDate,
                lte: window.toDate,
            },
        };
        if (ownerId) {
            where.assigned_to = ownerId;
        }

        const [leads, sources] = await Promise.all([
            this.db.lead.findMany({
                where,
                select: {
                    id: true,
                    source_id: true,
                    status: true,
                    last_contacted_at: true,
                    created_at: true,
                    closed_at: true,
                    converted_customer_id: true,
                },
            }),
            this.db.leadSourceOption.findMany({
                where: { tenant_id: tenantId },
                select: { id: true, name: true },
            }),
        ]);

        const sourceNames = new Map<string, string>();
        for (const s of sources) {
            sourceNames.set(s.id, s.name);
        }

        const convertedRefs: ConvertedLeadRef[] = leads
            .filter((l) => l.status === LeadStatus.CONVERTED)
            .map((l) => ({
                id: l.id,
                converted_customer_id: l.converted_customer_id,
                closed_at: l.closed_at,
            }));

        const revenueMap = await revenueByConvertedLead(this.db, tenantId, convertedRefs);

        const groups = new Map<string | null, typeof leads>();
        for (const lead of leads) {
            const key = lead.source_id;
            const existing = groups.get(key);
            if (!existing) {
                groups.set(key, [lead]);
            } else {
                existing.push(lead);
            }
        }

        const allConversionDays: number[] = [];

        const rows: LeadSourceRow[] = [];
        for (const [sourceId, groupLeads] of groups.entries()) {
            let contacted = 0;
            let open = 0;
            let converted = 0;
            let lost = 0;
            let revenue = 0;
            const conversionDays: number[] = [];

            for (const lead of groupLeads) {
                if (lead.last_contacted_at !== null) {
                    contacted++;
                }
                if (lead.status === LeadStatus.CONVERTED) {
                    converted++;
                    if (lead.closed_at) {
                        const days = calendarDaysBetween(window.dayOf(lead.created_at), window.dayOf(lead.closed_at));
                        conversionDays.push(days);
                        allConversionDays.push(days);
                    }
                } else if (lead.status === LeadStatus.LOST) {
                    lost++;
                } else if ((OPEN_LEAD_STATUSES as readonly string[]).includes(lead.status)) {
                    open++;
                } else {
                    open++;
                }

                const rev = revenueMap.get(lead.id);
                if (rev) {
                    revenue += rev.revenue;
                }
            }

            const totalLeads = groupLeads.length;
            const decided = converted + lost;

            rows.push({
                source_id: sourceId,
                name: sourceId ? (sourceNames.get(sourceId) ?? null) : null,
                leads: totalLeads,
                contacted,
                contacted_pct: percent(contacted, totalLeads),
                open,
                converted,
                lost,
                conversion_pct: percent(converted, totalLeads),
                win_rate_pct: percent(converted, decided),
                median_days_to_convert: computeMedian(conversionDays),
                revenue: money(revenue),
                revenue_per_lead: totalLeads > 0 ? money(revenue / totalLeads) : null,
            });
        }

        rows.sort((a, b) => b.leads - a.leads);

        let totalLeads = 0;
        let totalContacted = 0;
        let totalOpen = 0;
        let totalConverted = 0;
        let totalLost = 0;
        let totalRevenue = 0;

        for (const r of rows) {
            totalLeads += r.leads;
            totalContacted += r.contacted;
            totalOpen += r.open;
            totalConverted += r.converted;
            totalLost += r.lost;
            totalRevenue += r.revenue;
        }

        const totalDecided = totalConverted + totalLost;

        const totals: Omit<LeadSourceRow, 'source_id' | 'name'> = {
            leads: totalLeads,
            contacted: totalContacted,
            contacted_pct: percent(totalContacted, totalLeads),
            open: totalOpen,
            converted: totalConverted,
            lost: totalLost,
            conversion_pct: percent(totalConverted, totalLeads),
            win_rate_pct: percent(totalConverted, totalDecided),
            median_days_to_convert: computeMedian(allConversionDays),
            revenue: money(totalRevenue),
            revenue_per_lead: totalLeads > 0 ? money(totalRevenue / totalLeads) : null,
        };

        return {
            filters: {
                from: window.from,
                to: window.to,
                mine: Boolean(query.mine),
            },
            rows,
            totals,
        };
    }
}
