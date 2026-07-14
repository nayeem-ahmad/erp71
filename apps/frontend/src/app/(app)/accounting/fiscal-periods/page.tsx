'use client';

import { useEffect, useState } from 'react';
import { Lock, Unlock, AlertTriangle } from 'lucide-react';
import {
    AccountingPageShell,
    CompactSection,
} from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { compactDensity } from '@/lib/ui/compact-density';

interface FiscalPeriod {
    id: string;
    year: number;
    month: number;
    period_label: string;
    is_locked: boolean;
    locked_at: string | null;
}

export default function FiscalPeriodsPage() {
    const { t } = useI18n();
    const currentYear = new Date().getFullYear();
    const [year, setYear] = useState(currentYear);
    const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [working, setWorking] = useState<string | null>(null);

    useEffect(() => { void load(); }, [year]);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.getFiscalPeriods({ year });
            setPeriods(data);
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load fiscal periods');
        } finally {
            setLoading(false);
        }
    };

    const toggle = async (p: FiscalPeriod) => {
        const key = `${p.year}-${p.month}`;
        setWorking(key);
        try {
            if (p.is_locked) {
                await api.unlockFiscalPeriod({ year: p.year, month: p.month });
            } else {
                await api.lockFiscalPeriod({ year: p.year, month: p.month });
            }
            await load();
        } catch (e: any) {
            setError(e?.message ?? 'Action failed');
        } finally {
            setWorking(null);
        }
    };

    return (
        <AccountingPageShell maxWidth="narrow">
            <PageHeader
                title={t.fiscalPeriods.title}
                subtitle={t.fiscalPeriods.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.fiscalPeriods.title,
                    'accounting',
                )}
            />

            <CompactSection className="border-amber-100 bg-amber-50/50">
                <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-800">
                        Locking a period prevents any new vouchers from being posted with dates in that period. Only OWNER can unlock a period.
                    </p>
                </div>
            </CompactSection>

            <CompactSection>
                <div className="flex items-center gap-3">
                    <span className={compactDensity.formLabel}>Fiscal Year</span>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setYear((y) => y - 1)} className="w-7 h-7 rounded-lg bg-gray-100 font-semibold text-gray-600 hover:bg-gray-200 transition text-sm">−</button>
                        <span className="text-base font-bold w-14 text-center">{year}</span>
                        <button onClick={() => setYear((y) => y + 1)} className="w-7 h-7 rounded-lg bg-gray-100 font-semibold text-gray-600 hover:bg-gray-200 transition text-sm">+</button>
                    </div>
                </div>
            </CompactSection>

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            {loading ? (
                <CompactSection className="text-center text-gray-400 text-sm py-8">Loading…</CompactSection>
            ) : (
                <CompactSection className="!p-0 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-100">
                                <th className={`text-left px-3 py-2 ${compactDensity.formLabel}`}>Period</th>
                                <th className={`text-center px-3 py-2 ${compactDensity.formLabel}`}>Status</th>
                                <th className={`text-right px-3 py-2 ${compactDensity.formLabel}`}>Locked At</th>
                                <th className="px-3 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {periods.map((p) => {
                                const key = `${p.year}-${p.month}`;
                                const isBusy = working === key;
                                return (
                                    <tr key={p.id} className="border-b border-gray-50 last:border-0">
                                        <td className="px-3 py-2 font-semibold text-gray-800">{p.period_label}</td>
                                        <td className="px-3 py-2 text-center">
                                            {p.is_locked ? (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-danger-light px-2 py-0.5 text-xs font-semibold text-danger-text border border-red-100">
                                                    <Lock className="w-3 h-3" /> Locked
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-100">
                                                    <Unlock className="w-3 h-3" /> Open
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-right text-gray-400 text-xs">
                                            {p.locked_at ? new Date(p.locked_at).toLocaleDateString() : '—'}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <button
                                                onClick={() => toggle(p)}
                                                disabled={isBusy}
                                                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50 ${p.is_locked
                                                    ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                                    : 'bg-danger-light text-danger-text border border-red-100 hover:bg-danger-light'}`}
                                            >
                                                {isBusy ? '…' : p.is_locked ? 'Unlock' : 'Lock Period'}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </CompactSection>
            )}
        </AccountingPageShell>
    );
}