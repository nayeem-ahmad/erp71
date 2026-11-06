'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Banknote, Calculator, Hash, Percent, Trophy } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { AccountingPageShell, CompactSection } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { BranchFilter } from '@/components/ui';
import { TabPanel, Tabs } from '@/components/ui/compact/Tabs';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import { routes } from '@/lib/routes';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatBDT } from '@/lib/format';
import { createdRangeFromPreset, type CreatedRange } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import { MONTH_RANGE_PRESETS } from '@/components/hr/month-range';

interface HeadBreakdown {
    headId: string;
    name: string;
    amount: number;
    sharePct: number;
}

interface CategoryBreakdown {
    categoryId: string;
    name: string;
    amount: number;
    sharePct: number;
    heads?: HeadBreakdown[];
}

interface HeadRow extends HeadBreakdown {
    categoryId: string;
    categoryName: string;
}

interface MonthlyTrend {
    month: string;
    amount: number;
}

interface DailyTrend {
    date: string;
    amount: number;
}

interface ExpenseSummary {
    total: number;
    byCategory: CategoryBreakdown[];
    monthlyTrend: MonthlyTrend[];
    dailyTrend?: DailyTrend[];
    expenseToRevenueRatio: number;
}

interface PeriodRow {
    key: string;
    amount: number;
}

type ReportView = 'trend' | 'category' | 'head' | 'period';
type PeriodGrain = 'month' | 'week' | 'day';

