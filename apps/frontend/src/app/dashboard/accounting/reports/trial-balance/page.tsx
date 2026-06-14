'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

function defaultToday() {
    return new Date().toISOString().slice(0, 10);
}

interface TBRow {
    account: { id: string; name: string; code?: string | null; type: string; group: { name: string }; subgroup?: { name: string } | null };
    debit_total: number;
    credit_total: number;
    closing_balance: number;
    closing_balance_side: string;
    debit_balance: number;
    credit_balance: number;
}

interface TBData {
    as_of: string;
    rows: TBRow[];
    totals: { debit: number; credit: number };
    is_balanced: boolean;
}

export default function TrialBalancePage() {
    const { t, locale } = useI18n();
    const [data, setData] = useState<TBData | null>(null);
    const [asOfDate, setAsOfDate] = useState(defaultToday());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => { void load(); }, [asOfDate]);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await (api as any).getTrialBalance({ asOfDate: asOfDate || undefined });
            setData(result);
        } catch (err: any) {
            setError(err?.message ?? 'Failed to load report');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="w-full space-y-6">
                <div>
                    <h1 className="text-2xl font-black tracking-tight">Trial Balance</h1>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                        All accounts with debit and credit balances as of a date
                    </p>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-wrap gap-3 items-end">
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">As Of Date</span>
                        <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                    </div>
                    {data && (
                        <span className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-widest ${data.is_balanced ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                            {data.is_balanced ? 'Balanced' : 'Unbalanced'}
                        </span>
                    )}
                </div>

                {error && <div className="rounded-2xl bg-red-50 border border-red-100 p-4 text-sm text-red-700">{error}</div>}

                {loading ? (
                    <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center text-gray-400 text-sm font-medium">Loading…</div>
                ) : data ? (
                    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-gray-50 border-b border-gray-100">
                                    <th className="text-left px-4 py-3 font-black text-xs uppercase tracking-widest text-gray-500">Account</th>
                                    <th className="text-left px-4 py-3 font-black text-xs uppercase tracking-widest text-gray-500">Type</th>
                                    <th className="text-right px-4 py-3 font-black text-xs uppercase tracking-widest text-gray-500">Gross Debit</th>
                                    <th className="text-right px-4 py-3 font-black text-xs uppercase tracking-widest text-gray-500">Gross Credit</th>
                                    <th className="text-right px-4 py-3 font-black text-xs uppercase tracking-widest text-gray-500">Debit Balance</th>
                                    <th className="text-right px-4 py-3 font-black text-xs uppercase tracking-widest text-gray-500">Credit Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.map((row) => (
                                    <tr key={row.account.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                                        <td className="px-4 py-2.5">
                                            <span className="font-medium text-gray-800">{row.account.name}</span>
                                            {row.account.code && <span className="ml-2 text-xs text-gray-400">{row.account.code}</span>}
                                            <div className="text-xs text-gray-400">{row.account.group.name}</div>
                                        </td>
                                        <td className="px-4 py-2.5 text-xs text-gray-500">{row.account.type}</td>
                                        <td className="px-4 py-2.5 text-right text-gray-700">{formatBDT(row.debit_total, { locale })}</td>
                                        <td className="px-4 py-2.5 text-right text-gray-700">{formatBDT(row.credit_total, { locale })}</td>
                                        <td className="px-4 py-2.5 text-right font-medium text-gray-800">{row.debit_balance > 0 ? formatBDT(row.debit_balance, { locale }) : '—'}</td>
                                        <td className="px-4 py-2.5 text-right font-medium text-gray-800">{row.credit_balance > 0 ? formatBDT(row.credit_balance, { locale }) : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="bg-gray-50 font-black border-t border-gray-200">
                                    <td className="px-4 py-3 text-xs uppercase tracking-widest" colSpan={4}>Grand Totals</td>
                                    <td className="px-4 py-3 text-right text-gray-900">{formatBDT(data.totals.debit, { locale })}</td>
                                    <td className="px-4 py-3 text-right text-gray-900">{formatBDT(data.totals.credit, { locale })}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
