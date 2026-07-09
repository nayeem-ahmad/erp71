'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { UserPlus, Users, Megaphone, ListChecks, AlertTriangle } from 'lucide-react';
import ModuleHub, { type HubSectionConfig } from '@/components/ModuleHub';
import { FinancialKpiTile } from '@/components/dashboard/KpiTile';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { api } from '@/lib/api';

const statusColors: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-600',
    SCHEDULED: 'bg-blue-50 text-blue-700',
    SENDING: 'bg-amber-50 text-amber-700',
    COMPLETED: 'bg-emerald-50 text-emerald-700',
    CANCELLED: 'bg-rose-50 text-rose-700',
};

interface LeadsSummary {
    counts: Record<string, number>;
    open: number;
}

interface TaskSummary {
    dueToday: number;
    overdue: number;
    total: number;
}

interface CampaignSummary {
    id: string;
    name: string;
    status: string;
    channel: string;
    delivered_count: number;
    failed_count: number;
    recipient_count: number;
}

export default function CrmHubPage() {
    const { t } = useI18n();
    const hub = t.crm.hub;
    const leadStatusLabels = t.crm.leads.statuses as Record<string, string>;
    const [canAccessPremiumCrm, setCanAccessPremiumCrm] = useState(false);
    const [leadsSummary, setLeadsSummary] = useState<LeadsSummary | null>(null);
    const [taskSummary, setTaskSummary] = useState<TaskSummary | null>(null);
    const [recentCampaigns, setRecentCampaigns] = useState<CampaignSummary[]>([]);

    useEffect(() => {
        api.getMe().then((me) => {
            const tenant = me?.tenants?.find((entry: { id: string }) => entry.id === localStorage.getItem('tenant_id')) ?? me?.tenants?.[0];
            const planCode = tenant?.subscription?.plan?.code;
            const features = (tenant?.subscription?.plan?.features_json ?? {}) as Record<string, unknown>;
            setCanAccessPremiumCrm(planCode === 'PREMIUM' || Boolean(features.premiumCrm));
        }).catch(() => null);
    }, []);

    useEffect(() => {
        if (!canAccessPremiumCrm) return;
        api.getLeadsSummary().then(setLeadsSummary).catch(() => null);
    }, [canAccessPremiumCrm]);

    useEffect(() => {
        api.getCrmTaskSummary().then(setTaskSummary).catch(() => null);
        api.getCrmCampaigns({ limit: 3 }).then((data) => setRecentCampaigns(data?.items ?? data ?? [])).catch(() => null);
    }, []);

    const sections: HubSectionConfig[] = useMemo(() => {
        const pipelineLinks = canAccessPremiumCrm
            ? [
                { href: routes.crm.leads, key: 'leads', icon: UserPlus, accent: 'bg-violet-50 text-violet-700 border-violet-100' },
                { href: routes.crm.tasks, key: 'crmTasks', icon: ListChecks, accent: 'bg-amber-50 text-amber-700 border-amber-100' },
            ]
            : [];
        const result: HubSectionConfig[] = [];
        if (pipelineLinks.length > 0) {
            result.push({ sectionKey: 'pipeline', links: pipelineLinks });
        }
        result.push({
            sectionKey: 'relationships',
            links: [
                { href: routes.crm.customers, key: 'customers', icon: Users, accent: 'bg-blue-50 text-blue-700 border-blue-100' },
            ],
        });
        if (canAccessPremiumCrm) {
            result.push({
                sectionKey: 'engagement',
                links: [
                    { href: routes.crm.campaigns, key: 'crmCampaigns', icon: Megaphone, accent: 'bg-rose-50 text-rose-700 border-rose-100' },
                ],
            });
        }
        return result;
    }, [canAccessPremiumCrm]);

    const sectionLabels = useMemo(() => ({
        pipeline: hub.pipeline,
        relationships: hub.relationships,
        engagement: hub.engagement,
    }), [hub]);

    const stageBreakdown = leadsSummary
        ? ['NEW', 'CONTACTED', 'QUALIFIED']
            .map((s) => `${leadStatusLabels[s] ?? s}: ${leadsSummary.counts[s] ?? 0}`)
            .join(' · ')
        : '';

    const hasDashboardData = canAccessPremiumCrm || taskSummary || recentCampaigns.length > 0;

    return (
        <ModuleHub
            module="crm"
            moduleLabel={hub.moduleLabel}
            title={hub.title}
            subtitle={hub.subtitle}
            sections={sections}
            sectionLabels={sectionLabels}
            linkCopy={hub.links}
            openSectionLabel={t.accountingShared.openSection}
            viewReportLabel={t.accountingShared.viewReport}
        >
            {hasDashboardData && (
                <div className="mb-6 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {canAccessPremiumCrm && leadsSummary && (
                            <FinancialKpiTile
                                title={hub.dashboard.openLeads}
                                value={String(leadsSummary.open)}
                                helper={stageBreakdown}
                                tone="neutral"
                                Icon={UserPlus}
                            />
                        )}
                        {taskSummary && (
                            <>
                                <FinancialKpiTile
                                    title={hub.dashboard.tasksDueToday}
                                    value={String(taskSummary.dueToday)}
                                    helper={`${taskSummary.total} ${hub.dashboard.pendingTotal}`}
                                    tone={taskSummary.dueToday > 0 ? 'negative' : 'positive'}
                                    Icon={ListChecks}
                                />
                                <FinancialKpiTile
                                    title={hub.dashboard.overdueTasks}
                                    value={String(taskSummary.overdue)}
                                    helper=""
                                    tone={taskSummary.overdue > 0 ? 'negative' : 'positive'}
                                    Icon={AlertTriangle}
                                />
                            </>
                        )}
                    </div>

                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                            <h2 className="text-sm font-bold text-gray-800">{hub.dashboard.recentCampaigns}</h2>
                            <Link href={routes.crm.campaigns} className="text-xs font-semibold text-violet-600 hover:underline">
                                {hub.dashboard.viewAll}
                            </Link>
                        </div>
                        {recentCampaigns.length === 0 ? (
                            <p className="px-5 py-4 text-sm text-gray-400">{hub.dashboard.noCampaigns}</p>
                        ) : (
                            <div className="divide-y divide-gray-50">
                                {recentCampaigns.map((c) => (
                                    <div key={c.id} className="px-5 py-3 flex items-center justify-between gap-3">
                                        <div className="min-w-0 flex items-center gap-2">
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${statusColors[c.status] ?? 'bg-gray-100 text-gray-600'}`}>
                                                {c.status}
                                            </span>
                                            <span className="text-sm font-medium text-gray-800 truncate">{c.name}</span>
                                        </div>
                                        <div className="text-xs text-gray-500 shrink-0">
                                            {c.status === 'COMPLETED'
                                                ? `${c.delivered_count} / ${c.recipient_count} delivered`
                                                : `${c.recipient_count} recipients`}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </ModuleHub>
    );
}
