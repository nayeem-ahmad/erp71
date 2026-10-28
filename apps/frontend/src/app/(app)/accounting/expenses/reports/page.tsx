'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import {
    AccountingPageShell,
    CompactSection,
    CompactStat,
} from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { BranchFilter } from '@/components/ui';
import { TabPanel, Tabs } from '@/components/ui/compact/Tabs';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import { routes } from '@/lib/routes';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatBDT } from '@/lib/format';
import { compactDensity } from '@/lib/ui/compact-density';

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

function periodBuckets(summary: ExpenseSummary, grain: PeriodGrain): { key: string; amount: number }[] {
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

function defaultFrom() {
    const d = new Date();
    d.setMonth(d.getMonth() - 5);
    d.setDate(1);
    return d.toISOString().slice(0, 10);
}

function defaultTo() {
    return new Date().toISOString().slice(0, 10);
}

export default function ExpenseReportsPage() {
    const { t } = useI18n();
    const branch = useBranchScope();
    const [summary, setSummary] = useState<ExpenseSummary | null>(null);
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(defaultTo());
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState<ReportView>('trend');
    const [grain, setGrain] = useState<PeriodGrain>('month');

    useEffect(() => {
        if (!branch.ready) return;
        void loadSummary();
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

    const categoryColumns: ColumnDef<CategoryBreakdown, any>[] = useMemo(
        () => [
            categoryHelper.accessor('name', {
                header: t.expenses.category,
                cell: (info) => <span className="text-sm font-bold text-gray-800">{info.getValue()}</span>,
                size: 200,
            }),
            categoryHelper.accessor('amount', {
                header: t.common.amount,
                cell: (info) => <span className="text-sm font-bold text-danger">{formatBDT(Number(info.getValue()))}</span>,
                size: 140,
            }),
            categoryHelper.accessor('sharePct', {
                header: t.expenses.share,
                cell: (info) => (
                    <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden max-w-[120px]">
                            <div className="h-full bg-danger rounded-full" style={{ width: `${Math.min(100, info.getValue())}%` }} />
                        </div>
                        <span className="text-xs font-bold text-gray-500">{Number(info.getValue()).toFixed(1)}%</span>
                    </div>
                ),
                size: 180,
            }),
        ],
        [t],
    );

    const headRows: HeadRow[] = useMemo(
        () => (summary?.byCategory ?? []).flatMap((category) =>
            (category.heads ?? []).map((head) => ({ ...head, categoryName: category.name })),
        ),
        [summary],
    );

    const headColumns: ColumnDef<HeadRow, any>[] = useMemo(
        () => [
            headHelper.accessor('categoryName', {
                header: t.expenses.category,
                cell: (info) => <span className="text-sm text-gray-600">{info.getValue()}</span>,
                size: 160,
            }),
            headHelper.accessor('name', {
                header: t.expenses.head,
                cell: (info) => <span className="text-sm font-bold text-gray-800">{info.getValue()}</span>,
                size: 200,
            }),
            headHelper.accessor('amount', {
                header: t.common.amount,
                cell: (info) => <span className="text-sm font-bold text-danger">{formatBDT(Number(info.getValue()))}</span>,
                size: 140,
            }),
            headHelper.accessor('sharePct', {
                header: t.expenses.share,
                cell: (info) => <span className="text-xs font-bold text-gray-500">{Number(info.getValue()).toFixed(1)}%</span>,
                size: 100,
            }),
        ],
        [t],
    );

    const trendColumns: ColumnDef<MonthlyTrend, any>[] = useMemo(
        () => [
            trendHelper.accessor('month', {
                header: t.expenses.month,
                cell: (info) => <span className="text-sm font-bold text-gray-700">{info.getValue()}</span>,
                size: 120,
            }),
            trendHelper.accessor('amount', {
                header: t.common.amount,
                cell: (info) => <span className="text-sm font-bold text-danger">{formatBDT(Number(info.getValue()))}</span>,
                size: 140,
            }),
        ],
        [t],
    );

    const maxTrend = Math.max(...(summary?.monthlyTrend.map((row) => row.amount) ?? [1]), 1);

    const periods = useMemo(
        () => (summary ? periodBuckets(summary, grain) : []),
        [summary, grain],
    );

    const periodColumns: ColumnDef<{ key: string; amount: number }, any>[] = useMemo(
        () => [
            {
                id: 'key',
                accessorKey: 'key',
                header: t.expenses.period,
                cell: (info: { getValue: () => string }) => <span className="text-sm font-medium text-gray-700">{info.getValue()}</span>,
                size: 140,
            },
            {
                id: 'amount',
                accessorKey: 'amount',
                header: t.common.amount,
                cell: (info: { getValue: () => number }) => <span className="text-sm font-medium text-danger">{formatBDT(Number(info.getValue()))}</span>,
                size: 140,
            },
            {
                id: 'share',
                header: t.expenses.share,
                cell: ({ row }: { row: { original: { amount: number } } }) => {
                    const share = summary && summary.total > 0 ? (row.original.amount / summary.total) * 100 : 0;
                    return <span className="text-xs font-medium text-gray-500">{share.toFixed(1)}%</span>;
                },
                size: 100,
            },
        ],
        [t, summary],
    );

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

            <CompactSection flat>
                <div className={`${compactDensity.filterBar} !p-0 !border-0 !bg-transparent max-w-lg`}>
                    <label className="block">
                        <span className={`${compactDensity.formLabel} block mb-1`}>{t.common.date} (from)</span>
                        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={compactDensity.formField} />
                    </label>
                    <label className="block">
                        <span className={`${compactDensity.formLabel} block mb-1`}>{t.common.date} (to)</span>
                        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={compactDensity.formField} />
                    </label>
                </div>
            </CompactSection>

            {loading ? (
                <div className="flex items-center justify-center py-12 text-gray-400">
                    <Loader2 className="w-5 h-5 animate-spin me-2" />
                    {t.common.loading}
                </div>
            ) : summary ? (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <CompactStat label={t.expenses.totalExpenses} value={formatBDT(summary.total)} tone="negative" />
                        <CompactStat
                            label={t.expenses.expenseRatio}
                            value={(
                                <>
                                    <span>{(summary.expenseToRevenueRatio * 100).toFixed(1)}%</span>
                                    <span className="block text-xs font-normal text-gray-500 mt-0.5">{t.expenses.expenseRatioHelp}</span>
                                </>
                            )}
                        />
                        <CompactStat
                            label={t.expenses.topCategory}
                            value={(
                                <>
                                    <span className="text-base">{summary.byCategory[0]?.name ?? '—'}</span>
                                    {summary.byCategory[0] ? (
                                        <span className="block text-sm font-semibold text-danger mt-0.5">{formatBDT(summary.byCategory[0].amount)}</span>
                                    ) : null}
                                </>
                            )}
                        />
                    </div>

                    <Tabs
                        tabs={reportTabs}
                        value={view}
                        onChange={(next) => { if (next) setView(next); }}
                        idPrefix="expense-report"
                        label={t.expenses.reports}
                    />

                    <TabPanel tabKey="trend" value={view} idPrefix="expense-report">
                        {summary.monthlyTrend.length > 0 && (
                            <CompactSection title={t.expenses.monthlyTrend}>
                                <div className="flex items-end gap-2 h-32">
                                    {summary.monthlyTrend.map((row) => (
                                        <div key={row.month} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                                            <div
                                                className="w-full bg-danger rounded-t-md transition-all"
                                                style={{ height: `${Math.max(8, (row.amount / maxTrend) * 100)}%` }}
                                                title={formatBDT(row.amount)}
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
                            data={summary.monthlyTrend}
                            columns={trendColumns}
                            emptyMessage={t.common.noData}
                        />
                    </TabPanel>

                    <TabPanel tabKey="category" value={view} idPrefix="expense-report">
                        <DataTable
                            tableId="expense-reports-by-category"
                            title={t.expenses.byCategory}
                            data={summary.byCategory}
                            columns={categoryColumns}
                            searchPlaceholder={t.expenses.searchCategories}
                            emptyMessage={t.common.noData}
                        />
                    </TabPanel>

                    <TabPanel tabKey="head" value={view} idPrefix="expense-report">
                        <DataTable
                            tableId="expense-reports-by-head"
                            title={t.expenses.byHead}
                            data={headRows}
                            columns={headColumns}
                            searchPlaceholder={t.expenses.searchHeads}
                            emptyMessage={t.common.noData}
                        />
                    </TabPanel>

                    <TabPanel tabKey="period" value={view} idPrefix="expense-report">
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
                            emptyMessage={t.common.noData}
                        />
                    </TabPanel>
                </>
            ) : (
                <p className="text-center text-gray-500 py-8 text-sm">{t.common.noData}</p>
            )}
        </AccountingPageShell>
    );
}