import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CrmDashboardQueryDto } from '../crm-dashboard/crm-dashboard.dto';
import {
    DateWindow,
    resolveDateWindow,
    clampWindow,
    percent,
} from '../common/dashboard-window';
import { startOfZonedToday } from '../common/tenant-time.util';

export const REPORT_MAX_DAYS = 371;

export type FollowUpOutcome = 'on_time' | 'late' | 'overdue' | 'pending' | 'cancelled';

export function classifyFollowUp(
    row: { status: string; due_at: Date; completed_at: Date | null },
    todayStart: Date,
    dayOf: (d: Date) => string,
): FollowUpOutcome {
    if (row.status === 'CANCELLED') {
        return 'cancelled';
    }
    if (row.status === 'DONE') {
        if (!row.completed_at) {
            return 'on_time';
        }
        return dayOf(row.completed_at) <= dayOf(row.due_at) ? 'on_time' : 'late';
    }
    return row.due_at < todayStart ? 'overdue' : 'pending';
}

export type ComplianceCounts = {
    due: number;
    on_time: number;
    late: number;
    overdue: number;
    pending: number;
    cancelled: number;
    compliance_pct: number | null;
};

export type FollowUpComplianceReport = {
    filters: { from: string; to: string; mine: boolean };
    by_assignee: (ComplianceCounts & { user_id: string | null; name: string | null })[];
    by_purpose: (ComplianceCounts & { purpose_id: string | null; name: string | null })[];
    totals: ComplianceCounts;
    undated_open: number;
};

type RawCounts = {
    on_time: number;
    late: number;
    overdue: number;
    pending: number;
    cancelled: number;
};

function initRawCounts(): RawCounts {
    return { on_time: 0, late: 0, overdue: 0, pending: 0, cancelled: 0 };
}

function finalizeCounts(raw: RawCounts): ComplianceCounts {
    const due = raw.on_time + raw.late + raw.overdue + raw.pending + raw.cancelled;
    const base = raw.on_time + raw.late + raw.overdue;
    return {
        due,
        ...raw,
        compliance_pct: percent(raw.on_time, base),
    };
}

@Injectable()
export class FollowUpComplianceService {
    constructor(private readonly db: DatabaseService) {}

    async byAssignee(
        tenantId: string,
        window: DateWindow,
        ownerId?: string,
    ): Promise<Map<string | null, ComplianceCounts>> {
        const todayStart = startOfZonedToday(window.timezone);

        const where: any = {
            tenant_id: tenantId,
            subject: { not: null },
            due_at: {
                gte: window.fromDate,
                lte: window.toDate,
            },
        };
        if (ownerId) {
            where.assigned_to = ownerId;
        }

        const activities = await this.db.crmActivity.findMany({
            where,
            select: {
                assigned_to: true,
                purpose_id: true,
                status: true,
                due_at: true,
                completed_at: true,
            },
        });

        const rawMap = new Map<string | null, RawCounts>();
        for (const act of activities) {
            if (!act.due_at) continue;
            const outcome = classifyFollowUp(act as any, todayStart, window.dayOf);
            let counts = rawMap.get(act.assigned_to);
            if (!counts) {
                counts = initRawCounts();
                rawMap.set(act.assigned_to, counts);
            }
            counts[outcome]++;
        }

        const result = new Map<string | null, ComplianceCounts>();
        for (const [userId, raw] of rawMap.entries()) {
            result.set(userId, finalizeCounts(raw));
        }
        return result;
    }

    async report(
        tenantId: string,
        query: CrmDashboardQueryDto,
        timezone: string,
        ownerId?: string,
    ): Promise<FollowUpComplianceReport> {
        const rawWindow = resolveDateWindow(query, timezone);
        const window = clampWindow(rawWindow, REPORT_MAX_DAYS);
        const todayStart = startOfZonedToday(window.timezone);

        const where: any = {
            tenant_id: tenantId,
            subject: { not: null },
            due_at: {
                gte: window.fromDate,
                lte: window.toDate,
            },
        };
        if (ownerId) {
            where.assigned_to = ownerId;
        }

        const countWhere: any = {
            tenant_id: tenantId,
            status: 'PLANNED',
            due_at: null,
            subject: { not: null },
        };
        if (ownerId) {
            countWhere.assigned_to = ownerId;
        }

        const [activities, purposes, undatedOpen] = await Promise.all([
            this.db.crmActivity.findMany({
                where,
                select: {
                    assigned_to: true,
                    purpose_id: true,
                    status: true,
                    due_at: true,
                    completed_at: true,
                },
            }),
            this.db.crmActivityPurpose.findMany({
                where: { tenant_id: tenantId },
                select: { id: true, name: true },
            }),
            this.db.crmActivity.count({
                where: countWhere,
            }),
        ]);

        const userIds = [
            ...new Set(
                activities
                    .map((a) => a.assigned_to)
                    .filter((id): id is string => Boolean(id)),
            ),
        ];

        const users = userIds.length
            ? await this.db.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, name: true, email: true },
            })
            : [];

        const userNames = new Map<string, string>();
        for (const u of users) {
            userNames.set(u.id, u.name || u.email || '—');
        }

        const purposeNames = new Map<string, string>();
        for (const p of purposes) {
            purposeNames.set(p.id, p.name);
        }

        const assigneeRaw = new Map<string | null, RawCounts>();
        const purposeRaw = new Map<string | null, RawCounts>();
        const totalRaw = initRawCounts();

        for (const act of activities) {
            if (!act.due_at) continue;
            const outcome = classifyFollowUp(act as any, todayStart, window.dayOf);

            totalRaw[outcome]++;

            let aCounts = assigneeRaw.get(act.assigned_to);
            if (!aCounts) {
                aCounts = initRawCounts();
                assigneeRaw.set(act.assigned_to, aCounts);
            }
            aCounts[outcome]++;

            let pCounts = purposeRaw.get(act.purpose_id);
            if (!pCounts) {
                pCounts = initRawCounts();
                purposeRaw.set(act.purpose_id, pCounts);
            }
            pCounts[outcome]++;
        }

        const by_assignee: FollowUpComplianceReport['by_assignee'] = [];
        for (const [userId, raw] of assigneeRaw.entries()) {
            by_assignee.push({
                user_id: userId,
                name: userId ? (userNames.get(userId) ?? null) : null,
                ...finalizeCounts(raw),
            });
        }
        by_assignee.sort((a, b) => b.due - a.due);

        const by_purpose: FollowUpComplianceReport['by_purpose'] = [];
        for (const [purposeId, raw] of purposeRaw.entries()) {
            by_purpose.push({
                purpose_id: purposeId,
                name: purposeId ? (purposeNames.get(purposeId) ?? null) : null,
                ...finalizeCounts(raw),
            });
        }
        by_purpose.sort((a, b) => b.due - a.due);

        return {
            filters: {
                from: window.from,
                to: window.to,
                mine: Boolean(query.mine),
            },
            by_assignee,
            by_purpose,
            totals: finalizeCounts(totalRaw),
            undated_open: undatedOpen,
        };
    }
}
