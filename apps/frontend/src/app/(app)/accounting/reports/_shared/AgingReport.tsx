'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlarmClock, AlertTriangle, CalendarClock, Users, Wallet } from 'lucide-react';
import { AccountingPageShell } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { NumberCondition } from '@/lib/number-condition';
import { matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import { useApprovedOnly } from '@/lib/accounting-report-scope';
import { AS_OF_PRESETS, approvedOnlyFilter, asOfFromRange, asOfRange, todayDate, wholeTaka } from './report-chips';

export interface AgingAccount {
    id: string;
    name: string;
    code?: string | null;
    type: string;
    balance: number;
    balance_side: string;
    buckets: { current: number; overdue_31_60: number; overdue_61_90: number; overdue_90_plus: number };
}

interface AgingData {
    as_of: string;
    accounts: AgingAccount[];
    totals: { balance: number; current: number; overdue_31_60: number; overdue_61_90: number; overdue_90_plus: number };
    note: string;
}

type Bucket = keyof AgingAccount['buckets'];
const BUCKETS: Bucket[] = ['current', 'overdue_31_60', 'overdue_61_90', 'overdue_90_plus'];

/** Below this an amount is a rounding artefact, not money in a bucket. */
const EPSILON = 0.005;

function overdueOf(account: AgingAccount): number {
    return account.buckets.overdue_31_60 + account.buckets.overdue_61_90 + account.buckets.overdue_90_plus;
}

/** Whether an account holds money in any of the chosen buckets (or, excluding, in none of them). */
function inBuckets(account: AgingAccount, selected: readonly string[], exclude: boolean): boolean {
    if (selected.length === 0) return true;
    const hit = selected.some((bucket) => Math.abs(account.buckets[bucket as Bucket] ?? 0) > EPSILON);
    return exclude ? !hit : hit;
}

/**
 * Receivables (AR) or payables (AP) by age — one party account per row, its
 * balance split over the age buckets. The parties and the strip above them
 * follow the same chips.
 */
export default function AgingReport({ kind }: { kind: 'ar' | 'ap' }) {
    const { t, locale } = useI18n();
    const copy = kind === 'ar' ? t.accounting.reports.arAging : t.accounting.reports.apAging;
    const ui = t.accountingReportsUi.aging;
    const [data, setData] = useState<AgingData | null>(null);
    const [asOfDate, setAsOfDate] = useState(todayDate);
    const [loading, setLoading] = useState(true);
    const { approvedOnly, setApprovedOnly, approvalEnabled, ready: approvalReady } = useApprovedOnly();
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [buckets, setBuckets] = useState<string[]>([]);
    const [excludeBuckets, setExcludeBuckets] = useState(false);
    const [overdueOnly, setOverdueOnly] = useState(false);
    const [balanceFilter, setBalanceFilter] = useState<NumberCondition | null>(null);

    // approvalReady holds the first fetch until the tenant's approved-only
    // setting is known, so the report is never generated against the wrong value.
    useEffect(() => {
        if (!approvalReady) return;
        let active = true;
        setLoading(true);
        setError(null);
        const params = { approvedOnly, asOfDate: asOfDate || undefined };
        (kind === 'ar' ? api.getArAging(params) : api.getApAging(params))
            .then((result: AgingData) => {
                if (active) setData(result);
            })
            .catch((err: unknown) => {
                if (active) setError(err instanceof Error ? err.message : t.accounting.reports.loadFailed);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [kind, asOfDate, approvalReady, approvedOnly, t.accounting.reports.loadFailed]);

    const bucketLabels: Record<Bucket, string> = useMemo(() => ({
        current: copy.bucket0_30,
        overdue_31_60: copy.bucket31_60,
        overdue_61_90: copy.bucket61_90,
        overdue_90_plus: copy.bucket90plus,
    }), [copy]);

    const rows = useMemo(
        () => (data?.accounts ?? []).filter((account) => matchesSearch(search, account.name, account.code)
            && inBuckets(account, buckets, excludeBuckets)
            && (!overdueOnly || overdueOf(account) > EPSILON)
            && matchesNumberCondition(account.balance, balanceFilter)),
        [data, search, buckets, excludeBuckets, overdueOnly, balanceFilter],
    );

    const columns = useMemo(() => {
        const money = (value: number, tone = '') => (
            <span className={`tabular-nums ${Math.abs(value) > EPSILON ? tone : ''}`}>{formatBDT(value, { locale })}</span>
        );
        return [
            {
                id: 'name',
                header: ui.party,
                accessorKey: 'name',
                cell: ({ row }: { row: { original: AgingAccount } }) => (
                    <span className="font-medium text-gray-800">
                        {row.original.name}
                        {row.original.code ? <span className="ms-2 text-xs text-gray-400">{row.original.code}</span> : null}
                    </span>
                ),
            },
            {
                id: 'balance',
                header: ui.balance,
                accessorKey: 'balance',
                meta: { align: 'end' },
                cell: ({ row }: { row: { original: AgingAccount } }) => (
                    <span className="font-semibold tabular-nums">{formatBDT(row.original.balance, { locale })}</span>
                ),
            },
            {
                id: 'current',
                header: ui.current,
                accessorFn: (row: AgingAccount) => row.buckets.current,
                meta: { align: 'end', hideOnMobile: true },
                cell: ({ row }: { row: { original: AgingAccount } }) => money(row.original.buckets.current),
            },
            {
                id: 'overdue_31_60',
                header: copy.bucket31_60,
                accessorFn: (row: AgingAccount) => row.buckets.overdue_31_60,
                meta: { align: 'end', hideOnMobile: true },
                cell: ({ row }: { row: { original: AgingAccount } }) => money(row.original.buckets.overdue_31_60, 'text-amber-700'),
            },
            {
                id: 'overdue_61_90',
                header: copy.bucket61_90,
                accessorFn: (row: AgingAccount) => row.buckets.overdue_61_90,
                meta: { align: 'end', hideOnMobile: true },
                cell: ({ row }: { row: { original: AgingAccount } }) => money(row.original.buckets.overdue_61_90, 'text-amber-700'),
            },
            {
                id: 'overdue_90_plus',
                header: copy.bucket90plus,
                accessorFn: (row: AgingAccount) => row.buckets.overdue_90_plus,
                meta: { align: 'end' },
                cell: ({ row }: { row: { original: AgingAccount } }) => money(row.original.buckets.overdue_90_plus, 'text-red-600'),
            },
        ];
    }, [ui, copy, locale]);

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'asOf',
            type: 'date-range',
            label: t.accounting.reports.balanceSheet.asOf,
            value: asOfRange(asOfDate),
            // Aging is always as of some day: cleared, it goes back to today.
            onChange: (next) => setAsOfDate(asOfFromRange(next)),
            presets: AS_OF_PRESETS,
            operators: true,
        },
        {
            id: 'bucket',
            type: 'multi-select',
            label: ui.ageBucket,
            value: buckets,
            onChange: setBuckets,
            exclude: { value: excludeBuckets, onChange: setExcludeBuckets },
            options: BUCKETS.map((bucket) => ({ value: bucket, label: bucketLabels[bucket] })),
        },
        {
            id: 'overdue',
            type: 'toggle',
            label: ui.overdueOnly,
            pressed: overdueOnly,
            onChange: setOverdueOnly,
        },
        {
            id: 'balance',
            type: 'number',
            label: ui.balance,
            value: balanceFilter,
            onChange: setBalanceFilter,
            money: true,
            more: true,
        },
        ...approvedOnlyFilter(t, { approvalEnabled, approvedOnly, onChange: setApprovedOnly }).map((filter) => ({ ...filter, more: true })),
    ], [t, ui, asOfDate, buckets, excludeBuckets, overdueOnly, balanceFilter, bucketLabels, approvalEnabled, approvedOnly, setApprovedOnly]);

    const stats = useMemo(() => {
        const sum = (pick: (account: AgingAccount) => number) => rows.reduce((total, account) => total + pick(account), 0);
        const overdue = sum(overdueOf);
        const over90 = sum((account) => account.buckets.overdue_90_plus);
        const items: ListStat[] = [
            { id: 'parties', icon: <Users aria-hidden />, label: ui.parties, value: rows.length.toLocaleString(locale) },
            { id: 'due', icon: <Wallet aria-hidden />, label: ui.totalDue, value: wholeTaka(sum((account) => account.balance), locale) },
            { id: 'current', icon: <CalendarClock aria-hidden />, label: ui.currentDue, value: wholeTaka(sum((account) => account.buckets.current), locale) },
            {
                id: 'overdue',
                icon: <AlarmClock aria-hidden />,
                label: ui.overdue,
                value: wholeTaka(overdue, locale),
                tone: overdue > EPSILON ? 'warning' : 'default',
            },
            {
                id: 'over90',
                icon: <AlertTriangle aria-hidden />,
                label: ui.over90,
                value: wholeTaka(over90, locale),
                tone: over90 > EPSILON ? 'danger' : 'default',
            },
        ];
        return { items, loading, label: t.accountingReportsUi.common.stats };
    }, [rows, loading, locale, ui, t]);

    return (
        <AccountingPageShell maxWidth="full">
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    copy.title,
                    'accounting',
                )}
            />

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            <DataTable
                title={copy.title}
                tableId={kind === 'ar' ? 'accounting-ar-aging' : 'accounting-ap-aging'}
                columns={columns as never}
                data={rows}
                isLoading={loading}
                emptyMessage={ui.empty}
                searchValue={search}
                onSearchChange={setSearch}
                searchPlaceholder={ui.searchPlaceholder}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
            />

            {data?.note ? <p className="text-xs text-gray-400 italic">{data.note}</p> : null}
        </AccountingPageShell>
    );
}
