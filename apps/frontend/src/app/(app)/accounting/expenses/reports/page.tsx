'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import {
    AccountingPageShell,
    AccountingToolbar,
    CompactSection,
    CompactStat,
} from '@/components/accounting/compact';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatBDT } from '@/lib/format';
import { compactDensity } from '@/lib/ui/compact-density';

interface CategoryBreakdown {
    categoryId: string;
    name: string;
    amount: number;
    sharePct: number;
}

interface MonthlyTrend {
    month: string;
    amount: number;
}

interface ExpenseSummary {
    total: number;
    byCategory: CategoryBreakdown[];
    monthlyTrend: MonthlyTrend[];
    expenseToRevenueRatio: number;
}

const categoryHelper = createColumnHelper<CategoryBreakdown>();
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
    const [summary, setSummary] = useState<ExpenseSummary | null>(null);
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(defaultTo());
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void loadSummary();
    }, [fromDate, toDate]);

    const loadSummary = async () => {
        setLoading(true);
        try {
            const data = await api.getExpenseSummary({
                from: fromDate || undefined,
                to: toDate || undefined,
            });
            setSummary(data);
        } catch (error) {
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
                cell: (info) => <span className="text-sm font-black text-rose-600">{formatBDT(Number(info.getValue()))}</span>,
                size: 140,
            }),
            categoryHelper.accessor('sharePct', {
                header: t.expenses.share,
                cell: (info) => (
                    <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden max-w-[120px]">
                            <div className="h-full bg-rose-500 rounded-full" style={{ width: `${Math.min(100, info.getValue())}%` }} />
                        </div>
                        <span className="text-xs font-bold text-gray-500">{Number(info.getValue()).toFixed(1)}%</span>
                    </div>
                ),
                size: 180,
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
                cell: (info) => <span className="text-sm font-black text-rose-600">{formatBDT(Number(info.getValue()))}</span>,
                size: 140,
            }),
        ],
        [t],
    );

    const maxTrend = Math.max(...(summary?.monthlyTrend.map((row) => row.amount) ?? [1]), 1);

    return (
        <AccountingPageShell maxWidth="wide">
            <Link href="/accounting/expenses" className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-gray-700">
                <ArrowLeft className="w-3.5 h-3.5" />
                {t.expenses.title}
            </Link>

            <AccountingToolbar subtitle={t.expenses.reportsDescription} />

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
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
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
                                        <span className="block text-sm font-semibold text-rose-600 mt-0.5">{formatBDT(summary.byCategory[0].amount)}</span>
                                    ) : null}
                                </>
                            )}
                        />
                    </div>

                    {summary.monthlyTrend.length > 0 && (
                        <CompactSection title={t.expenses.monthlyTrend}>
                            <div className="flex items-end gap-2 h-32">
                                {summary.monthlyTrend.map((row) => (
                                    <div key={row.month} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                                        <div
                                            className="w-full bg-rose-500 rounded-t-md transition-all"
                                            style={{ height: `${Math.max(8, (row.amount / maxTrend) * 100)}%` }}
                                            title={formatBDT(row.amount)}
                                        />
                                        <span className="text-[10px] font-medium text-gray-500 truncate w-full text-center">{row.month.slice(5)}</span>
                                    </div>
                                ))}
                            </div>
                        </CompactSection>
                    )}

                    <CompactSection title={t.expenses.byCategory}>
                        <DataTable
                            tableId="expense-reports-by-category"
                            title="Expenses by Category"
                            data={summary.byCategory}
                            columns={categoryColumns}
                            searchPlaceholder={t.expenses.searchCategories}
                            emptyMessage={t.common.noData}
                        />
                    </CompactSection>

                    <CompactSection title={t.expenses.monthlyTrend}>
                        <DataTable
                            tableId="expense-reports-monthly"
                            title="Monthly Expense Trend"
                            data={summary.monthlyTrend}
                            columns={trendColumns}
                            emptyMessage={t.common.noData}
                        />
                    </CompactSection>
                </>
            ) : (
                <p className="text-center text-gray-500 py-8 text-sm">{t.common.noData}</p>
            )}
        </AccountingPageShell>
    );
}