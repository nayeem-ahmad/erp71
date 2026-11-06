'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Calculator, Package, ShoppingCart, Store, TrendingUp } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { Alert, PageHeader, PageShell } from '@/components/ui';
import { createdRangeFromPreset, type CreatedRange, type CreatedRangePreset } from '@/lib/created-range';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import type { NumberCondition } from '@/lib/number-condition';

interface StoreRow {
    store_id: string;
    store_name: string;
    revenue: number;
    transactions: number;
    avg_order: number;
    revenue_share: number;
}

interface Overall {
    revenue: number;
    transactions: number;
    avg_order: number;
    top_product: string | null;
}

interface ConsolidatedReport {
    period: { from: string | null; to: string | null };
    overall: Overall;
    by_store: StoreRow[];
}

const PERIOD_PRESETS: readonly CreatedRangePreset[] = [
    'today', 'yesterday', 'last7', 'last30', 'thisMonth', 'last3Months', 'last6Months', 'thisYear',
];
// Cleared, the period goes back to the last 30 days.
const defaultPeriod = () => createdRangeFromPreset('last30');

/**
 * Sales › Reports › Consolidated: every branch side by side over a period.
 * The period goes to the server; the branch and revenue chips narrow the
 * branches already loaded, and the strip and the total row add up what is
 * left. The top product is the company's, whichever branches are shown.
 */
export default function ConsolidatedReportPage() {
    const { t, locale } = useI18n();
    const m = t.reports.consolidated;
    const [period, setPeriod] = useState<CreatedRange>(defaultPeriod);
    const [branches, setBranches] = useState<string[]>([]);
    const [branchesExclude, setBranchesExclude] = useState(false);
    const [revenueFilter, setRevenueFilter] = useState<NumberCondition | null>(null);
    const [search, setSearch] = useState('');
    const [report, setReport] = useState<ConsolidatedReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.getConsolidatedReport({ from: period.from, to: period.to });
            setReport(data as ConsolidatedReport);
        } catch (err: any) {
            setError(err?.message ?? m.loadFailed);
            setReport(null);
        } finally {
            setLoading(false);
        }
    }, [period, m.loadFailed]);

    useEffect(() => {
        void load();
    }, [load]);

    const rows = useMemo(
        () => (report?.by_store ?? []).filter((row) => (
            matchesAnyOf(branches, row.store_id, branchesExclude)
            && matchesNumberCondition(row.revenue, revenueFilter)
            && matchesSearch(search, row.store_name)
        )),
        [report, branches, branchesExclude, revenueFilter, search],
    );

    const totals = useMemo(() => {
        const revenue = rows.reduce((total, row) => total + row.revenue, 0);
        const transactions = rows.reduce((total, row) => total + row.transactions, 0);
        const share = rows.reduce((total, row) => total + row.revenue_share, 0);
        return { revenue, transactions, share, average: transactions > 0 ? revenue / transactions : 0 };
    }, [rows]);

    const columns = useMemo(() => {
        const money = (value: number) => <span className="tabular-nums">{formatBDT(value, { locale })}</span>;
        return [
            {
                id: 'store_name',
                header: m.columns.storeName,
                accessorKey: 'store_name',
                footer: () => t.common.total,
            },
            {
                id: 'revenue',
                header: m.columns.revenue,
                accessorKey: 'revenue',
                meta: { align: 'end' },
                cell: ({ row }: { row: { original: StoreRow } }) => money(row.original.revenue),
                footer: () => money(totals.revenue),
            },
            {
                id: 'transactions',
                header: m.columns.transactions,
                accessorKey: 'transactions',
                meta: { align: 'end', hideOnMobile: true },
                cell: ({ row }: { row: { original: StoreRow } }) => (
                    <span className="tabular-nums">{row.original.transactions.toLocaleString()}</span>
                ),
                footer: () => <span className="tabular-nums">{totals.transactions.toLocaleString()}</span>,
            },
            {
                id: 'avg_order',
                header: m.columns.avgOrder,
                accessorKey: 'avg_order',
                meta: { align: 'end', hideOnMobile: true },
                cell: ({ row }: { row: { original: StoreRow } }) => money(row.original.avg_order),
                footer: () => money(totals.average),
            },
            {
                id: 'revenue_share',
                header: m.columns.revenueShare,
                accessorKey: 'revenue_share',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: StoreRow } }) => (
                    <div className="flex items-center gap-2">
                        <div className="h-1.5 min-w-[48px] flex-1 rounded-full bg-gray-100">
                            <div
                                className="h-1.5 rounded-full bg-blue-600"
                                style={{ width: `${Math.min(row.original.revenue_share, 100)}%` }}
                            />
                        </div>
                        <span className="w-12 text-end tabular-nums text-gray-600">
                            {row.original.revenue_share.toFixed(1)}%
                        </span>
                    </div>
                ),
                footer: () => <span className="tabular-nums">{totals.share.toFixed(1)}%</span>,
            },
        ];
    }, [m, t, totals, locale]);

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'period',
            type: 'date-range',
            label: m.period,
            value: period,
            onChange: (next) => setPeriod(next ?? defaultPeriod()),
            presets: PERIOD_PRESETS,
            operators: true,
        },
        {
            id: 'branch',
            type: 'multi-select',
            label: t.common.branch,
            value: branches,
            onChange: setBranches,
            exclude: { value: branchesExclude, onChange: setBranchesExclude },
            options: (report?.by_store ?? []).map((row) => ({ value: row.store_id, label: row.store_name })),
        },
        {
            id: 'revenue',
            type: 'number',
            label: m.columns.revenue,
            value: revenueFilter,
            onChange: setRevenueFilter,
            money: true,
        },
    ], [m, t, period, branches, branchesExclude, report, revenueFilter]);

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale });
        const items: ListStat[] = [
            { id: 'revenue', icon: <TrendingUp aria-hidden />, label: m.summary.totalRevenue, value: money(totals.revenue) },
            {
                id: 'transactions',
                icon: <ShoppingCart aria-hidden />,
                label: m.summary.totalTransactions,
                value: totals.transactions.toLocaleString(),
            },
            { id: 'average', icon: <Calculator aria-hidden />, label: m.summary.avgOrderValue, value: money(totals.average) },
            { id: 'branches', icon: <Store aria-hidden />, label: m.branches, value: rows.length.toLocaleString() },
            {
                id: 'topProduct',
                icon: <Package aria-hidden />,
                label: m.summary.topProduct,
                value: report?.overall.top_product ?? m.summary.none,
            },
        ];
        return { items, loading: loading && !report, label: m.statsLabel };
    }, [totals, rows, report, loading, locale, m]);

    return (
        <PageShell>
            <PageHeader
                title={m.title}
                subtitle={m.description}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    m.title,
                    'sales',
                )}
            />

            {error ? <Alert tone="danger">{error}</Alert> : null}

            <DataTable
                title={m.storeBreakdown}
                tableId="sales-consolidated-report"
                columns={columns as never}
                data={rows}
                isLoading={loading}
                emptyMessage={m.empty.title}
                emptyIcon={<BarChart3 className="h-16 w-16 text-gray-200" />}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
            />
        </PageShell>
    );
}
