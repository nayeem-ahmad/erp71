import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
    emptyDailyBuckets,
    money,
    resolveDateWindow,
    type DateWindow,
} from '../common/dashboard-window';
import { AdminDashboardQueryDto } from './admin-dashboard.dto';

/** Ranked panels show a handful of rows; the rest is noise on a dashboard. */
const RANK_LIMIT = 6;
const RECENT_SIGNUPS = 5;

/** A trial ending this soon needs a conversation before it lapses. */
const TRIAL_ENDING_WITHIN_DAYS = 7;

/** A soft-deleted tenant is not a customer, and not churn either — it is gone. */
const LIVE_TENANT = { deleted_at: null } as const;

/**
 * Aggregates for the platform-admin dashboard: how many tenants there are, what
 * they are paying, and which of them need attention.
 *
 * Platform-scoped throughout — nothing here is filtered by tenant, which is why
 * the controller has no `TenantInterceptor`.
 */
@Injectable()
export class AdminDashboardService {
    constructor(private readonly db: DatabaseService) {}

    async getOverview(query: AdminDashboardQueryDto, timezone: string) {
        const window = resolveDateWindow(query, timezone);

        const [tenants, subscriptions, revenue, support, topTenants, recentSignups, plans] = await Promise.all([
            this.getTenants(window),
            this.getSubscriptions(),
            this.getRevenue(window),
            this.getSupport(),
            this.getTopTenants(window),
            this.getRecentSignups(),
            this.getPlanMix(),
        ]);

        return {
            filters: { from: window.from, to: window.to },
            tenants,
            subscriptions,
            revenue,
            support,
            top_tenants: topTenants,
            recent_signups: recentSignups,
            plans,
        };
    }

    private async getTenants(window: DateWindow) {
        const inWindow = { gte: window.fromDate, lte: window.toDate };

        const [total, newInPeriod, users, newUsers] = await Promise.all([
            this.db.tenant.count({ where: LIVE_TENANT }),
            this.db.tenant.count({ where: { ...LIVE_TENANT, created_at: inWindow } }),
            this.db.user.count(),
            this.db.user.count({ where: { created_at: inWindow } }),
        ]);

        return { total, new_in_period: newInPeriod, users, new_users_in_period: newUsers };
    }

    private async getSubscriptions() {
        const now = new Date();
        const soon = new Date(now);
        soon.setDate(soon.getDate() + TRIAL_ENDING_WITHIN_DAYS);

        const [grouped, expiringTrials, lapsed] = await Promise.all([
            this.db.tenantSubscription.groupBy({
                by: ['status'],
                where: { tenant: LIVE_TENANT },
                _count: { status: true },
            }),
            this.db.tenantSubscription.count({
                where: {
                    tenant: LIVE_TENANT,
                    status: 'TRIALING',
                    current_period_end: { gte: now, lte: soon },
                },
            }),
            // Already past its period end and nobody has renewed it.
            this.db.tenantSubscription.count({
                where: {
                    tenant: LIVE_TENANT,
                    status: { in: ['ACTIVE', 'TRIALING'] },
                    current_period_end: { lt: now },
                },
            }),
        ]);

        const byStatus = Object.fromEntries(grouped.map((row) => [row.status, row._count.status]));

        return {
            active: byStatus.ACTIVE ?? 0,
            trialing: byStatus.TRIALING ?? 0,
            past_due: byStatus.PAST_DUE ?? 0,
            cancelled: byStatus.CANCELLED ?? 0,
            expiring_trials: expiringTrials,
            lapsed,
        };
    }

    /**
     * Billed in the window, and the run rate the active book implies.
     *
     * `mrr` is the sum of list prices on active subscriptions. It deliberately
     * ignores per-tenant discounts: those are stored as a type and a value on
     * the subscription rather than a resolved amount, and applying them here
     * would put a second, differently-rounded implementation of billing
     * arithmetic on a dashboard. The figure is a ceiling, and named as one.
     */
    private async getRevenue(window: DateWindow) {
        const [billed, activeSubs] = await Promise.all([
            this.db.billingEvent.aggregate({
                where: {
                    status: 'SUCCESS',
                    created_at: { gte: window.fromDate, lte: window.toDate },
                },
                _sum: { amount: true },
                _count: { _all: true },
            }),
            this.db.tenantSubscription.findMany({
                where: { tenant: LIVE_TENANT, status: 'ACTIVE' },
                select: { plan: { select: { monthly_price: true } } },
            }),
        ]);

        const mrr = activeSubs.reduce((sum, row) => sum + Number(row.plan?.monthly_price ?? 0), 0);

        return {
            billed_in_period: money(Number(billed._sum.amount ?? 0)),
            payments: billed._count._all,
            mrr_ceiling: money(mrr),
        };
    }

