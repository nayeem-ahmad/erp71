'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, ShoppingCart, BarChart3, RotateCcw, Package } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

function defaultFrom() {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
}

function defaultTo() {
    return new Date().toISOString().slice(0, 10);
}

interface Store {
    id: string;
    name: string;
}

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

function KpiCard({
    icon: Icon,
    label,
    value,
    accent,
    sub,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
    accent: string;
    sub?: string;
}) {
    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-start gap-4">
            <div className={`rounded-xl p-2.5 ${accent}`}>
                <Icon className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">{label}</p>
                <p className="mt-1 text-xl font-bold text-gray-900 truncate">{value}</p>
                {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
            </div>
        </div>
    );
}

function Skeleton({ className }: { className?: string }) {
    return <div className={`animate-pulse bg-gray-200 rounded ${className ?? ''}`} />;
}

export default function BranchReportPage() {
    const { t } = useI18n();
    const m = t.reports.branch;
    const [stores, setStores] = useState<Store[]>([]);
    const [selectedStore, setSelectedStore] = useState<string>('');
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(defaultTo());
    const [inputFrom, setInputFrom] = useState(defaultFrom());
    const [inputTo, setInputTo] = useState(defaultTo());
    const [report, setReport] = useState<BranchReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [storesLoading, setStoresLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        api.getStores()
            .then((s: Store[]) => {
                setStores(s);
                if (s.length > 0) {
                    setSelectedStore(s[0].id);
                }
            })
            .catch(() => {})
            .finally(() => setStoresLoading(false));
    }, []);

    useEffect(() => {
        if (selectedStore) {
            void fetchReport(selectedStore, fromDate, toDate);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedStore]);

    const fetchReport = async (storeId: string, from: string, to: string) => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.getBranchReport({ storeId, from, to });
            setReport(data as BranchReport);
        } catch (err: any) {
            setError(err?.message ?? m.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const handleGenerate = () => {
        setFromDate(inputFrom);
        setToDate(inputTo);
        if (selectedStore) {
            void fetchReport(selectedStore, inputFrom, inputTo);
        }
    };

    const r = report;

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="w-full px-4 sm:px-6 py-8 space-y-6">

                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-end gap-4">
                    <div className="flex-1">
                        <h1 className="text-2xl font-bold text-gray-900">{m.title}</h1>
                        <p className="mt-1 text-sm text-gray-500">
                            {m.description}
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {/* Store selector */}
                        {storesLoading ? (
                            <Skeleton className="h-10 w-40" />
                        ) : (
                            <select
                                value={selectedStore}
                                onChange={(e) => setSelectedStore(e.target.value)}
                                className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 shadow-sm outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                {stores.length === 0 && (
                                    <option value="">{m.noStores}</option>
                                )}
                                {stores.map((s) => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                        )}

                        <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm">
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest shrink-0">{m.fromLabel}</label>
                            <input
                                type="date"
                                value={inputFrom}
                                max={inputTo}
                                onChange={(e) => setInputFrom(e.target.value)}
                                className="text-sm text-gray-700 bg-transparent border-none outline-none"
                            />
                        </div>
                        <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm">
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest shrink-0">{m.toLabel}</label>
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
                            disabled={loading || !selectedStore}
                            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-xl shadow-sm transition-colors"
                        >
                            {loading ? m.loading : m.generate}
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
                        {error}
                    </div>
                )}

                {/* Loading skeleton */}
                {loading && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            {[...Array(4)].map((_, i) => (
                                <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
                                    <Skeleton className="h-4 w-28" />
                                    <Skeleton className="h-7 w-36" />
                                </div>
                            ))}
                        </div>
                        <Skeleton className="h-48 w-full" />
                    </div>
                )}

                {/* Report content */}
                {!loading && r && (
                    <>
                        {/* Branch + period label */}
                        <div className="flex items-center gap-3">
                            <span className="bg-blue-100 text-blue-800 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-widest">
                                {r.store.name}
                            </span>
                            <span className="text-xs text-gray-400">
                                {r.period.from} — {r.period.to}
                            </span>
                        </div>

                        {/* KPI Cards */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            <KpiCard
                                icon={TrendingUp}
                                label={m.summary.branchRevenue}
                                value={formatBDT(r.summary.revenue)}
                                accent="bg-blue-500"
                                sub={formatMessage(m.summary.percentOfCompany, { percent: r.company_comparison.revenue_share.toFixed(1) })}
                            />
                            <KpiCard
                                icon={ShoppingCart}
                                label={m.summary.transactions}
                                value={r.summary.transactions.toLocaleString()}
                                accent="bg-emerald-500"
                                sub={formatMessage(m.summary.transactionsSub, { total: r.company_comparison.company_transactions.toLocaleString() })}
                            />
                            <KpiCard
                                icon={BarChart3}
                                label={m.summary.avgOrder}
                                value={formatBDT(r.summary.avg_order)}
                                accent="bg-violet-500"
                            />
                            <KpiCard
                                icon={RotateCcw}
                                label={m.summary.returns}
                                value={formatBDT(r.summary.returns)}
                                accent="bg-rose-500"
                                sub={formatMessage(m.summary.netSub, { amount: formatBDT(r.summary.net_revenue) })}
                            />
                        </div>

                        {/* Company comparison bar */}
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                            <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400 mb-4">
                                {m.companyComparison.title}
                            </h3>
                            <div className="space-y-3">
                                <div className="flex items-center gap-3">
                                    <span className="w-28 shrink-0 text-sm text-gray-600 text-right">{r.store.name}</span>
                                    <div className="flex-1 h-7 bg-gray-100 rounded-lg overflow-hidden">
                                        <div
                                            className="h-full bg-blue-500 rounded-lg transition-all duration-500"
                                            style={{ width: `${Math.min(r.company_comparison.revenue_share, 100)}%` }}
                                        />
                                    </div>
                                    <span className="w-32 shrink-0 text-sm font-semibold text-gray-700">
                                        {formatBDT(r.summary.revenue)} ({r.company_comparison.revenue_share.toFixed(1)}%)
                                    </span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="w-28 shrink-0 text-sm text-gray-500 text-right">{m.companyComparison.allBranches}</span>
                                    <div className="flex-1 h-7 bg-gray-100 rounded-lg overflow-hidden">
                                        <div className="h-full bg-gray-300 rounded-lg w-full" />
                                    </div>
                                    <span className="w-32 shrink-0 text-sm font-semibold text-gray-500">
                                        {formatBDT(r.company_comparison.company_revenue)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="grid md:grid-cols-2 gap-6">
                            {/* Top Products */}
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                                <div className="px-6 py-4 border-b border-gray-100">
                                    <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400">
                                        {m.topProducts.title}
                                    </h3>
                                </div>
                                {r.top_products.length === 0 ? (
                                    <div className="px-6 py-8 text-center text-gray-400 text-sm">
                                        <Package className="w-8 h-8 mx-auto mb-2 text-gray-200" />
                                        {m.topProducts.empty}
                                    </div>
                                ) : (
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-gray-50">
                                                <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-widest text-gray-400">{m.topProducts.product}</th>
                                                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-widest text-gray-400">{m.topProducts.units}</th>
                                                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-widest text-gray-400">{m.topProducts.revenue}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                            {r.top_products.map((p, i) => (
                                                <tr key={i} className="hover:bg-gray-50 transition-colors">
                                                    <td className="px-6 py-3 font-medium text-gray-800 truncate max-w-[160px]">{p.name}</td>
                                                    <td className="px-4 py-3 text-right text-gray-600">{p.unitsSold}</td>
                                                    <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatBDT(p.revenue)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>

                            {/* Daily Breakdown */}
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                                <div className="px-6 py-4 border-b border-gray-100">
                                    <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400">
                                        {m.dailyBreakdown.title}
                                    </h3>
                                </div>
                                {r.daily.length === 0 ? (
                                    <div className="px-6 py-8 text-center text-gray-400 text-sm">
                                        <BarChart3 className="w-8 h-8 mx-auto mb-2 text-gray-200" />
                                        {m.dailyBreakdown.empty}
                                    </div>
                                ) : (
                                    <div className="overflow-y-auto max-h-72">
                                        <table className="w-full text-sm">
                                            <thead className="sticky top-0 bg-gray-50">
                                                <tr>
                                                    <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-widest text-gray-400">{m.dailyBreakdown.date}</th>
                                                    <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-widest text-gray-400">{m.dailyBreakdown.txns}</th>
                                                    <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-widest text-gray-400">{m.dailyBreakdown.netRevenue}</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-50">
                                                {r.daily.map((row) => (
                                                    <tr key={row.date} className="hover:bg-gray-50 transition-colors">
                                                        <td className="px-6 py-2 text-gray-600">{row.date}</td>
                                                        <td className="px-4 py-2 text-right text-gray-600">{row.transactions}</td>
                                                        <td className="px-4 py-2 text-right font-semibold text-gray-900">{formatBDT(row.net_revenue)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}

                {!loading && !r && !error && selectedStore && (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
                            <BarChart3 className="w-8 h-8 text-gray-300" />
                        </div>
                        <p className="text-base font-semibold text-gray-500">{m.empty.title}</p>
                        <p className="text-sm text-gray-400 mt-1">{m.empty.description}</p>
                    </div>
                )}
            </div>
        </div>
    );
}
