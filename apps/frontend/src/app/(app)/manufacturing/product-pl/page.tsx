'use client';

import { useState, useEffect } from 'react';
import { Package, Wallet, Calculator } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import PageHeader from '@/components/ui/compact/PageHeader';
import { FinancialKpiTile } from '@/components/dashboard/KpiTile';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Alert } from '@/components/ui';
import type { ProductPLReport as ProductPLReportData } from '../manufacturing-shared';

// ------------------------------------------------------------------ //
//  Per-Product P&L                                                    //
// ------------------------------------------------------------------ //

export default function ManufacturingProductPLPage() {
    const { t } = useI18n();

    return (
        <PageShell>
            <PageHeader
                title={t.manufacturing.tabs.productPL}
                subtitle={t.manufacturing.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.manufacturing,
                    t.manufacturing.tabs.productPL,
                    'manufacturing',
                )}
            />
            <ProductPLReport />
        </PageShell>
    );
}

/**
 * Split out from the page so the header and breadcrumbs stay on screen through
 * the loading, error and empty states this returns early for.
 */
function ProductPLReport() {
    const { t } = useI18n();
    const [data, setData] = useState<ProductPLReportData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        (async () => {
            setLoading(true);
            setError('');
            try {
                const result: ProductPLReportData = await fetchWithAuth('/manufacturing/reports/product-pl');
                setData(result);
            } catch {
                setError(t.manufacturing.productPL.loadFailed);
            } finally {
                setLoading(false);
            }
        })();
    }, [t.manufacturing.productPL.loadFailed]);

    if (loading) {
        return <div className="text-center py-12 text-gray-500">{t.common.loading}</div>;
    }

    if (error) {
        return <Alert tone="danger">{error}</Alert>;
    }

    if (!data || data.products.length === 0) {
        return (
            <div className="text-center py-12 text-gray-400">
                <Calculator className="h-12 w-12 mx-auto mb-3 opacity-40" />
                <p>{t.manufacturing.productPL.empty}</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <FinancialKpiTile
                    title={t.manufacturing.productPL.quantityProduced}
                    value={String(data.totals.quantityProduced)}
                    tone="neutral"
                    Icon={Package}
                />
                <FinancialKpiTile
                    title={t.manufacturing.productPL.totalProductionCost}
                    value={formatBDT(data.totals.totalProductionCost)}
                    tone="neutral"
                    Icon={Wallet}
                />
                <FinancialKpiTile
                    title={t.manufacturing.productPL.revenue}
                    value={formatBDT(data.totals.revenue)}
                    tone="neutral"
                    Icon={Calculator}
                />
                <FinancialKpiTile
                    title={t.manufacturing.productPL.grossProfit}
                    value={formatBDT(data.totals.grossProfit)}
                    tone={data.totals.grossProfit >= 0 ? 'positive' : 'negative'}
                    Icon={Calculator}
                />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                        <tr>
                            <th className="px-4 py-3 text-start">{t.manufacturing.productPL.columns.product}</th>
                            <th className="px-4 py-3 text-end">{t.manufacturing.productPL.columns.jobsCompleted}</th>
                            <th className="px-4 py-3 text-end">{t.manufacturing.productPL.columns.qtyProduced}</th>
                            <th className="px-4 py-3 text-end">{t.manufacturing.productPL.columns.unitsSold}</th>
                            <th className="px-4 py-3 text-end">{t.manufacturing.productPL.columns.avgCost}</th>
                            <th className="px-4 py-3 text-end">{t.manufacturing.productPL.columns.productionCost}</th>
                            <th className="px-4 py-3 text-end">{t.manufacturing.productPL.columns.revenue}</th>
                            <th className="px-4 py-3 text-end">{t.manufacturing.productPL.columns.grossProfit}</th>
                            <th className="px-4 py-3 text-end">{t.manufacturing.productPL.columns.margin}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {data.products.map((row) => (
                            <tr key={row.productId} className="hover:bg-gray-50">
                                <td className="px-4 py-3">
                                    <div className="font-medium text-gray-900">{row.productName}</div>
                                    {row.productSku && <div className="text-xs text-gray-500">{row.productSku}</div>}
                                </td>
                                <td className="px-4 py-3 text-end text-gray-700">{row.jobsCompleted}</td>
                                <td className="px-4 py-3 text-end text-gray-700">{row.quantityProduced}</td>
                                <td className="px-4 py-3 text-end text-gray-700">{row.unitsSold}</td>
                                <td className="px-4 py-3 text-end text-gray-700">{formatBDT(row.avgCostPerUnit)}</td>
                                <td className="px-4 py-3 text-end text-gray-700">{formatBDT(row.totalProductionCost)}</td>
                                <td className="px-4 py-3 text-end text-gray-700">{formatBDT(row.revenue)}</td>
                                <td className={`px-4 py-3 text-end font-medium ${row.grossProfit >= 0 ? 'text-emerald-700' : 'text-danger'}`}>
                                    {formatBDT(row.grossProfit)}
                                </td>
                                <td className={`px-4 py-3 text-end font-medium ${row.grossMarginPct >= 0 ? 'text-emerald-700' : 'text-danger'}`}>
                                    {row.grossMarginPct.toFixed(1)}%
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
