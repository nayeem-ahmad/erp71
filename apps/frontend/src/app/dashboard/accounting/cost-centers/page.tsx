'use client';

import { useEffect, useState } from 'react';
import { Plus, Building2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

interface CostCenter { id: string; code: string; name: string; is_active: boolean; }

function defaultFrom() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function CostCentersPage() {
    const { t, locale } = useI18n();
    const [centers, setCenters] = useState<CostCenter[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [code, setCode] = useState('');
    const [name, setName] = useState('');
    const [creating, setCreating] = useState(false);
    const [selected, setSelected] = useState<CostCenter | null>(null);
    const [from, setFrom] = useState(defaultFrom());
    const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
    const [plData, setPlData] = useState<any>(null);
    const [plLoading, setPlLoading] = useState(false);

    useEffect(() => { void load(); }, []);
    useEffect(() => { if (selected) void loadPL(); }, [selected, from, to]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.listCostCenters();
            setCenters(Array.isArray(data) ? data : data.data ?? []);
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load');
        } finally {
            setLoading(false);
        }
    };

    const loadPL = async () => {
        if (!selected) return;
        setPlLoading(true);
        try {
            const data = await api.getCostCenterPL({ costCenterId: selected.id, from, to });
            setPlData(data);
        } catch { setPlData(null); }
        finally { setPlLoading(false); }
    };

    const handleCreate = async () => {
        if (!code || !name) return;
        setCreating(true);
        setError(null);
        try {
            await api.createCostCenter({ code, name });
            setCode(''); setName(''); setShowCreate(false);
            await load();
        } catch (e: any) {
            setError(e?.message ?? 'Failed to create');
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="w-full space-y-6">
                <div className="flex items-start justify-between">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">Cost Centers</h1>
                        <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                            Tag voucher lines by department or branch for segment P&L
                        </p>
                    </div>
                    <button onClick={() => setShowCreate(true)}
                        className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-gray-700 transition">
                        <Plus className="w-4 h-4" /> New Cost Center
                    </button>
                </div>

                {error && <div className="rounded-2xl bg-red-50 border border-red-100 p-4 text-sm text-red-700">{error}</div>}

                {showCreate && (
                    <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
                        <h2 className="font-black text-gray-900">New Cost Center</h2>
                        <div className="flex gap-4">
                            <div className="flex-1">
                                <span className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Code</span>
                                <input value={code} onChange={(e) => setCode(e.target.value)}
                                    placeholder="e.g. DEPT-01" className="w-full rounded-xl bg-gray-50 border-none py-2.5 px-4 text-sm" />
                            </div>
                            <div className="flex-[2]">
                                <span className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Name</span>
                                <input value={name} onChange={(e) => setName(e.target.value)}
                                    placeholder="e.g. Retail Operations" className="w-full rounded-xl bg-gray-50 border-none py-2.5 px-4 text-sm" />
                            </div>
                        </div>
                        <div className="flex gap-3">
                            <button onClick={() => setShowCreate(false)}
                                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 transition">
                                Cancel
                            </button>
                            <button onClick={handleCreate} disabled={creating || !code || !name}
                                className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-gray-700 disabled:opacity-50 transition">
                                {creating ? 'Creating…' : 'Create'}
                            </button>
                        </div>
                    </div>
                )}

                <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
                    <div className="space-y-2">
                        {loading ? (
                            <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center text-gray-400 text-sm">Loading…</div>
                        ) : centers.length === 0 ? (
                            <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center text-gray-400 text-sm">
                                No cost centers yet.
                            </div>
                        ) : centers.map((c) => (
                            <button key={c.id} onClick={() => setSelected(c)}
                                className={`w-full text-left rounded-2xl border p-4 transition ${selected?.id === c.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-100 hover:border-gray-200'}`}>
                                <div className="flex items-center gap-3">
                                    <Building2 className="w-4 h-4 shrink-0" />
                                    <div>
                                        <div className="font-bold text-sm">{c.name}</div>
                                        <div className={`text-xs ${selected?.id === c.id ? 'text-gray-300' : 'text-gray-400'}`}>{c.code}</div>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>

                    <div>
                        {!selected ? (
                            <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center text-gray-400 text-sm">
                                Select a cost center to view its P&L
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="bg-white border border-gray-100 rounded-2xl p-4 flex gap-4 items-end flex-wrap">
                                    <div>
                                        <span className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">From</span>
                                        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                                            className="bg-gray-50 border-none rounded-xl py-2.5 px-4 text-sm font-medium" />
                                    </div>
                                    <div>
                                        <span className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">To</span>
                                        <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                                            className="bg-gray-50 border-none rounded-xl py-2.5 px-4 text-sm font-medium" />
                                    </div>
                                </div>

                                {plLoading ? (
                                    <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center text-gray-400 text-sm">Loading…</div>
                                ) : plData ? (
                                    <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
                                        <h3 className="font-black text-gray-900">{selected.name} — P&L</h3>
                                        {['revenue', 'expenses'].map((section) => (
                                            <div key={section}>
                                                <div className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-widest mb-2 ${section === 'revenue' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                                                    {section}
                                                </div>
                                                {plData[section]?.groups?.map((g: any) => (
                                                    <div key={g.group.id} className="mb-3">
                                                        <div className="flex justify-between px-3 py-1.5 bg-gray-50 rounded-lg text-sm font-bold text-gray-700">
                                                            <span>{g.group.name}</span>
                                                            <span>{formatBDT(g.total, { locale })}</span>
                                                        </div>
                                                        {g.accounts.map((a: any) => (
                                                            <div key={a.id} className="flex justify-between px-5 py-1 text-sm text-gray-500">
                                                                <span>{a.name}</span>
                                                                <span>{formatBDT(a.balance, { locale })}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                        <div className={`flex justify-between px-4 py-3 rounded-2xl font-black text-sm border ${plData.net_profit >= 0 ? 'bg-blue-50 text-blue-800 border-blue-100' : 'bg-red-50 text-red-800 border-red-100'}`}>
                                            <span>{plData.net_profit >= 0 ? 'Net Profit' : 'Net Loss'}</span>
                                            <span>{formatBDT(Math.abs(plData.net_profit))}</span>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
