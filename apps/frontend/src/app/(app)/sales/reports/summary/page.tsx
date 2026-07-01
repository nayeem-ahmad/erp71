'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { TrendingUp, Sparkles, Loader2, X } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

interface SummaryRow {
    date: string;
    transactions: number;
    grossRevenue: number;
    returns: number;
    netRevenue: number;
}

interface Summary {
    totalRevenue: number;
    totalReturns: number;
    netRevenue: number;
    transactionCount: number;
    avgOrderValue: number;
}

const columnHelper = createColumnHelper<SummaryRow>();

function defaultFrom() {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
}

function defaultTo() {
    return new Date().toISOString().slice(0, 10);
}

export default function SalesSummaryPage() {
    const { t, locale } = useI18n();
    const [rows, setRows] = useState<SummaryRow[]>([]);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(defaultTo());
    const [loading, setLoading] = useState(true);
    const [narrating, setNarrating] = useState(false);
    const [narration, setNarration] = useState<string | null>(null);

    useEffect(() => {
        void loadReport();
    }, [fromDate, toDate]);

    const loadReport = async () => {
        setLoading(true);
        setNarration(null);
        try {
            const data = await api.getSalesSummary({
                from: fromDate || undefined,
                to: toDate || undefined,
            });
            setSummary(data.summary);
            setRows(data.rows);
        } catch (error) {
            console.error('Failed to load sales summary', error);
        } finally {
            setLoading(false);
        }
    };

    const handleNarrate = async () => {
        if (!summary) return;
        setNarrating(true);
        try {
            const result = await api.aiNarrateReport({
                reportType: 'sales_summary',
                reportData: {
                    period: `${fromDate} to ${toDate}`,
                    totalRevenue: summary.totalRevenue,
                    totalReturns: summary.totalReturns,
                    netRevenue: summary.netRevenue,
                    transactionCount: summary.transactionCount,
                    avgOrderValue: summary.avgOrderValue,
                    dailyRows: rows.slice(0, 10),
                },
                locale,
            });
            setNarration(result.narration);
        } catch (err: any) {
            setNarration(`Error: ${err.message ?? 'AI narration failed.'}`);
        } finally {
            setNarrating(false);
        }
    };

    const columns: ColumnDef<SummaryRow, any>[] = useMemo(
        () => [
            columnHelper.accessor('date', { header: t.salesReports.common.date, size: 130 }),
            columnHelper.accessor('transactions', { header: t.salesReports.common.transactions, size: 120 }),
            columnHelper.accessor('grossRevenue', {
                header: t.salesReports.common.grossRevenue,
                cell: (info) => formatBDT(Number(info.getValue()), { locale }),
                size: 140,
            }),
            columnHelper.accessor('returns', {
                header: t.salesReports.common.returns,
                cell: (info) => (
                    <span className="text-rose-600">{formatBDT(Number(info.getValue()), { locale })}</span>
                ),
                size: 120,
            }),
            columnHelper.accessor('netRevenue', {
                header: t.salesReports.common.netRevenue,
                cell: (info) => (
                    <span className="font-black text-blue-700">{formatBDT(Number(info.getValue()), { locale })}</span>
                ),
                size: 140,
            }),
        ],
        [t, locale],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <div>
                    <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.salesReports.summary.title}</h1>
                    <p className="text-xs text-gray-500 mt-0.5">
                        {t.salesReports.summary.subtitle}
                    </p>
                </div>

                <div className="grid md:grid-cols-5 gap-4">
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.salesReports.common.grossRevenue}</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">
                            {formatBDT(Number(summary?.totalRevenue ?? 0), { locale })}
                        </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.salesReports.common.returns}</div>
                        <div className="text-2xl font-black text-rose-600 mt-2">
                            {formatBDT(Number(summary?.totalReturns ?? 0), { locale })}
                        </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.salesReports.common.netRevenue}</div>
                        <div className="text-2xl font-black text-blue-700 mt-2">
                            {formatBDT(Number(summary?.netRevenue ?? 0), { locale })}
                        </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.salesReports.common.transactions}</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">
                            {summary?.transactionCount ?? 0}
                        </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.salesReports.common.avgOrderValue}</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">
                            {formatBDT(Number(summary?.avgOrderValue ?? 0), { locale })}
                        </div>
                    </div>
                </div>

                {/* AI Narration */}
                {narration && (
                    <div className="bg-purple-50 border border-purple-200 rounded-2xl p-5 flex gap-3">
                        <Sparkles className="w-5 h-5 text-purple-500 shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <p className="text-xs font-black uppercase tracking-widest text-purple-400 mb-1">AI Insight</p>
                            <p className="text-sm text-gray-800 leading-relaxed">{narration}</p>
                        </div>
                        <button onClick={() => setNarration(null)} className="text-purple-300 hover:text-purple-500 shrink-0">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                )}

                <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-wrap gap-3 items-end justify-between">
                    <div className="flex flex-wrap gap-3 items-end">
                        <div className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-gray-500">{t.salesReports.common.from}</span>
                            <input
                                type="date"
                                value={fromDate}
                                onChange={(e) => setFromDate(e.target.value)}
                                className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-gray-500">{t.salesReports.common.to}</span>
                            <input
                                type="date"
                                value={toDate}
                                onChange={(e) => setToDate(e.target.value)}
                                className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium"
                            />
                        </div>
                    </div>
                    <button
                        onClick={handleNarrate}
                        disabled={narrating || !summary || loading}
                        className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 text-white rounded-xl text-sm font-bold hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {narrating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                        {narrating ? 'Generating…' : 'AI Narrate'}
                    </button>
                </div>

                <DataTable<SummaryRow>
                    tableId="sales-summary"
                    columns={columns}
                    data={rows}
                    title={t.salesReports.summary.dailyBreakdown}
                    isLoading={loading}
                    emptyMessage={t.salesReports.common.noSalesInPeriod}
                    emptyIcon={<TrendingUp className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.salesReports.summary.searchPlaceholder}
                />
            </div>
        </div>
    );
}