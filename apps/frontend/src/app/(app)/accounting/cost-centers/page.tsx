'use client';

import { useEffect, useState } from 'react';
import { Plus, Building2 } from 'lucide-react';
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
        <AccountingPageShell>
            <PageHeader
                title={t.costCenters.title}
                subtitle={t.costCenters.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.costCenters.title,
                    'accounting',
                )}
                actions={(
                    <button onClick={() => setShowCreate(true)} className={`${compactDensity.btnPrimary} bg-gray-900 text-white hover:bg-gray-700`}>
                        <Plus className="w-3.5 h-3.5" /> New Cost Center
                    </button>
                )}
            />

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            {showCreate && (
                <CompactSection title="New Cost Center">
                    <div className="flex gap-3">
                        <label className="flex-1 block">
                            <span className={`${compactDensity.formLabel} block mb-1`}>Code</span>
                            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. DEPT-01" className={compactDensity.formField} />
                        </label>
                        <label className="flex-[2] block">
                            <span className={`${compactDensity.formLabel} block mb-1`}>Name</span>
                            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Retail Operations" className={compactDensity.formField} />
                        </label>
                    </div>
                    <div className="flex gap-2 mt-3">
                        <button onClick={() => setShowCreate(false)} className={compactDensity.btnSecondary}>Cancel</button>
                        <button onClick={handleCreate} disabled={creating || !code || !name} className={`${compactDensity.btnPrimary} bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50`}>
                            {creating ? 'Creating…' : 'Create'}
                        </button>
                    </div>
                </CompactSection>
            )}

            <div className="grid gap-3 lg:grid-cols-[240px_1fr]">
                <div className="space-y-2">
                    {loading ? (
                        <CompactSection className="text-center text-gray-400 text-sm py-6">Loading…</CompactSection>
                    ) : centers.length === 0 ? (
                        <CompactSection className="text-center text-gray-400 text-sm py-6">No cost centers yet.</CompactSection>
                    ) : centers.map((c) => (
                        <button key={c.id} onClick={() => setSelected(c)}
                            className={`w-full text-left rounded-lg border p-3 transition ${selected?.id === c.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-100 hover:border-gray-200'}`}>
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
                        <CompactSection className="text-center text-gray-400 text-sm py-8">Select a cost center to view its P&L</CompactSection>
                    ) : (
                        <div className="space-y-3">
                            <CompactSection flat>
                                <div className={`${compactDensity.filterBar} !p-0 !border-0 !bg-transparent`}>
                                    <label className="block">
                                        <span className={`${compactDensity.formLabel} block mb-1`}>From</span>
                                        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={compactDensity.formField} />
                                    </label>
                                    <label className="block">
                                        <span className={`${compactDensity.formLabel} block mb-1`}>To</span>
                                        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={compactDensity.formField} />
                                    </label>
                                </div>
                            </CompactSection>

                            {plLoading ? (
                                <CompactSection className="text-center text-gray-400 text-sm py-6">Loading…</CompactSection>
                            ) : plData ? (
                                <CompactSection title={`${selected.name} — P&L`}>
                                        {['revenue', 'expenses'].map((section) => (
                                            <div key={section}>
                                                <div className={`px-3 py-1.5 rounded-xl text-xs font-semibold mb-2 ${section === 'revenue' ? 'bg-emerald-50 text-emerald-700' : 'bg-danger-light text-danger-text'}`}>
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
                                    <div className={`flex justify-between px-3 py-2 rounded-lg font-semibold text-sm border ${plData.net_profit >= 0 ? 'bg-blue-50 text-blue-800 border-blue-100' : 'bg-red-50 text-red-800 border-red-100'}`}>
                                        <span>{plData.net_profit >= 0 ? 'Net Profit' : 'Net Loss'}</span>
                                        <span>{formatBDT(Math.abs(plData.net_profit))}</span>
                                    </div>
                                </CompactSection>
                            ) : null}
                        </div>
                    )}
                </div>
            </div>
        </AccountingPageShell>
    );
}
