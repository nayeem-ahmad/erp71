'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { TrendingUp } from 'lucide-react';
import DataTable from '@/components/data-table/DataTable';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell } from '@/components/ui';
import { ProfitCell, StatTile } from '@/components/gross-profit';

interface Bridge {
    previousGrossProfit: number;
    currentGrossProfit: number;
    totalChange: number;
    volumeEffect: number;
    priceEffect: number;
    costEffect: number;
    mixEffect: number;
}

interface Row extends Bridge {
    productId: string;
    productName: string;
}

const columnHelper = createColumnHelper<Row>();

function isoDaysAgo(days: number) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
}

export default function MarginBridgePage() {
    const { t, locale } = useI18n();
    const gp = t.salesReports.grossProfit;
    const [rows, setRows] = useState<Row[]>([]);
    const [bridge, setBridge] = useState<Bridge | null>(null);
    const [from, setFrom] = useState(isoDaysAgo(29));
    const [to, setTo] = useState(isoDaysAgo(0));
    const [compareFrom, setCompareFrom] = useState(isoDaysAgo(59));
    const [compareTo, setCompareTo] = useState(isoDaysAgo(30));
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void load();
    }, [from, to, compareFrom, compareTo]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getMarginBridge({ from, to, compareFrom, compareTo });
            setBridge(data.summary.bridge);
            setRows(data.rows);
        } catch (error) {
            console.error('Failed to load margin bridge', error);
        } finally {
            setLoading(false);
        }
    };

    const columns: ColumnDef<Row, any>[] = useMemo(() => {
        const effect = (id: keyof Bridge, header: string, hideOnMobile = false) =>
            columnHelper.accessor((row) => row[id], {
                id,
                header,
                cell: (info) => <ProfitCell value={info.getValue() as number} locale={locale} dash={t.shared.dash} />,
                size: 120,
                ...(hideOnMobile ? { meta: { hideOnMobile: true } } : {}),
            });

        return [
            columnHelper.accessor('productName', { header: gp.product, size: 220 }),
            effect('totalChange', gp.totalChange),
            effect('volumeEffect', gp.volumeEffect),
            effect('priceEffect', gp.priceEffect),
            effect('costEffect', gp.costEffect),
            effect('mixEffect', gp.mixEffect, true),
        ];
    }, [t, locale, gp]);

    return (
        <PageShell>
            <PageHeader
                title={gp.bridgeTitle}
                subtitle={gp.bridgeSubtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    gp.bridgeTitle,
                    'sales',
                )}
            />

            <div className="grid md:grid-cols-3 gap-4">
                <StatTile label={gp.previousPeriod}>
                    {formatBDT(bridge?.previousGrossProfit ?? 0, { locale })}
                </StatTile>
                <StatTile label={gp.currentPeriod} tone="primary">
                    {formatBDT(bridge?.currentGrossProfit ?? 0, { locale })}
                </StatTile>
                <StatTile label={gp.totalChange} tone={(bridge?.totalChange ?? 0) < 0 ? 'danger' : 'default'}>
                    <ProfitCell value={bridge?.totalChange} locale={locale} dash={t.shared.dash} />
                </StatTile>
            </div>

            <div className="bg-white border border-gray-100 rounded-lg p-5 space-y-3">
                <h2 className="text-sm font-bold text-gray-700">{gp.whatMoved}</h2>
                <p className="text-xs text-gray-500">{gp.bridgeExplainer}</p>
                <div className="grid md:grid-cols-4 gap-3">
                    {(
                        [
                            ['volumeEffect', gp.volumeEffect, gp.volumeHelp],
                            ['priceEffect', gp.priceEffect, gp.priceHelp],
                            ['costEffect', gp.costEffect, gp.costHelp],
                            ['mixEffect', gp.mixEffect, gp.mixHelp],
                        ] as const
                    ).map(([key, label, help]) => {
                        const value = bridge?.[key] ?? 0;
                        return (
                            <div key={key} className="rounded-lg bg-gray-50 p-4">
                                <div className="text-xs font-medium text-gray-500">{label}</div>
                                <div
                                    className={`text-lg font-bold mt-1 ${value < 0 ? 'text-red-600' : 'text-emerald-600'}`}
                                >
                                    {formatBDT(value, { locale })}
                                </div>
                                <div className="text-xs text-gray-400 mt-1">{help}</div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="bg-white border border-gray-100 rounded-lg p-4 flex flex-wrap gap-3 items-end">
                <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">{gp.currentPeriod}</label>
                    <div className="flex gap-2">
                        <input
                            type="date"
                            value={from}
                            onChange={(e) => setFrom(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-h-touch"
                        />
                        <input
                            type="date"
                            value={to}
                            onChange={(e) => setTo(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-h-touch"
                        />
                    </div>
                </div>
                <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">{gp.comparedWith}</label>
                    <div className="flex gap-2">
                        <input
                            type="date"
                            value={compareFrom}
                            onChange={(e) => setCompareFrom(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-h-touch"
                        />
                        <input
                            type="date"
                            value={compareTo}
                            onChange={(e) => setCompareTo(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-h-touch"
                        />
                    </div>
                </div>
            </div>

            <DataTable<Row>
                tableId="margin-bridge"
                columns={columns}
                data={rows}
                title={gp.bridgeTitle}
                isLoading={loading}
                emptyMessage={gp.empty}
                emptyIcon={<TrendingUp className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={gp.searchProducts}
            />
        </PageShell>
    );
}
