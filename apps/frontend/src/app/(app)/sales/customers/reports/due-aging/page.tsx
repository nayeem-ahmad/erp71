'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Clock } from 'lucide-react';
import { DataTable, type ListFilter } from '@/components/data-table';
import { api, type CustomerDueAging, type CustomerDueAgingRow } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { todayInTenantZone } from '@/lib/dashboard-range';
import { ALL_BRANCHES, handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import { BranchFilter, CompactStat, Input, PageHeader, PageShell } from '@/components/ui';

/** Sales-rep filter values that are not an employee id. */
const MY_CUSTOMERS = 'me';
const NO_REP = 'none';

/** What a row owes past each "Overdue" choice: every bracket from that age on. */
const OVERDUE_FROM: Record<string, (row: CustomerDueAgingRow) => number> = {
    '31': (row) => row.bucket_31_60 + row.bucket_61_90 + row.bucket_90_plus,
    '61': (row) => row.bucket_61_90 + row.bucket_90_plus,
    '91': (row) => row.bucket_90_plus,
};

type Named = { id: string; name: string };

/** The distinct `pick` of the rows, by name — the options a filter offers. */
function distinctByName(rows: CustomerDueAgingRow[], pick: (row: CustomerDueAgingRow) => Named | null) {
    const byId = new Map<string, string>();
    for (const row of rows) {
        const value = pick(row);
        if (value) byId.set(value.id, value.name);
    }
    return [...byId].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

const columnHelper = createColumnHelper<CustomerDueAgingRow>();

/**
 * Sales › Reports › Due Aging: who owes money, and how long each unpaid taka
 * has been owed.
 *
 * The branch and the "as of" day are the server's; the sales rep, overdue age,
 * group and territory are the page's own, over the rows already loaded, so the
 * tiles always total exactly the customers on screen. As on the Dues Summary, a
 * viewer who is the sales rep of any customer listed opens on their own.
 */
export default function DueAgingReportPage() {
    const { t, locale } = useI18n();
    const copy = t.salesReports.dueAging;
    const branch = useBranchScope({ startOnAll: true });
    const today = useMemo(() => todayInTenantZone(), []);
    const [asOf, setAsOf] = useState(today);
    const [data, setData] = useState<CustomerDueAging>({ me: null, rows: [] });
    const [loading, setLoading] = useState(true);
    const [rep, setRep] = useState<string | null>(null);
    const [overdue, setOverdue] = useState<string | null>(null);
    const [group, setGroup] = useState<string | null>(null);
    const [territory, setTerritory] = useState<string | null>(null);
    // The "my customers" default is applied once, on the first load: after
    // that the filter is the viewer's, and a reload keeps it.
    const repDefaulted = useRef(false);

    // An empty or today's date is "now": only a past day goes to the server.
    const apiAsOf = asOf && asOf !== today ? asOf : undefined;

    useEffect(() => {
        if (!branch.ready) return;
        let cancelled = false;
        setLoading(true);
        api.getDueAgingReport({ storeId: branch.apiStoreId, asOf: apiAsOf })
            .then((result) => {
                if (cancelled) return;
                setData(result);
                if (!repDefaulted.current) {
                    repDefaulted.current = true;
                    const me = result.me;
                    if (me && result.rows.some((row) => row.sales_rep?.id === me.id)) setRep(MY_CUSTOMERS);
                }
            })
            .catch((err) => {
                if (cancelled) return;
                setData({ me: null, rows: [] });
                if (handleBranchForbidden(err, branch, t.dashboardLayout.branchFilterForbidden)) return;
                console.error('Failed to load the due aging report', err);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branch.ready, branch.apiStoreId, apiAsOf]);

    const options = useMemo(() => ({
        reps: distinctByName(data.rows, (row) => row.sales_rep),
        groups: distinctByName(data.rows, (row) => row.customer_group),
        territories: distinctByName(data.rows, (row) => row.territory),
    }), [data.rows]);

    const rows = useMemo(() => {
        const repId = rep === MY_CUSTOMERS ? data.me?.id : rep;
        const overdueAmount = overdue ? OVERDUE_FROM[overdue] : null;
        return data.rows.filter((row) => {
            if (overdueAmount && overdueAmount(row) <= 0) return false;
            if (group && row.customer_group?.id !== group) return false;
            if (territory && row.territory?.id !== territory) return false;
            if (!rep) return true;
            if (rep === NO_REP) return !row.sales_rep;
            return row.sales_rep?.id === repId;
        });
    }, [data, rep, overdue, group, territory]);

    const totals = useMemo(() => rows.reduce(
        (acc, row) => ({
            b0_30: acc.b0_30 + row.bucket_0_30,
            b31_60: acc.b31_60 + row.bucket_31_60,
            b61_90: acc.b61_90 + row.bucket_61_90,
            b90plus: acc.b90plus + row.bucket_90_plus,
            total: acc.total + row.total,
        }),
        { b0_30: 0, b31_60: 0, b61_90: 0, b90plus: 0, total: 0 },
    ), [rows]);

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'salesRep',
            type: 'select',
            label: copy.salesRep,
            value: rep,
            onChange: setRep,
            options: [
                ...(data.me ? [{ value: MY_CUSTOMERS, label: copy.myCustomers }] : []),
                ...options.reps,
                { value: NO_REP, label: copy.noSalesRep },
            ],
        },
        {
            id: 'overdue',
            type: 'select',
            label: copy.overdue,
            value: overdue,
            onChange: setOverdue,
            options: [
                { value: '31', label: copy.overdue31 },
                { value: '61', label: copy.overdue61 },
                { value: '91', label: copy.overdue90 },
            ],
        },
        // Offered only where the tenant uses them, so a shop without groups or
        // territories is not handed two filters that can only empty the list.
        ...(options.groups.length > 0 ? [{
            id: 'group', type: 'select' as const, label: copy.group, value: group, onChange: setGroup, options: options.groups,
        }] : []),
        ...(options.territories.length > 0 ? [{
            id: 'territory', type: 'select' as const, label: copy.territory, value: territory, onChange: setTerritory, options: options.territories,
        }] : []),
    ], [copy, data.me, options, rep, overdue, group, territory]);

    const showBranch = branch.value === ALL_BRANCHES;

    const columns = useMemo(() => {
        const money = (value: number, className = 'text-gray-900') =>
            value > 0 ? <span className={className}>{formatBDT(value, { locale })}</span> : <span className="text-gray-300">{t.shared.dash}</span>;
        const bucket = (id: keyof CustomerDueAgingRow, header: string, className?: string) =>
            columnHelper.accessor((row) => row[id] as number, {
                id,
                header,
                cell: (info) => money(info.getValue(), className),
                size: 105,
                meta: { align: 'end', hideOnMobile: true },
            });
        const paidAgo = (days: number) => {
            if (days <= 0) return copy.paidToday;
            if (days === 1) return copy.paidDayAgo;
            return formatMessage(copy.paidDaysAgo, { days });
        };

        return [
            columnHelper.accessor((row) => row.customer.name, {
                id: 'customer',
                header: t.salesReports.common.customer,
                cell: (info) => {
                    const { customer } = info.row.original;
                    return (
                        <Link href={routes.sales.customerDetail(customer.id)} className="hover:text-blue-600">
                            <div className="font-medium text-gray-900">{customer.name}</div>
                            {customer.phone ? <div className="text-xs text-gray-400">{customer.phone}</div> : null}
                        </Link>
                    );
                },
                size: 180,
            }),
            bucket('bucket_0_30', copy.bucket0to30),
            bucket('bucket_31_60', copy.bucket31to60, 'text-amber-700'),
            bucket('bucket_61_90', copy.bucket61to90, 'text-amber-700'),
            bucket('bucket_90_plus', copy.bucket90plus, 'font-semibold text-red-600'),
            columnHelper.accessor('total', {
                header: copy.totalDue,
                cell: (info) => <span className="font-semibold text-gray-900">{formatBDT(info.getValue(), { locale })}</span>,
                size: 120,
                meta: { align: 'end' },
            }),
            columnHelper.accessor((row) => row.last_payment?.date ?? '', {
                id: 'lastPayment',
                header: copy.lastPayment,
                cell: (info) => {
                    const payment = info.row.original.last_payment;
                    if (!payment) return <span className="text-xs text-gray-400">{copy.neverPaid}</span>;
                    return (
                        <div>
                            <div className="text-gray-900">{formatDate(payment.date, locale)}</div>
                            <div className="whitespace-nowrap text-xs text-gray-400">
                                {formatBDT(payment.amount, { locale })} · {paidAgo(payment.days_ago)}
                            </div>
                        </div>
                    );
                },
                size: 170,
                meta: { hideOnMobile: true },
            }),
            // One branch picked: every row would repeat it.
            ...(showBranch ? [columnHelper.accessor((row) => row.store?.name ?? t.shared.dash, {
                id: 'branch', header: copy.branch, size: 130, meta: { hideOnMobile: true },
            })] : []),
            columnHelper.accessor((row) => row.sales_rep?.name ?? t.shared.dash, {
                id: 'salesRep', header: copy.salesRep, size: 130, meta: { hideOnMobile: true },
            }),
            ...(options.groups.length > 0 ? [columnHelper.accessor((row) => row.customer_group?.name ?? t.shared.dash, {
                id: 'group', header: copy.group, size: 110, meta: { hideOnMobile: true },
            })] : []),
            ...(options.territories.length > 0 ? [columnHelper.accessor((row) => row.territory?.name ?? t.shared.dash, {
                id: 'territory', header: copy.territory, size: 120, meta: { hideOnMobile: true },
            })] : []),
        ] as ColumnDef<CustomerDueAgingRow, any>[];
    }, [t, copy, locale, showBranch, options.groups.length, options.territories.length]);

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
                actions={(
                    <>
                        <BranchFilter scope={branch} />
                        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                            {copy.asOf}
                            <Input
                                type="date"
                                value={asOf}
                                max={today}
                                onChange={(event) => setAsOf(event.target.value)}
                                className="w-auto"
                            />
                        </label>
                    </>
                )}
            />

            {/* A bracket is tinted only while it holds money: an amber ৳0.00 reads as a problem. */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <CompactStat label={copy.bucket0to30} value={formatBDT(totals.b0_30, { locale })} />
                <CompactStat label={copy.bucket31to60} value={formatBDT(totals.b31_60, { locale })} tone={totals.b31_60 > 0 ? 'warning' : 'default'} />
                <CompactStat label={copy.bucket61to90} value={formatBDT(totals.b61_90, { locale })} tone={totals.b61_90 > 0 ? 'warning' : 'default'} />
                <CompactStat label={copy.bucket90plus} value={formatBDT(totals.b90plus, { locale })} tone={totals.b90plus > 0 ? 'negative' : 'default'} />
                <CompactStat label={copy.totalDue} value={formatBDT(totals.total, { locale })} className="col-span-2 md:col-span-1" />
            </div>

            <DataTable<CustomerDueAgingRow>
                tableId="customer-due-aging"
                columns={columns}
                data={rows}
                title={copy.tableTitle}
                isLoading={loading}
                emptyMessage={copy.empty}
                emptyIcon={<Clock className="h-16 w-16 text-gray-200" />}
                searchPlaceholder={copy.searchPlaceholder}
                getRowId={(row) => row.customer.id}
                filters={filters}
                viewOptions
            />
        </PageShell>
    );
}
