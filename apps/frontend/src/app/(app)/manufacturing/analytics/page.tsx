'use client';

import { useState, useEffect } from 'react';
import { CheckCircle2, Package, Wallet, Calculator } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { formatDate, formatBDT } from '@/lib/format';
import PageHeader from '@/components/ui/compact/PageHeader';
import { FinancialKpiTile } from '@/components/dashboard/KpiTile';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Alert } from '@/components/ui';
import type { AnalyticsSummary } from '../manufacturing-shared';

// ------------------------------------------------------------------ //
//  Manufacturing Analytics                                            //
// ------------------------------------------------------------------ //

export default function ManufacturingAnalyticsPage() {
    const { t } = useI18n();

    return (
        <PageShell>
            <PageHeader
                title={t.manufacturing.tabs.analytics}
                subtitle={t.manufacturing.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.manufacturing,
                    t.manufacturing.tabs.analytics,
                    'manufacturing',
                )}
            />
            <AnalyticsReport />
        </PageShell>
    );
}

/**
 * Split out from the page so the header and breadcrumbs stay on screen through
 * the loading, error and empty states this returns early for.
 */
function AnalyticsReport() {
    const { t } = useI18n();
    const [data, setData] = useState<AnalyticsSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        (async () => {
            setLoading(true);
            setError('');
            try {
                const result: AnalyticsSummary = await fetchWithAuth('/manufacturing/analytics');
                setData(result);
            } catch {
                setError(t.manufacturing.analytics.loadFailed);
            } finally {
                setLoading(false);
            }
        })();
    }, [t.manufacturing.analytics.loadFailed]);

    if (loading) {
        return <div className="text-center py-12 text-gray-500">{t.common.loading}</div>;
    }

    if (error) {
        return <Alert tone="danger">{error}</Alert>;
    }

    if (!data || data.totalCompletedJobs === 0) {
        return (
            <div className="text-center py-12 text-gray-400">
                <Calculator className="h-12 w-12 mx-auto mb-3 opacity-40" />
                <p>{t.manufacturing.analytics.empty}</p>
            </div>
        );
    }

    const maxVolume = Math.max(...data.volumeTrend.map((p) => p.quantityProduced), 1);

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <FinancialKpiTile
                    title={t.manufacturing.analytics.completedJobs}
                    value={String(data.totalCompletedJobs)}
                    tone="neutral"
                    Icon={CheckCircle2}
                />
                <FinancialKpiTile
                    title={t.manufacturing.analytics.unitsProduced}
                    value={String(data.totalUnitsProduced)}
                    tone="neutral"
                    Icon={Package}
                />
                <FinancialKpiTile
                    title={t.manufacturing.analytics.totalMaterialCost}
                    value={formatBDT(data.totalMaterialCost)}
                    tone="neutral"
                    Icon={Wallet}
                />
                <FinancialKpiTile
                    title={t.manufacturing.analytics.avgUnitCost}
                    value={formatBDT(data.avgUnitProductionCost)}
                    tone="neutral"
                    Icon={Calculator}
                />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">
                    {t.manufacturing.analytics.volumeTrendTitle}
                </h3>
                <div className="space-y-2">
                    {data.volumeTrend.map((point) => (
                        <div key={point.date} className="flex items-center gap-3">
                            <span className="w-24 shrink-0 text-xs text-gray-500">{formatDate(point.date)}</span>
                            <div className="flex-1 bg-blue-50 rounded h-4 overflow-hidden">
                                <div
                                    className="bg-blue-600 h-full rounded"
                                    style={{ width: `${Math.max(4, (point.quantityProduced / maxVolume) * 100)}%` }}
                                />
                            </div>
                            <span className="w-12 shrink-0 text-xs text-gray-700 text-end">{point.quantityProduced}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <div className="p-4 border-b border-gray-100">
                    <h3 className="text-sm font-semibold text-gray-900">{t.manufacturing.analytics.costTableTitle}</h3>
                </div>
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                        <tr>
                            <th className="px-4 py-3 text-start">{t.manufacturing.analytics.columns.product}</th>
                            <th className="px-4 py-3 text-start">{t.manufacturing.analytics.columns.completed}</th>
                            <th className="px-4 py-3 text-end">{t.manufacturing.analytics.columns.qtyProduced}</th>
                            <th className="px-4 py-3 text-end">{t.manufacturing.analytics.columns.plannedCost}</th>
                            <th className="px-4 py-3 text-end">{t.manufacturing.analytics.columns.wastageCost}</th>
                            <th className="px-4 py-3 text-end">{t.manufacturing.analytics.columns.actualCost}</th>
                            <th className="px-4 py-3 text-end">{t.manufacturing.analytics.columns.unitCost}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {data.jobs.map((job) => (
                            <tr key={job.jobId} className="hover:bg-gray-50">
                                <td className="px-4 py-3">
                                    <div className="font-medium text-gray-900">{job.productName}</div>
                                    {job.productSku && <div className="text-xs text-gray-500">{job.productSku}</div>}
                                </td>
                                <td className="px-4 py-3 text-gray-500">{formatDate(job.completedAt)}</td>
                                <td className="px-4 py-3 text-end text-gray-700">{job.quantityProduced}</td>
                                <td className="px-4 py-3 text-end text-gray-700">{formatBDT(job.plannedMaterialCost)}</td>
                                <td className={`px-4 py-3 text-end ${job.wastageCost > 0 ? 'text-amber-700 font-medium' : 'text-gray-700'}`}>
                                    {formatBDT(job.wastageCost)}
                                </td>
                                <td className="px-4 py-3 text-end text-gray-700">{formatBDT(job.actualMaterialCost)}</td>
                                <td className="px-4 py-3 text-end text-gray-900 font-medium">{formatBDT(job.unitProductionCost)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
