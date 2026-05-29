'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';

interface AccountRow {
    id: string;
    name: string;
    code?: string | null;
    subgroup?: { name: string } | null;
    balance: number;
}

interface Group {
    group: { id: string; name: string };
    accounts: AccountRow[];
    total: number;
}

interface BSData {
    as_of: string;
    assets: { groups: Group[]; total: number };
    liabilities: { groups: Group[]; total: number };
    equity: { groups: Group[]; net_profit: number; total: number };
    total_liabilities_and_equity: number;
    is_balanced: boolean;
}

function BSSection({ groups, label, colorClass }: { groups: Group[]; label: string; colorClass: string }) {
    return (
        <div>
            <div className={`px-4 py-2 rounded-xl font-black text-xs uppercase tracking-widest ${colorClass} mb-2`}>
                {label}
            </div>
            {groups.map((g) => (
                <div key={g.group.id} className="mb-4">
                    <div className="flex justify-between items-center px-4 py-2 bg-gray-50 rounded-lg font-bold text-sm text-gray-700">
                        <span>{g.group.name}</span>
                        <span>{formatBDT(g.total)}</span>
                    </div>
                    {g.accounts.map((a) => (
                        <div key={a.id} className="flex justify-between items-center px-6 py-1.5 text-sm text-gray-600">
                            <span>{a.name}{a.code ? <span className="ml-2 text-xs text-gray-400">{a.code}</span> : null}</span>
                            <span>{formatBDT(a.balance)}</span>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

export default function BalanceSheetPage() {
    const [data, setData] = useState<BSData | null>(null);
    const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        void load();
    }, [asOfDate]);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await api.getBalanceSheet({ asOfDate: asOfDate || undefined });
            setData(result);
        } catch (err: any) {
            setError(err?.message ?? 'Failed to load report');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[900px] mx-auto space-y-6">
                <div>
                    <h1 className="text-2xl font-black tracking-tight">Balance Sheet</h1>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                        Assets, liabilities, and equity snapshot as of a date
                    </p>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-wrap gap-3 items-end">
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">As of Date</span>
                        <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                    </div>
                </div>

                {error && <div className="rounded-2xl bg-red-50 border border-red-100 p-4 text-sm text-red-700">{error}</div>}

                {loading ? (
                    <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center text-gray-400 text-sm font-medium">Loading…</div>
                ) : data ? (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-sm font-bold text-gray-500">
                            {data.is_balanced
                                ? <><CheckCircle className="w-4 h-4 text-emerald-500" /><span className="text-emerald-700">Balanced</span></>
                                : <><AlertCircle className="w-4 h-4 text-amber-500" /><span className="text-amber-700">Not balanced — check postings</span></>
                            }
                            <span className="ml-2">As of {data.as_of}</span>
                        </div>

                        <div className="grid md:grid-cols-2 gap-4">
                            <div className="bg-white border border-gray-100 rounded-2xl p-6 space-y-4">
                                <BSSection groups={data.assets.groups} label="Assets" colorClass="bg-sky-50 text-sky-700" />
                                <div className="flex justify-between items-center px-4 py-3 bg-sky-50 rounded-xl font-black text-sm text-sky-800 border border-sky-100">
                                    <span>Total Assets</span>
                                    <span>{formatBDT(data.assets.total)}</span>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="bg-white border border-gray-100 rounded-2xl p-6 space-y-4">
                                    <BSSection groups={data.liabilities.groups} label="Liabilities" colorClass="bg-rose-50 text-rose-700" />
                                    <div className="flex justify-between items-center px-4 py-3 bg-rose-50 rounded-xl font-black text-sm text-rose-800 border border-rose-100">
                                        <span>Total Liabilities</span>
                                        <span>{formatBDT(data.liabilities.total)}</span>
                                    </div>
                                </div>

                                <div className="bg-white border border-gray-100 rounded-2xl p-6 space-y-4">
                                    <BSSection groups={data.equity.groups} label="Equity" colorClass="bg-violet-50 text-violet-700" />
                                    <div className="flex justify-between items-center px-6 py-1.5 text-sm text-gray-600">
                                        <span>Current Period Net Profit</span>
                                        <span className={data.equity.net_profit >= 0 ? 'text-emerald-700 font-bold' : 'text-red-600 font-bold'}>
                                            {formatBDT(data.equity.net_profit)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center px-4 py-3 bg-violet-50 rounded-xl font-black text-sm text-violet-800 border border-violet-100">
                                        <span>Total Equity</span>
                                        <span>{formatBDT(data.equity.total)}</span>
                                    </div>
                                </div>

                                <div className="flex justify-between items-center px-5 py-4 bg-gray-900 text-white rounded-2xl font-black text-base">
                                    <span>Total Liabilities + Equity</span>
                                    <span>{formatBDT(data.total_liabilities_and_equity)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
