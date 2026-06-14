'use client';

import { useEffect, useState } from 'react';
import { Plus, Play } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

interface FixedAsset {
    id: string;
    asset_code: string;
    name: string;
    purchase_date: string;
    cost: number;
    residual_value: number;
    useful_life_months: number;
    depreciation_method: string;
    accumulated_depreciation: number;
    is_active: boolean;
}

export default function FixedAssetsPage() {
    const { t, locale } = useI18n();
    const [assets, setAssets] = useState<FixedAsset[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState({ assetCode: '', name: '', purchaseDate: '', cost: '', residualValue: '0', usefulLifeMonths: '60', depreciationMethod: 'STRAIGHT_LINE' });
    const [creating, setCreating] = useState(false);
    const [showRunDep, setShowRunDep] = useState(false);
    const [depYear, setDepYear] = useState(new Date().getFullYear());
    const [depMonth, setDepMonth] = useState(new Date().getMonth() + 1);
    const [runningDep, setRunningDep] = useState(false);
    const [depResult, setDepResult] = useState<string | null>(null);

    useEffect(() => { void load(); }, []);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.listFixedAssets();
            setAssets(Array.isArray(data) ? data : data.data ?? []);
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load');
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        setCreating(true);
        setError(null);
        try {
            await api.createFixedAsset({
                assetCode: form.assetCode,
                name: form.name,
                purchaseDate: form.purchaseDate,
                cost: parseFloat(form.cost),
                residualValue: parseFloat(form.residualValue) || 0,
                usefulLifeMonths: parseInt(form.usefulLifeMonths),
                depreciationMethod: form.depreciationMethod,
            });
            setShowCreate(false);
            setForm({ assetCode: '', name: '', purchaseDate: '', cost: '', residualValue: '0', usefulLifeMonths: '60', depreciationMethod: 'STRAIGHT_LINE' });
            await load();
        } catch (e: any) {
            setError(e?.message ?? 'Failed to create');
        } finally {
            setCreating(false);
        }
    };

    const handleRunDepreciation = async () => {
        setRunningDep(true);
        setDepResult(null);
        try {
            const result = await api.runDepreciation({ year: depYear, month: depMonth });
            setDepResult(`Depreciation posted: ${result.processed ?? 0} asset(s) processed.`);
            await load();
        } catch (e: any) {
            setDepResult(`Error: ${e?.message ?? 'Failed'}`);
        } finally {
            setRunningDep(false);
        }
    };

    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="w-full space-y-6">
                <div className="flex items-start justify-between flex-wrap gap-3">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">Fixed Asset Register</h1>
                        <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                            Track assets, useful life, and auto-generate depreciation journals
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => setShowRunDep(true)}
                            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 transition">
                            <Play className="w-4 h-4" /> Run Depreciation
                        </button>
                        <button onClick={() => setShowCreate(true)}
                            className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-gray-700 transition">
                            <Plus className="w-4 h-4" /> Add Asset
                        </button>
                    </div>
                </div>

                {error && <div className="rounded-2xl bg-red-50 border border-red-100 p-4 text-sm text-red-700">{error}</div>}

                {showRunDep && (
                    <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
                        <h2 className="font-black text-gray-900">Run Monthly Depreciation</h2>
                        <div className="flex gap-4 items-end flex-wrap">
                            <div>
                                <span className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Year</span>
                                <select value={depYear} onChange={(e) => setDepYear(Number(e.target.value))}
                                    className="bg-gray-50 border-none rounded-xl py-2.5 px-4 text-sm font-medium">
                                    {[depYear - 1, depYear, depYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
                                </select>
                            </div>
                            <div>
                                <span className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Month</span>
                                <select value={depMonth} onChange={(e) => setDepMonth(Number(e.target.value))}
                                    className="bg-gray-50 border-none rounded-xl py-2.5 px-4 text-sm font-medium">
                                    {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                                </select>
                            </div>
                            <button onClick={handleRunDepreciation} disabled={runningDep}
                                className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-gray-700 disabled:opacity-50 transition">
                                {runningDep ? 'Running…' : 'Run Now'}
                            </button>
                            <button onClick={() => { setShowRunDep(false); setDepResult(null); }}
                                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 transition">
                                Close
                            </button>
                        </div>
                        {depResult && (
                            <div className={`rounded-xl p-3 text-sm font-medium ${depResult.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                {depResult}
                            </div>
                        )}
                    </div>
                )}

                {showCreate && (
                    <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
                        <h2 className="font-black text-gray-900">Add Fixed Asset</h2>
                        <div className="grid grid-cols-2 gap-4">
                            {[
                                { label: 'Asset Code', key: 'assetCode', placeholder: 'e.g. FA-001' },
                                { label: 'Name', key: 'name', placeholder: 'e.g. Office Furniture' },
                                { label: 'Purchase Date', key: 'purchaseDate', type: 'date', placeholder: '' },
                                { label: 'Cost', key: 'cost', type: 'number', placeholder: '0.00' },
                                { label: 'Residual Value', key: 'residualValue', type: 'number', placeholder: '0.00' },
                                { label: 'Useful Life (months)', key: 'usefulLifeMonths', type: 'number', placeholder: '60' },
                            ].map(({ label, key, type, placeholder }) => (
                                <div key={key}>
                                    <span className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">{label}</span>
                                    <input type={type ?? 'text'} value={(form as any)[key]} placeholder={placeholder}
                                        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                                        className="w-full rounded-xl bg-gray-50 border-none py-2.5 px-4 text-sm" />
                                </div>
                            ))}
                        </div>
                        <div>
                            <span className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Method</span>
                            <select value={form.depreciationMethod} onChange={(e) => setForm((f) => ({ ...f, depreciationMethod: e.target.value }))}
                                className="rounded-xl bg-gray-50 border-none py-2.5 px-4 text-sm">
                                <option value="STRAIGHT_LINE">Straight Line</option>
                                <option value="DECLINING_BALANCE">Declining Balance</option>
                            </select>
                        </div>
                        <div className="flex gap-3">
                            <button onClick={() => setShowCreate(false)}
                                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 transition">Cancel</button>
                            <button onClick={handleCreate} disabled={creating}
                                className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-gray-700 disabled:opacity-50 transition">
                                {creating ? 'Saving…' : 'Save Asset'}
                            </button>
                        </div>
                    </div>
                )}

                {loading ? (
                    <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center text-gray-400 text-sm">Loading…</div>
                ) : assets.length === 0 ? (
                    <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center text-gray-400 text-sm">No assets yet. Add your first fixed asset.</div>
                ) : (
                    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100">
                                    {['Code', 'Name', 'Purchase Date', 'Cost', 'Accum. Dep.', 'Net Book Value', 'Method'].map((h) => (
                                        <th key={h} className="text-left px-4 py-3 text-xs font-black uppercase tracking-widest text-gray-400">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {assets.map((a) => (
                                    <tr key={a.id} className="border-b border-gray-50">
                                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{a.asset_code}</td>
                                        <td className="px-4 py-3 font-bold text-gray-800">{a.name}</td>
                                        <td className="px-4 py-3 text-gray-500">{new Date(a.purchase_date).toLocaleDateString()}</td>
                                        <td className="px-4 py-3">{formatBDT(Number(a.cost), { locale })}</td>
                                        <td className="px-4 py-3 text-rose-600">{formatBDT(Number(a.accumulated_depreciation), { locale })}</td>
                                        <td className="px-4 py-3 font-bold">{formatBDT(Number(a.cost) - Number(a.accumulated_depreciation), { locale })}</td>
                                        <td className="px-4 py-3 text-xs text-gray-400">{a.depreciation_method === 'STRAIGHT_LINE' ? 'SL' : 'DB'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
