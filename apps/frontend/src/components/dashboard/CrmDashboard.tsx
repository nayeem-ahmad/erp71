'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { useModuleDashboard } from '@/lib/use-module-dashboard';
import {
    activityHeatmapWindow,
    todayInTenantZone,
    HEATMAP_WEEKS_AHEAD,
    HEATMAP_WEEKS_BACK,
} from '@/lib/dashboard-range';
import { routes } from '@/lib/routes';
import ModuleDashboard, {
    AttentionSection,
    DashboardSection,
    KpiTileGrid,
    type DashboardMount,
    type KpiTileSpec,
} from '@/components/dashboard/ModuleDashboard';
import { type AttentionItem } from '@/components/dashboard/AttentionStrip';
import { PipelineFunnel, type FunnelStage } from '@/components/dashboard/PipelineFunnel';
import { RankedListPanel, type RankedItem } from '@/components/dashboard/RankedListPanel';
import { ActivityHeatmap, type ActivityHeatmapPoint } from '@/components/dashboard/ActivityHeatmap';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui';
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

type HeatmapResponse = {
    filters: { from: string; to: string };
    points: ActivityHeatmapPoint[];
    max: { done: number; planned: number };
    totals: { done: number; planned: number };
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
}: Readonly<DashboardIdentity & { variant?: DashboardMount }>) {
    const { t, locale } = useI18n();
    const copy = t.dashboardHome;
    const crm = copy.crm;
    const leadStatusLabels = t.crm.leads.statuses as Record<string, string>;

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
        fetchOverview: (window) => api.getCrmDashboardOverview(window),
        fetchTrends: (window) => api.getCrmDashboardTrends(window),
        unavailableMessage: crm.overviewUnavailable,
    });

    /**
     * The heatmap runs on its own window and so on its own request: it reaches
     * back further than "this month" and forward past today, and neither end
     * moves when the range tabs do. A failure here costs the calendar and
     * nothing else — same rule `useModuleDashboard` applies to the trends.
     */
    const [heatmap, setHeatmap] = useState<HeatmapResponse | null>(null);
    const [heatmapLoading, setHeatmapLoading] = useState(true);
    const today = useMemo(() => todayInTenantZone(), []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const result = await api.getCrmDashboardActivityHeatmap(activityHeatmapWindow());
                if (!cancelled) setHeatmap(result);
            } catch {
                if (!cancelled) setHeatmap(null);
            } finally {
                if (!cancelled) setHeatmapLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const pipeline = overview?.pipeline;
    const followUps = overview?.follow_ups;
    const activity = overview?.activity;
    const campaigns = overview?.campaigns;

    // Four small objects — not memoised, because the `compare` closure would have
    // to be hoisted or suppressed to satisfy the dependency rule, and neither is
    // worth it for work this cheap.
    const kpiTiles: KpiTileSpec[] = [
        {
            key: 'new-leads',
            title: crm.kpiNewLeads,
            value: String(pipeline?.created_in_period ?? 0),
            points: trends.map((point) => point.leads_created),
            delta: compare(pipeline?.created_in_period, prev?.pipeline.created_in_period),
        },
        {
            key: 'conversion',
            title: crm.kpiConversionRate,
            value: pipeline?.conversion_rate_pct == null ? '—' : `${pipeline.conversion_rate_pct}%`,
            points: trends.map((point) => point.leads_converted),
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
            points: trends.map((point) => point.conversations),
            delta: compare(activity?.logged_in_period, prev?.activity.logged_in_period),
            note: formatMessage(crm.helperLeadsTouched, { count: activity?.leads_touched ?? 0 }),
        },
        {
            key: 'campaign-revenue',
            title: crm.kpiCampaignRevenue,
            value: formatBDT(campaigns?.attributed_revenue ?? 0, { locale }),
            points: [] as number[],
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
                // Both halves of what was counted: open leads, untouched for the
                // window the label just named. "View all" landing on the whole
                // lead list would show a number the tile never claimed.
                href: `${routes.crm.leads}?status=open&staleDays=${pipeline.stale_after_days}`,
                cta: crm.viewAll,
            });
        }
        if (pipeline && pipeline.unassigned > 0) {
            items.push({
                id: 'unassigned',
                tone: 'blue',
                value: String(pipeline.unassigned),
                label: formatMessage(crm.attnUnassignedLeads, { count: pipeline.unassigned }),
                // `unassigned` is the owner-filter sentinel the leads list already
                // understands; `status=open` matches the count, which ignores
                // leads that were converted or lost while nobody owned them.
                href: `${routes.crm.leads}?status=open&assignedTo=unassigned`,
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

    return (
        <ModuleDashboard
            mount={variant}
            greeting={greeting}
            tenantName={tenantName}
            subtitle={crm.subtitle}
            range={range}
            onRangeChange={setRange}
            error={error}
        >
            <AttentionSection
                items={attentionItems}
                loading={loading}
                label={copy.sectionAttention}
                allClearLabel={crm.attnAllClear}
            />

            <DashboardSection label={crm.sectionHealth}>
                <KpiTileGrid tiles={kpiTiles} loading={loading} deltaContext={deltaContext} />
            </DashboardSection>

            <DashboardSection label={crm.sectionPipeline}>
                {/* Three panels on one row. `minmax(0, …)` on every track because
                    the calendar's grid is `w-max` and would otherwise widen its
                    column past the row instead of scrolling inside it. */}
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)_minmax(0,3fr)]">
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
                    <ActivityHeatmap
                        points={heatmap?.points ?? []}
                        max={heatmap?.max ?? { done: 0, planned: 0 }}
                        today={today}
                        loading={heatmapLoading}
                        locale={locale}
                        labels={{
                            title: crm.heatmapTitle,
                            subtitle: formatMessage(crm.heatmapSubtitle, {
                                back: HEATMAP_WEEKS_BACK,
                                ahead: HEATMAP_WEEKS_AHEAD,
                            }),
                            done: crm.heatmapDone,
                            planned: crm.heatmapPlanned,
                            less: crm.heatmapLess,
                            more: crm.heatmapMore,
                            empty: crm.heatmapEmpty,
                            today: crm.heatmapToday,
                            dayCounts: crm.heatmapDayCounts,
                            summary: formatMessage(crm.heatmapSummary, {
                                done: heatmap?.totals.done ?? 0,
                                planned: heatmap?.totals.planned ?? 0,
                                days: heatmap?.points.length ?? 0,
                            }),
                            tableCaption: crm.heatmapTableCaption,
                            tableDate: crm.heatmapTableDate,
                        }}
                    />
                </div>
            </DashboardSection>

            <DashboardSection label={crm.sectionTeam}>
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
                                        <span className="ms-auto shrink-0 text-[10px] text-gray-500">
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
            </DashboardSection>
        </ModuleDashboard>
    );
}