/** Monday of the UTC week that contains `YYYY-MM-DD`. */
function weekStart(isoDate: string): string {
    const [year, month, day] = isoDate.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    const weekday = date.getUTCDay();
    date.setUTCDate(date.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
    return date.toISOString().slice(0, 10);
}

function periodBuckets(summary: ExpenseSummary, grain: PeriodGrain): PeriodRow[] {
    if (grain === 'month') {
        return summary.monthlyTrend.map((row) => ({ key: row.month, amount: row.amount }));
    }
    const days = summary.dailyTrend ?? [];
    if (grain === 'day') return days.map((row) => ({ key: row.date, amount: row.amount }));
    const weeks = new Map<string, number>();
    for (const row of days) {
        const key = weekStart(row.date);
        weeks.set(key, (weeks.get(key) ?? 0) + row.amount);
    }
    return Array.from(weeks, ([key, amount]) => ({ key, amount })).sort((a, b) => a.key.localeCompare(b.key));
}

const categoryHelper = createColumnHelper<CategoryBreakdown>();
const headHelper = createColumnHelper<HeadRow>();
const trendHelper = createColumnHelper<MonthlyTrend>();

/** The report always covers some period: cleared, it goes back to the last six months. */
const defaultPeriod = (): CreatedRange => createdRangeFromPreset('last6Months');

const amountCell = (value: number, locale: string) => (
    <span className="text-sm font-medium text-gray-900">{formatBDT(Number(value), { locale })}</span>
);

export default function ExpenseReportsPage() {
    const { t, locale } = useI18n();
    const ui = t.accountingBooksUi.expenseReports;
    const branch = useBranchScope();
    const [summary, setSummary] = useState<ExpenseSummary | null>(null);
    const [period, setPeriod] = useState<CreatedRange>(defaultPeriod);
    const fromDate = period.from ?? '';
    const toDate = period.to ?? '';
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState<ReportView>('trend');
    const [grain, setGrain] = useState<PeriodGrain>('month');

    // Chips over the rows each report already holds.
    const [categoryIds, setCategoryIds] = useState<string[]>([]);
    const [headIds, setHeadIds] = useState<string[]>([]);
    const [trendAmount, setTrendAmount] = useState<NumberCondition | null>(null);
    const [categoryAmount, setCategoryAmount] = useState<NumberCondition | null>(null);
    const [headAmount, setHeadAmount] = useState<NumberCondition | null>(null);
    const [periodAmount, setPeriodAmount] = useState<NumberCondition | null>(null);
    const [categoryShare, setCategoryShare] = useState<NumberCondition | null>(null);
    const [headShare, setHeadShare] = useState<NumberCondition | null>(null);
    const [categorySearch, setCategorySearch] = useState('');
    const [headSearch, setHeadSearch] = useState('');

    useEffect(() => {
        if (!branch.ready) return;
        void loadSummary();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branch.ready, branch.apiStoreId, fromDate, toDate]);

    const loadSummary = async () => {
        setLoading(true);
        try {
            const data = await api.getExpenseSummary({
                storeId: branch.apiStoreId,
                from: fromDate || undefined,
                to: toDate || undefined,
            });
            setSummary(data);
        } catch (error) {
            if (handleBranchForbidden(error, branch, t.dashboardLayout.branchFilterForbidden)) return;
            console.error('Failed to load expense summary', error);
            setSummary(null);
        } finally {
            setLoading(false);
        }
    };

    const headRows: HeadRow[] = useMemo(
        () => (summary?.byCategory ?? []).flatMap((category) =>
            (category.heads ?? []).map((head) => ({ ...head, categoryId: category.categoryId, categoryName: category.name })),
        ),
        [summary],
    );

    const trendRows = useMemo(
        () => (summary?.monthlyTrend ?? []).filter((row) => matchesNumberCondition(Number(row.amount), trendAmount)),
        [summary, trendAmount],
    );

    const categoryRows = useMemo(
        () => (summary?.byCategory ?? []).filter((row) => (
            matchesAnyOf(categoryIds, row.categoryId)
            && matchesNumberCondition(Number(row.amount), categoryAmount)
            && matchesNumberCondition(Number(row.sharePct), categoryShare)
            && matchesSearch(categorySearch, row.name)
        )),
        [summary, categoryIds, categoryAmount, categoryShare, categorySearch],
    );

    const filteredHeadRows = useMemo(
        () => headRows.filter((row) => (
            matchesAnyOf(categoryIds, row.categoryId)
            && matchesAnyOf(headIds, row.headId)
            && matchesNumberCondition(Number(row.amount), headAmount)
            && matchesNumberCondition(Number(row.sharePct), headShare)
            && matchesSearch(headSearch, row.name, row.categoryName)
        )),
        [headRows, categoryIds, headIds, headAmount, headShare, headSearch],
    );

    const periods = useMemo(
        () => (summary ? periodBuckets(summary, grain) : [])
            .filter((row) => matchesNumberCondition(Number(row.amount), periodAmount)),
        [summary, grain, periodAmount],
    );

    const categoryColumns: ColumnDef<CategoryBreakdown, any>[] = useMemo(
        () => [
            categoryHelper.accessor('name', {
                header: t.expenses.category,
                cell: (info) => <span className="text-sm font-medium text-gray-800">{info.getValue()}</span>,
                size: 200,
            }),
            categoryHelper.accessor('amount', {
                header: t.common.amount,
                cell: (info) => amountCell(info.getValue(), locale),
                meta: { align: 'end' },
                size: 140,
            }),
            categoryHelper.accessor('sharePct', {
                header: t.expenses.share,
                cell: (info) => (
                    <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden max-w-[120px]">
                            <div className="h-full bg-blue-600 rounded-full" style={{ width: `${Math.min(100, info.getValue())}%` }} />
                        </div>
                        <span className="text-xs text-gray-500 tabular-nums">{Number(info.getValue()).toFixed(1)}%</span>
                    </div>
                ),
                meta: { hideOnMobile: true },
                size: 180,
            }),
        ],
        [t, locale],
    );

    const headColumns: ColumnDef<HeadRow, any>[] = useMemo(
        () => [
            headHelper.accessor('categoryName', {
                header: t.expenses.category,
                cell: (info) => <span className="text-sm text-gray-600">{info.getValue()}</span>,
                meta: { hideOnMobile: true },
                size: 160,
            }),
            headHelper.accessor('name', {
                header: t.expenses.head,
                cell: (info) => <span className="text-sm font-medium text-gray-800">{info.getValue()}</span>,
                size: 200,
            }),
            headHelper.accessor('amount', {
                header: t.common.amount,
                cell: (info) => amountCell(info.getValue(), locale),
                meta: { align: 'end' },
                size: 140,
            }),
            headHelper.accessor('sharePct', {
                header: t.expenses.share,
                cell: (info) => <span className="text-xs text-gray-500">{Number(info.getValue()).toFixed(1)}%</span>,
                meta: { align: 'end', hideOnMobile: true },
                size: 100,
            }),
        ],
        [t, locale],
    );

    const trendColumns: ColumnDef<MonthlyTrend, any>[] = useMemo(
        () => [
            trendHelper.accessor('month', {
                header: t.expenses.month,
                cell: (info) => <span className="text-sm text-gray-700">{info.getValue()}</span>,
                size: 120,
            }),
            trendHelper.accessor('amount', {
                header: t.common.amount,
                cell: (info) => amountCell(info.getValue(), locale),
                meta: { align: 'end' },
                size: 140,
            }),
        ],
        [t, locale],
    );

    const periodColumns: ColumnDef<PeriodRow, any>[] = useMemo(
        () => [
            {
                id: 'key',
                accessorKey: 'key',
                header: t.expenses.period,
                cell: (info: { getValue: () => string }) => <span className="text-sm text-gray-700">{info.getValue()}</span>,
                size: 140,
            },
            {
                id: 'amount',
                accessorKey: 'amount',
                header: t.common.amount,
                cell: (info: { getValue: () => number }) => amountCell(info.getValue(), locale),
                meta: { align: 'end' },
                size: 140,
            },
            {
                id: 'share',
                header: t.expenses.share,
                cell: ({ row }: { row: { original: PeriodRow } }) => {
                    const share = summary && summary.total > 0 ? (row.original.amount / summary.total) * 100 : 0;
                    return <span className="text-xs text-gray-500">{share.toFixed(1)}%</span>;
                },
                meta: { align: 'end', hideOnMobile: true },
                size: 100,
            },
        ],
        [t, summary, locale],
    );

    const periodFilter = useMemo<ListFilter>(() => ({
        id: 'period',
        type: 'date-range',
        label: t.expenses.period,
        value: period,
        onChange: (next) => setPeriod(next ?? defaultPeriod()),
        presets: MONTH_RANGE_PRESETS,
        operators: true,
    }), [t, period]);

    const amountChip = (value: NumberCondition | null, onChange: (next: NumberCondition | null) => void): ListFilter => ({
        id: 'amount',
        type: 'number',
        label: t.common.amount,
        value,
        onChange,
        money: true,
    });

    const shareChip = (value: NumberCondition | null, onChange: (next: NumberCondition | null) => void): ListFilter => ({
        id: 'share',
        type: 'number',
        label: t.expenses.share,
        value,
        onChange,
        more: true,
    });

    const categoryChip: ListFilter = {
        id: 'category',
        type: 'multi-select',
        label: t.expenses.category,
        value: categoryIds,
        onChange: (next) => {
            setCategoryIds(next);
            if (!next.length) return;
            const allowed = new Set(headRows.filter((head) => next.includes(head.categoryId)).map((head) => head.headId));
            setHeadIds((current) => current.filter((id) => allowed.has(id)));
        },
        options: (summary?.byCategory ?? []).map((category) => ({ value: category.categoryId, label: category.name })),
    };

    const headChoices = categoryIds.length ? headRows.filter((head) => categoryIds.includes(head.categoryId)) : headRows;

    const trendFilters: ListFilter[] = [periodFilter, amountChip(trendAmount, setTrendAmount)];
    const categoryFilters: ListFilter[] = [
        periodFilter,
        categoryChip,
        amountChip(categoryAmount, setCategoryAmount),
        shareChip(categoryShare, setCategoryShare),
    ];
    const headFilters: ListFilter[] = [
        periodFilter,
        categoryChip,
        {
            id: 'head',
            type: 'multi-select',
            label: t.expenses.head,
            value: headIds,
            onChange: setHeadIds,
            options: headChoices.map((head) => ({
                value: head.headId,
                label: categoryIds.length === 1 ? head.name : `${head.categoryName} — ${head.name}`,
            })),
        },
        amountChip(headAmount, setHeadAmount),
        shareChip(headShare, setHeadShare),
    ];
    const periodFilters: ListFilter[] = [periodFilter, amountChip(periodAmount, setPeriodAmount)];

    /**
     * One report's strip, over the rows its chips leave: their total, how many,
     * the average, the largest, and the period's expense-to-revenue ratio.
     */
    const reportStats = (
        rows: { label: string; amount: number }[],
        countLabel: string,
        topLabel: string,
        countIcon: ReactNode,
    ) => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
        const top = rows.reduce<{ label: string; amount: number } | null>(
            (best, row) => (!best || Number(row.amount) > Number(best.amount) ? row : best),
            null,
        );
        const items: ListStat[] = [
            {
                id: 'total',
                icon: <Banknote aria-hidden />,
                label: t.expenses.totalExpenses,
                value: money(total),
                tone: total > 0 ? 'danger' : 'default',
            },
            { id: 'count', icon: countIcon, label: countLabel, value: rows.length.toLocaleString(locale) },
            {
                id: 'average',
                icon: <Calculator aria-hidden />,
                label: t.expenses.average,
                value: money(rows.length ? total / rows.length : 0),
            },
            {
                id: 'top',
                icon: <Trophy aria-hidden />,
                label: topLabel,
                value: top?.label ?? '—',
                hint: top ? money(Number(top.amount)) : undefined,
            },
            {
                id: 'ratio',
                icon: <Percent aria-hidden />,
                label: t.expenses.expenseRatio,
                value: summary ? `${(summary.expenseToRevenueRatio * 100).toFixed(1)}%` : '—',
            },
        ];
        return { items, loading: loading && !summary, label: ui.statsLabel };
    };

    const maxTrend = Math.max(...trendRows.map((row) => row.amount), 1);

    const reportTabs = [
        { key: 'trend' as const, label: t.expenses.monthlyTrend },
        { key: 'category' as const, label: t.expenses.byCategory },
        { key: 'head' as const, label: t.expenses.byHead },
        { key: 'period' as const, label: t.expenses.byPeriod },
    ];

    const grainTabs = [
        { key: 'month' as const, label: t.expenses.periodMonth },
        { key: 'week' as const, label: t.expenses.periodWeek },
        { key: 'day' as const, label: t.expenses.periodDay },
    ];

    return (
        <AccountingPageShell maxWidth="full">
            <PageHeader
                title={t.accounting.links.expenseReports.title}
                subtitle={t.expenses.reportsDescription}
                breadcrumbs={nestedPageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    'accounting',
                    [{ label: t.expenses.title, href: routes.accounting.expenses }],
                    t.accounting.links.expenseReports.title,
                )}
                actions={<BranchFilter scope={branch} />}
            />

            <Tabs
                tabs={reportTabs}
                value={view}
                onChange={(next) => { if (next) setView(next); }}
                idPrefix="expense-report"
                label={t.expenses.reports}
            />

            <TabPanel tabKey="trend" value={view} idPrefix="expense-report">
                <div className="space-y-4">
                    {trendRows.length > 0 && (
                        <CompactSection title={t.expenses.monthlyTrend}>
                            <div className="flex items-end gap-2 h-32">
                                {trendRows.map((row) => (
                                    <div key={row.month} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                                        <div
                                            className="w-full bg-danger rounded-t-md transition-all"
                                            style={{ height: `${Math.max(8, (row.amount / maxTrend) * 100)}%` }}
                                            title={formatBDT(row.amount, { locale })}
                                        />
                                        <span className="text-[10px] font-medium text-gray-500 truncate w-full text-center">{row.month.slice(5)}</span>
                                    </div>
                                ))}
                            </div>
                        </CompactSection>
                    )}
                    <DataTable
                        tableId="expense-reports-monthly"
                        title={t.expenses.monthlyTrend}
                        data={trendRows}
                        columns={trendColumns}
                        isLoading={loading}
                        emptyMessage={t.common.noData}
                        showSearch={false}
                        filters={trendFilters}
                        filterLayout="row"
                        stats={reportStats(
                            trendRows.map((row) => ({ label: row.month, amount: row.amount })),
                            ui.months,
                            ui.highestMonth,
                            <Hash aria-hidden />,
                        )}
                        enableColumnFilters={false}
                        viewOptions
                    />
                </div>
            </TabPanel>

            <TabPanel tabKey="category" value={view} idPrefix="expense-report">
                <DataTable
                    tableId="expense-reports-by-category"
                    title={t.expenses.byCategory}
                    data={categoryRows}
                    columns={categoryColumns}
                    isLoading={loading}
                    searchPlaceholder={t.expenses.searchCategories}
                    searchValue={categorySearch}
                    onSearchChange={setCategorySearch}
                    emptyMessage={t.common.noData}
                    filters={categoryFilters}
                    filterLayout="row"
                    stats={reportStats(
                        categoryRows.map((row) => ({ label: row.name, amount: row.amount })),
                        t.expenses.categoryCount,
                        t.expenses.topCategory,
                        <Hash aria-hidden />,
                    )}
                    enableColumnFilters={false}
                    viewOptions
                />
            </TabPanel>

            <TabPanel tabKey="head" value={view} idPrefix="expense-report">
                <DataTable
                    tableId="expense-reports-by-head"
                    title={t.expenses.byHead}
                    data={filteredHeadRows}
                    columns={headColumns}
                    isLoading={loading}
                    searchPlaceholder={t.expenses.searchHeads}
                    searchValue={headSearch}
                    onSearchChange={setHeadSearch}
                    emptyMessage={t.common.noData}
                    filters={headFilters}
                    filterLayout="row"
                    stats={reportStats(
                        filteredHeadRows.map((row) => ({ label: row.name, amount: row.amount })),
                        t.expenses.heads,
                        ui.topHead,
                        <Hash aria-hidden />,
                    )}
                    enableColumnFilters={false}
                    viewOptions
                />
            </TabPanel>

            <TabPanel tabKey="period" value={view} idPrefix="expense-report">
                <div className="space-y-3">
                    <Tabs
                        tabs={grainTabs}
                        value={grain}
                        onChange={(next) => { if (next) setGrain(next); }}
                        idPrefix="expense-period"
                        label={t.expenses.byPeriod}
                        bordered={false}
                    />
                    <DataTable
                        tableId="expense-reports-by-period"
                        title={t.expenses.byPeriod}
                        data={periods}
                        columns={periodColumns}
                        isLoading={loading}
                        emptyMessage={t.common.noData}
                        showSearch={false}
                        filters={periodFilters}
                        filterLayout="row"
                        stats={reportStats(
                            periods.map((row) => ({ label: row.key, amount: row.amount })),
                            ui.periods,
                            ui.highestPeriod,
                            <Hash aria-hidden />,
                        )}
                        enableColumnFilters={false}
                        viewOptions
                    />
                </div>
            </TabPanel>
        </AccountingPageShell>
    );
}
