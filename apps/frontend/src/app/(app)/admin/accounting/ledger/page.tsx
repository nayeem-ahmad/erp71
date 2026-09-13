'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatBDT, formatDate } from '@/lib/format';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import {
    startOfYearISO,
    todayISO,
    type PlatformAccount,
    type PlatformLedger,
} from '@/components/admin/accounting/types';

/**
 * Admin › Accounting › Ledger — the chart of accounts, and what is behind a
 * balance.
 *
 * Deliberately read-only. Corrections belong upstream: a wrong subscription fee
 * is fixed in the tenant's billing ledger and re-synced, a wrong expense on the
 * Expenses page. Letting someone edit a voucher here would let the books drift
 * from the billing data they are projected from, with nothing to say which was
 * right.
 */
export default function PlatformLedgerPage() {
    const { t } = useI18n();
    const m = t.admin.accounting;
    const ml = m.ledgerPage;

    const [accounts, setAccounts] = useState<PlatformAccount[]>([]);
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState('');
    const [ledger, setLedger] = useState<PlatformLedger | null>(null);
    const [from, setFrom] = useState(startOfYearISO());
    const [to, setTo] = useState(todayISO());
    const [loadingAccounts, setLoadingAccounts] = useState(true);
    const [loadingLedger, setLoadingLedger] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        setLoadingAccounts(true);
        api.getPlatformAccountingAccounts()
            .then((rows: PlatformAccount[]) => {
                if (cancelled) return;
                setAccounts(rows ?? []);
            })
            .catch((err: unknown) => {
                if (!cancelled) setError(err instanceof Error ? err.message : m.loadFailed);
            })
            .finally(() => {
                if (!cancelled) setLoadingAccounts(false);
            });
        return () => { cancelled = true; };
    }, [m.loadFailed]);

    const loadLedger = useCallback(async () => {
        if (!selectedId) {
            setLedger(null);
            return;
        }
        setLoadingLedger(true);
        setError('');
        try {
            setLedger(await api.getPlatformAccountingLedger(selectedId, {
                from: from || undefined,
                to: to || undefined,
            }));
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.loadFailed);
        } finally {
            setLoadingLedger(false);
        }
    }, [selectedId, from, to, m.loadFailed]);

    useEffect(() => {
        void loadLedger();
    }, [loadLedger]);

    const filtered = useMemo(() => {
        const needle = search.trim().toLowerCase();
        const rows = needle
            ? accounts.filter((account) =>
                account.name.toLowerCase().includes(needle)
                || (account.code ?? '').toLowerCase().includes(needle))
            : accounts;
        // Code order is hierarchy order — see account-code.ts — so a plain sort
        // groups assets, then liabilities, equity, revenue and expenses.
        return [...rows].sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''));
    }, [accounts, search]);

    return (
        <PageShell>
            <div className="space-y-4">
                <PageHeader
                    title={ml.title}
                    subtitle={ml.description}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        'admin',
                        [{ label: m.breadcrumb, href: routes.admin.accounting.root }],
                        ml.title,
                    )}
                />

                {error ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
                ) : null}

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_1fr]">
                    <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
                        <div className="border-b border-gray-100 p-3">
                            <p className="mb-2 text-xs font-medium text-gray-500">{ml.accounts}</p>
                            <Input
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder={ml.searchAccounts}
                            />
                        </div>
                        <div className="max-h-[28rem] overflow-y-auto">
                            {loadingAccounts ? (
                                <div className="p-6 text-center text-gray-400">
                                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                                </div>
                            ) : null}
                            <ul>
                                {filtered.map((account) => (
                                    <li key={account.id}>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedId(account.id)}
                                            className={`flex w-full items-baseline gap-2 px-3 py-2 text-start text-sm transition-colors max-md:min-h-touch ${
                                                account.id === selectedId
                                                    ? 'bg-primary-light/50 text-blue-700'
                                                    : 'text-gray-700 hover:bg-gray-50'
                                            }`}
                                        >
                                            <span className="w-14 flex-shrink-0 font-mono text-xs text-gray-400">
                                                {account.code ?? ''}
                                            </span>
                                            <span className="min-w-0 truncate">{account.name}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </section>

                    <section className="min-w-0 space-y-3">
                        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-100 bg-white p-3">
                            <label className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-gray-500">{m.range.from}</span>
                                <input
                                    type="date"
                                    value={from}
                                    onChange={(event) => setFrom(event.target.value)}
                                    className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm"
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-gray-500">{m.range.to}</span>
                                <input
                                    type="date"
                                    value={to}
                                    onChange={(event) => setTo(event.target.value)}
                                    className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm"
                                />
                            </label>
                            {ledger ? (
                                <div className="ms-auto text-end">
                                    <p className="text-xs font-medium text-gray-500">{ml.balance}</p>
                                    <p className="text-lg font-bold tracking-tight text-gray-900">
                                        {formatBDT(ledger.closing_balance)}
                                        <span className="ms-1 text-xs font-medium uppercase text-gray-400">
                                            {ledger.closing_balance_side}
                                        </span>
                                    </p>
                                </div>
                            ) : null}
                        </div>

                        {!selectedId ? (
                            <p className="rounded-lg border border-gray-100 bg-white p-6 text-center text-xs text-gray-400">
                                {ml.selectAccount}
                            </p>
                        ) : (
                            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                                <table className="w-full min-w-[44rem] text-sm">
                                    <thead>
                                        <tr className="border-b border-gray-200 bg-gray-50/80 text-xs font-medium text-gray-500">
                                            <th className="px-2 py-1.5 text-start">{ml.columns.date}</th>
                                            <th className="px-2 py-1.5 text-start">{ml.columns.voucher}</th>
                                            <th className="px-2 py-1.5 text-start">{ml.columns.description}</th>
                                            <th className="px-2 py-1.5 text-end">{ml.columns.debit}</th>
                                            <th className="px-2 py-1.5 text-end">{ml.columns.credit}</th>
                                            <th className="px-2 py-1.5 text-end">{ml.columns.balance}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {loadingLedger ? (
                                            <tr>
                                                <td colSpan={6} className="p-6 text-center text-gray-400">
                                                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                                                </td>
                                            </tr>
                                        ) : null}

                                        {!loadingLedger && (ledger?.data.length ?? 0) === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="p-6 text-center text-xs text-gray-400">
                                                    {ml.empty}
                                                </td>
                                            </tr>
                                        ) : null}

                                        {!loadingLedger && ledger?.data.map((entry) => (
                                            <tr key={entry.id} className="border-b border-gray-100 last:border-0">
                                                <td className="whitespace-nowrap px-2 py-1.5">{formatDate(entry.date)}</td>
                                                <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs text-gray-500">
                                                    {entry.voucher_number}
                                                </td>
                                                <td className="max-w-sm truncate px-2 py-1.5 text-gray-600">
                                                    {entry.narration || entry.description || '—'}
                                                </td>
                                                <td className="whitespace-nowrap px-2 py-1.5 text-end">
                                                    {entry.debit_amount ? formatBDT(entry.debit_amount) : '—'}
                                                </td>
                                                <td className="whitespace-nowrap px-2 py-1.5 text-end">
                                                    {entry.credit_amount ? formatBDT(entry.credit_amount) : '—'}
                                                </td>
                                                <td className="whitespace-nowrap px-2 py-1.5 text-end font-semibold">
                                                    {formatBDT(entry.running_balance)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </PageShell>
    );
}
