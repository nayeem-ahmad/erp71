'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatBDT } from '@/lib/format';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import {
    startOfYearISO,
    todayISO,
    type PlatformBalanceSheet,
    type PlatformProfitLoss,
    type PlatformStatementGroup,
    type PlatformTrialBalance,
} from '@/components/admin/accounting/types';

type ReportKey = 'profit-loss' | 'balance-sheet' | 'trial-balance';

/**
 * Admin › Accounting › Reports — ERP71's own financial statements.
 *
 * The same three reports a shop gets, served by the same engine against the
 * platform's books. No branch scope: the platform has no stores, so there is
 * nothing to consolidate and no filter to offer.
 */
export default function PlatformReportsPage() {
    const { t } = useI18n();
    const m = t.admin.accounting;
    const mr = m.reports;

    const [report, setReport] = useState<ReportKey>('profit-loss');
    const [from, setFrom] = useState(startOfYearISO());
    const [to, setTo] = useState(todayISO());
    const [data, setData] = useState<PlatformProfitLoss | PlatformBalanceSheet | PlatformTrialBalance | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            // A P&L covers a period; the other two are a snapshot, so they take
            // the end of the range as their as-at date and ignore the start.
            const params = report === 'profit-loss' ? { from, to } : { asOfDate: to };
            setData(await api.getPlatformAccountingReport(report, params));
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.loadFailed);
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [report, from, to, m.loadFailed]);

    useEffect(() => {
        void load();
    }, [load]);

    const tabs: Array<{ key: ReportKey; label: string }> = [
        { key: 'profit-loss', label: mr.profitLoss },
        { key: 'balance-sheet', label: mr.balanceSheet },
        { key: 'trial-balance', label: mr.trialBalance },
    ];

    return (
        <PageShell>
            <div className="space-y-4">
                <PageHeader
                    title={mr.title}
                    subtitle={mr.description}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        'admin',
                        [{ label: m.breadcrumb, href: routes.admin.accounting.root }],
                        mr.title,
                    )}
                />

                <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-100 bg-white p-3">
                    <div className="flex flex-wrap gap-1">
                        {tabs.map((tab) => (
                            <button
                                key={tab.key}
                                type="button"
                                onClick={() => setReport(tab.key)}
                                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors max-md:min-h-touch ${
                                    report === tab.key
                                        ? 'bg-primary text-white'
                                        : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {report === 'profit-loss' ? (
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-gray-500">{m.range.from}</span>
                            <input
                                type="date"
                                value={from}
                                onChange={(event) => setFrom(event.target.value)}
                                className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm"
                            />
                        </label>
                    ) : null}
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-500">
                            {report === 'profit-loss' ? m.range.to : mr.asOf}
                        </span>
                        <input
                            type="date"
                            value={to}
                            onChange={(event) => setTo(event.target.value)}
                            className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm"
                        />
                    </label>
                </div>

                {error ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
                ) : null}

                {loading ? (
                    <div className="flex items-center justify-center p-10 text-gray-400">
                        <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                ) : null}

                {!loading && data && report === 'profit-loss' ? (
                    <ProfitLossReport data={data as PlatformProfitLoss} />
                ) : null}
                {!loading && data && report === 'balance-sheet' ? (
                    <BalanceSheetReport data={data as PlatformBalanceSheet} />
                ) : null}
                {!loading && data && report === 'trial-balance' ? (
                    <TrialBalanceReport data={data as PlatformTrialBalance} />
                ) : null}
            </div>
        </PageShell>
    );
}

function StatementBlock({
    heading,
    groups,
    total,
}: Readonly<{ heading: string; groups: PlatformStatementGroup[]; total: number }>) {
    const { t } = useI18n();
    const mr = t.admin.accounting.reports;

    return (
        <section className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm md:p-4">
            <p className="mb-2 text-xs font-medium text-gray-500">{heading}</p>

            {groups.length === 0 ? (
                <p className="py-4 text-center text-xs text-gray-400">{mr.empty}</p>
            ) : (
                <div className="space-y-3">
                    {groups.map((entry) => (
                        <div key={entry.group.id}>
                            <div className="flex items-baseline justify-between gap-3 border-b border-gray-100 pb-1 text-sm font-semibold text-gray-900">
                                <span className="min-w-0 truncate">{entry.group.name}</span>
                                <span className="flex-shrink-0">{formatBDT(entry.total)}</span>
                            </div>
                            <ul className="mt-1 space-y-0.5">
                                {entry.rows.map((row) => (
                                    <li key={row.id} className="flex items-baseline justify-between gap-3 text-sm">
                                        <span className="flex min-w-0 items-baseline gap-2">
                                            <span className="w-14 flex-shrink-0 font-mono text-xs text-gray-400">
                                                {row.code ?? ''}
                                            </span>
                                            <span className="truncate text-gray-600">{row.name}</span>
                                        </span>
                                        <span className="flex-shrink-0 text-gray-700">{formatBDT(row.balance)}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            )}

            <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-gray-200 pt-2 text-sm font-bold text-gray-900">
                <span>{mr.total}</span>
                <span>{formatBDT(total)}</span>
            </div>
        </section>
    );
}

function ProfitLossReport({ data }: Readonly<{ data: PlatformProfitLoss }>) {
    const { t } = useI18n();
    const mr = t.admin.accounting.reports;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <StatementBlock heading={mr.revenue} groups={data.revenue.groups} total={data.revenue.total} />
                <StatementBlock heading={mr.expenses} groups={data.expenses.groups} total={data.expenses.total} />
            </div>
            <div className="flex items-baseline justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm md:p-4">
                <span className="text-sm font-semibold text-gray-900">{mr.netProfit}</span>
                <span className={`text-xl font-bold tracking-tight ${data.net_profit < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                    {formatBDT(data.net_profit)}
                </span>
            </div>
        </div>
    );
}

function BalanceSheetReport({ data }: Readonly<{ data: PlatformBalanceSheet }>) {
    const { t } = useI18n();
    const mr = t.admin.accounting.reports;

    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <StatementBlock heading={mr.assets} groups={data.assets.groups} total={data.assets.total} />
            <div className="space-y-4">
                <StatementBlock heading={mr.liabilities} groups={data.liabilities.groups} total={data.liabilities.total} />
                <StatementBlock heading={mr.equity} groups={data.equity.groups} total={data.equity.total} />
            </div>
        </div>
    );
}

function TrialBalanceReport({ data }: Readonly<{ data: PlatformTrialBalance }>) {
    const { t } = useI18n();
    const mr = t.admin.accounting.reports;

    return (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="w-full min-w-[32rem] text-sm">
                <thead>
                    <tr className="border-b border-gray-200 bg-gray-50/80 text-xs font-medium text-gray-500">
                        <th className="px-2 py-1.5 text-start">{mr.account}</th>
                        <th className="px-2 py-1.5 text-end">{mr.debit}</th>
                        <th className="px-2 py-1.5 text-end">{mr.credit}</th>
                    </tr>
                </thead>
                <tbody>
                    {data.rows.length === 0 ? (
                        <tr>
                            <td colSpan={3} className="p-6 text-center text-xs text-gray-400">{mr.empty}</td>
                        </tr>
                    ) : null}
                    {data.rows.map((row) => (
                        <tr key={row.account.id} className="border-b border-gray-100">
                            <td className="px-2 py-1.5">
                                <span className="flex min-w-0 items-baseline gap-2">
                                    <span className="w-14 flex-shrink-0 font-mono text-xs text-gray-400">
                                        {row.account.code ?? ''}
                                    </span>
                                    <span className="truncate">{row.account.name}</span>
                                </span>
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-end">
                                {row.debit_balance ? formatBDT(row.debit_balance) : '—'}
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-end">
                                {row.credit_balance ? formatBDT(row.credit_balance) : '—'}
                            </td>
                        </tr>
                    ))}
                </tbody>
                <tfoot>
                    <tr className="bg-gray-50/80 text-sm font-bold text-gray-900">
                        <td className="px-2 py-1.5">{mr.total}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-end">{formatBDT(data.totals.debit)}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-end">{formatBDT(data.totals.credit)}</td>
                    </tr>
                </tfoot>
            </table>
        </div>
    );
}
