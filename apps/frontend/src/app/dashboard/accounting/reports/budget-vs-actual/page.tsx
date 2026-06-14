'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

interface BudgetRow {
    account: { id: string; name: string; code?: string | null; type: string };
    budget: number;
    actual: number;
    variance: number;
    variance_pct: number | null;
}

interface BudgetVsActualData {
    filters: { fiscalYear: number; month: number | null };
    rows: BudgetRow[];
    totals: { budget: number; actual: number; variance: number };
}

function varianceColor(row: BudgetRow) {
    if (row.account.type === 'EXPENSE') {
        return row.variance >= 0 ? 'text-emerald-700' : 'text-rose-700';
    }
    return row.variance >= 0 ? 'text-emerald-700' : 'text-rose-700';
}

export default function BudgetVsActualPage() {
    const { t, locale } = useI18n();
    const currentYear = new Date().getFullYear();
    const [fiscalYear, setFiscalYear] = useState(currentYear);
    const [month, setMonth] = useState<number | ''>('');
    const [data, setData] = useState<BudgetVsActualData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => { void load(); }, [fiscalYear, month]);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await api.getBudgetVsActual({ fiscalYear, month: month !== '' ? month : undefined });
            setData(result);
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load report');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="w-full space-y-6">
                <div>
                    <h1 className="text-2xl font-black tracking-tight">Budget vs. Actual</h1>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                        Compare planned budget against actual account activity
                    </p>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-wrap gap-4 items-end">
                    <div>
                        <span className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Fiscal Year</span>
                        <select value={fiscalYear} onChange={(e) => setFiscalYear(Number(e.target.value))}
                            className="bg-gray-50 border-none rounded-xl py-2.5 px-4 text-sm font-medium">
                            {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                                <option key={y} value={y}>{y}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <span className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Month (optional)</span>
                        <select value={month} onChange={(e) => setMonth(e.target.value === '' ? '' : Number(e.target.value))}
                            className="bg-gray-50 border-none rounded-xl py-2.5 px-4 text-sm font-medium">
                            <option value="">Full Year</option>
                            {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => (
                                <option key={i + 1} value={i + 1}>{m}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {error && <div className="rounded-2xl bg-red-50 border border-red-100 p-4 text-sm text-red-700">{error}</div>}

                {loading ? (
                    <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center text-gray-400 text-sm font-medium">Loading…</div>
                ) : data && data.rows.length === 0 ? (
                    <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center text-gray-400 text-sm">
                        No budget entries found for this period. Set budgets per account to use this report.
                    </div>
                ) : data ? (
                    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100">
                                    <th className="text-left px-5 py-3 text-xs font-black uppercase tracking-widest text-gray-400">Account</th>
                                    <th className="text-left px-5 py-3 text-xs font-black uppercase tracking-widest text-gray-400">Type</th>
                                    <th className="text-right px-5 py-3 text-xs font-black uppercase tracking-widest text-gray-400">Budget</th>
                                    <th className="text-right px-5 py-3 text-xs font-black uppercase tracking-widest text-gray-400">Actual</th>
                                    <th className="text-right px-5 py-3 text-xs font-black uppercase tracking-widest text-gray-400">Variance</th>
                                    <th className="text-right px-5 py-3 text-xs font-black uppercase tracking-widest text-gray-400">Var %</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.map((row) => (
                                    <tr key={row.account.id} className="border-b border-gray-50">
                                        <td className="px-5 py-3 font-medium text-gray-800">
                                            {row.account.name}
                                            {row.account.code && <span className="ml-2 text-xs text-gray-400">{row.account.code}</span>}
                                        </td>
                                        <td className="px-5 py-3 text-gray-400 text-xs capitalize">{row.account.type.toLowerCase()}</td>
                                        <td className="px-5 py-3 text-right">{formatBDT(row.budget, { locale })}</td>
                                        <td className="px-5 py-3 text-right">{formatBDT(row.actual, { locale })}</td>
                                        <td className={`px-5 py-3 text-right font-bold ${varianceColor(row)}`}>
                                            {row.variance >= 0 ? '+' : ''}{formatBDT(row.variance, { locale })}
                                        </td>
                                        <td className={`px-5 py-3 text-right font-bold ${varianceColor(row)}`}>
                                            {row.variance_pct !== null ? `${row.variance_pct >= 0 ? '+' : ''}${row.variance_pct.toFixed(1)}%` : '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="border-t border-gray-200 bg-gray-50">
                                    <td className="px-5 py-3 font-black text-sm text-gray-700" colSpan={2}>Totals</td>
                                    <td className="px-5 py-3 text-right font-black text-sm">{formatBDT(data.totals.budget, { locale })}</td>
                                    <td className="px-5 py-3 text-right font-black text-sm">{formatBDT(data.totals.actual, { locale })}</td>
                                    <td className={`px-5 py-3 text-right font-black text-sm ${data.totals.variance >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                        {data.totals.variance >= 0 ? '+' : ''}{formatBDT(data.totals.variance, { locale })}
                                    </td>
                                    <td />
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
