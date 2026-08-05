'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { useModuleDashboard } from '@/lib/use-module-dashboard';
import ModuleDashboard, {
    AttentionSection,
    DashboardSection,
    KpiTileGrid,
    type DashboardMount,
    type KpiTileSpec,
} from '@/components/dashboard/ModuleDashboard';
import { type AttentionItem } from '@/components/dashboard/AttentionStrip';
import { RankedListPanel, type RankedItem } from '@/components/dashboard/RankedListPanel';
import type { DashboardIdentity } from './dashboard-identity';

type OverviewResponse = {
    filters: { from: string; to: string };
    tenants: { total: number; new_in_period: number; users: number; new_users_in_period: number };
    subscriptions: {
        active: number;
        trialing: number;
        past_due: number;
        cancelled: number;
        expiring_trials: number;
        lapsed: number;
    };
    revenue: { billed_in_period: number; payments: number; mrr_ceiling: number };
    support: { open_threads: number; awaiting_reply: number };
    top_tenants: Array<{
        id: string;
        name: string;
        plan: string | null;
        revenue: number;
        payments: number;
    }>;
    recent_signups: Array<{
        id: string;
        name: string;
        plan: string | null;
        status: string | null;
        created_at: string;
    }>;
    plans: Array<{ id: string; code: string | null; name: string; tenants: number }>;
};

type TrendPoint = { date: string; signups: number; billed: number };

/**
 * Admin > Overview: how many tenants there are, what they are paying, and which
 * of them need attention.
 *
 * Platform-scoped, so it never takes a tenant identity — the greeting props are
 * accepted for shape compatibility with the other dashboards and are only used
 * on the standalone mount.
 */
