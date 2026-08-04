'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { previousDateWindow, rangeToDateWindow } from '@/lib/dashboard-range';
import { periodDelta } from '@/lib/dashboard-delta';
import { routes } from '@/lib/routes';
import { DashboardHeader, RangeTabs, type DashboardRange } from '@/components/dashboard/DashboardHeader';
import { HealthKpiTile } from '@/components/dashboard/HealthKpiTile';
import { AttentionStrip, type AttentionItem } from '@/components/dashboard/AttentionStrip';
import { PipelineFunnel, type FunnelStage } from '@/components/dashboard/PipelineFunnel';
import { RankedListPanel, type RankedItem } from '@/components/dashboard/RankedListPanel';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui';
import PageShell from '@/components/ui/compact/PageShell';
import type { DashboardIdentity } from './dashboard-identity';

type OverviewResponse = {
    filters: { from: string; to: string };
    pipeline: {
        counts: Record<string, number>;
        open: number;
        created_in_period: number;
        converted_in_period: number;
        lost_in_period: number;
        conversion_rate_pct: number | null;
        avg_days_to_convert: number | null;
        unassigned: number;
        stale: number;
        stale_after_days: number;
    };
    follow_ups: { due_today: number; overdue: number; total_pending: number; completed_in_period: number };
    activity: {
        logged_in_period: number;
        leads_touched: number;
        by_type: Array<{ code: string; name: string; count: number }>;
    };
    sources: Array<{
        id: string | null;
        name: string;
        leads: number;
        converted: number;
        conversion_rate_pct: number | null;
    }>;
    owners: Array<{
        user_id: string;
        name: string;
        open_leads: number;
        converted_in_period: number;
        overdue_follow_ups: number;
    }>;
    campaigns: {
        sent_in_period: number;
        delivered: number;
        failed: number;
        attributed_revenue: number;
        attributed_orders: number;
        recent: Array<{
            id: string;
            name: string;
            status: string;
            channel: string;
            recipient_count: number;
            delivered_count: number;
            failed_count: number;
        }>;
    };
};

type TrendPoint = {
    date: string;
    leads_created: number;
    conversations: number;
    leads_converted: number;
    follow_ups_completed: number;
};

const campaignStatusTone: Record<string, StatusBadgeTone> = {
    DRAFT: 'neutral',
    SCHEDULED: 'info',
    SENDING: 'warning',
    COMPLETED: 'success',
    CANCELLED: 'danger',
};

/** Initials for the owner leaderboard avatars. */
function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    const last = parts.length > 1 ? (parts.at(-1) as string)[0] : '';
    return (parts[0][0] + last).toUpperCase();
}

/**
 * The pipeline dashboard: what came in, what is going cold, what closed, and who
 * is carrying it.
 *
 * Rendered from two places — `/crm` for any premium-CRM tenant, and `/dashboard`
 * when `resolveDashboardVariant` returns CRM — so it takes its identity strings
 * as props rather than fetching `/auth/me` for itself.
 *
 * `variant="embedded"` drops the page shell and the greeting, because on `/crm`
 * the module hub already supplies both and two of either is one too many.
 */
