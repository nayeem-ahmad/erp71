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

const thClass = `text-right px-3 py-2 ${compactDensity.formLabel}`;
const thLeftClass = `text-left px-3 py-2 ${compactDensity.formLabel}`;

export default function ArAgingPage() {
    const { t, locale } = useI18n();
    const [data, setData] = useState<AgingData | null>(null);
    const [asOfDate, setAsOfDate] = useState(defaultToday());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => { void load(); }, [asOfDate]);

    const load = async () => {
        setLoading(true); setError(null);
        try {
            const result = await (api as any).getArAging({ asOfDate: asOfDate || undefined });
            setData(result);
        } catch (err: any) { setError(err?.message ?? 'Failed to load'); }
        finally { setLoading(false); }
    };

    return (
        <AccountingPageShell maxWidth="full">
            <AccountingToolbar subtitle="Accounts receivable by age bucket">
                <div className={compactDensity.filterBar}>
                    <div className="flex flex-col gap-1">
                        <span className={compactDensity.formLabel}>As Of Date</span>
                        <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)}
                            className={compactDensity.formField} />
                    </div>
                </div>
            </AccountingToolbar>

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            {loading ? (
                <CompactSection className="py-8 text-center text-gray-400 text-sm font-medium">Loading…</CompactSection>
            ) : data ? (
                <>
                    <CompactSection className="p-0 overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-gray-50 border-b border-gray-100">
                                    <th className={thLeftClass}>Account</th>
                                    <th className={thClass}>Balance</th>
                                    <th className={thClass}>Current (0-30d)</th>
                                    <th className={thClass}>31-60 Days</th>
                                    <th className={thClass}>61-90 Days</th>
                                    <th className={thClass}>90+ Days</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.accounts.map((a) => (
                                    <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                                        <td className="px-3 py-2 font-medium text-gray-800">{a.name}{a.code && <span className="ml-2 text-xs text-gray-400">{a.code}</span>}</td>
                                        <td className="px-3 py-2 text-right">{formatBDT(a.balance, { locale })}</td>
                                        <td className="px-3 py-2 text-right">{formatBDT(a.buckets.current, { locale })}</td>
                                        <td className="px-3 py-2 text-right text-amber-700">{formatBDT(a.buckets.overdue_31_60, { locale })}</td>
                                        <td className="px-3 py-2 text-right text-orange-700">{formatBDT(a.buckets.overdue_61_90, { locale })}</td>
                                        <td className="px-3 py-2 text-right text-red-700">{formatBDT(a.buckets.overdue_90_plus, { locale })}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="bg-gray-50 font-semibold border-t border-gray-200">
                                    <td className="px-3 py-2 text-xs">Totals</td>
                                    <td className="px-3 py-2 text-right">{formatBDT(data.totals.balance, { locale })}</td>
                                    <td className="px-3 py-2 text-right">{formatBDT(data.totals.current, { locale })}</td>
                                    <td className="px-3 py-2 text-right text-amber-700">{formatBDT(data.totals.overdue_31_60, { locale })}</td>
                                    <td className="px-3 py-2 text-right text-orange-700">{formatBDT(data.totals.overdue_61_90, { locale })}</td>
                                    <td className="px-3 py-2 text-right text-red-700">{formatBDT(data.totals.overdue_90_plus, { locale })}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </CompactSection>
                    <p className="text-xs text-gray-400 italic">{data.note}</p>
                </>
            ) : null}
        </AccountingPageShell>
    );
}