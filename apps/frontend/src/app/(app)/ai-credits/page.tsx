'use client';

import { useEffect, useState } from 'react';
import { Sparkles, Loader2, AlertTriangle, CheckCircle2, BarChart2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell } from '@/components/ui';

type AiUsageLogEntry = {
    id: string;
    feature: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    credits_used: number;
    cost_usd: number;
    created_at: string;
};

type AiUsageSummary = {
    plan: string;
    credits_limit: number;
    credits_used: number;
    credits_remaining: number;
    period_start: string;
    period_end: string;
    logs: AiUsageLogEntry[];
};

const FEATURE_LABELS: Record<string, string> = {
    report_narration: 'Report Narration',
    message_drafter: 'Message Drafter',
    data_chat: 'AI Assistant',
};

/**
 * Credits spent per feature this period. The assistant bills one row per model
 * round-trip, so a single question can appear several times in the raw log —
 * this rollup is what makes a heavy chat user visible at a glance.
 */
function featureBreakdown(logs: AiUsageLogEntry[]): Array<{ feature: string; credits: number; requests: number }> {
    const byFeature = new Map<string, { feature: string; credits: number; requests: number }>();
    for (const log of logs) {
        const row = byFeature.get(log.feature) ?? { feature: log.feature, credits: 0, requests: 0 };
        row.credits += log.credits_used;
        row.requests += 1;
        byFeature.set(log.feature, row);
    }
    return Array.from(byFeature.values()).sort((a, b) => b.credits - a.credits);
}

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function UsageBar({ used, limit }: { used: number; limit: number }) {
    const pct = limit === 0 ? 100 : Math.min(100, (used / limit) * 100);
    const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-green-500';
    return (
        <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div className={`${color} h-3 rounded-full transition-all`} style={{ width: `${pct}%` }} />
        </div>
    );
}

export default function AiCreditsPage() {
    const { t } = useI18n();
    const [summary, setSummary] = useState<AiUsageSummary | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        setIsLoading(true);
        api.getAiUsage()
            .then((data: AiUsageSummary) => setSummary(data))
            .catch((err: Error) => setError(err.message || 'Failed to load AI usage.'))
            .finally(() => setIsLoading(false));
    }, []);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="animate-spin text-gray-400" size={32} />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-6 flex items-center gap-3 text-red-600 bg-red-50 rounded-lg">
                <AlertTriangle size={20} />
                <span>{error}</span>
            </div>
        );
    }

    if (!summary) return null;

    const isFreePlan = summary.credits_limit === 0;
    const isNearLimit = !isFreePlan && summary.credits_remaining < summary.credits_limit * 0.1;
    const periodLabel = `${new Date(summary.period_start).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} – ${new Date(summary.period_end).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;

    return (
        <PageShell>
            <PageHeader
                title="AI Credits"
                subtitle="Track your monthly AI usage and credit balance"
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    'AI Credits',
                    'AI Credits',
                    'aiCredits',
                )}
            />

            {/* Summary card */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Plan</span>
                        <p className="text-lg font-bold text-gray-900 mt-0.5">{summary.plan}</p>
                    </div>
                    <div className="text-right">
                        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Billing period</span>
                        <p className="text-sm text-gray-700 mt-0.5">{periodLabel}</p>
                    </div>
                </div>

                {isFreePlan ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
                        <AlertTriangle className="text-amber-500 shrink-0" size={20} />
                        <div>
                            <p className="font-semibold text-amber-800">AI features require a paid plan</p>
                            <p className="text-sm text-amber-700 mt-1">
                                Upgrade to BASIC (100 credits/month) or STANDARD (500) to use AI-powered report narration and message drafting. Premium (2,000 credits/month) is coming soon.
                            </p>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-3 gap-4 text-center">
                            <div className="bg-gray-50 rounded-lg p-3">
                                <p className="text-2xl font-bold text-gray-900">{summary.credits_limit}</p>
                                <p className="text-xs text-gray-500 mt-1">Monthly limit</p>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-3">
                                <p className="text-2xl font-bold text-blue-600">{Math.round(summary.credits_used * 10) / 10}</p>
                                <p className="text-xs text-gray-500 mt-1">Used</p>
                            </div>
                            <div className={`rounded-lg p-3 ${isNearLimit ? 'bg-red-50' : 'bg-green-50'}`}>
                                <p className={`text-2xl font-bold ${isNearLimit ? 'text-red-600' : 'text-green-600'}`}>
                                    {Math.round(summary.credits_remaining * 10) / 10}
                                </p>
                                <p className="text-xs text-gray-500 mt-1">Remaining</p>
                            </div>
                        </div>

                        <UsageBar used={summary.credits_used} limit={summary.credits_limit} />

                        {isNearLimit && (
                            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                                <AlertTriangle size={16} />
                                <span>You&apos;re almost out of AI credits. Consider upgrading your plan.</span>
                            </div>
                        )}

                        <p className="text-xs text-gray-400">
                            1 credit = 1,000 tokens. Credits reset at the start of each billing period.
                        </p>
                    </>
                )}
            </div>

            {/* Usage log */}
            {summary.logs.length > 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
                        <BarChart2 size={18} className="text-gray-500" />
                        <h2 className="font-semibold text-gray-900">Credits by feature</h2>
                    </div>
                    <div className="divide-y divide-gray-100">
                        {featureBreakdown(summary.logs).map((row) => (
                            <div key={row.feature} className="flex items-center justify-between px-6 py-3 text-sm">
                                <span className="font-medium text-gray-800">
                                    {FEATURE_LABELS[row.feature] ?? row.feature}
                                </span>
                                <span className="text-gray-500 text-xs">
                                    {row.requests} request{row.requests === 1 ? '' : 's'}
                                </span>
                                <span className="font-semibold text-gray-900">
                                    {Math.round(row.credits * 100) / 100} credits
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
                    <BarChart2 size={18} className="text-gray-500" />
                    <h2 className="font-semibold text-gray-900">Recent AI requests</h2>
                    <span className="ml-auto text-xs text-gray-400">(last 100)</span>
                </div>

                {summary.logs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
                        <CheckCircle2 size={40} className="text-gray-300" />
                        <p className="text-sm">No AI requests yet this period.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                    <th className="text-left px-6 py-3">Feature</th>
                                    <th className="text-left px-4 py-3">Model</th>
                                    <th className="text-right px-4 py-3">Tokens in</th>
                                    <th className="text-right px-4 py-3">Tokens out</th>
                                    <th className="text-right px-4 py-3">Credits</th>
                                    <th className="text-left px-4 py-3">Date</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {summary.logs.map((log) => (
                                    <tr key={log.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-3 font-medium text-gray-800">
                                            {FEATURE_LABELS[log.feature] ?? log.feature}
                                        </td>
                                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">{log.model}</td>
                                        <td className="px-4 py-3 text-right text-gray-700">{log.input_tokens.toLocaleString()}</td>
                                        <td className="px-4 py-3 text-right text-gray-700">{log.output_tokens.toLocaleString()}</td>
                                        <td className="px-4 py-3 text-right font-semibold text-purple-700">
                                            {Math.round(log.credits_used * 100) / 100}
                                        </td>
                                        <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(log.created_at)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </PageShell>
    );
}
