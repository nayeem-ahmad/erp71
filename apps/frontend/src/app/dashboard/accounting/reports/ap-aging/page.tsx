'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

function defaultToday() { return new Date().toISOString().slice(0, 10); }

interface AgingAccount {
    id: string; name: string; code?: string | null; type: string;
    balance: number; balance_side: string;
    buckets: { current: number; overdue_31_60: number; overdue_61_90: number; overdue_90_plus: number };
}
interface AgingData {
    as_of: string;
    accounts: AgingAccount[];
    totals: { balance: number; current: number; overdue_31_60: number; overdue_61_90: number; overdue_90_plus: number };
    note: string;
}

export default function ApAgingPage() {
    const { t, locale } = useI18n();
    const [data, setData] = useState<AgingData | null>(null);
    const [asOfDate, setAsOfDate] = useState(defaultToday());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => { void load(); }, [asOfDate]);

    const load = async () => {
        setLoading(true); setError(null);
        try {
            const result = await (api as any).getApAging({ asOfDate: asOfDate || undefined });
            setData(result);
        } catch (err: any) { setError(err?.message ?? 'Failed to load'); }
        finally { setLoading(false); }
    };

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="w-full space-y-6">
                <div>
                    <h1 className="text-2xl font-black tracking-tight">AP Aging Report</h1>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">Accounts payable by age bucket</p>
                </div>
                <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-wrap gap-3 items-end">
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">As Of Date</span>
                        <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                    </div>
                </div>
                {error && <div className="rounded-2xl bg-red-50 border border-red-100 p-4 text-sm text-red-700">{error}</div>}
                {loading ? (
                    <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center text-gray-400 text-sm font-medium">Loading…</div>
                ) : data ? (
                    <>
                        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-gray-50 border-b border-gray-100">
                                        <th className="text-left px-4 py-3 font-black text-xs uppercase tracking-widest text-gray-500">Account</th>
                                        <th className="text-right px-4 py-3 font-black text-xs uppercase tracking-widest text-gray-500">Balance</th>
                                        <th className="text-right px-4 py-3 font-black text-xs uppercase tracking-widest text-gray-500">Current (0-30d)</th>
                                        <th className="text-right px-4 py-3 font-black text-xs uppercase tracking-widest text-gray-500">31-60 Days</th>
                                        <th className="text-right px-4 py-3 font-black text-xs uppercase tracking-widest text-gray-500">61-90 Days</th>
                                        <th className="text-right px-4 py-3 font-black text-xs uppercase tracking-widest text-gray-500">90+ Days</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.accounts.map((a) => (
                                        <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                                            <td className="px-4 py-2.5 font-medium text-gray-800">{a.name}{a.code && <span className="ml-2 text-xs text-gray-400">{a.code}</span>}</td>
                                            <td className="px-4 py-2.5 text-right">{formatBDT(a.balance, { locale })}</td>
                                            <td className="px-4 py-2.5 text-right">{formatBDT(a.buckets.current, { locale })}</td>
                                            <td className="px-4 py-2.5 text-right text-amber-700">{formatBDT(a.buckets.overdue_31_60, { locale })}</td>
                                            <td className="px-4 py-2.5 text-right text-orange-700">{formatBDT(a.buckets.overdue_61_90, { locale })}</td>
                                            <td className="px-4 py-2.5 text-right text-red-700">{formatBDT(a.buckets.overdue_90_plus, { locale })}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-gray-50 font-black border-t border-gray-200">
                                        <td className="px-4 py-3 text-xs uppercase tracking-widest">Totals</td>
                                        <td className="px-4 py-3 text-right">{formatBDT(data.totals.balance, { locale })}</td>
                                        <td className="px-4 py-3 text-right">{formatBDT(data.totals.current, { locale })}</td>
                                        <td className="px-4 py-3 text-right text-amber-700">{formatBDT(data.totals.overdue_31_60, { locale })}</td>
                                        <td className="px-4 py-3 text-right text-orange-700">{formatBDT(data.totals.overdue_61_90, { locale })}</td>
                                        <td className="px-4 py-3 text-right text-red-700">{formatBDT(data.totals.overdue_90_plus, { locale })}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                        <p className="text-xs text-gray-400 italic">{data.note}</p>
                    </>
                ) : null}
            </div>
        </div>
    );
}
