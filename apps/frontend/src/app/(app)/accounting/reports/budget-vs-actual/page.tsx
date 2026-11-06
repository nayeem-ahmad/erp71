'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Banknote, Scale, Target } from 'lucide-react';
import { AccountingPageShell } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { StatusBadge } from '@/components/ui';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { useApprovedOnly } from '@/lib/accounting-report-scope';
import type { NumberCondition } from '@/lib/number-condition';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import { approvedOnlyFilter, signedPercent, wholeTaka } from '../_shared/report-chips';

interface BudgetRow {
    account: { id: string; name: string; code?: string | null; type: string };
    budget: number;
    actual: number;
    /** Budget minus actual: below zero, the account has gone over its budget. */
    variance: number;
    variance_pct: number | null;
    /**
     * Monthly budget rows summed into `budget` — one row per account, so an
     * account's actual is never repeated. Null when the year view uses the
     * account's annual budget.
     */
    months?: number | null;
}

interface BudgetVsActualData {
    fiscal_year?: number;
    month?: number | null;
    rows: BudgetRow[];
    totals: { budget: number; actual: number; variance: number };
}

type BudgetStatus = 'over' | 'within';
const STATUSES: BudgetStatus[] = ['over', 'within'];

function statusOf(row: BudgetRow): BudgetStatus {
    return row.variance < 0 ? 'over' : 'within';
}

const MONTHS_IN_YEAR = 12;

function varianceClass(variance: number) {
    return variance >= 0 ? 'text-emerald-700' : 'text-red-600';
}

