'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BarChart3, Loader2 } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatBDT } from '@/lib/format';

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
        <div className="h-full overflow-y-auto bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1200px] mx-auto space-y-6">
                <div>
                    <Link href="/dashboard/expenses" className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-gray-700 mb-3">
                        <ArrowLeft className="w-3.5 h-3.5" />
                        {t.expenses.title}
                    </Link>
                    <h1 className="text-2xl font-black tracking-tight inline-flex items-center gap-2">
                        <BarChart3 className="w-7 h-7 text-rose-600" />
                        {t.expenses.reports}
                    </h1>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                        {t.expenses.reportsDescription}
                    </p>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
                    <label className="space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t.common.date} (from)</span>
                        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm" />
                    </label>
                    <label className="space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t.common.date} (to)</span>
                        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm" />
                    </label>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-20 text-gray-400">
                        <Loader2 className="w-6 h-6 animate-spin mr-2" />
                        {t.common.loading}
                    </div>
                ) : summary ? (
                    <>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="rounded-2xl border border-gray-200 bg-white p-5">
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t.expenses.totalExpenses}</p>
                                <p className="text-2xl font-black text-rose-600 mt-1">{formatBDT(summary.total)}</p>
                            </div>
                            <div className="rounded-2xl border border-gray-200 bg-white p-5">
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t.expenses.expenseRatio}</p>
                                <p className="text-2xl font-black text-gray-900 mt-1">
                                    {(summary.expenseToRevenueRatio * 100).toFixed(1)}%
                                </p>
                                <p className="text-xs text-gray-500 mt-1">{t.expenses.expenseRatioHelp}</p>
                            </div>
                            <div className="rounded-2xl border border-gray-200 bg-white p-5">
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t.expenses.topCategory}</p>
                                <p className="text-lg font-black text-gray-900 mt-1">{summary.byCategory[0]?.name ?? '—'}</p>
                                {summary.byCategory[0] && (
                                    <p className="text-sm text-rose-600 font-bold">{formatBDT(summary.byCategory[0].amount)}</p>
                                )}
                            </div>
                        </div>

                        {summary.monthlyTrend.length > 0 && (
                            <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-4">
                                <h2 className="text-sm font-black uppercase tracking-widest text-gray-500">{t.expenses.monthlyTrend}</h2>
                                <div className="flex items-end gap-3 h-40">
                                    {summary.monthlyTrend.map((row) => (
                                        <div key={row.month} className="flex-1 flex flex-col items-center gap-2 min-w-0">
                                            <div
                                                className="w-full bg-rose-500 rounded-t-lg transition-all"
                                                style={{ height: `${Math.max(8, (row.amount / maxTrend) * 100)}%` }}
                                                title={formatBDT(row.amount)}
                                            />
                                            <span className="text-[10px] font-bold text-gray-500 truncate w-full text-center">{row.month.slice(5)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="space-y-3">
                            <h2 className="text-sm font-black uppercase tracking-widest text-gray-500">{t.expenses.byCategory}</h2>
                            <DataTable
                                tableId="expense-reports-by-category"
                                title="Expenses by Category"
                                data={summary.byCategory}
                                columns={categoryColumns}
                                searchPlaceholder={t.expenses.searchCategories}
                                emptyMessage={t.common.noData}
                            />
                        </div>

                        <div className="space-y-3">
                            <h2 className="text-sm font-black uppercase tracking-widest text-gray-500">{t.expenses.monthlyTrend}</h2>
                            <DataTable
                                tableId="expense-reports-monthly"
                                title="Monthly Expense Trend"
                                data={summary.monthlyTrend}
                                columns={trendColumns}
                                emptyMessage={t.common.noData}
                            />
                        </div>
                    </>
                ) : (
                    <p className="text-center text-gray-500 py-12">{t.common.noData}</p>
                )}
            </div>
        </div>
    );
}