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

const thClass = `text-right px-3 py-2 ${compactDensity.formLabel}`;
const thLeftClass = `text-left px-3 py-2 ${compactDensity.formLabel}`;

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
        <AccountingPageShell maxWidth="full">
            <AccountingToolbar subtitle="All accounts with debit and credit balances as of a date">
                <div className={compactDensity.filterBar}>
                    <div className="flex flex-col gap-1">
                        <span className={compactDensity.formLabel}>As Of Date</span>
                        <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)}
                            className={compactDensity.formField} />
                    </div>
                    {data && (
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${data.is_balanced ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                            {data.is_balanced ? 'Balanced' : 'Unbalanced'}
                        </span>
                    )}
                </div>
            </AccountingToolbar>

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            {loading ? (
                <CompactSection className="py-8 text-center text-gray-400 text-sm font-medium">Loading…</CompactSection>
            ) : data ? (
                <CompactSection className="p-0 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-gray-50 border-b border-gray-100">
                                <th className={thLeftClass}>Account</th>
                                <th className={thLeftClass}>Type</th>
                                <th className={thClass}>Gross Debit</th>
                                <th className={thClass}>Gross Credit</th>
                                <th className={thClass}>Debit Balance</th>
                                <th className={thClass}>Credit Balance</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.rows.map((row) => (
                                <tr key={row.account.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                                    <td className="px-3 py-2">
                                        <span className="font-medium text-gray-800">{row.account.name}</span>
                                        {row.account.code && <span className="ml-2 text-xs text-gray-400">{row.account.code}</span>}
                                        <div className="text-xs text-gray-400">{row.account.group.name}</div>
                                    </td>
                                    <td className="px-3 py-2 text-xs text-gray-500">{row.account.type}</td>
                                    <td className="px-3 py-2 text-right text-gray-700">{formatBDT(row.debit_total, { locale })}</td>
                                    <td className="px-3 py-2 text-right text-gray-700">{formatBDT(row.credit_total, { locale })}</td>
                                    <td className="px-3 py-2 text-right font-medium text-gray-800">{row.debit_balance > 0 ? formatBDT(row.debit_balance, { locale }) : '—'}</td>
                                    <td className="px-3 py-2 text-right font-medium text-gray-800">{row.credit_balance > 0 ? formatBDT(row.credit_balance, { locale }) : '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="bg-gray-50 font-semibold border-t border-gray-200">
                                <td className="px-3 py-2 text-xs" colSpan={4}>Grand Totals</td>
                                <td className="px-3 py-2 text-right text-gray-900">{formatBDT(data.totals.debit, { locale })}</td>
                                <td className="px-3 py-2 text-right text-gray-900">{formatBDT(data.totals.credit, { locale })}</td>
                            </tr>
                        </tfoot>
                    </table>
                </CompactSection>
            ) : null}
        </AccountingPageShell>
    );
}