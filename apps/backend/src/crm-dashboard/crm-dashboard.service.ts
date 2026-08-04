import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { LeadStatus, OPEN_LEAD_STATUSES } from '../crm-leads/crm-leads.dto';
import { CrmDashboardQueryDto } from './crm-dashboard.dto';

/** A lead with no contact for this long is going cold. */
const STALE_AFTER_DAYS = 14;
/** Ranked panels show a handful of rows; the rest is noise on a dashboard. */
const RANK_LIMIT = 6;
const RECENT_CAMPAIGNS = 5;

type DateWindow = { from: string; to: string; fromDate: Date; toDate: Date };

function startOfDay(value: Date): Date {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
}

/**
 * `YYYY-MM-DD` in the server's timezone — deliberately not `toISOString()`, which
 * would bucket a Dhaka evening (UTC+6) into the previous day and shift every
 * trend point by one.
 */
/**
 * Reads a `YYYY-MM-DD` bound as local midnight. `new Date('2026-08-04')` is *UTC*
 * midnight, which lands on the previous day in any negative-offset timezone — the
 * same off-by-one the formatter below avoids, at the other end of the request.
 */
function parseDateOnly(value: string | undefined): Date | null {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
}

function formatDate(value: Date): string {
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${month}-${day}`;
}

function percent(part: number, whole: number): number | null {
    if (whole <= 0) return null;
    return Math.round((part / whole) * 1000) / 10;
}

/**
 * Aggregates for the CRM dashboard — the pipeline half of CRM, in one request.
 *
 * A dedicated service rather than another method on `CrmLeadsService` because the
 * payload spans leads, follow-ups, conversations and campaigns; the page paints
 * once and must not fan out into six round trips to do it.
 */
@Injectable()
export class CrmDashboardService {
    constructor(private readonly db: DatabaseService) {}

    /** Defaults to the last 30 days when the client sends no window. */
    private resolveWindow(query: CrmDashboardQueryDto): DateWindow {
        const today = startOfDay(new Date());
        const defaultFrom = new Date(today);
        defaultFrom.setDate(defaultFrom.getDate() - 29);

        const fromDate = parseDateOnly(query.from) ?? defaultFrom;
        const toDate = parseDateOnly(query.to) ?? new Date(today);
        toDate.setHours(23, 59, 59, 999);

        return { from: formatDate(fromDate), to: formatDate(toDate), fromDate, toDate };
    }

    async getOverview(tenantId: string, query: CrmDashboardQueryDto) {
        const window = this.resolveWindow(query);

        const [pipeline, followUps, activity, sources, owners, campaigns] = await Promise.all([
            this.getPipeline(tenantId, window),
            this.getFollowUps(tenantId, window),
            this.getActivity(tenantId, window),
            this.getSources(tenantId, window),
            this.getOwners(tenantId, window),
            this.getCampaigns(tenantId, window),
        ]);

        return {
            filters: { from: window.from, to: window.to },
            pipeline,
            follow_ups: followUps,
            activity,
            sources,
            owners,
            campaigns,
        };
    }

    /**
     * Stage counts are the whole book — an open pipeline is a stock, and a window
     * on it would answer a question nobody asked. Only the flows below are dated.
     */
    private async getPipeline(tenantId: string, window: DateWindow) {
        const staleBefore = new Date();
        staleBefore.setDate(staleBefore.getDate() - STALE_AFTER_DAYS);

        const openStatuses = [...OPEN_LEAD_STATUSES];
        const closedInWindow = { gte: window.fromDate, lte: window.toDate };

        const [grouped, createdInPeriod, converted, lost, unassigned, stale] = await Promise.all([
            this.db.lead.groupBy({
                by: ['status'],
                where: { tenant_id: tenantId },
                _count: { _all: true },
            }),
            this.db.lead.count({
                where: { tenant_id: tenantId, created_at: closedInWindow },
            }),
            this.db.lead.findMany({
                where: { tenant_id: tenantId, status: LeadStatus.CONVERTED, closed_at: closedInWindow },
                select: { created_at: true, closed_at: true },
            }),
            this.db.lead.count({
                where: { tenant_id: tenantId, status: LeadStatus.LOST, closed_at: closedInWindow },
            }),
            this.db.lead.count({
                where: { tenant_id: tenantId, status: { in: openStatuses }, assigned_to: null },
            }),
            this.db.lead.count({
                where: {
                    tenant_id: tenantId,
                    status: { in: openStatuses },
                    // A lead nobody has contacted yet is only stale once it has been
                    // sitting there — a lead created this morning is not neglected.
                    OR: [
                        { last_contacted_at: { lt: staleBefore } },
                        { last_contacted_at: null, created_at: { lt: staleBefore } },
                    ],
                },
            }),
        ]);

        const counts: Record<string, number> = {};
        for (const status of Object.values(LeadStatus)) counts[status] = 0;
        for (const row of grouped) counts[row.status] = row._count._all;

        const convertedInPeriod = converted.length;
        const daysToConvert = converted
            .filter((lead) => lead.closed_at)
            .map((lead) => (lead.closed_at!.getTime() - lead.created_at.getTime()) / 86_400_000);

        return {
            counts,
            open: counts[LeadStatus.NEW] + counts[LeadStatus.CONTACTED] + counts[LeadStatus.QUALIFIED],
            created_in_period: createdInPeriod,
            converted_in_period: convertedInPeriod,
            lost_in_period: lost,
            // Of the deals that *closed* this period, the share that were won.
            // Leads still open are not failures yet, so they stay out of it.
            conversion_rate_pct: percent(convertedInPeriod, convertedInPeriod + lost),
            avg_days_to_convert: daysToConvert.length
                ? Math.round((daysToConvert.reduce((sum, d) => sum + d, 0) / daysToConvert.length) * 10) / 10
                : null,
            unassigned,
            stale,
            stale_after_days: STALE_AFTER_DAYS,
        };
    }

    private async getFollowUps(tenantId: string, window: DateWindow) {
        const today = startOfDay(new Date());
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const [dueToday, overdue, totalPending, completed] = await Promise.all([
            this.db.crmFollowUp.count({
                where: { tenant_id: tenantId, status: 'PENDING', due_at: { gte: today, lt: tomorrow } },
            }),
            this.db.crmFollowUp.count({
                where: { tenant_id: tenantId, status: 'PENDING', due_at: { lt: today } },
            }),
            this.db.crmFollowUp.count({ where: { tenant_id: tenantId, status: 'PENDING' } }),
            this.db.crmFollowUp.count({
                where: {
                    tenant_id: tenantId,
                    completed_at: { gte: window.fromDate, lte: window.toDate },
                },
            }),
        ]);

        return {
            due_today: dueToday,
            overdue,
            total_pending: totalPending,
            completed_in_period: completed,
        };
    }

    private async getActivity(tenantId: string, window: DateWindow) {
        const created = { gte: window.fromDate, lte: window.toDate };

        const [logged, byType, touched] = await Promise.all([
            this.db.leadConversation.count({ where: { tenant_id: tenantId, created_at: created } }),
            this.db.leadConversation.groupBy({
                by: ['type'],
                where: { tenant_id: tenantId, created_at: created },
                _count: { _all: true },
            }),
            this.db.leadConversation.findMany({
                where: { tenant_id: tenantId, created_at: created },
                select: { lead_id: true },
                distinct: ['lead_id'],
            }),
        ]);

        // `type` is the channel's code, denormalised onto the conversation. Resolve
        // it back to the tenant's editable label so a renamed channel reads right.
        const codes = byType.map((row) => row.type);
        const channels = codes.length
            ? await this.db.conversationChannel.findMany({
                where: { tenant_id: tenantId, code: { in: codes } },
                select: { code: true, name: true },
            })
            : [];
        const nameByCode = new Map(channels.map((c) => [c.code, c.name]));

        return {
            logged_in_period: logged,
            leads_touched: touched.length,
            by_type: byType
                .map((row) => ({
                    code: row.type,
                    name: nameByCode.get(row.type) ?? row.type,
                    count: row._count._all,
                }))
                .sort((a, b) => b.count - a.count),
        };
    }

    /**
     * Attribution for the leads that *arrived* in the window, not for every lead
     * that closed in it — "where did this month's pipeline come from" is the
     * question a source mix answers, and it needs no close date to be honest.
     */
    private async getSources(tenantId: string, window: DateWindow) {
        const created = { gte: window.fromDate, lte: window.toDate };

        const [grouped, convertedGrouped] = await Promise.all([
            this.db.lead.groupBy({
                by: ['source_id'],
                where: { tenant_id: tenantId, created_at: created },
                _count: { _all: true },
            }),
            this.db.lead.groupBy({
                by: ['source_id'],
                where: { tenant_id: tenantId, created_at: created, status: LeadStatus.CONVERTED },
                _count: { _all: true },
            }),
        ]);

        const convertedBySource = new Map(
            convertedGrouped.map((row) => [row.source_id, row._count._all]),
        );

        const ids = grouped.map((row) => row.source_id).filter((id): id is string => Boolean(id));
        const options = ids.length
            ? await this.db.leadSourceOption.findMany({
                where: { tenant_id: tenantId, id: { in: ids } },
                select: { id: true, name: true },
            })
            : [];
        const nameById = new Map(options.map((option) => [option.id, option.name]));

        return grouped
            .map((row) => {
                const leads = row._count._all;
                const converted = convertedBySource.get(row.source_id) ?? 0;
                return {
                    id: row.source_id,
                    // Leads predating the taxonomy backfill have no source row.
                    name: row.source_id ? (nameById.get(row.source_id) ?? '—') : '—',
                    leads,
                    converted,
                    conversion_rate_pct: percent(converted, leads),
                };
            })
            .sort((a, b) => b.leads - a.leads)
            .slice(0, RANK_LIMIT);
    }

    private async getOwners(tenantId: string, window: DateWindow) {
        const today = startOfDay(new Date());
        const openStatuses = [...OPEN_LEAD_STATUSES];

        const [openGrouped, convertedGrouped, overdueGrouped] = await Promise.all([
            this.db.lead.groupBy({
                by: ['assigned_to'],
                where: { tenant_id: tenantId, status: { in: openStatuses }, assigned_to: { not: null } },
                _count: { _all: true },
            }),
            this.db.lead.groupBy({
                by: ['assigned_to'],
                where: {
                    tenant_id: tenantId,
                    status: LeadStatus.CONVERTED,
                    closed_at: { gte: window.fromDate, lte: window.toDate },
                    assigned_to: { not: null },
                },
                _count: { _all: true },
            }),
            this.db.crmFollowUp.groupBy({
                by: ['assigned_to'],
                where: {
                    tenant_id: tenantId,
                    status: 'PENDING',
                    due_at: { lt: today },
                    assigned_to: { not: null },
                },
                _count: { _all: true },
            }),
        ]);

        const convertedByUser = new Map(convertedGrouped.map((row) => [row.assigned_to, row._count._all]));
        const overdueByUser = new Map(overdueGrouped.map((row) => [row.assigned_to, row._count._all]));

        // Someone who closed a deal or is sitting on an overdue call belongs on the
        // board even with an empty open pipeline.
        const userIds = [
            ...new Set(
                [...openGrouped, ...convertedGrouped, ...overdueGrouped]
                    .map((row) => row.assigned_to)
                    .filter((id): id is string => Boolean(id)),
            ),
        ];
        const users = userIds.length
            ? await this.db.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, name: true, email: true },
            })
            : [];
        const userById = new Map(users.map((user) => [user.id, user]));
        const openByUser = new Map(openGrouped.map((row) => [row.assigned_to, row._count._all]));

        return userIds
            .map((id) => ({
                user_id: id,
                name: userById.get(id)?.name || userById.get(id)?.email || '—',
                open_leads: openByUser.get(id) ?? 0,
                converted_in_period: convertedByUser.get(id) ?? 0,
                overdue_follow_ups: overdueByUser.get(id) ?? 0,
            }))
            .sort((a, b) => b.open_leads - a.open_leads || b.converted_in_period - a.converted_in_period)
            .slice(0, RANK_LIMIT);
    }

    private async getCampaigns(tenantId: string, window: DateWindow) {
        const sentInWindow = { gte: window.fromDate, lte: window.toDate };

        const [totals, recent] = await Promise.all([
            this.db.crmCampaign.aggregate({
                where: { tenant_id: tenantId, sent_at: sentInWindow },
                _count: { _all: true },
                _sum: {
                    delivered_count: true,
                    failed_count: true,
                    attributed_revenue: true,
                    attributed_orders: true,
                },
            }),
            this.db.crmCampaign.findMany({
                where: { tenant_id: tenantId },
                orderBy: { created_at: 'desc' },
                take: RECENT_CAMPAIGNS,
                select: {
                    id: true,
                    name: true,
                    status: true,
                    channel: true,
                    recipient_count: true,
                    delivered_count: true,
                    failed_count: true,
                },
            }),
        ]);

        return {
            sent_in_period: totals._count._all,
            delivered: totals._sum.delivered_count ?? 0,
            failed: totals._sum.failed_count ?? 0,
            attributed_revenue: Number(totals._sum.attributed_revenue ?? 0),
            attributed_orders: totals._sum.attributed_orders ?? 0,
            recent,
        };
    }

    /**
     * Daily buckets for the KPI sparklines. Rows are bucketed in JS rather than
     * with `date_trunc`, the same way the accounting trends do it: at CRM volumes
     * the row count is small, and it keeps day boundaries on one clock.
     */
    async getTrends(tenantId: string, query: CrmDashboardQueryDto) {
        const window = this.resolveWindow(query);
        const range = { gte: window.fromDate, lte: window.toDate };

        const [created, conversations, converted, completedFollowUps] = await Promise.all([
            this.db.lead.findMany({
                where: { tenant_id: tenantId, created_at: range },
                select: { created_at: true },
            }),
            this.db.leadConversation.findMany({
                where: { tenant_id: tenantId, created_at: range },
                select: { created_at: true },
            }),
            this.db.lead.findMany({
                where: { tenant_id: tenantId, status: LeadStatus.CONVERTED, closed_at: range },
                select: { closed_at: true },
            }),
            this.db.crmFollowUp.findMany({
                where: { tenant_id: tenantId, completed_at: range },
                select: { completed_at: true },
            }),
        ]);

        const points = new Map<string, {
            date: string;
            leads_created: number;
            conversations: number;
            leads_converted: number;
            follow_ups_completed: number;
        }>();

        // Every day in the window gets a point, so a quiet Friday reads as a zero
        // rather than closing the gap and flattering the line.
        for (let day = new Date(window.fromDate); day <= window.toDate; day.setDate(day.getDate() + 1)) {
            const key = formatDate(day);
            points.set(key, {
                date: key,
                leads_created: 0,
                conversations: 0,
                leads_converted: 0,
                follow_ups_completed: 0,
            });
        }

        const bucket = (
            at: Date | null,
            field: 'leads_created' | 'conversations' | 'leads_converted' | 'follow_ups_completed',
        ) => {
            if (!at) return;
            const point = points.get(formatDate(startOfDay(at)));
            if (point) point[field] += 1;
        };

        for (const row of created) bucket(row.created_at, 'leads_created');
        for (const row of conversations) bucket(row.created_at, 'conversations');
        for (const row of converted) bucket(row.closed_at, 'leads_converted');
        for (const row of completedFollowUps) bucket(row.completed_at, 'follow_ups_completed');

        return { filters: { from: window.from, to: window.to }, points: [...points.values()] };
    }
}
