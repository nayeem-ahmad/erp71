'use client';

import { useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';

function defaultFrom() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function defaultTo() {
    return new Date().toISOString().slice(0, 10);
}

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

interface PLData {
    filters: { from: string; to: string };
    revenue: { groups: Group[]; total: number };
    expenses: { groups: Group[]; total: number };
    net_profit: number;
}

function AccountSection({ groups, label, colorClass }: { groups: Group[]; label: string; colorClass: string }) {
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

export default function ProfitLossPage() {
    const [data, setData] = useState<PLData | null>(null);
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(defaultTo());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        void load();
    }, [fromDate, toDate]);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await api.getProfitLoss({ from: fromDate || undefined, to: toDate || undefined });
            setData(result);
        } catch (err: any) {
            setError(err?.message ?? 'Failed to load report');
        } finally {
            setLoading(false);
        }
    };

    const isProfit = (data?.net_profit ?? 0) >= 0;

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[900px] mx-auto space-y-6">
                <div>
                    <h1 className="text-2xl font-black tracking-tight">Profit & Loss Account</h1>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                        Income statement — revenue, expenses, and net profit for a period
                    </p>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-wrap gap-3 items-end">
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">From</span>
                        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">To</span>
                        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                    </div>
                </div>

                {error && <div className="rounded-2xl bg-red-50 border border-red-100 p-4 text-sm text-red-700">{error}</div>}

                {loading ? (
                    <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center text-gray-400 text-sm font-medium">
                        Loading…
                    </div>
                ) : data ? (
                    <div className="bg-white border border-gray-100 rounded-2xl p-6 space-y-6">
                        <div className="text-center border-b border-gray-100 pb-4">
                            <p className="text-xs font-black uppercase tracking-widest text-gray-400">Period</p>
                            <p className="text-sm font-bold text-gray-700 mt-1">{data.filters.from} — {data.filters.to}</p>
                        </div>

                        <AccountSection groups={data.revenue.groups} label="Revenue" colorClass="bg-emerald-50 text-emerald-700" />

                        <div className="flex justify-between items-center px-4 py-3 bg-emerald-50 rounded-xl font-black text-sm text-emerald-800 border border-emerald-100">
                            <span>Total Revenue</span>
                            <span>{formatBDT(data.revenue.total)}</span>
                        </div>

                        <AccountSection groups={data.expenses.groups} label="Expenses" colorClass="bg-rose-50 text-rose-700" />

                        <div className="flex justify-between items-center px-4 py-3 bg-rose-50 rounded-xl font-black text-sm text-rose-800 border border-rose-100">
                            <span>Total Expenses</span>
                            <span>{formatBDT(data.expenses.total)}</span>
                        </div>

                        <div className={`flex justify-between items-center px-5 py-4 rounded-2xl font-black text-base border ${isProfit ? 'bg-blue-50 text-blue-800 border-blue-200' : 'bg-red-50 text-red-800 border-red-200'}`}>
                            <div className="flex items-center gap-2">
                                <TrendingUp className="w-5 h-5" />
                                <span>{isProfit ? 'Net Profit' : 'Net Loss'}</span>
                            </div>
                            <span>{formatBDT(Math.abs(data.net_profit))}</span>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
