'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Users } from 'lucide-react';
import DataTable from '@/components/data-table/DataTable';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell } from '@/components/ui';
import { CoverageNotice, MarginCell, ProfitCell, StatTile, type Coverage } from '@/components/gross-profit';

interface Row {
    id: string | null;
    name: string;
    orders: number;
    units: number;
    revenue: number;
    cogs: number;
    grossProfit: number | null;
    grossMarginPct: number | null;
    coverage: Coverage;
}

interface Summary {
    groupBy: string;
    netRevenue: number;
    cogs: number;
    grossProfit: number | null;
    grossMarginPct: number | null;
    coverage: Coverage;
}

const columnHelper = createColumnHelper<Row>();

function defaultFrom() {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
}

export default function GrossProfitBySalespersonPage() {
    const { t, locale } = useI18n();
    const gp = t.salesReports.grossProfit;
    const [rows, setRows] = useState<Row[]>([]);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
    const [groupBy, setGroupBy] = useState<'user' | 'counter'>('user');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void load();
    }, [fromDate, toDate, groupBy]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getGrossProfitBySalesperson({ from: fromDate, to: toDate, groupBy });
            setSummary(data.summary);
            setRows(data.rows);
        } catch (error) {
            console.error('Failed to load gross profit by salesperson', error);
        } finally {
            setLoading(false);
        }
    };

    const columns: ColumnDef<Row, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: groupBy === 'counter' ? gp.counter : gp.salesperson,
                size: 200,
            }),
            columnHelper.accessor('orders', { header: gp.orders, size: 90 }),
            columnHelper.accessor('units', { header: gp.units, size: 90, meta: { hideOnMobile: true } }),
            columnHelper.accessor('revenue', {
                header: gp.revenue,
                cell: (info) => formatBDT(Number(info.getValue()), { locale }),
                size: 130,
            }),
            columnHelper.accessor('cogs', {
                header: gp.cogs,
                cell: (info) => formatBDT(Number(info.getValue()), { locale }),
                size: 130,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('grossProfit', {
                header: gp.grossProfit,
                cell: (info) => <ProfitCell value={info.getValue()} locale={locale} dash={t.shared.dash} />,
                size: 130,
            }),
            columnHelper.accessor('grossMarginPct', {
                header: gp.margin,
                cell: (info) => <MarginCell value={info.getValue()} dash={t.shared.dash} />,
                size: 100,
            }),
        ],
        [t, locale, gp, groupBy],
    );

    return (
        <PageShell>
            <PageHeader
                title={gp.bySalespersonTitle}
                subtitle={gp.bySalespersonSubtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    gp.bySalespersonTitle,
                    'sales',
                )}
            />

            <div className="grid md:grid-cols-4 gap-4">
                <StatTile label={gp.revenue} tone="primary">
                    {formatBDT(summary?.netRevenue ?? 0, { locale })}
                </StatTile>
                <StatTile label={gp.cogs}>{formatBDT(summary?.cogs ?? 0, { locale })}</StatTile>
                <StatTile label={gp.grossProfit}>
                    <ProfitCell value={summary?.grossProfit} locale={locale} dash={t.shared.dash} />
                </StatTile>
                <StatTile label={gp.margin}>
                    <MarginCell value={summary?.grossMarginPct} dash={t.shared.dash} />
                </StatTile>
            </div>

            <CoverageNotice
                coverage={summary?.coverage}
                locale={locale}
                labels={{
                    full: gp.coverageFull,
                    partial: gp.coveragePartial,
                    none: gp.coverageNone,
                    fixLink: gp.coverageFix,
                }}
            />

            <div className="bg-white border border-gray-100 rounded-lg p-4 flex flex-wrap gap-3 items-end">
                <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-h-touch"
                />
                <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-h-touch"
                />
                <select
                    value={groupBy}
                    onChange={(e) => setGroupBy(e.target.value as 'user' | 'counter')}
                    className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-h-touch"
                >
                    <option value="user">{gp.groupByUser}</option>
                    <option value="counter">{gp.groupByCounter}</option>
                </select>
            </div>

            <DataTable<Row>
                tableId="gross-profit-by-salesperson"
                columns={columns}
                data={rows}
                title={gp.bySalespersonTitle}
                isLoading={loading}
                emptyMessage={gp.empty}
                emptyIcon={<Users className="w-16 h-16 text-gray-200" />}
            />
        </PageShell>
    );
}
