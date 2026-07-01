'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle } from 'lucide-react';
import {
    AccountingPageShell,
    AccountingToolbar,
    CompactSection,
} from '@/components/accounting/compact';
import { compactDensity } from '@/lib/ui/compact-density';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

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

interface BSData {
    as_of: string;
    assets: { groups: Group[]; total: number };
    liabilities: { groups: Group[]; total: number };
    equity: { groups: Group[]; net_profit: number; total: number };
    total_liabilities_and_equity: number;
    is_balanced: boolean;
}

function BSSection({ groups, label, colorClass }: { groups: Group[]; label: string; colorClass: string }) {
    const { locale } = useI18n();
    return (
        <div>
            <div className={`px-3 py-1.5 rounded-lg text-xs font-medium ${colorClass} mb-2`}>
                {label}
            </div>
            {groups.map((g) => (
                <div key={g.group.id} className="mb-3">
                    <div className="flex justify-between items-center px-3 py-1.5 bg-gray-50 rounded-lg font-semibold text-sm text-gray-700">
                        <span>{g.group.name}</span>
                        <span>{formatBDT(g.total, { locale })}</span>
                    </div>
                    {g.accounts.map((a) => (
                        <div key={a.id} className="flex justify-between items-center px-5 py-1 text-sm text-gray-600">
                            <span>{a.name}{a.code ? <span className="ml-2 text-xs text-gray-400">{a.code}</span> : null}</span>
                            <span>{formatBDT(a.balance, { locale })}</span>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

export default function BalanceSheetPage() {
    const { t, locale } = useI18n();
    const [data, setData] = useState<BSData | null>(null);
    const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        void load();
    }, [asOfDate]);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await api.getBalanceSheet({ asOfDate: asOfDate || undefined });
            setData(result);
        } catch (err: any) {
            setError(err?.message ?? 'Failed to load report');
        } finally {
            setLoading(false);
        }
    };

    return (
        <AccountingPageShell maxWidth="narrow">
            <AccountingToolbar subtitle="Assets, liabilities, and equity snapshot as of a date">
                <div className={compactDensity.filterBar}>
                    <div className="flex flex-col gap-1">
                        <span className={compactDensity.formLabel}>As of Date</span>
                        <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)}
                            className={compactDensity.formField} />
                    </div>
                </div>
            </AccountingToolbar>

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            {loading ? (
                <CompactSection className="py-8 text-center text-gray-400 text-sm font-medium">Loading…</CompactSection>
            ) : data ? (
                <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
                        {data.is_balanced
                            ? <><CheckCircle className="w-4 h-4 text-emerald-500" /><span className="text-emerald-700">Balanced</span></>
                            : <><AlertCircle className="w-4 h-4 text-amber-500" /><span className="text-amber-700">Not balanced — check postings</span></>
                        }
                        <span className="ml-2">As of {data.as_of}</span>
                    </div>

                    <div className="grid md:grid-cols-2 gap-3">
                        <CompactSection className="space-y-3">
                            <BSSection groups={data.assets.groups} label={t.accounting.reports.assets} colorClass="bg-sky-50 text-sky-700" />
                            <div className="flex justify-between items-center px-3 py-2 bg-sky-50 rounded-lg font-semibold text-sm text-sky-800 border border-sky-100">
                                <span>Total Assets</span>
                                <span>{formatBDT(data.assets.total, { locale })}</span>
                            </div>
                        </CompactSection>

                        <div className="space-y-3">
                            <CompactSection className="space-y-3">
                                <BSSection groups={data.liabilities.groups} label={t.accounting.reports.liabilities} colorClass="bg-rose-50 text-rose-700" />
                                <div className="flex justify-between items-center px-3 py-2 bg-rose-50 rounded-lg font-semibold text-sm text-rose-800 border border-rose-100">
                                    <span>Total Liabilities</span>
                                    <span>{formatBDT(data.liabilities.total, { locale })}</span>
                                </div>
                            </CompactSection>

                            <CompactSection className="space-y-3">
                                <BSSection groups={data.equity.groups} label={t.accounting.reports.equity} colorClass="bg-violet-50 text-violet-700" />
                                <div className="flex justify-between items-center px-5 py-1 text-sm text-gray-600">
                                    <span>Current Period Net Profit</span>
                                    <span className={data.equity.net_profit >= 0 ? 'text-emerald-700 font-semibold' : 'text-red-600 font-semibold'}>
                                        {formatBDT(data.equity.net_profit, { locale })}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center px-3 py-2 bg-violet-50 rounded-lg font-semibold text-sm text-violet-800 border border-violet-100">
                                    <span>Total Equity</span>
                                    <span>{formatBDT(data.equity.total, { locale })}</span>
                                </div>
                            </CompactSection>

                            <div className="flex justify-between items-center px-4 py-3 bg-gray-900 text-white rounded-lg font-semibold text-sm">
                                <span>Total Liabilities + Equity</span>
                                <span>{formatBDT(data.total_liabilities_and_equity, { locale })}</span>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </AccountingPageShell>
    );
}