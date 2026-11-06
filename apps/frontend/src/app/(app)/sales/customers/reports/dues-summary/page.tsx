'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { HandCoins, PiggyBank, UserCheck, Users, Wallet } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { api, type CustomerDuesRow, type CustomerDuesSummary } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import { BranchFilter, PageHeader, PageShell } from '@/components/ui';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import type { NumberCondition } from '@/lib/number-condition';

/** Sales-rep filter values that are not an employee id. */
const MY_CUSTOMERS = 'me';
const NO_REP = 'none';

const columnHelper = createColumnHelper<CustomerDuesRow>();

/**
 * Sales › Reports › Customer Dues Summary: every customer of the chosen branch
 * with what they owe now.
 *
 * The branch is the server's filter; the sales rep, due amount, "only who owe"
 * and search chips are the page's own, over the rows already loaded, so the
 * strip always totals exactly the rows on screen. A viewer who is the sales rep of any customer listed
 * opens on their own customers.
 */
export default function CustomerDuesSummaryPage() {
    const { t, locale } = useI18n();
    const copy = t.salesReports.customerDues;
    const branch = useBranchScope({ startOnAll: true });
    const [data, setData] = useState<CustomerDuesSummary>({ me: null, rows: [] });
    const [loading, setLoading] = useState(true);
    const [reps, setReps] = useState<string[]>([]);
    const [dueFilter, setDueFilter] = useState<NumberCondition | null>(null);
    const [onlyWithDue, setOnlyWithDue] = useState(false);
    const [search, setSearch] = useState('');
    // The "my customers" default is applied once, on the first load: after
    // that the filter is the viewer's, and a branch change keeps it.
    const repDefaulted = useRef(false);

    useEffect(() => {
        if (!branch.ready) return;
        let cancelled = false;
        setLoading(true);
        api.getCustomerDuesSummary({ storeId: branch.apiStoreId })
            .then((result) => {
                if (cancelled) return;
                setData(result);
                if (!repDefaulted.current) {
                    repDefaulted.current = true;
                    const me = result.me;
                    if (me && result.rows.some((row) => row.sales_rep?.id === me.id)) setReps([MY_CUSTOMERS]);
                }
            })
            .catch((err) => {
                if (cancelled) return;
                setData({ me: null, rows: [] });
                if (handleBranchForbidden(err, branch, t.dashboardLayout.branchFilterForbidden)) return;
                console.error('Failed to load customer dues', err);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branch.ready, branch.apiStoreId]);

    const salesReps = useMemo(() => {
        const byId = new Map<string, string>();
        for (const row of data.rows) {
            if (row.sales_rep) byId.set(row.sales_rep.id, row.sales_rep.name);
        }
        return [...byId].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    }, [data.rows]);

    const rows = useMemo(() => {
        // "My customers" is the viewer's own employee id; "No sales rep" the empty one.
        const repIds = reps.map((value) => (value === MY_CUSTOMERS ? data.me?.id ?? MY_CUSTOMERS : value));
        return data.rows.filter((row) => {
            if (onlyWithDue && row.due_balance <= 0) return false;
            if (!matchesAnyOf(repIds, row.sales_rep?.id ?? NO_REP)) return false;
            if (!matchesNumberCondition(row.due_balance, dueFilter)) return false;
            return matchesSearch(search, row.name, row.customer_code, row.phone, row.sales_rep?.name, row.store?.name);
        });
    }, [data, reps, onlyWithDue, dueFilter, search]);

    const totals = useMemo(() => rows.reduce(
        (acc, row) => {
            if (row.due_balance > 0) {
                acc.withDue += 1;
                acc.due += row.due_balance;
            } else if (row.due_balance < 0) {
                acc.advance -= row.due_balance;
            }
            return acc;
        },
        { withDue: 0, due: 0, advance: 0 },
    ), [rows]);

    const columns: ColumnDef<CustomerDuesRow, any>[] = useMemo(() => [
        columnHelper.accessor('name', {
            header: t.salesReports.common.customer,
            cell: (info) => (
                <Link href={routes.sales.customerDetail(info.row.original.id)} className="hover:text-blue-600">
                    {info.getValue()}
                </Link>
            ),
            size: 220,
        }),
        columnHelper.accessor((row) => row.customer_code ?? t.shared.dash, {
            id: 'code', header: t.salesReports.common.code, size: 110, meta: { hideOnMobile: true },
        }),
        columnHelper.accessor((row) => row.phone ?? t.shared.dash, {
            id: 'phone', header: t.salesReports.common.phone, size: 130, meta: { hideOnMobile: true },
        }),
        columnHelper.accessor((row) => row.store?.name ?? t.shared.dash, {
            id: 'branch', header: copy.branch, size: 140, meta: { hideOnMobile: true },
        }),
        columnHelper.accessor((row) => row.sales_rep?.name ?? t.shared.dash, {
            id: 'salesRep', header: copy.salesRep, size: 140, meta: { hideOnMobile: true },
        }),
        columnHelper.accessor('due_balance', {
            header: copy.due,
            cell: (info) => {
                const due = Number(info.getValue() || 0);
                return <span className={due > 0 ? 'text-amber-700' : 'text-gray-500'}>{formatBDT(due, { locale })}</span>;
            },
            size: 130,
            meta: { align: 'end' },
        }),
    ], [t, copy, locale]);

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'salesRep',
            type: 'multi-select',
            label: copy.salesRep,
            value: reps,
            onChange: setReps,
            options: [
                ...(data.me ? [{ value: MY_CUSTOMERS, label: copy.myCustomers }] : []),
                ...salesReps,
                { value: NO_REP, label: copy.noSalesRep },
            ],
        },
        {
            id: 'due',
            type: 'number',
            label: copy.due,
            value: dueFilter,
            onChange: setDueFilter,
            money: true,
        },
        {
            id: 'onlyWithDue',
            type: 'toggle',
            label: copy.onlyWithDue,
            pressed: onlyWithDue,
            onChange: setOnlyWithDue,
            control: 'button',
        },
    ], [copy, data.me, salesReps, reps, dueFilter, onlyWithDue]);

    const stats = useMemo(() => {
        const items: ListStat[] = [
            { id: 'customers', icon: <Users aria-hidden />, label: copy.customers, value: rows.length.toLocaleString() },
            { id: 'withDue', icon: <UserCheck aria-hidden />, label: copy.withDue, value: totals.withDue.toLocaleString() },
            {
                id: 'due',
                icon: <Wallet aria-hidden />,
                label: copy.totalDue,
                value: formatBDT(totals.due, { locale }),
                tone: totals.due > 0 ? 'warning' : 'default',
            },
            { id: 'advance', icon: <PiggyBank aria-hidden />, label: copy.advance, value: formatBDT(totals.advance, { locale }) },
        ];
        return { items, loading: loading && data.rows.length === 0, label: copy.statsLabel };
    }, [rows.length, totals, loading, data.rows.length, locale, copy]);

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    copy.title,
                    'sales',
                )}
                actions={<BranchFilter scope={branch} />}
            />

            <DataTable<CustomerDuesRow>
                tableId="customer-dues-summary"
                columns={columns}
                data={rows}
                title={copy.tableTitle}
                isLoading={loading}
                emptyMessage={copy.empty}
                emptyIcon={<HandCoins className="h-16 w-16 text-gray-200" />}
                searchPlaceholder={copy.searchPlaceholder}
                getRowId={(row) => row.id}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
            />
        </PageShell>
    );
}