export default function CrmDashboard({
    greeting,
    tenantName,
    variant = 'page',
}: Readonly<DashboardIdentity & { variant?: 'page' | 'embedded' }>) {
    const { t, locale } = useI18n();
    const copy = t.dashboardHome;
    const crm = copy.crm;
    const leadStatusLabels = t.crm.leads.statuses as Record<string, string>;

    const [range, setRange] = useState<DashboardRange>('month');
    const [overview, setOverview] = useState<OverviewResponse | null>(null);
    const [previous, setPrevious] = useState<OverviewResponse | null>(null);
    const [trends, setTrends] = useState<TrendPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setLoading(true);
            setError('');

            const window = rangeToDateWindow(range);
            const prevWindow = previousDateWindow(window);

            const [overviewRes, prevRes, trendRes] = await Promise.allSettled([
                api.getCrmDashboardOverview(window),
                api.getCrmDashboardOverview(prevWindow),
                api.getCrmDashboardTrends(window),
            ]);

            if (cancelled) return;

            if (overviewRes.status === 'fulfilled') {
                setOverview(overviewRes.value);
            } else {
                setOverview(null);
                setError(overviewRes.reason instanceof Error ? overviewRes.reason.message : crm.overviewUnavailable);
            }

            // The comparison window only feeds the deltas, and the trend only the
            // sparklines; losing either costs a "—", not the dashboard.
            setPrevious(prevRes.status === 'fulfilled' ? prevRes.value : null);
            setTrends(trendRes.status === 'fulfilled' ? (trendRes.value?.points ?? []) : []);
            setLoading(false);
        };

        void load();

        return () => {
            cancelled = true;
        };
    }, [range, crm.overviewUnavailable]);

    const pipeline = overview?.pipeline;
    const followUps = overview?.follow_ups;
    const activity = overview?.activity;
    const campaigns = overview?.campaigns;

    const DELTA_CONTEXT: Record<DashboardRange, string> = {
        today: copy.vsPreviousToday,
        week: copy.vsPreviousWeek,
        month: copy.vsPreviousMonth,
    };
    const deltaContext = DELTA_CONTEXT[range];

    const compare = (current: number | null | undefined, prior: number | null | undefined) =>
        current == null || prior == null ? { label: '—', positive: true } : periodDelta(current, prior);

    // Four small objects — not memoised, because the `compare` closure would have
    // to be hoisted or suppressed to satisfy the dependency rule, and neither is
    // worth it for work this cheap.
    const prev = previous;
    const kpiTiles = [
            {
                key: 'new-leads',
                title: crm.kpiNewLeads,
                value: String(pipeline?.created_in_period ?? 0),
                series: trends.map((point) => point.leads_created),
                delta: compare(pipeline?.created_in_period, prev?.pipeline.created_in_period),
            },
            {
                key: 'conversion',
                title: crm.kpiConversionRate,
                value: pipeline?.conversion_rate_pct == null ? '—' : `${pipeline.conversion_rate_pct}%`,
                series: trends.map((point) => point.leads_converted),
                delta: compare(pipeline?.conversion_rate_pct, prev?.pipeline.conversion_rate_pct),
                note: formatMessage(crm.helperClosedDeals, {
                    won: pipeline?.converted_in_period ?? 0,
                    lost: pipeline?.lost_in_period ?? 0,
                }),
            },
            {
                key: 'conversations',
                title: crm.kpiConversations,
                value: String(activity?.logged_in_period ?? 0),
                series: trends.map((point) => point.conversations),
                delta: compare(activity?.logged_in_period, prev?.activity.logged_in_period),
                note: formatMessage(crm.helperLeadsTouched, { count: activity?.leads_touched ?? 0 }),
            },
            {
                key: 'campaign-revenue',
                title: crm.kpiCampaignRevenue,
                value: formatBDT(campaigns?.attributed_revenue ?? 0, { locale }),
                series: [] as number[],
                delta: compare(campaigns?.attributed_revenue, prev?.campaigns.attributed_revenue),
                note: formatMessage(crm.helperAttributedOrders, { count: campaigns?.attributed_orders ?? 0 }),
            },
    ];

    const attentionItems = useMemo<AttentionItem[]>(() => {
        const items: AttentionItem[] = [];
        if (!overview) return items;

        if (followUps && followUps.overdue > 0) {
            items.push({
                id: 'overdue',
                tone: 'red',
                value: String(followUps.overdue),
                label: formatMessage(crm.attnOverdueFollowUps, { count: followUps.overdue }),
                href: routes.crm.followUps,
                cta: crm.viewAll,
            });
        }
        if (followUps && followUps.due_today > 0) {
            items.push({
                id: 'due-today',
                tone: 'amber',
                value: String(followUps.due_today),
                label: formatMessage(crm.attnDueToday, { count: followUps.due_today }),
                href: routes.crm.followUps,
                cta: crm.viewAll,
            });
        }
        if (pipeline && pipeline.stale > 0) {
            items.push({
                id: 'stale',
                tone: 'amber',
                value: String(pipeline.stale),
                label: formatMessage(crm.attnStaleLeads, {
                    count: pipeline.stale,
                    days: pipeline.stale_after_days,
                }),
                href: routes.crm.leads,
                cta: crm.viewAll,
            });
        }
        if (pipeline && pipeline.unassigned > 0) {
            items.push({
                id: 'unassigned',
                tone: 'blue',
                value: String(pipeline.unassigned),
                label: formatMessage(crm.attnUnassignedLeads, { count: pipeline.unassigned }),
                href: routes.crm.leads,
                cta: crm.viewAll,
            });
        }
        if (campaigns && campaigns.failed > 0) {
            items.push({
                id: 'failed-sends',
                tone: 'red',
                value: String(campaigns.failed),
                label: formatMessage(crm.attnFailedSends, { count: campaigns.failed }),
                href: routes.crm.campaigns,
                cta: crm.viewAll,
            });
        }
        return items;
    }, [overview, followUps, pipeline, campaigns, crm]);

    const funnelStages = useMemo<FunnelStage[]>(() => {
        const counts = pipeline?.counts ?? {};
        const stage = (id: string, label: string, outcome?: 'won' | 'lost'): FunnelStage => ({
            id,
            label,
            count: counts[id] ?? 0,
            href: `${routes.crm.leads}?status=${id}`,
            outcome,
        });
        return [
            stage('NEW', leadStatusLabels.NEW ?? crm.stageNew),
            stage('CONTACTED', leadStatusLabels.CONTACTED ?? crm.stageContacted),
            stage('QUALIFIED', leadStatusLabels.QUALIFIED ?? crm.stageQualified),
            stage('CONVERTED', leadStatusLabels.CONVERTED ?? crm.stageConverted, 'won'),
            stage('LOST', leadStatusLabels.LOST ?? crm.stageLost, 'lost'),
        ];
    }, [pipeline, leadStatusLabels, crm]);

    const sourceItems = useMemo<RankedItem[]>(
        () => (overview?.sources ?? []).map((source) => ({
            id: source.id ?? 'unattributed',
            name: source.name,
            meta: source.conversion_rate_pct == null
                ? formatMessage(crm.sourceMetaNoRate, { converted: source.converted })
                : formatMessage(crm.sourceMeta, {
                    converted: source.converted,
                    rate: source.conversion_rate_pct,
                }),
            amount: String(source.leads),
        })),
        [overview?.sources, crm],
    );

    const ownerItems = useMemo<RankedItem[]>(
        () => (overview?.owners ?? []).map((owner) => ({
            id: owner.user_id,
            name: owner.name,
            meta: formatMessage(crm.ownerMeta, {
                converted: owner.converted_in_period,
                overdue: owner.overdue_follow_ups,
            }),
            amount: String(owner.open_leads),
            avatarInitials: initials(owner.name),
        })),
        [overview?.owners, crm],
    );

    const channelItems = useMemo<RankedItem[]>(
        () => (overview?.activity.by_type ?? []).map((channel) => ({
            id: channel.code,
            name: channel.name,
            meta: crm.channelMeta,
            amount: String(channel.count),
        })),
        [overview?.activity.by_type, crm],
    );

    const rangeLabels = { today: copy.rangeToday, week: copy.rangeWeek, month: copy.rangeMonth };

    const body = (
            <div className="space-y-4">
                {variant === 'page' ? (
                    <DashboardHeader
                        greeting={greeting}
                        tenantName={tenantName}
                        subtitle={crm.subtitle}
                        range={range}
                        onRangeChange={setRange}
                        labels={rangeLabels}
                    />
                ) : (
                    <div className="flex justify-end">
                        <RangeTabs range={range} onRangeChange={setRange} labels={rangeLabels} />
                    </div>
                )}

                {error ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                        {error}
                    </div>
                ) : null}

                <section>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                        {crm.sectionHealth}
                    </p>
                    {loading ? (
                        <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
                            {Array.from({ length: 4 }).map((_, index) => (
                                <div
                                    key={index}
                                    className="animate-pulse rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                                >
                                    <div className="h-3 w-16 rounded bg-gray-200" />
                                    <div className="mt-2 h-6 w-24 rounded bg-gray-200" />
                                    <div className="mt-2 h-3 w-12 rounded bg-gray-200" />
                                    <div className="mt-3 h-5 w-full rounded bg-gray-100" />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
                            {kpiTiles.map((tile) => (
                                <HealthKpiTile
                                    key={tile.key}
                                    title={tile.title}
                                    value={tile.value}
                                    delta={tile.delta.label}
                                    deltaPositive={tile.delta.positive}
                                    deltaContext={tile.delta.label === '—' ? undefined : deltaContext}
                                    points={tile.series}
                                    note={tile.note}
                                />
                            ))}
                        </div>
                    )}
                </section>

                <section>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                        {copy.sectionAttention}
                    </p>
                    {loading ? (
                        <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
                            {Array.from({ length: 3 }).map((_, index) => (
                                <div
                                    key={index}
                                    className="h-16 animate-pulse rounded-xl border border-gray-100 bg-white p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                                />
                            ))}
                        </div>
                    ) : (
                        <AttentionStrip items={attentionItems} allClearLabel={crm.attnAllClear} />
                    )}
                </section>

                <section>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                        {crm.sectionPipeline}
                    </p>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[3fr_2fr]">
                        <PipelineFunnel
                            title={crm.funnelTitle}
                            subtitle={crm.funnelSubtitle}
                            stages={funnelStages}
                            emptyLabel={crm.funnelEmpty}
                            formatCount={(count, share) => (share == null
                                ? formatMessage(crm.funnelCount, { count })
                                : formatMessage(crm.funnelCountWithShare, { count, share }))}
                        />
                        <RankedListPanel
                            title={crm.sourcesTitle}
                            items={sourceItems}
                            emptyLabel={crm.sourcesEmpty}
                        />
                    </div>
                </section>

                <section>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                        {crm.sectionTeam}
                    </p>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                        <RankedListPanel title={crm.ownersTitle} items={ownerItems} emptyLabel={crm.ownersEmpty} />
                        <RankedListPanel title={crm.channelsTitle} items={channelItems} emptyLabel={crm.channelsEmpty} />

                        <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                            <div className="mb-2 flex items-center justify-between gap-2">
                                <h3 className="text-xs font-bold text-gray-900">{crm.campaignsTitle}</h3>
                                <Link href={routes.crm.campaigns} className="text-[10px] font-bold text-primary hover:underline">
                                    {crm.viewAll}
                                </Link>
                            </div>
                            {(campaigns?.recent ?? []).length === 0 ? (
                                <p className="py-4 text-center text-[11px] text-gray-400">{crm.campaignsEmpty}</p>
                            ) : (
                                <ul>
                                    {campaigns!.recent.map((campaign) => (
                                        <li
                                            key={campaign.id}
                                            className="flex items-center gap-2 border-b border-gray-50 py-1.5 text-[11px] last:border-0"
                                        >
                                            <StatusBadge tone={campaignStatusTone[campaign.status] ?? 'neutral'} className="shrink-0">
                                                {campaign.status}
                                            </StatusBadge>
                                            <span className="min-w-0 truncate font-semibold text-gray-900">{campaign.name}</span>
                                            <span className="ml-auto shrink-0 text-[10px] text-gray-500">
                                                {campaign.status === 'COMPLETED'
                                                    ? formatMessage(crm.campaignDelivered, {
                                                        delivered: campaign.delivered_count,
                                                        total: campaign.recipient_count,
                                                    })
                                                    : formatMessage(crm.campaignRecipients, { count: campaign.recipient_count })}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </section>
            </div>
    );

    return variant === 'page' ? <PageShell maxWidth="full">{body}</PageShell> : body;
}
