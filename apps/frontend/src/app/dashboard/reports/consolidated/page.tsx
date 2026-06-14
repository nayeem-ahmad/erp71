'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { TrendingUp, ShoppingCart, BarChart3, Package } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function defaultFrom(): string {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
}

function defaultTo(): string {
    return new Date().toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/*  Skeleton                                                           */
/* ------------------------------------------------------------------ */

function Skeleton({ className }: { className?: string }) {
    return (
        <div
            className={`animate-pulse bg-gray-200 rounded ${className ?? ''}`}
        />
    );
}

function SummaryCardSkeleton() {
    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-7 w-36" />
        </div>
    );
}

function TableSkeleton() {
    return (
        <div className="space-y-2 mt-4">
            {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
            ))}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Summary Card                                                       */
/* ------------------------------------------------------------------ */

function SummaryCard({
    icon: Icon,
    label,
    value,
    accent,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
    accent: string;
}) {
    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-start gap-4">
            <div className={`rounded-xl p-2.5 ${accent}`}>
                <Icon className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">{label}</p>
                <p className="mt-1 text-xl font-bold text-gray-900 truncate">{value}</p>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Bar Chart (CSS-only)                                               */
/* ------------------------------------------------------------------ */

function RevenueBarChart({ stores, title }: { stores: StoreRow[]; title: string }) {
    if (stores.length === 0) return null;

    const maxRevenue = Math.max(...stores.map((s) => s.revenue), 1);

    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400 mb-5">
                {title}
            </h3>
            <div className="space-y-3">
                {stores.map((store) => {
                    const widthPct = Math.max((store.revenue / maxRevenue) * 100, 0.5);
                    return (
                        <div key={store.store_id} className="flex items-center gap-3">
                            {/* Label */}
                            <span
                                className="w-32 shrink-0 text-sm text-gray-600 truncate text-right"
                                title={store.store_name}
                            >
                                {store.store_name}
                            </span>
                            {/* Bar track */}
                            <div className="flex-1 h-7 bg-gray-100 rounded-lg overflow-hidden relative">
                                <div
                                    className="h-full bg-blue-500 rounded-lg transition-all duration-500"
                                    style={{ width: `${widthPct}%` }}
                                />
                            </div>
                            {/* Value label */}
                            <span className="w-32 shrink-0 text-sm font-semibold text-gray-700">
                                {formatBDT(store.revenue)}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Store Breakdown Table                                              */
/* ------------------------------------------------------------------ */

function StoreTable({ stores, m }: { stores: StoreRow[]; m: ReturnType<typeof useI18n>['t']['reports']['consolidated'] }) {
    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
                <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400">
                    {m.storeBreakdown}
                </h3>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-gray-50">
                            <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
                                {m.columns.storeName}
                            </th>
                            <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
                                {m.columns.revenue}
                            </th>
                            <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
                                {m.columns.transactions}
                            </th>
                            <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
                                {m.columns.avgOrder}
                            </th>
                            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-gray-400 min-w-[160px]">
                                {m.columns.revenueShare}
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {stores.map((store) => (
                            <tr key={store.store_id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-6 py-3 font-medium text-gray-800">
                                    {store.store_name}
                                </td>
                                <td className="px-4 py-3 text-right font-semibold text-gray-900">
                                    {formatBDT(store.revenue)}
                                </td>
                                <td className="px-4 py-3 text-right text-gray-600">
                                    {store.transactions.toLocaleString()}
                                </td>
                                <td className="px-4 py-3 text-right text-gray-600">
                                    {formatBDT(store.avg_order)}
                                </td>
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-2">
                                        {/* Progress bar */}
                                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-blue-500 rounded-full transition-all duration-500"
                                                style={{
                                                    width: `${Math.min(store.revenue_share, 100)}%`,
                                                }}
                                            />
                                        </div>
                                        <span className="text-xs font-semibold text-gray-500 w-12 text-right shrink-0">
                                            {store.revenue_share.toFixed(1)}%
                                        </span>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Empty State                                                        */
/* ------------------------------------------------------------------ */

function EmptyState({ m }: { m: ReturnType<typeof useI18n>['t']['reports']['consolidated'] }) {
    return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
                <BarChart3 className="w-8 h-8 text-gray-300" />
            </div>
            <p className="text-base font-semibold text-gray-500">{m.empty.title}</p>
            <p className="text-sm text-gray-400 mt-1">
                {m.empty.description}
            </p>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ConsolidatedReportPage() {
    const { t } = useI18n();
    const m = t.reports.consolidated;
    const [from, setFrom] = useState(defaultFrom);
    const [to, setTo] = useState(defaultTo);
    const [inputFrom, setInputFrom] = useState(defaultFrom);
    const [inputTo, setInputTo] = useState(defaultTo);
    const [report, setReport] = useState<ConsolidatedReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchReport = async (fromDate: string, toDate: string) => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.getConsolidatedReport({ from: fromDate, to: toDate });
            setReport(data as ConsolidatedReport);
        } catch (err: any) {
            setError(err?.message ?? m.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    // Load on initial mount with default range
    useEffect(() => {
        void fetchReport(from, to);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleGenerate = () => {
        setFrom(inputFrom);
        setTo(inputTo);
        void fetchReport(inputFrom, inputTo);
    };

    const hasData = report && report.by_store.length > 0;

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="w-full px-4 sm:px-6 py-8 space-y-6">

                {/* ---- Header ---- */}
                <div className="flex flex-col sm:flex-row sm:items-end gap-4">
                    <div className="flex-1">
                        <h1 className="text-2xl font-bold text-gray-900">{m.title}</h1>
                        <p className="mt-1 text-sm text-gray-500">
                            {m.description}
                        </p>
                    </div>

                    {/* Date range picker */}
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm">
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest shrink-0">
                                {m.fromLabel}
                            </label>
                            <input
                                type="date"
                                value={inputFrom}
                                max={inputTo}
                                onChange={(e) => setInputFrom(e.target.value)}
                                className="text-sm text-gray-700 bg-transparent border-none outline-none"
                            />
                        </div>
                        <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm">
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest shrink-0">
                                {m.toLabel}
                            </label>
                            <input
                                type="date"
                                value={inputTo}
                                min={inputFrom}
                                onChange={(e) => setInputTo(e.target.value)}
                                className="text-sm text-gray-700 bg-transparent border-none outline-none"
                            />
                        </div>
                        <button
                            onClick={handleGenerate}
                            disabled={loading}
                            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-xl shadow-sm transition-colors"
                        >
                            {loading ? m.loading : m.generate}
                        </button>
                    </div>
                </div>

                {/* Period badge */}
                {!loading && report && (
                    <p className="text-xs text-gray-400">
                        {formatMessage(m.periodLabel, { from: formatDate(from), to: formatDate(to) })}
                    </p>
                )}

                {/* ---- Error ---- */}
                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
                        {error}
                    </div>
                )}

                {/* ---- Loading skeleton ---- */}
                {loading && (
                    <>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            {[...Array(4)].map((_, i) => <SummaryCardSkeleton key={i} />)}
                        </div>
                        <TableSkeleton />
                        <TableSkeleton />
                    </>
                )}

                {/* ---- Content ---- */}
                {!loading && report && (
                    <>
                        {/* Overall Summary Cards */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            <SummaryCard
                                icon={TrendingUp}
                                label={m.summary.totalRevenue}
                                value={formatBDT(report.overall.revenue)}
                                accent="bg-blue-500"
                            />
                            <SummaryCard
                                icon={ShoppingCart}
                                label={m.summary.totalTransactions}
                                value={report.overall.transactions.toLocaleString()}
                                accent="bg-emerald-500"
                            />
                            <SummaryCard
                                icon={BarChart3}
                                label={m.summary.avgOrderValue}
                                value={formatBDT(report.overall.avg_order)}
                                accent="bg-violet-500"
                            />
                            <SummaryCard
                                icon={Package}
                                label={m.summary.topProduct}
                                value={report.overall.top_product ?? m.summary.none}
                                accent="bg-amber-500"
                            />
                        </div>

                        {/* Empty state */}
                        {!hasData && <EmptyState m={m} />}

                        {/* Store table + bar chart */}
                        {hasData && (
                            <>
                                <StoreTable stores={report.by_store} m={m} />
                                <RevenueBarChart stores={report.by_store} title={m.revenueByStore} />
                            </>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
