'use client';

import { useEffect, useState } from 'react';
import {
    AccountingPageShell,
    AccountingToolbar,
    CompactSection,
} from '@/components/accounting/compact';
import { compactDensity } from '@/lib/ui/compact-density';
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

const thClass = `text-right px-3 py-2 ${compactDensity.formLabel}`;
const thLeftClass = `text-left px-3 py-2 ${compactDensity.formLabel}`;

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
        <AccountingPageShell maxWidth="full">
            <AccountingToolbar subtitle="Compare planned budget against actual account activity">
                <div className={compactDensity.filterBar}>
                    <div className="flex flex-col gap-1">
                        <span className={compactDensity.formLabel}>Fiscal Year</span>
                        <select value={fiscalYear} onChange={(e) => setFiscalYear(Number(e.target.value))}
                            className={compactDensity.formField}>
                            {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                                <option key={y} value={y}>{y}</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className={compactDensity.formLabel}>Month (optional)</span>
                        <select value={month} onChange={(e) => setMonth(e.target.value === '' ? '' : Number(e.target.value))}
                            className={compactDensity.formField}>
                            <option value="">Full Year</option>
                            {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => (
                                <option key={i + 1} value={i + 1}>{m}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </AccountingToolbar>

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            {loading ? (
                <CompactSection className="py-8 text-center text-gray-400 text-sm font-medium">Loading…</CompactSection>
            ) : data && data.rows.length === 0 ? (
                <CompactSection className="py-6 text-center text-gray-400 text-sm">
                    No budget entries found for this period. Set budgets per account to use this report.
                </CompactSection>
            ) : data ? (
                <CompactSection className="p-0 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-100">
                                <th className={thLeftClass}>Account</th>
                                <th className={thLeftClass}>Type</th>
                                <th className={thClass}>Budget</th>
                                <th className={thClass}>Actual</th>
                                <th className={thClass}>Variance</th>
                                <th className={thClass}>Var %</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.rows.map((row) => (
                                <tr key={row.account.id} className="border-b border-gray-50">
                                    <td className="px-3 py-2 font-medium text-gray-800">
                                        {row.account.name}
                                        {row.account.code && <span className="ml-2 text-xs text-gray-400">{row.account.code}</span>}
                                    </td>
                                    <td className="px-3 py-2 text-gray-400 text-xs capitalize">{row.account.type.toLowerCase()}</td>
                                    <td className="px-3 py-2 text-right">{formatBDT(row.budget, { locale })}</td>
                                    <td className="px-3 py-2 text-right">{formatBDT(row.actual, { locale })}</td>
                                    <td className={`px-3 py-2 text-right font-semibold ${varianceColor(row)}`}>
                                        {row.variance >= 0 ? '+' : ''}{formatBDT(row.variance, { locale })}
                                    </td>
                                    <td className={`px-3 py-2 text-right font-semibold ${varianceColor(row)}`}>
                                        {row.variance_pct !== null ? `${row.variance_pct >= 0 ? '+' : ''}${row.variance_pct.toFixed(1)}%` : '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="border-t border-gray-200 bg-gray-50">
                                <td className="px-3 py-2 font-semibold text-sm text-gray-700" colSpan={2}>Totals</td>
                                <td className="px-3 py-2 text-right font-semibold text-sm">{formatBDT(data.totals.budget, { locale })}</td>
                                <td className="px-3 py-2 text-right font-semibold text-sm">{formatBDT(data.totals.actual, { locale })}</td>
                                <td className={`px-3 py-2 text-right font-semibold text-sm ${data.totals.variance >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                    {data.totals.variance >= 0 ? '+' : ''}{formatBDT(data.totals.variance, { locale })}
                                </td>
                                <td />
                            </tr>
                        </tfoot>
                    </table>
                </CompactSection>
            ) : null}
        </AccountingPageShell>
    );
}