'use client';

import { useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
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

function defaultTo() {
    return new Date().toISOString().slice(0, 10);
}

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

interface PLData {
    filters: { from: string; to: string };
    revenue: { groups: Group[]; total: number };
    expenses: { groups: Group[]; total: number };
    net_profit: number;
}

function AccountSection({ groups, label, colorClass, locale }: { groups: Group[]; label: string; colorClass: string; locale: string }) {
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

export default function ProfitLossPage() {
    const { t, locale } = useI18n();
    const [data, setData] = useState<PLData | null>(null);
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(defaultTo());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        void load();
    }, [fromDate, toDate]);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await api.getProfitLoss({ from: fromDate || undefined, to: toDate || undefined });
            setData(result);
        } catch (err: any) {
            setError(err?.message ?? t.accounting.reports.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const isProfit = (data?.net_profit ?? 0) >= 0;

    return (
        <AccountingPageShell maxWidth="narrow">
            <AccountingToolbar subtitle={t.accounting.reports.pl.subtitle}>
                <div className={compactDensity.filterBar}>
                    <div className="flex flex-col gap-1">
                        <span className={compactDensity.formLabel}>{t.accountingShared.from}</span>
                        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                            className={compactDensity.formField} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className={compactDensity.formLabel}>{t.accountingShared.to}</span>
                        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                            className={compactDensity.formField} />
                    </div>
                </div>
            </AccountingToolbar>

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            {loading ? (
                <CompactSection className="py-8 text-center text-gray-400 text-sm font-medium">
                    {t.accountingShared.loading}
                </CompactSection>
            ) : data ? (
                <CompactSection className="space-y-4">
                    <div className="text-center border-b border-gray-100 pb-3">
                        <p className={compactDensity.sectionLabel}>{t.accountingShared.period}</p>
                        <p className="text-sm font-semibold text-gray-700 mt-1">{data.filters.from} — {data.filters.to}</p>
                    </div>

                    <AccountSection groups={data.revenue.groups} label={t.accounting.reports.revenue} colorClass="bg-emerald-50 text-emerald-700" locale={locale} />

                    <div className="flex justify-between items-center px-3 py-2 bg-emerald-50 rounded-lg font-semibold text-sm text-emerald-800 border border-emerald-100">
                        <span>{t.accounting.reports.totalRevenue}</span>
                        <span>{formatBDT(data.revenue.total, { locale })}</span>
                    </div>

                    <AccountSection groups={data.expenses.groups} label={t.accounting.reports.expenses} colorClass="bg-rose-50 text-rose-700" locale={locale} />

                    <div className="flex justify-between items-center px-3 py-2 bg-rose-50 rounded-lg font-semibold text-sm text-rose-800 border border-rose-100">
                        <span>{t.accounting.reports.totalExpenses}</span>
                        <span>{formatBDT(data.expenses.total, { locale })}</span>
                    </div>

                    <div className={`flex justify-between items-center px-4 py-3 rounded-lg font-semibold text-sm border ${isProfit ? 'bg-blue-50 text-blue-800 border-blue-200' : 'bg-red-50 text-red-800 border-red-200'}`}>
                        <div className="flex items-center gap-2">
                            <TrendingUp className="w-4 h-4" />
                            <span>{isProfit ? t.accounting.reports.netProfit : t.accounting.reports.netLoss}</span>
                        </div>
                        <span>{formatBDT(Math.abs(data.net_profit), { locale })}</span>
                    </div>
                </CompactSection>
            ) : null}
        </AccountingPageShell>
    );
}