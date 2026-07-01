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

function defaultFrom() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function defaultTo() { return new Date().toISOString().slice(0, 10); }

interface Activity { id: string; name: string; type: string; net_change: number; }
interface CashFlowData {
    filters: { from: string; to: string };
    operating: { activities: Activity[]; net: number };
    investing: { activities: Activity[]; net: number };
    financing: { activities: Activity[]; net: number };
    net_change_in_cash: number;
    opening_cash_balance: number;
    closing_cash_balance: number;
    note: string;
}

function ActivitySection({ label, data, colorClass }: { label: string; data: { activities: Activity[]; net: number }; colorClass: string }) {
    const { locale } = useI18n();
    return (
        <div>
            <div className={`px-3 py-1.5 rounded-lg text-xs font-medium ${colorClass} mb-2`}>{label}</div>
            {data.activities.map((a) => (
                <div key={a.id} className="flex justify-between items-center px-5 py-1 text-sm text-gray-600 border-b border-gray-50">
                    <span>{a.name}</span>
                    <span className={a.net_change >= 0 ? 'text-emerald-700' : 'text-red-700'}>{formatBDT(a.net_change, { locale })}</span>
                </div>
            ))}
            <div className="flex justify-between items-center px-3 py-1.5 bg-gray-50 rounded-lg font-semibold text-sm text-gray-700 mt-1">
                <span>Net {label}</span>
                <span className={data.net >= 0 ? 'text-emerald-700' : 'text-red-700'}>{formatBDT(data.net, { locale })}</span>
            </div>
        </div>
    );
}

export default function CashFlowPage() {
    const { t, locale } = useI18n();
    const [data, setData] = useState<CashFlowData | null>(null);
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(defaultTo());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => { void load(); }, [fromDate, toDate]);

    const load = async () => {
        setLoading(true); setError(null);
        try {
            const result = await (api as any).getCashFlow({ from: fromDate || undefined, to: toDate || undefined });
            setData(result);
        } catch (err: any) { setError(err?.message ?? 'Failed to load'); }
        finally { setLoading(false); }
    };

    return (
        <AccountingPageShell maxWidth="narrow">
            <AccountingToolbar subtitle="Operating, investing, and financing activities">
                <div className={compactDensity.filterBar}>
                    <div className="flex flex-col gap-1">
                        <span className={compactDensity.formLabel}>From</span>
                        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                            className={compactDensity.formField} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className={compactDensity.formLabel}>To</span>
                        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                            className={compactDensity.formField} />
                    </div>
                </div>
            </AccountingToolbar>

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            {loading ? (
                <CompactSection className="py-8 text-center text-gray-400 text-sm font-medium">Loading…</CompactSection>
            ) : data ? (
                <CompactSection className="space-y-4">
                    <div className="text-center border-b border-gray-100 pb-3">
                        <p className={compactDensity.sectionLabel}>Period</p>
                        <p className="text-sm font-semibold text-gray-700 mt-1">{data.filters.from} — {data.filters.to}</p>
                    </div>
                    <ActivitySection label={t.accounting.reports.cashFlow.operating} data={data.operating} colorClass="bg-blue-50 text-blue-700" />
                    <ActivitySection label={t.accounting.reports.cashFlow.investing} data={data.investing} colorClass="bg-purple-50 text-purple-700" />
                    <ActivitySection label={t.accounting.reports.cashFlow.financing} data={data.financing} colorClass="bg-orange-50 text-orange-700" />
                    <div className="border-t border-gray-200 pt-3 space-y-2">
                        <div className="flex justify-between text-sm text-gray-600">
                            <span>Opening Cash Balance</span>
                            <span className="font-medium">{formatBDT(data.opening_cash_balance, { locale })}</span>
                        </div>
                        <div className="flex justify-between text-sm text-gray-600">
                            <span>Net Change in Cash</span>
                            <span className={`font-medium ${data.net_change_in_cash >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatBDT(data.net_change_in_cash, { locale })}</span>
                        </div>
                        <div className="flex justify-between font-semibold text-sm border-t border-gray-200 pt-2">
                            <span>Closing Cash Balance</span>
                            <span className={data.closing_cash_balance >= 0 ? 'text-emerald-700' : 'text-red-700'}>{formatBDT(data.closing_cash_balance, { locale })}</span>
                        </div>
                    </div>
                    <p className="text-xs text-gray-400 italic">{data.note}</p>
                </CompactSection>
            ) : null}
        </AccountingPageShell>
    );
}