    /**
     * Open threads, and how many of them the platform owes a reply on.
     *
     * "Awaiting a reply" is *the last message was the shop owner's*, which no
     * column records — so the newest message of each open thread is read and
     * counted here. Bounded by the open threads, which is the set a human is
     * expected to work through anyway.
     */
    private async getSupport() {
        const openThreads = await this.db.supportThread.findMany({
            where: { status: 'open' },
            select: {
                id: true,
                messages: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: { senderRole: true },
                },
            },
        });

        const awaitingReply = openThreads.filter(
            (thread) => thread.messages[0]?.senderRole === 'owner',
        ).length;

        return { open_threads: openThreads.length, awaiting_reply: awaitingReply };
    }

    private async getTopTenants(window: DateWindow) {
        const grouped = await this.db.billingEvent.groupBy({
            by: ['tenant_id'],
            where: {
                status: 'SUCCESS',
                created_at: { gte: window.fromDate, lte: window.toDate },
            },
            _sum: { amount: true },
            _count: { _all: true },
        });

        const ranked = grouped
            .map((row) => ({
                id: row.tenant_id,
                revenue: Number(row._sum.amount ?? 0),
                payments: row._count._all,
            }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, RANK_LIMIT);

        const named = await this.db.tenant.findMany({
            where: { id: { in: ranked.map((row) => row.id) } },
            select: { id: true, name: true, subscription: { select: { plan: { select: { code: true } } } } },
        });
        const byId = new Map(named.map((tenant) => [tenant.id, tenant]));

        return ranked.map((row) => ({
            id: row.id,
            name: byId.get(row.id)?.name ?? 'Unknown tenant',
            plan: byId.get(row.id)?.subscription?.plan?.code ?? null,
            revenue: money(row.revenue),
            payments: row.payments,
        }));
    }

    private async getRecentSignups() {
        const rows = await this.db.tenant.findMany({
            where: LIVE_TENANT,
            orderBy: { created_at: 'desc' },
            take: RECENT_SIGNUPS,
            select: {
                id: true,
                name: true,
                created_at: true,
                subscription: { select: { status: true, plan: { select: { code: true } } } },
            },
        });

        return rows.map((row) => ({
            id: row.id,
            name: row.name,
            plan: row.subscription?.plan?.code ?? null,
            status: row.subscription?.status ?? null,
            created_at: row.created_at,
        }));
    }

    private async getPlanMix() {
        const grouped = await this.db.tenantSubscription.groupBy({
            by: ['plan_id'],
            where: { tenant: LIVE_TENANT },
            _count: { _all: true },
        });

        const plans = await this.db.subscriptionPlan.findMany({
            where: { id: { in: grouped.map((row) => row.plan_id) } },
            select: { id: true, code: true, name: true },
        });
        const byId = new Map(plans.map((plan) => [plan.id, plan]));

        return grouped
            .map((row) => ({
                id: row.plan_id,
                code: byId.get(row.plan_id)?.code ?? null,
                name: byId.get(row.plan_id)?.name ?? 'Unknown plan',
                tenants: row._count._all,
            }))
            .sort((a, b) => b.tenants - a.tenants)
            .slice(0, RANK_LIMIT);
    }

    /** Daily signups and billed amount, feeding the KPI sparklines. */
    async getTrends(query: AdminDashboardQueryDto, timezone: string) {
        const window = resolveDateWindow(query, timezone);
        const inWindow = { gte: window.fromDate, lte: window.toDate };

        const [tenants, payments] = await Promise.all([
            this.db.tenant.findMany({
                where: { ...LIVE_TENANT, created_at: inWindow },
                select: { created_at: true },
            }),
            this.db.billingEvent.findMany({
                where: { status: 'SUCCESS', created_at: inWindow },
                select: { created_at: true, amount: true },
            }),
        ]);

        const buckets = emptyDailyBuckets(window, () => ({ signups: 0, billed: 0 }));

        for (const tenant of tenants) {
            const bucket = buckets.get(window.dayOf(tenant.created_at));
            if (bucket) bucket.signups += 1;
        }
        for (const payment of payments) {
            const bucket = buckets.get(window.dayOf(payment.created_at));
            if (bucket) bucket.billed += Number(payment.amount ?? 0);
        }

        return {
            points: [...buckets.entries()].map(([date, values]) => ({
                date,
                signups: values.signups,
                billed: money(values.billed),
            })),
        };
    }
}
