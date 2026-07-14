'use client';

import { useEffect, useState } from 'react';
import { Plus, Play } from 'lucide-react';
import {
    AccountingPageShell,
    CompactSection,
} from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { compactDensity } from '@/lib/ui/compact-density';

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
        <AccountingPageShell>
            <PageHeader
                title={t.fixedAssets.title}
                subtitle={t.fixedAssets.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.fixedAssets.title,
                    'accounting',
                )}
                actions={(
                    <>
                        <button onClick={() => setShowRunDep(true)} className={compactDensity.btnSecondary}>
                            <Play className="w-3.5 h-3.5" /> Run Depreciation
                        </button>
                        <button onClick={() => setShowCreate(true)} className={`${compactDensity.btnPrimary} bg-gray-900 text-white hover:bg-gray-700`}>
                            <Plus className="w-3.5 h-3.5" /> Add Asset
                        </button>
                    </>
                )}
            />

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            {showRunDep && (
                <CompactSection title="Run Monthly Depreciation">
                    <div className="flex gap-3 items-end flex-wrap">
                        <label className="block">
                            <span className={`${compactDensity.formLabel} block mb-1`}>Year</span>
                            <select value={depYear} onChange={(e) => setDepYear(Number(e.target.value))} className={compactDensity.formField}>
                                {[depYear - 1, depYear, depYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
                            </select>
                        </label>
                        <label className="block">
                            <span className={`${compactDensity.formLabel} block mb-1`}>Month</span>
                            <select value={depMonth} onChange={(e) => setDepMonth(Number(e.target.value))} className={compactDensity.formField}>
                                {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                            </select>
                        </label>
                        <button onClick={handleRunDepreciation} disabled={runningDep} className={`${compactDensity.btnPrimary} bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50`}>
                            {runningDep ? 'Running…' : 'Run Now'}
                        </button>
                        <button onClick={() => { setShowRunDep(false); setDepResult(null); }} className={compactDensity.btnSecondary}>Close</button>
                    </div>
                    {depResult && (
                        <div className={`rounded-lg p-2 text-xs mt-2 ${depResult.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                            {depResult}
                        </div>
                    )}
                </CompactSection>
            )}

            {showCreate && (
                <CompactSection title="Add Fixed Asset">
                    <div className={`grid grid-cols-2 gap-3 ${compactDensity.formStack}`}>
                        {[
                            { label: 'Asset Code', key: 'assetCode', placeholder: 'e.g. FA-001' },
                            { label: 'Name', key: 'name', placeholder: 'e.g. Office Furniture' },
                            { label: 'Purchase Date', key: 'purchaseDate', type: 'date', placeholder: '' },
                            { label: 'Cost', key: 'cost', type: 'number', placeholder: '0.00' },
                            { label: 'Residual Value', key: 'residualValue', type: 'number', placeholder: '0.00' },
                            { label: 'Useful Life (months)', key: 'usefulLifeMonths', type: 'number', placeholder: '60' },
                        ].map(({ label, key, type, placeholder }) => (
                            <label key={key} className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{label}</span>
                                <input type={type ?? 'text'} value={(form as any)[key]} placeholder={placeholder}
                                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                                    className={compactDensity.formField} />
                            </label>
                        ))}
                    </div>
                    <label className="block mt-3">
                        <span className={`${compactDensity.formLabel} block mb-1`}>Method</span>
                        <select value={form.depreciationMethod} onChange={(e) => setForm((f) => ({ ...f, depreciationMethod: e.target.value }))} className={compactDensity.formField}>
                            <option value="STRAIGHT_LINE">Straight Line</option>
                            <option value="DECLINING_BALANCE">Declining Balance</option>
                        </select>
                    </label>
                    <div className="flex gap-2 mt-3">
                        <button onClick={() => setShowCreate(false)} className={compactDensity.btnSecondary}>Cancel</button>
                        <button onClick={handleCreate} disabled={creating} className={`${compactDensity.btnPrimary} bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50`}>
                            {creating ? 'Saving…' : 'Save Asset'}
                        </button>
                    </div>
                </CompactSection>
            )}

            {loading ? (
                <CompactSection className="text-center text-gray-400 text-sm py-8">Loading…</CompactSection>
            ) : assets.length === 0 ? (
                <CompactSection className="text-center text-gray-400 text-sm py-6">No assets yet. Add your first fixed asset.</CompactSection>
            ) : (
                <CompactSection className="!p-0 overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100">
                                    {['Code', 'Name', 'Purchase Date', 'Cost', 'Accum. Dep.', 'Net Book Value', 'Method'].map((h) => (
                                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-400">{h}</th>
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
                                        <td className="px-4 py-3 text-danger">{formatBDT(Number(a.accumulated_depreciation), { locale })}</td>
                                        <td className="px-4 py-3 font-bold">{formatBDT(Number(a.cost) - Number(a.accumulated_depreciation), { locale })}</td>
                                        <td className="px-4 py-3 text-xs text-gray-400">{a.depreciation_method === 'STRAIGHT_LINE' ? 'SL' : 'DB'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                </CompactSection>
            )}
        </AccountingPageShell>
    );
}
