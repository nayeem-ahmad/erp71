'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { HandCoins } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api, type CustomerDuesRow, type CustomerDuesSummary } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import { BranchFilter, Checkbox, CompactStat, PageHeader, PageShell, Select } from '@/components/ui';

/** Sales-rep filter values that are not an employee id. */
const ALL_REPS = '';
const MY_CUSTOMERS = 'me';
const NO_REP = 'none';

const columnHelper = createColumnHelper<CustomerDuesRow>();

/**
 * Sales › Reports › Customer Dues Summary: every customer of the chosen branch
 * with what they owe now.
 *
 * The branch is the server's filter; the sales rep and "only who owe" are the
 * page's own, over the rows already loaded, so the tiles always total exactly
 * the rows on screen. A viewer who is the sales rep of any customer listed
 * opens on their own customers.
 */
export default function CustomerDuesSummaryPage() {
    const { t, locale } = useI18n();
    const copy = t.salesReports.customerDues;
    const branch = useBranchScope({ startOnAll: true });
    const [data, setData] = useState<CustomerDuesSummary>({ me: null, rows: [] });
    const [loading, setLoading] = useState(true);
    const [rep, setRep] = useState(ALL_REPS);
    const [onlyWithDue, setOnlyWithDue] = useState(false);
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
                    if (me && result.rows.some((row) => row.sales_rep?.id === me.id)) setRep(MY_CUSTOMERS);
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
        return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    }, [data.rows]);

    const rows = useMemo(() => {
        const repId = rep === MY_CUSTOMERS ? data.me?.id : rep;
        return data.rows.filter((row) => {
            if (onlyWithDue && row.due_balance <= 0) return false;
            if (rep === ALL_REPS) return true;
            if (rep === NO_REP) return !row.sales_rep;
            return row.sales_rep?.id === repId;
        });
    }, [data, rep, onlyWithDue]);

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
                <Link href={routes.sales.customerDetail(info.row.original.id)} className="font-medium text-gray-900 hover:text-blue-600">
                    {info.getValue()}
                </Link>
            ),
            size: 220,
        }),
        columnHelper.accessor((row) => row.customer_code ?? t.shared.dash, {
            id: 'code', header: t.salesReports.common.code, size: 110, meta: { hideOnMobile: true },
        }),
        columnHelper.accessor((row) => row.phone ?? t.shared.dash, {
            id: 'phone', header: t.salesReports.common.phone, size: 130,
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
                return (
                    <span className={due > 0 ? 'font-semibold text-amber-700' : 'text-gray-500'}>
                        {formatBDT(due, { locale })}
                    </span>
                );
            },
            size: 130,
        }),
    ], [t, copy, locale]);

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
                        <Select
                            value={rep}
                            onChange={(event) => setRep(event.target.value)}
                            aria-label={copy.salesRep}
                            className="w-auto max-w-[14rem]"
                        >
                            <option value={ALL_REPS}>{copy.allSalesReps}</option>
                            {data.me ? <option value={MY_CUSTOMERS}>{copy.myCustomers}</option> : null}
                            {salesReps.map((salesRep) => (
                                <option key={salesRep.id} value={salesRep.id}>{salesRep.name}</option>
                            ))}
                            <option value={NO_REP}>{copy.noSalesRep}</option>
                        </Select>
                        <label className="inline-flex min-h-touch items-center gap-2 text-sm text-gray-700 md:min-h-0">
                            <Checkbox checked={onlyWithDue} onChange={(event) => setOnlyWithDue(event.target.checked)} />
                            {copy.onlyWithDue}
                        </label>
                    </>
                )}
            />

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <CompactStat label={copy.customers} value={rows.length} />
                <CompactStat label={copy.withDue} value={totals.withDue} />
                <CompactStat label={copy.totalDue} value={formatBDT(totals.due, { locale })} tone="warning" />
                <CompactStat label={copy.advance} value={formatBDT(totals.advance, { locale })} />
            </div>

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
            />
        </PageShell>
    );
}
