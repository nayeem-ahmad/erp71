'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, FileText, Loader2, Receipt, RefreshCw } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell, Button, CompactSection, CompactStat } from '@/components/ui';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { formatBDT, formatDate } from '@/lib/format';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import {
    startOfYearISO,
    todayISO,
    type PlatformAccountingOverview,
    type PlatformBillingSyncResult,
} from '@/components/admin/accounting/types';

/**
 * Admin › Accounting — the platform's own books at a glance.
 *
 * The year-to-date figures are the point: the tenant ledger next door answers
 * "does this shop owe us money", and nothing until now answered "are we making
 * any".
 */
export default function PlatformAccountingPage() {
    const { t, fmt } = useI18n();
    const m = t.admin.accounting;

    const [from, setFrom] = useState(startOfYearISO());
    const [to, setTo] = useState(todayISO());
    const [overview, setOverview] = useState<PlatformAccountingOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setOverview(await api.getPlatformAccountingOverview({ from, to }));
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [from, to, m.loadFailed]);

    useEffect(() => {
        void load();
    }, [load]);

    const runSync = async () => {
        setSyncing(true);
        try {
            const result: PlatformBillingSyncResult = await api.syncPlatformAccounting();
            const summary = fmt(m.sync.summary, {
                posted: result.posted,
                repaired: result.repaired,
                reverted: result.reverted,
            });
            // A partial run is a warning, not a success: some money did not reach
            // the ledger and somebody has to know which.
            if (result.failed.length > 0) {
                toast.error(`${summary} ${fmt(m.sync.partial, { failed: result.failed.length })}`);
            } else {
                toast.success(`${m.sync.done} ${summary}`);
            }
            await load();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : m.sync.failed);
        } finally {
            setSyncing(false);
        }
    };

    const totals = overview?.totals;
    const pending = overview?.unsynced_billing_events ?? 0;

    return (
        <PageShell>
            <div className="space-y-4">
                <PageHeader
                    title={m.title}
                    subtitle={m.description}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        m.breadcrumb,
                        'admin',
                    )}
                    actions={(
                        <Button onClick={runSync} loading={syncing} icon={<RefreshCw className="h-4 w-4" />}>
                            {syncing ? m.sync.running : m.sync.action}
                        </Button>
                    )}
                />

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
                    <p className="ms-auto max-w-md text-xs text-gray-500">
                        {pending > 0 ? fmt(m.sync.pending, { count: pending }) : m.sync.upToDate}
                        {' '}
                        {m.sync.hint}
                    </p>
                </div>

                {error ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
                ) : null}

                {loading && !overview ? (
                    <div className="flex items-center justify-center p-10 text-gray-400">
                        <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                ) : null}

                {totals ? (
                    <>
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                            <CompactStat label={m.stats.revenue} value={formatBDT(totals.revenue)} tone="positive" />
                            <CompactStat label={m.stats.expenses} value={formatBDT(totals.expenses)} tone="warning" />
                            <CompactStat
                                label={m.stats.netProfit}
                                value={formatBDT(totals.net_profit)}
                                tone={totals.net_profit < 0 ? 'negative' : 'positive'}
                            />
                            <CompactStat label={m.stats.cash} value={formatBDT(totals.cash_and_bank)} />
                            <CompactStat label={m.stats.receivable} value={formatBDT(totals.subscription_receivable)} />
                            <CompactStat label={m.stats.gateway} value={formatBDT(totals.gateway_receivable)} />
                        </div>

                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <CompactSection title={m.sections.revenueByAccount}>
                                <AmountList
                                    rows={overview!.revenue_by_account.map((row) => ({ key: row.name, label: row.name, amount: row.amount }))}
                                    empty={m.empty.revenue}
                                />
                            </CompactSection>

                            <CompactSection title={m.sections.expensesByCategory}>
                                <AmountList
                                    rows={overview!.expenses_by_category.map((row) => ({ key: row.category_id, label: row.name, amount: row.amount }))}
                                    empty={m.empty.expenses}
                                />
                            </CompactSection>
                        </div>

                        <CompactSection title={m.sections.recentVouchers}>
                            {overview!.recent_vouchers.length === 0 ? (
                                <p className="py-4 text-center text-xs text-gray-400">{m.empty.vouchers}</p>
                            ) : (
                                <ul className="divide-y divide-gray-100">
                                    {overview!.recent_vouchers.map((voucher) => (
                                        <li key={voucher.id} className="flex items-center justify-between gap-3 py-2">
                                            <div className="min-w-0">
                                                <p className="truncate text-sm text-gray-900">
                                                    {voucher.description || voucher.voucher_number}
                                                </p>
                                                <p className="text-xs text-gray-400">
                                                    {formatDate(voucher.date)} · {voucher.voucher_number}
                                                </p>
                                            </div>
                                            <span className="flex-shrink-0 text-sm font-semibold text-gray-900">
                                                {formatBDT(voucher.amount)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </CompactSection>
                    </>
                ) : null}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <QuickLink
                        href={routes.admin.accounting.expenses}
                        icon={Receipt}
                        title={m.links.expenses.title}
                        description={m.links.expenses.description}
                    />
                    <QuickLink
                        href={routes.admin.accounting.ledger}
                        icon={BookOpen}
                        title={m.links.ledger.title}
                        description={m.links.ledger.description}
                    />
                    <QuickLink
                        href={routes.admin.accounting.reports}
                        icon={FileText}
                        title={m.links.reports.title}
                        description={m.links.reports.description}
                    />
                </div>
            </div>
        </PageShell>
    );
}

function AmountList({
    rows,
    empty,
}: Readonly<{ rows: Array<{ key: string; label: string; amount: number }>; empty: string }>) {
    if (rows.length === 0) {
        return <p className="py-4 text-center text-xs text-gray-400">{empty}</p>;
    }

    // Shares of the largest row, so the bars stay readable whatever the scale.
    const largest = Math.max(...rows.map((row) => Math.abs(row.amount)), 1);

    return (
        <ul className="space-y-2">
            {rows.map((row) => (
                <li key={row.key}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate text-gray-700">{row.label}</span>
                        <span className="flex-shrink-0 font-semibold text-gray-900">{formatBDT(row.amount)}</span>
                    </div>
                    <div className="mt-1 h-1 rounded-full bg-gray-100">
                        <div
                            className="h-1 rounded-full bg-blue-600"
                            style={{ width: `${Math.max(2, (Math.abs(row.amount) / largest) * 100)}%` }}
                        />
                    </div>
                </li>
            ))}
        </ul>
    );
}

function QuickLink({
    href,
    icon: Icon,
    title,
    description,
}: Readonly<{ href: string; icon: typeof Receipt; title: string; description: string }>) {
    return (
        <Link
            href={href}
            className="group block rounded-lg border border-gray-100 bg-white p-4 shadow-sm transition hover:border-primary-border hover:bg-primary-light/30"
        >
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary-light text-blue-700">
                        <Icon className="h-4 w-4" />
                    </div>
                    <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-gray-500">{description}</p>
                </div>
                <ArrowRight className="mt-1 h-4 w-4 flex-shrink-0 text-gray-300 transition group-hover:text-primary" />
            </div>
        </Link>
    );
}