export default function BudgetVsActualPage() {
    const { t, locale } = useI18n();
    const ui = t.accountingReportsUi.budget;
    const copy = t.accounting.reports.budgetVsActual;
    const currentYear = new Date().getFullYear();
    const [fiscalYear, setFiscalYear] = useState(currentYear);
    const [month, setMonth] = useState<number | null>(null);
    const [data, setData] = useState<BudgetVsActualData | null>(null);
    const [loading, setLoading] = useState(true);
    const { approvedOnly, setApprovedOnly, approvalEnabled, ready: approvalReady } = useApprovedOnly();
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [types, setTypes] = useState<string[]>([]);
    const [statuses, setStatuses] = useState<string[]>([]);
    const [varianceFilter, setVarianceFilter] = useState<NumberCondition | null>(null);

    // approvalReady holds the first fetch until the tenant's approved-only
    // setting is known, so the report is never generated against the wrong value.
    useEffect(() => {
        if (!approvalReady) return;
        let active = true;
        setLoading(true);
        setError(null);
        api.getBudgetVsActual({ approvedOnly, fiscalYear, month: month ?? undefined })
            .then((result: BudgetVsActualData) => {
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
    }, [fiscalYear, month, approvalReady, approvedOnly, t.accounting.reports.loadFailed]);

    const typeLabels = t.accountingShared.accountTypes as Record<string, string>;
    const typeLabel = (type: string) => typeLabels[type.toLowerCase()] ?? type.toLowerCase();
    const statusLabels: Record<BudgetStatus, string> = useMemo(() => ({ over: ui.overBudget, within: ui.withinBudget }), [ui]);

    const allRows = useMemo(() => data?.rows ?? [], [data]);
    // The year view compares a full year's actual, so a budget that covers only
    // some months says so under its figure.
    const yearView = (data?.month ?? null) === null;
    const rows = useMemo(
        () => allRows.filter((row) => matchesSearch(search, row.account.name, row.account.code)
            && matchesAnyOf(types, row.account.type)
            && matchesAnyOf(statuses, statusOf(row))
            && matchesNumberCondition(row.variance, varianceFilter)),
        [allRows, search, types, statuses, varianceFilter],
    );

    // The server's totals while every account is listed; the chips and the
    // search narrow them to the accounts shown.
    const totals = useMemo(() => {
        if (data && rows.length === allRows.length) return data.totals;
        const budget = rows.reduce((sum, row) => sum + row.budget, 0);
        const actual = rows.reduce((sum, row) => sum + row.actual, 0);
        return { budget, actual, variance: rows.reduce((sum, row) => sum + row.variance, 0) };
    }, [data, rows, allRows]);

    const columns = useMemo(() => [
        {
            id: 'account',
            header: t.accountingShared.account,
            accessorFn: (row: BudgetRow) => row.account.name,
            cell: ({ row }: { row: { original: BudgetRow } }) => (
                <span className="font-medium text-gray-800">
                    {row.original.account.name}
                    {row.original.account.code ? <span className="ms-2 text-xs text-gray-400">{row.original.account.code}</span> : null}
                </span>
            ),
        },
        {
            id: 'type',
            header: t.accountingShared.type,
            accessorFn: (row: BudgetRow) => row.account.type,
            meta: { hideOnMobile: true },
            cell: ({ row }: { row: { original: BudgetRow } }) => (
                <span className="text-xs capitalize text-gray-500">{typeLabel(row.original.account.type)}</span>
            ),
        },
        {
            id: 'budget',
            header: copy.budget,
            accessorKey: 'budget',
            meta: { align: 'end', hideOnMobile: true },
            cell: ({ row }: { row: { original: BudgetRow } }) => {
                const months = row.original.months;
                const partial = yearView && typeof months === 'number' && months > 0 && months < MONTHS_IN_YEAR;
                return (
                    <>
                        <span className="tabular-nums">{formatBDT(row.original.budget, { locale })}</span>
                        {partial ? (
                            <span className="block text-xs text-gray-400">
                                {formatMessage(ui.monthsBudgeted, {
                                    count: months.toLocaleString(locale),
                                    total: MONTHS_IN_YEAR.toLocaleString(locale),
                                })}
                            </span>
                        ) : null}
                    </>
                );
            },
            footer: () => formatBDT(totals.budget, { locale }),
        },
        {
            id: 'actual',
            header: copy.actual,
            accessorKey: 'actual',
            meta: { align: 'end', hideOnMobile: true },
            cell: ({ row }: { row: { original: BudgetRow } }) => (
                <span className="tabular-nums">{formatBDT(row.original.actual, { locale })}</span>
            ),
            footer: () => formatBDT(totals.actual, { locale }),
        },
        {
            id: 'variance',
            header: copy.variance,
            accessorKey: 'variance',
            meta: { align: 'end' },
            cell: ({ row }: { row: { original: BudgetRow } }) => (
                <span className={`font-semibold tabular-nums ${varianceClass(row.original.variance)}`}>
                    {row.original.variance >= 0 ? '+' : ''}{formatBDT(row.original.variance, { locale })}
                </span>
            ),
            footer: () => (
                <span className={varianceClass(totals.variance)}>
                    {totals.variance >= 0 ? '+' : ''}{formatBDT(totals.variance, { locale })}
                </span>
            ),
        },
        {
            id: 'variance_pct',
            header: copy.variancePct,
            accessorKey: 'variance_pct',
            meta: { align: 'end', hideOnMobile: true },
            cell: ({ row }: { row: { original: BudgetRow } }) => (
                <span className={`tabular-nums ${varianceClass(row.original.variance)}`}>
                    {signedPercent(row.original.variance_pct) ?? '—'}
                </span>
            ),
        },
        {
            id: 'status',
            header: ui.budgetStatus,
            accessorFn: (row: BudgetRow) => statusOf(row),
            cell: ({ row }: { row: { original: BudgetRow } }) => {
                const status = statusOf(row.original);
                return <StatusBadge tone={status === 'over' ? 'danger' : 'success'}>{statusLabels[status]}</StatusBadge>;
            },
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [t, ui, copy, statusLabels, locale, totals, yearView]);

    const monthOptions = useMemo(
        () => Array.from({ length: 12 }, (_, index) => ({
            value: String(index + 1),
            label: new Date(Date.UTC(2000, index, 1)).toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' }),
        })),
        [locale],
    );

    const typeOptions = useMemo(
        () => [...new Set(allRows.map((row) => row.account.type))].map((type) => ({ value: type, label: typeLabel(type) })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [allRows, typeLabels],
    );

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'fiscalYear',
            type: 'select',
            label: ui.fiscalYear,
            value: String(fiscalYear),
            // A budget is always for some year: All goes back to this one.
            onChange: (next) => setFiscalYear(next ? Number(next) : currentYear),
            options: [currentYear - 1, currentYear, currentYear + 1].map((year) => ({ value: String(year), label: String(year) })),
        },
        {
            id: 'month',
            type: 'select',
            label: ui.month,
            value: month === null ? null : String(month),
            // No month is the full year.
            onChange: (next) => setMonth(next ? Number(next) : null),
            options: monthOptions,
            title: month === null ? ui.fullYear : undefined,
        },
        {
            id: 'status',
            type: 'multi-select',
            label: ui.budgetStatus,
            value: statuses,
            onChange: setStatuses,
            options: STATUSES.map((status) => ({ value: status, label: statusLabels[status] })),
        },
        {
            id: 'type',
            type: 'multi-select',
            label: t.accountingShared.type,
            value: types,
            onChange: setTypes,
            options: typeOptions,
        },
        {
            id: 'variance',
            type: 'number',
            label: copy.variance,
            value: varianceFilter,
            onChange: setVarianceFilter,
            money: true,
            more: true,
        },
        ...approvedOnlyFilter(t, { approvalEnabled, approvedOnly, onChange: setApprovedOnly }).map((filter) => ({ ...filter, more: true })),
    ], [t, ui, copy, fiscalYear, currentYear, month, monthOptions, statuses, statusLabels, types, typeOptions, varianceFilter, approvalEnabled, approvedOnly, setApprovedOnly]);

    const stats = useMemo(() => {
        const budget = rows.reduce((sum, row) => sum + row.budget, 0);
        const actual = rows.reduce((sum, row) => sum + row.actual, 0);
        const variance = budget - actual;
        // Counted by account: the report has one row per account, and the strip
        // says so rather than relying on it.
        const accounts = new Set(rows.map((row) => row.account.id)).size;
        const over = new Set(rows.filter((row) => statusOf(row) === 'over').map((row) => row.account.id)).size;
        const items: ListStat[] = [
            { id: 'budget', icon: <Target aria-hidden />, label: copy.budget, value: wholeTaka(budget, locale) },
            { id: 'actual', icon: <Banknote aria-hidden />, label: copy.actual, value: wholeTaka(actual, locale) },
            {
                id: 'variance',
                icon: <Scale aria-hidden />,
                label: copy.variance,
                value: `${variance > 0 ? '+' : ''}${wholeTaka(variance, locale)}`,
                // Below zero, actual has run past the budget.
                tone: variance < 0 ? 'danger' : 'default',
            },
            {
                id: 'over',
                icon: <AlertTriangle aria-hidden />,
                label: ui.accountsOver,
                value: over.toLocaleString(locale),
                hint: formatMessage(ui.ofAccounts, { count: accounts.toLocaleString(locale) }),
                tone: over > 0 ? 'warning' : 'default',
            },
        ];
        return { items, loading, label: t.accountingReportsUi.common.stats };
    }, [rows, loading, locale, copy, ui, t]);

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
                tableId="accounting-budget-vs-actual"
                columns={columns as never}
                data={rows}
                isLoading={loading}
                emptyMessage={ui.empty}
                searchValue={search}
                onSearchChange={setSearch}
                searchPlaceholder={t.accountingReportsUi.common.searchAccounts}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                footerLabel={t.accountingShared.totals}
            />
        </AccountingPageShell>
    );
}
