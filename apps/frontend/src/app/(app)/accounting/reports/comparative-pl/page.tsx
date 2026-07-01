'use client';

import { useEffect, useState } from 'react';
import {
    AccountingPageShell,
    AccountingToolbar,
    CompactSection,
} from '@/components/accounting/compact';
import { compactDensity } from '@/lib/ui/compact-density';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

function defaultFrom() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function defaultTo() { return new Date().toISOString().slice(0, 10); }

interface ComparativeGroup {
    group: { id: string; name: string };
    accounts: Array<{
        id: string; name: string; code?: string | null;
        current: number; previous: number; year_ago: number;
        variance_period: number; variance_period_pct: number | null;
    }>;
    current: number; previous: number; year_ago: number;
}

interface ComparativeData {
    periods: {
        current: { from: string; to: string };
        previous: { from: string; to: string };
        year_ago: { from: string; to: string };
    };
    revenue: { groups: ComparativeGroup[]; total: { current: number; previous: number; year_ago: number } };
    expenses: { groups: ComparativeGroup[]; total: { current: number; previous: number; year_ago: number } };
    net_profit: { current: number; previous: number; year_ago: number };
}

function VarianceBadge({ pct }: { pct: number | null }) {
    if (pct === null) return <span className="text-gray-400">—</span>;
    const isPositive = pct >= 0;
    return (
        <span className={`text-xs font-semibold ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
            {isPositive ? '+' : ''}{pct.toFixed(1)}%
        </span>
    );
}

const thClass = `text-right px-3 py-2 ${compactDensity.formLabel}`;
const thLeftClass = `text-left px-3 py-2 ${compactDensity.formLabel}`;

export default function ComparativePLPage() {
    const { t, locale } = useI18n();
    const [data, setData] = useState<ComparativeData | null>(null);
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(defaultTo());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => { void load(); }, [fromDate, toDate]);

    const load = async () => {
        setLoading(true); setError(null);
        try {
            const result = await (api as any).getComparativePL({ from: fromDate || undefined, to: toDate || undefined });
            setData(result);
        } catch (err: any) { setError(err?.message ?? 'Failed to load'); }
        finally { setLoading(false); }
    };

    return (
        <AccountingPageShell maxWidth="wide">
            <AccountingToolbar subtitle="Current, previous, and year-ago period comparison">
                <div className={compactDensity.filterBar}>
                    <div className="flex flex-col gap-1">
                        <span className={compactDensity.formLabel}>From</span>
                        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                            className={compactDensity.formField} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className={compactDensity.formLabel}>To</span>
                        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                            className={compactDensity.formField} />
                    </div>
                </div>
            </AccountingToolbar>

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            {loading ? (
                <CompactSection className="py-8 text-center text-gray-400 text-sm font-medium">Loading…</CompactSection>
            ) : data ? (
                <CompactSection className="p-0 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-gray-50 border-b border-gray-100">
                                <th className={thLeftClass}>Account</th>
                                <th className={thClass}>
                                    Current<div className="text-[10px] font-normal text-gray-400">{data.periods.current.from} — {data.periods.current.to}</div>
                                </th>
                                <th className={thClass}>
                                    Previous<div className="text-[10px] font-normal text-gray-400">{data.periods.previous.from} — {data.periods.previous.to}</div>
                                </th>
                                <th className={thClass}>
                                    Year Ago<div className="text-[10px] font-normal text-gray-400">{data.periods.year_ago.from} — {data.periods.year_ago.to}</div>
                                </th>
                                <th className={thClass}>vs Prev</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr className="bg-emerald-50">
                                <td colSpan={5} className="px-3 py-1.5 text-xs font-medium text-emerald-700">Revenue</td>
                            </tr>
                            {data.revenue.groups.map((g) => (
                                <>
                                    <tr key={g.group.id} className="bg-gray-50/50 border-b border-gray-100">
                                        <td className="px-3 py-1.5 font-semibold text-gray-700 text-xs">{g.group.name}</td>
                                        <td className="px-3 py-1.5 text-right font-semibold">{formatBDT(g.current, { locale })}</td>
                                        <td className="px-3 py-1.5 text-right text-gray-500">{formatBDT(g.previous, { locale })}</td>
                                        <td className="px-3 py-1.5 text-right text-gray-500">{formatBDT(g.year_ago, { locale })}</td>
                                        <td className="px-3 py-1.5 text-right">—</td>
                                    </tr>
                                    {g.accounts.map((a) => (
                                        <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                                            <td className="px-5 py-1.5 text-gray-600">{a.name}{a.code && <span className="ml-2 text-xs text-gray-400">{a.code}</span>}</td>
                                            <td className="px-3 py-1.5 text-right">{formatBDT(a.current, { locale })}</td>
                                            <td className="px-3 py-1.5 text-right text-gray-500">{formatBDT(a.previous, { locale })}</td>
                                            <td className="px-3 py-1.5 text-right text-gray-500">{formatBDT(a.year_ago, { locale })}</td>
                                            <td className="px-3 py-1.5 text-right"><VarianceBadge pct={a.variance_period_pct} /></td>
                                        </tr>
                                    ))}
                                </>
                            ))}
                            <tr className="bg-emerald-50 font-semibold border-y border-emerald-100">
                                <td className="px-3 py-2 text-xs">Total Revenue</td>
                                <td className="px-3 py-2 text-right text-emerald-800">{formatBDT(data.revenue.total.current, { locale })}</td>
                                <td className="px-3 py-2 text-right text-emerald-700">{formatBDT(data.revenue.total.previous, { locale })}</td>
                                <td className="px-3 py-2 text-right text-emerald-700">{formatBDT(data.revenue.total.year_ago, { locale })}</td>
                                <td className="px-3 py-2 text-right">—</td>
                            </tr>
                            <tr className="bg-rose-50">
                                <td colSpan={5} className="px-3 py-1.5 text-xs font-medium text-rose-700">Expenses</td>
                            </tr>
                            {data.expenses.groups.map((g) => (
                                <>
                                    <tr key={g.group.id} className="bg-gray-50/50 border-b border-gray-100">
                                        <td className="px-3 py-1.5 font-semibold text-gray-700 text-xs">{g.group.name}</td>
                                        <td className="px-3 py-1.5 text-right font-semibold">{formatBDT(g.current, { locale })}</td>
                                        <td className="px-3 py-1.5 text-right text-gray-500">{formatBDT(g.previous, { locale })}</td>
                                        <td className="px-3 py-1.5 text-right text-gray-500">{formatBDT(g.year_ago, { locale })}</td>
                                        <td className="px-3 py-1.5 text-right">—</td>
                                    </tr>
                                    {g.accounts.map((a) => (
                                        <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                                            <td className="px-5 py-1.5 text-gray-600">{a.name}{a.code && <span className="ml-2 text-xs text-gray-400">{a.code}</span>}</td>
                                            <td className="px-3 py-1.5 text-right">{formatBDT(a.current, { locale })}</td>
                                            <td className="px-3 py-1.5 text-right text-gray-500">{formatBDT(a.previous, { locale })}</td>
                                            <td className="px-3 py-1.5 text-right text-gray-500">{formatBDT(a.year_ago, { locale })}</td>
                                            <td className="px-3 py-1.5 text-right"><VarianceBadge pct={a.variance_period_pct} /></td>
                                        </tr>
                                    ))}
                                </>
                            ))}
                            <tr className="bg-rose-50 font-semibold border-y border-rose-100">
                                <td className="px-3 py-2 text-xs">Total Expenses</td>
                                <td className="px-3 py-2 text-right text-rose-800">{formatBDT(data.expenses.total.current, { locale })}</td>
                                <td className="px-3 py-2 text-right text-rose-700">{formatBDT(data.expenses.total.previous, { locale })}</td>
                                <td className="px-3 py-2 text-right text-rose-700">{formatBDT(data.expenses.total.year_ago, { locale })}</td>
                                <td className="px-3 py-2 text-right">—</td>
                            </tr>
                            <tr className="bg-blue-50 font-semibold border-t-2 border-blue-200">
                                <td className="px-3 py-3 text-blue-800">Net Profit</td>
                                <td className="px-3 py-3 text-right text-blue-900">{formatBDT(data.net_profit.current, { locale })}</td>
                                <td className="px-3 py-3 text-right text-blue-700">{formatBDT(data.net_profit.previous, { locale })}</td>
                                <td className="px-3 py-3 text-right text-blue-700">{formatBDT(data.net_profit.year_ago, { locale })}</td>
                                <td className="px-3 py-3 text-right">—</td>
                            </tr>
                        </tbody>
                    </table>
                </CompactSection>
            ) : null}
        </AccountingPageShell>
    );
}