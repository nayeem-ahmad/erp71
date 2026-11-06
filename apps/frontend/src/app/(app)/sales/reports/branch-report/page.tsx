'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Calculator, Package, PieChart, RotateCcw, ShoppingCart, TrendingUp, Wallet } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { Alert, BranchFilter, PageHeader, PageShell } from '@/components/ui';
import GroupByChip from '@/components/hr/GroupByChip';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import { createdRangeFromPreset, type CreatedRange, type CreatedRangePreset } from '@/lib/created-range';

interface BranchSummary {
    revenue: number;
    transactions: number;
    returns: number;
    net_revenue: number;
    avg_order: number;
}

interface CompanyComparison {
    company_revenue: number;
    company_transactions: number;
    revenue_share: number;
}

interface TopProduct {
    name: string;
    unitsSold: number;
    revenue: number;
}

interface DailyRow {
    date: string;
    transactions: number;
    gross_revenue: number;
    returns: number;
    net_revenue: number;
}

interface BranchReport {
    store: { id: string; name: string };
    period: { from: string | null; to: string | null };
    summary: BranchSummary;
    company_comparison: CompanyComparison;
    top_products: TopProduct[];
    daily: DailyRow[];
}

type GroupBy = 'day' | 'week' | 'month';

const GROUPS: GroupBy[] = ['day', 'week', 'month'];
const PERIOD_PRESETS: readonly CreatedRangePreset[] = [
    'today', 'yesterday', 'last7', 'last30', 'thisMonth', 'last3Months', 'last6Months', 'thisYear',
];
// Cleared, the period goes back to the last 30 days.
const defaultPeriod = () => createdRangeFromPreset('last30');

/**
 * The day a row rolls up into: itself, the Monday of its week (ISO, as every
 * other chart in the app buckets weeks), or the first of its month.
 */
function bucketOf(date: string, groupBy: GroupBy): string {
    if (groupBy === 'month') return `${date.slice(0, 7)}-01`;
    if (groupBy === 'day') return date;
    const [year, month, day] = date.split('-').map(Number);
    const at = Date.UTC(year, month - 1, day);
    const sinceMonday = (new Date(at).getUTCDay() + 6) % 7;
    return new Date(at - sinceMonday * 86_400_000).toISOString().slice(0, 10);
}

