import { Injectable } from '@nestjs/common';
import { Prisma } from '@erp71/database';
import { DatabaseService } from '../database/database.service';
import { resolveDateWindow, clampWindow, percent } from '../common/dashboard-window';
import { calendarDaysBetween } from '../common/dashboard-window';
import { CrmDashboardQueryDto } from '../crm-dashboard/crm-dashboard.dto';
import { LeadStatus } from '../crm-leads/crm-leads.dto';
import { REPORT_MAX_DAYS } from './follow-up-compliance.service';

/** How many named reasons the list shows before the rest are folded together. */
const NAMED_REASONS = 10;

/**
 * The sentinel a folded tail gets. Not a real reason, so it cannot collide with
 * one a tenant typed.
 */
export const OTHER_REASONS = '__other__';

export type LostLeadRow = {
    lead_id: string;
    name: string;
    reason: string | null;
    closed_at: string | null;
    days_open: number;
};

export type LostReasonRow = {
    reason: string | null;
    leads: number;
    share_pct: number | null;
    avg_days_open: number | null;
};

export type LostLeadsReport = {
    filters: { from: string; to: string; mine: boolean };
    rows: LostLeadRow[];
    by_reason: LostReasonRow[];
    totals: { lost: number; avg_days_open: number | null };
};

function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

/** A reason that is only whitespace is no reason at all. */
function normaliseReason(reason: string | null): string | null {
    if (typeof reason !== 'string') return null;
    const trimmed = reason.trim();
    return trimmed.length ? trimmed : null;
}

/**
 * What we lost, and why.
 *
 * **`lost_reason` is free text**, so grouping it verbatim produces a long tail
 * of one-off strings — "price", "Price", "too expensive" — that reads as noise
 * rather than as analysis. Until it becomes a pick-list (see TODO) the list is
 * capped: the ten most common reasons are named and everything below them is
 * folded into one `__other__` row, so the shape of the loss is visible without
 * pretending the strings are categories. The full rows are still in the list
 * below, where a person can read the actual wording.
 */
@Injectable()
export class CrmLostLeadsService {
    constructor(private readonly db: DatabaseService) {}

    async report(
        tenantId: string,
        query: CrmDashboardQueryDto,
        timezone: string,
        ownerId?: string,
    ): Promise<LostLeadsReport> {
        const window = clampWindow(resolveDateWindow(query, timezone), REPORT_MAX_DAYS);

        const where: Prisma.LeadWhereInput = {
            tenant_id: tenantId,
            status: LeadStatus.LOST,
            closed_at: { gte: window.fromDate, lte: window.toDate },
        };
        if (ownerId) where.assigned_to = ownerId;

        const leads = await this.db.lead.findMany({
            where,
            select: {
                id: true,
                name: true,
                lost_reason: true,
                closed_at: true,
                created_at: true,
            },
        });

        const rows: LostLeadRow[] = leads.map((lead) => {
            const closedDay = lead.closed_at ? window.dayOf(lead.closed_at) : null;
            const createdDay = window.dayOf(lead.created_at);
            return {
                lead_id: lead.id,
                name: lead.name,
                reason: normaliseReason(lead.lost_reason),
                closed_at: closedDay,
                days_open: closedDay ? Math.max(0, calendarDaysBetween(createdDay, closedDay)) : 0,
            };
        });

        rows.sort((a, b) => (b.closed_at ?? '').localeCompare(a.closed_at ?? ''));

        // Group by reason. The `null` key is the "no reason recorded" bucket,
        // which is a finding in its own right rather than something to hide.
        const groups = new Map<string | null, { leads: number; totalDays: number }>();
        for (const row of rows) {
            const group = groups.get(row.reason) ?? { leads: 0, totalDays: 0 };
            group.leads += 1;
            group.totalDays += row.days_open;
            groups.set(row.reason, group);
        }

        const ordered = [...groups.entries()]
            .sort((a, b) => b[1].leads - a[1].leads || String(a[0]).localeCompare(String(b[0])));

        const named = ordered.slice(0, NAMED_REASONS);
        const folded = ordered.slice(NAMED_REASONS);

        const by_reason: LostReasonRow[] = named.map(([reason, group]) => ({
            reason,
            leads: group.leads,
            share_pct: percent(group.leads, rows.length),
            avg_days_open: round1(group.totalDays / group.leads),
        }));

        if (folded.length > 0) {
            const leadsInTail = folded.reduce((sum, [, group]) => sum + group.leads, 0);
            const daysInTail = folded.reduce((sum, [, group]) => sum + group.totalDays, 0);
            by_reason.push({
                reason: OTHER_REASONS,
                leads: leadsInTail,
                share_pct: percent(leadsInTail, rows.length),
                avg_days_open: round1(daysInTail / leadsInTail),
            });
        }

        const totalDays = rows.reduce((sum, row) => sum + row.days_open, 0);

        return {
            filters: { from: window.from, to: window.to, mine: Boolean(query.mine) },
            rows,
            by_reason,
            totals: {
                lost: rows.length,
                avg_days_open: rows.length > 0 ? round1(totalDays / rows.length) : null,
            },
        };
    }
}