export default function AdminDashboard({
    greeting,
    tenantName,
    variant = 'page',
}: Readonly<DashboardIdentity & { variant?: DashboardMount }>) {
    const { t, locale } = useI18n();
    const copy = t.dashboardHome;
    const adm = copy.admin;

    const {
        range,
        setRange,
        overview,
        previous: prev,
        trends,
        loading,
        error,
        deltaContext,
        compare,
    } = useModuleDashboard<OverviewResponse, TrendPoint>({
        fetchOverview: (window) => api.getAdminDashboardOverview(window),
        fetchTrends: (window) => api.getAdminDashboardTrends(window),
        unavailableMessage: adm.overviewUnavailable,
    });

    const money = (value: number) => formatBDT(value, { locale });
    const tenants = overview?.tenants;
    const subscriptions = overview?.subscriptions;
    const revenue = overview?.revenue;

    const kpiTiles: KpiTileSpec[] = [
        {
            key: 'tenants',
            title: adm.kpiTenants,
            // How many customers exist is a stock; a period delta on it would
            // read as growth while quietly ignoring churn.
            value: String(tenants?.total ?? 0),
            delta: { label: '—', positive: true },
            note: formatMessage(adm.helperUsers, {
                count: tenants?.users ?? 0,
                joined: tenants?.new_users_in_period ?? 0,
            }),
        },
        {
            key: 'signups',
            title: adm.kpiSignups,
            value: String(tenants?.new_in_period ?? 0),
            points: trends.map((point) => point.signups),
            delta: compare(tenants?.new_in_period, prev?.tenants.new_in_period),
            note: formatMessage(adm.helperActiveSubs, {
                active: subscriptions?.active ?? 0,
                trialing: subscriptions?.trialing ?? 0,
            }),
        },
        {
            key: 'billed',
            title: adm.kpiBilled,
            value: money(revenue?.billed_in_period ?? 0),
            points: trends.map((point) => point.billed),
            delta: compare(revenue?.billed_in_period, prev?.revenue.billed_in_period),
            note: formatMessage(adm.helperPayments, { count: revenue?.payments ?? 0 }),
        },
        {
            key: 'mrr',
            title: adm.kpiMrr,
            value: money(revenue?.mrr_ceiling ?? 0),
            delta: compare(revenue?.mrr_ceiling, prev?.revenue.mrr_ceiling),
            // Says out loud that discounts are not applied, rather than letting
            // the number pass for the real run rate.
            note: adm.helperMrrCaveat,
        },
    ];

    const attentionItems = useMemo<AttentionItem[]>(() => {
        const items: AttentionItem[] = [];
        if (!overview) return items;

        const { subscriptions: subs, support } = overview;

        if (subs.past_due > 0) {
            items.push({
                id: 'past-due',
                tone: 'red',
                value: String(subs.past_due),
                label: formatMessage(adm.attnPastDue, { count: subs.past_due }),
                href: '/admin/tenants',
                cta: adm.viewAll,
            });
        }
        if (subs.lapsed > 0) {
            items.push({
                id: 'lapsed',
                tone: 'red',
                value: String(subs.lapsed),
                label: formatMessage(adm.attnLapsed, { count: subs.lapsed }),
                href: '/admin/tenants',
                cta: adm.viewAll,
            });
        }
        if (support.awaiting_reply > 0) {
            items.push({
                id: 'awaiting-reply',
                tone: 'red',
                value: String(support.awaiting_reply),
                label: formatMessage(adm.attnAwaitingReply, { count: support.awaiting_reply }),
                href: '/admin/support',
                cta: adm.viewAll,
            });
        }
        if (subs.expiring_trials > 0) {
            items.push({
                id: 'expiring-trials',
                tone: 'amber',
                value: String(subs.expiring_trials),
                label: formatMessage(adm.attnExpiringTrials, { count: subs.expiring_trials }),
                href: '/admin/tenants',
                cta: adm.viewAll,
            });
        }
        if (support.open_threads > 0) {
            items.push({
                id: 'open-threads',
                tone: 'blue',
                value: String(support.open_threads),
                label: formatMessage(adm.attnOpenThreads, { count: support.open_threads }),
                href: '/admin/support',
                cta: adm.viewAll,
            });
        }
        return items;
    }, [overview, adm]);

    const tenantItems = useMemo<RankedItem[]>(
        () => (overview?.top_tenants ?? []).map((row) => ({
            id: row.id,
            name: row.name,
            meta: formatMessage(adm.topTenantMeta, {
                plan: row.plan ?? adm.topTenantNoPlan,
                count: row.payments,
            }),
            amount: money(row.revenue),
        })),
        [overview?.top_tenants, adm, locale],
    );

    const planItems = useMemo<RankedItem[]>(
        () => (overview?.plans ?? []).map((row) => ({
            id: row.id,
            name: row.name,
            meta: adm.planMeta,
            amount: String(row.tenants),
        })),
        [overview?.plans, adm],
    );

    return (
        <ModuleDashboard
            mount={variant}
            greeting={greeting}
            tenantName={tenantName}
            subtitle={adm.subtitle}
            range={range}
            onRangeChange={setRange}
            error={error}
        >
            <AttentionSection
                items={attentionItems}
                loading={loading}
                label={copy.sectionAttention}
                allClearLabel={adm.attnAllClear}
            />

            <DashboardSection label={adm.sectionPlatform}>
                <KpiTileGrid tiles={kpiTiles} loading={loading} deltaContext={deltaContext} />
            </DashboardSection>

            <DashboardSection label={adm.sectionCustomers}>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                    <RankedListPanel
                        title={adm.topTenantsTitle}
                        items={tenantItems}
                        emptyLabel={adm.topTenantsEmpty}
                    />
                    <RankedListPanel
                        title={adm.plansTitle}
                        items={planItems}
                        emptyLabel={adm.plansEmpty}
                    />

                    <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <h3 className="text-xs font-bold text-gray-900">{adm.signupsTitle}</h3>
                            <Link href="/admin/tenants" className="text-[10px] font-bold text-primary hover:underline">
                                {adm.viewAll}
                            </Link>
                        </div>
                        {(overview?.recent_signups ?? []).length === 0 ? (
                            <p className="py-4 text-center text-[11px] text-gray-400">{adm.signupsEmpty}</p>
                        ) : (
                            <ul>
                                {overview!.recent_signups.map((row) => (
                                    <li
                                        key={row.id}
                                        className="flex items-center gap-2 border-b border-gray-50 py-1.5 text-[11px] last:border-0"
                                    >
                                        <span className="min-w-0 flex-1 truncate font-semibold text-gray-900">
                                            {row.name}
                                        </span>
                                        <span className="shrink-0 text-[10px] text-gray-500">
                                            {row.plan ?? adm.signupNoPlan}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </DashboardSection>
        </ModuleDashboard>
    );
}