function rollUp(rows: DailyRow[], groupBy: GroupBy): DailyRow[] {
    if (groupBy === 'day') return rows;
    const buckets = new Map<string, DailyRow>();
    for (const row of rows) {
        const key = bucketOf(row.date, groupBy);
        const bucket = buckets.get(key) ?? { date: key, transactions: 0, gross_revenue: 0, returns: 0, net_revenue: 0 };
        bucket.transactions += row.transactions;
        bucket.gross_revenue += row.gross_revenue;
        bucket.returns += row.returns;
        bucket.net_revenue += row.net_revenue;
        buckets.set(key, bucket);
    }
    return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const sum = (rows: DailyRow[], pick: (row: DailyRow) => number) => rows.reduce((total, row) => total + pick(row), 0);

/**
 * Sales › Reports › Branch Report: one branch over a period, against the
 * company. The period and branch go to the server; the Group by chip rolls
 * the day rows up into weeks or months here, so the totals never move.
 */
export default function BranchReportPage() {
    const { t, locale } = useI18n();
    const m = t.reports.branch;
    // One branch at a time: this report compares a branch against the company,
    // so "All branches" has nothing to compare. It opens on the header branch.
    const branch = useBranchScope({ allowAll: false });
    const selectedStore = branch.apiStoreId ?? '';
    const [period, setPeriod] = useState<CreatedRange>(defaultPeriod);
    const [groupBy, setGroupBy] = useState<GroupBy>('day');
    const [report, setReport] = useState<BranchReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!selectedStore) return;
        setLoading(true);
        setError(null);
        try {
            const data = await api.getBranchReport({ storeId: selectedStore, from: period.from, to: period.to });
            setReport(data as BranchReport);
        } catch (err: any) {
            if (handleBranchForbidden(err, branch, t.dashboardLayout.branchFilterForbidden)) return;
            setError(err?.message ?? m.loadFailed);
            setReport(null);
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedStore, period, m.loadFailed]);

    useEffect(() => {
        void load();
    }, [load]);

    const rows = useMemo(() => rollUp(report?.daily ?? [], groupBy), [report, groupBy]);

    const columns = useMemo(() => {
        const money = (value: number) => <span className="tabular-nums">{formatBDT(value, { locale })}</span>;
        return [
            {
                id: 'date',
                header: m.groups[groupBy],
                accessorKey: 'date',
                cell: ({ row }: { row: { original: DailyRow } }) => (groupBy === 'month' ? row.original.date.slice(0, 7) : row.original.date),
                footer: () => t.common.total,
            },
            {
                id: 'transactions',
                header: m.dailyBreakdown.transactions,
                accessorKey: 'transactions',
                meta: { align: 'end' },
                cell: ({ row }: { row: { original: DailyRow } }) => <span className="tabular-nums">{row.original.transactions}</span>,
                footer: () => <span className="tabular-nums">{sum(rows, (row) => row.transactions)}</span>,
            },
            {
                id: 'gross_revenue',
                header: m.dailyBreakdown.grossRevenue,
                accessorKey: 'gross_revenue',
                meta: { align: 'end', hideOnMobile: true },
                cell: ({ row }: { row: { original: DailyRow } }) => money(row.original.gross_revenue),
                footer: () => money(sum(rows, (row) => row.gross_revenue)),
            },
            {
                id: 'returns',
                header: m.dailyBreakdown.returns,
                accessorKey: 'returns',
                meta: { align: 'end', hideOnMobile: true },
                cell: ({ row }: { row: { original: DailyRow } }) => money(row.original.returns),
                footer: () => money(sum(rows, (row) => row.returns)),
            },
            {
                id: 'net_revenue',
                header: m.dailyBreakdown.netRevenue,
                accessorKey: 'net_revenue',
                meta: { align: 'end' },
                cell: ({ row }: { row: { original: DailyRow } }) => money(row.original.net_revenue),
                footer: () => money(sum(rows, (row) => row.net_revenue)),
            },
        ];
    }, [m, t, groupBy, rows, locale]);

    const productColumns = useMemo(() => [
        {
            id: 'name',
            header: m.topProducts.product,
            accessorKey: 'name',
        },
        {
            id: 'unitsSold',
            header: m.topProducts.units,
            accessorKey: 'unitsSold',
            meta: { align: 'end' },
            cell: ({ row }: { row: { original: TopProduct } }) => <span className="tabular-nums">{row.original.unitsSold}</span>,
        },
        {
            id: 'revenue',
            header: m.topProducts.revenue,
            accessorKey: 'revenue',
            meta: { align: 'end' },
            cell: ({ row }: { row: { original: TopProduct } }) => (
                <span className="tabular-nums">{formatBDT(row.original.revenue, { locale })}</span>
            ),
        },
    ], [m, locale]);

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
    ], [m, period]);

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale });
        const summary = report?.summary;
        const company = report?.company_comparison;
        const items: ListStat[] = [
            {
                id: 'revenue',
                icon: <TrendingUp aria-hidden />,
                label: m.summary.branchRevenue,
                value: money(summary?.revenue ?? 0),
                hint: company ? formatMessage(m.summary.percentOfCompany, { percent: company.revenue_share.toFixed(1) }) : undefined,
            },
            {
                id: 'transactions',
                icon: <ShoppingCart aria-hidden />,
                label: m.summary.transactions,
                value: (summary?.transactions ?? 0).toLocaleString(),
                hint: company
                    ? formatMessage(m.summary.transactionsSub, { total: company.company_transactions.toLocaleString() })
                    : undefined,
            },
            { id: 'average', icon: <Calculator aria-hidden />, label: m.summary.avgOrder, value: money(summary?.avg_order ?? 0) },
            {
                id: 'returns',
                icon: <RotateCcw aria-hidden />,
                label: m.summary.returns,
                value: money(summary?.returns ?? 0),
                tone: (summary?.returns ?? 0) > 0 ? 'danger' : 'default',
            },
            { id: 'net', icon: <Wallet aria-hidden />, label: m.summary.netRevenue, value: money(summary?.net_revenue ?? 0) },
            {
                id: 'share',
                icon: <PieChart aria-hidden />,
                label: m.companyComparison.revenueShare,
                value: company ? `${company.revenue_share.toFixed(1)}%` : '—',
                hint: company
                    ? formatMessage(m.summary.transactionsSub, { total: money(company.company_revenue) })
                    : undefined,
            },
        ];
        return { items, loading: loading && !report, label: m.statsLabel };
    }, [report, loading, locale, m]);

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
                actions={<BranchFilter scope={branch} />}
            />

            {branch.ready && !selectedStore ? <Alert tone="info">{m.noStores}</Alert> : null}
            {error ? <Alert tone="danger">{error}</Alert> : null}

            <DataTable
                title={report ? `${m.title} — ${report.store.name}` : m.title}
                tableId="sales-branch-report"
                columns={columns as never}
                data={rows}
                isLoading={loading}
                emptyMessage={m.dailyBreakdown.empty}
                emptyIcon={<BarChart3 className="h-16 w-16 text-gray-200" />}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                toolbarActions={(
                    <GroupByChip<GroupBy>
                        label={m.groupBy}
                        value={groupBy}
                        onChange={setGroupBy}
                        options={GROUPS.map((group) => ({ value: group, label: m.groups[group] }))}
                    />
                )}
            />

            <section aria-labelledby="branch-top-products" className="space-y-2">
                <h2 id="branch-top-products" className="text-sm font-semibold text-gray-900">{m.topProducts.title}</h2>
                <DataTable
                    title={m.topProducts.title}
                    tableId="sales-branch-top-products"
                    columns={productColumns as never}
                    data={report?.top_products ?? []}
                    isLoading={loading}
                    emptyMessage={m.topProducts.empty}
                    emptyIcon={<Package className="h-16 w-16 text-gray-200" />}
                    showSearch={false}
                    enableColumnFilters={false}
                />
            </section>
        </PageShell>
    );
}
