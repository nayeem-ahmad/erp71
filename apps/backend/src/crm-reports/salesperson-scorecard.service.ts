import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CrmDashboardQueryDto } from '../crm-dashboard/crm-dashboard.dto';
import {
    resolveDateWindow,
    clampWindow,
    percent,
    money,
} from '../common/dashboard-window';
import { startOfZonedToday } from '../common/tenant-time.util';
import { LeadStatus, OPEN_LEAD_STATUSES } from '../crm-leads/crm-leads.dto';
import { revenueByConvertedLead } from './converted-revenue.util';
import { FollowUpComplianceService, REPORT_MAX_DAYS } from './follow-up-compliance.service';

export type ScorecardRow = {
    user_id: string;
    name: string;
    open_leads: number;
    new_leads: number;
    activities_logged: number;
    leads_touched: number;
    follow_ups_due: number;
    follow_ups_on_time_pct: number | null;
    overdue_now: number;
    converted: number;
    lost: number;
    win_rate_pct: number | null;
    revenue: number;
};

export type ScorecardReport = {
    filters: { from: string; to: string; mine: boolean };
    rows: ScorecardRow[];
    totals: Omit<ScorecardRow, 'user_id' | 'name'>;
};

@Injectable()
export class SalespersonScorecardService {
    constructor(
        private readonly db: DatabaseService,
        private readonly followUpComplianceService: FollowUpComplianceService,
    ) {}

    async report(
        tenantId: string,
        query: CrmDashboardQueryDto,
        timezone: string,
        ownerId?: string,
    ): Promise<ScorecardReport> {
        const rawWindow = resolveDateWindow(query, timezone);
        const window = clampWindow(rawWindow, REPORT_MAX_DAYS);
        const todayStart = startOfZonedToday(window.timezone);

        const assignedFilter: any = ownerId ? ownerId : { not: null };

        const [
            openGrouped,
            newGrouped,
            activitiesGrouped,
            touchedGrouped,
            overdueGrouped,
            closedGrouped,
            convertedLeads,
            followUpsByAssignee,
        ] = await Promise.all([
            this.db.lead.groupBy({
                by: ['assigned_to'],
                where: {
                    tenant_id: tenantId,
                    status: { in: [...OPEN_LEAD_STATUSES] },
                    assigned_to: assignedFilter,
                },
                _count: { _all: true },
            }),
            this.db.lead.groupBy({
                by: ['assigned_to'],
                where: {
                    tenant_id: tenantId,
                    created_at: { gte: window.fromDate, lte: window.toDate },
                    assigned_to: assignedFilter,
                },
                _count: { _all: true },
            }),
            this.db.crmActivity.groupBy({
                by: ['assigned_to'],
                where: {
                    tenant_id: tenantId,
                    status: 'DONE',
                    channel_id: { not: null },
                    completed_at: { gte: window.fromDate, lte: window.toDate },
                    assigned_to: assignedFilter,
                },
                _count: { _all: true },
            }),
            this.db.crmActivity.groupBy({
                by: ['assigned_to', 'lead_id'],
                where: {
                    tenant_id: tenantId,
                    status: 'DONE',
                    channel_id: { not: null },
                    completed_at: { gte: window.fromDate, lte: window.toDate },
                    lead_id: { not: null },
                    assigned_to: assignedFilter,
                },
                _count: { _all: true },
            }),
            this.db.crmActivity.groupBy({
                by: ['assigned_to'],
                where: {
                    tenant_id: tenantId,
                    status: 'PLANNED',
                    due_at: { lt: todayStart },
                    assigned_to: assignedFilter,
                },
                _count: { _all: true },
            }),
            this.db.lead.groupBy({
                by: ['assigned_to', 'status'],
                where: {
                    tenant_id: tenantId,
                    closed_at: { gte: window.fromDate, lte: window.toDate },
                    status: { in: [LeadStatus.CONVERTED, LeadStatus.LOST] },
                    assigned_to: assignedFilter,
                },
                _count: { _all: true },
            }),
            this.db.lead.findMany({
                where: {
                    tenant_id: tenantId,
                    status: LeadStatus.CONVERTED,
                    converted_customer_id: { not: null },
                    assigned_to: assignedFilter,
                },
                select: {
                    id: true,
                    assigned_to: true,
                    converted_customer_id: true,
                    closed_at: true,
                },
            }),
            this.followUpComplianceService.byAssignee(tenantId, window, ownerId),
        ]);

        const revenueMap = await revenueByConvertedLead(
            this.db,
            tenantId,
            convertedLeads,
            { fromDate: window.fromDate, toDate: window.toDate },
        );

        const revenueByUser = new Map<string, number>();
        for (const lead of convertedLeads) {
            if (!lead.assigned_to) continue;
            const rev = revenueMap.get(lead.id)?.revenue ?? 0;
            revenueByUser.set(lead.assigned_to, (revenueByUser.get(lead.assigned_to) ?? 0) + rev);
        }

        const userIds = new Set<string>();
        if (ownerId) {
            userIds.add(ownerId);
        }

        const openByUser = new Map<string, number>();
        for (const r of openGrouped) {
            if (r.assigned_to) {
                openByUser.set(r.assigned_to, r._count._all);
                userIds.add(r.assigned_to);
            }
        }

        const newByUser = new Map<string, number>();
        for (const r of newGrouped) {
            if (r.assigned_to) {
                newByUser.set(r.assigned_to, r._count._all);
                userIds.add(r.assigned_to);
            }
        }

        const activitiesByUser = new Map<string, number>();
        for (const r of activitiesGrouped) {
            if (r.assigned_to) {
                activitiesByUser.set(r.assigned_to, r._count._all);
                userIds.add(r.assigned_to);
            }
        }

        const touchedByUser = new Map<string, Set<string>>();
        for (const r of touchedGrouped) {
            if (r.assigned_to && r.lead_id) {
                let set = touchedByUser.get(r.assigned_to);
                if (!set) {
                    set = new Set<string>();
                    touchedByUser.set(r.assigned_to, set);
                }
                set.add(r.lead_id);
                userIds.add(r.assigned_to);
            }
        }

        const overdueByUser = new Map<string, number>();
        for (const r of overdueGrouped) {
            if (r.assigned_to) {
                overdueByUser.set(r.assigned_to, r._count._all);
                userIds.add(r.assigned_to);
            }
        }

        const convertedByUser = new Map<string, number>();
        const lostByUser = new Map<string, number>();
        for (const r of closedGrouped) {
            if (r.assigned_to) {
                userIds.add(r.assigned_to);
                if (r.status === LeadStatus.CONVERTED) {
                    convertedByUser.set(r.assigned_to, r._count._all);
                } else if (r.status === LeadStatus.LOST) {
                    lostByUser.set(r.assigned_to, r._count._all);
                }
            }
        }

        for (const [userId, counts] of followUpsByAssignee.entries()) {
            if (userId && counts.due > 0) {
                userIds.add(userId);
            }
        }

        for (const [userId, rev] of revenueByUser.entries()) {
            if (rev > 0) {
                userIds.add(userId);
            }
        }

        const userList = Array.from(userIds);
        const users = userList.length
            ? await this.db.user.findMany({
                where: { id: { in: userList } },
                select: { id: true, name: true, email: true },
            })
            : [];

        const userNames = new Map<string, string>();
        for (const u of users) {
            userNames.set(u.id, u.name || u.email || '—');
        }

        const rows: ScorecardRow[] = [];
        let totalOpen = 0;
        let totalNew = 0;
        let totalActivities = 0;
        let totalTouched = 0;
        let totalFollowUpsDue = 0;
        let totalFollowUpsOnTime = 0;
        let totalFollowUpsLate = 0;
        let totalFollowUpsOverdue = 0;
        let totalOverdueNow = 0;
        let totalConverted = 0;
        let totalLost = 0;
        let totalRevenue = 0;

        for (const userId of userList) {
            const name = userNames.get(userId) ?? '—';
            const open_leads = openByUser.get(userId) ?? 0;
            const new_leads = newByUser.get(userId) ?? 0;
            const activities_logged = activitiesByUser.get(userId) ?? 0;
            const leads_touched = touchedByUser.get(userId)?.size ?? 0;
            const followUps = followUpsByAssignee.get(userId);
            const follow_ups_due = followUps?.due ?? 0;
            const follow_ups_on_time_pct = followUps?.compliance_pct ?? null;
            const overdue_now = overdueByUser.get(userId) ?? 0;
            const converted = convertedByUser.get(userId) ?? 0;
            const lost = lostByUser.get(userId) ?? 0;
            const win_rate_pct = percent(converted, converted + lost);
            const revenue = money(revenueByUser.get(userId) ?? 0);

            totalOpen += open_leads;
            totalNew += new_leads;
            totalActivities += activities_logged;
            totalTouched += leads_touched;
            totalFollowUpsDue += follow_ups_due;
            if (followUps) {
                totalFollowUpsOnTime += followUps.on_time;
                totalFollowUpsLate += followUps.late;
                totalFollowUpsOverdue += followUps.overdue;
            }
            totalOverdueNow += overdue_now;
            totalConverted += converted;
            totalLost += lost;
            totalRevenue += revenue;

            rows.push({
                user_id: userId,
                name,
                open_leads,
                new_leads,
                activities_logged,
                leads_touched,
                follow_ups_due,
                follow_ups_on_time_pct,
                overdue_now,
                converted,
                lost,
                win_rate_pct,
                revenue,
            });
        }

        rows.sort((a, b) => b.revenue - a.revenue || b.converted - a.converted);

        const totalFollowUpsBase = totalFollowUpsOnTime + totalFollowUpsLate + totalFollowUpsOverdue;
        const totals: Omit<ScorecardRow, 'user_id' | 'name'> = {
            open_leads: totalOpen,
            new_leads: totalNew,
            activities_logged: totalActivities,
            leads_touched: totalTouched,
            follow_ups_due: totalFollowUpsDue,
            follow_ups_on_time_pct: percent(totalFollowUpsOnTime, totalFollowUpsBase),
            overdue_now: totalOverdueNow,
            converted: totalConverted,
            lost: totalLost,
            win_rate_pct: percent(totalConverted, totalConverted + totalLost),
            revenue: money(totalRevenue),
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
