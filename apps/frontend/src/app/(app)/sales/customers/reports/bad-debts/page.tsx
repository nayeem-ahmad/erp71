'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { ArrowUpRight, FileX, ReceiptText, RefreshCw, Undo2, Users, Wallet } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import { matchesAnyOf, matchesNumberCondition, matchesSearch, inDateRange } from '@/lib/list-filter';
import type { CreatedRange } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';
import { Button, ConfirmDialog, PageHeader, PageShell } from '@/components/ui';

type WriteOff = {
    id: string;
    payment_number: string | null;
    amount: number | string;
    notes: string | null;
    reason: string | null;
    created_at: string;
    accounting_voucher_number: string | null;
    customer: { id: string; name: string; phone: string | null } | null;
    creator: { id: string; name: string } | null;
};

/** The chips' value for a write-off whose customer or author is gone. */
const NONE = '__none__';

const columnHelper = createColumnHelper<WriteOff>();

/** The distinct `pick` of the rows, by name — the options a chip offers. */
function distinctByName(rows: WriteOff[], pick: (row: WriteOff) => { id: string; name: string } | null) {
    const byId = new Map<string, string>();
    for (const row of rows) {
        const value = pick(row);
        if (value) byId.set(value.id, value.name);
    }
    return [...byId].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The bad-debt register: every customer debt this workspace has forgiven.
 *
 * Exists because a write-off is the one AR action with no document from the
 * other side — nothing arrives in the post to file against it — so the list of
 * them, with who entered each and why, IS the audit trail. It is also the only
 * place a write-off can be undone, which is how a debt that is paid after being
 * written off gets back onto the customer's ledger.
 *
 * The register is loaded whole, so its chips narrow the rows here and the
 * strip adds up exactly what is left.
 */
export default function BadDebtsReportPage() {
    const { t, locale } = useI18n();
    const m = t.customers.profile.writeOff;
    const title = t.sales.hub.links.badDebts.title;

    const [writeOffs, setWriteOffs] = useState<WriteOff[]>([]);
    const [loading, setLoading] = useState(true);
    const [reversing, setReversing] = useState<string | null>(null);
    const [confirming, setConfirming] = useState<WriteOff | null>(null);
    const [dateRange, setDateRange] = useState<CreatedRange | null>(null);
    const [reasons, setReasons] = useState<string[]>([]);
    const [reasonsExclude, setReasonsExclude] = useState(false);
    const [customers, setCustomers] = useState<string[]>([]);
    const [amountFilter, setAmountFilter] = useState<NumberCondition | null>(null);
    const [creators, setCreators] = useState<string[]>([]);
    const [search, setSearch] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getCustomerWriteOffs();
            setWriteOffs(Array.isArray(data) ? data : []);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : t.common.error);
        } finally {
            setLoading(false);
        }
    }, [t.common.error]);

    useEffect(() => { void load(); }, [load]);

    const handleReverse = async (writeOff: WriteOff) => {
        setReversing(writeOff.id);
        try {
            await api.reverseCustomerWriteOff(writeOff.id);
            toast.success(m.reversed);
            setConfirming(null);
            await load();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : m.reverseFailed);
        } finally {
            setReversing(null);
        }
    };

    const reasonLabel = useCallback(
        (reason: string | null) => (reason && reason in m.reasons ? m.reasons[reason as keyof typeof m.reasons] : null),
        [m],
    );

    const rows = useMemo(
        () => writeOffs.filter((row) => (
            inDateRange(row.created_at, dateRange)
            && matchesAnyOf(reasons, row.reason ?? NONE, reasonsExclude)
            && matchesAnyOf(customers, row.customer?.id ?? NONE)
            && matchesAnyOf(creators, row.creator?.id ?? NONE)
            && matchesNumberCondition(Number(row.amount), amountFilter)
            && matchesSearch(
                search,
                row.payment_number,
                row.customer?.name,
                row.customer?.phone,
                reasonLabel(row.reason),
                row.notes,
                row.creator?.name,
                row.accounting_voucher_number,
            )
        )),
        [writeOffs, dateRange, reasons, reasonsExclude, customers, creators, amountFilter, search, reasonLabel],
    );

    const total = useMemo(() => rows.reduce((sum, row) => sum + Number(row.amount), 0), [rows]);

    const columns = useMemo<ColumnDef<WriteOff, any>[]>(() => [
        columnHelper.accessor('created_at', {
            header: t.common.date,
            cell: (info) => (
                <div className="min-w-0">
                    <span>{formatDate(info.getValue(), locale)}</span>
                    {info.row.original.payment_number ? (
                        <span className="block truncate text-gray-500">{info.row.original.payment_number}</span>
                    ) : null}
                </div>
            ),
            footer: () => t.common.total,
            sortingFn: 'datetime',
            size: 130,
        }),
        columnHelper.accessor((row) => row.customer?.name ?? '', {
            id: 'customer',
            header: t.common.customer,
            cell: (info) => {
                const customer = info.row.original.customer;
                if (!customer) return <span className="text-gray-400">—</span>;
                return (
                    <Link href={routes.sales.customerDetail(customer.id)} className="text-blue-600 hover:underline">
                        {customer.name}
                    </Link>
                );
            },
            size: 180,
        }),
        columnHelper.accessor((row) => reasonLabel(row.reason) ?? '—', {
            id: 'reason',
            header: m.reason,
            size: 170,
        }),
        columnHelper.accessor((row) => row.notes ?? '—', {
            id: 'notes',
            header: m.notes,
            size: 220,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor((row) => row.creator?.name ?? '—', {
            id: 'recordedBy',
            header: m.recordedBy,
            cell: (info) => (
                <div className="min-w-0">
                    <span>{info.getValue()}</span>
                    {info.row.original.accounting_voucher_number ? (
                        <span className="block truncate text-gray-500">{info.row.original.accounting_voucher_number}</span>
                    ) : null}
                </div>
            ),
            size: 150,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor((row) => Number(row.amount), {
            id: 'amount',
            header: t.common.amount,
            cell: (info) => formatBDT(info.getValue(), { locale }),
            footer: () => formatBDT(total, { locale }),
            size: 130,
            meta: { align: 'end' },
        }),
        columnHelper.display({
            id: 'actions',
            header: t.common.actions,
            cell: (info) => (
                <RowActions>
                    <RowActionButton
                        icon={<Undo2 />}
                        label={m.reverse}
                        intent="warning"
                        onClick={() => setConfirming(info.row.original)}
                        disabled={reversing === info.row.original.id}
                    />
                </RowActions>
            ),
            size: 80,
            enableSorting: false,
        }),
    ], [t, m, locale, total, reversing, reasonLabel]);

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'date',
            type: 'date-range',
            label: t.common.date,
            value: dateRange,
            onChange: setDateRange,
            operators: true,
        },
        {
            id: 'reason',
            type: 'multi-select',
            label: m.reason,
            value: reasons,
            onChange: setReasons,
            exclude: { value: reasonsExclude, onChange: setReasonsExclude },
            options: Object.entries(m.reasons).map(([value, label]) => ({ value, label })),
        },
        {
            id: 'customer',
            type: 'multi-select',
            label: t.common.customer,
            value: customers,
            onChange: setCustomers,
            options: distinctByName(writeOffs, (row) => row.customer),
            searchable: true,
        },
        {
            id: 'amount',
            type: 'number',
            label: t.common.amount,
            value: amountFilter,
            onChange: setAmountFilter,
            money: true,
        },
        {
            id: 'recordedBy',
            type: 'multi-select',
            label: m.recordedBy,
            value: creators,
            onChange: setCreators,
            options: distinctByName(writeOffs, (row) => row.creator),
            more: true,
        },
    ], [t, m, dateRange, reasons, reasonsExclude, customers, writeOffs, amountFilter, creators]);

    const stats = useMemo(() => {
        const largest = rows.reduce((max, row) => Math.max(max, Number(row.amount)), 0);
        const customerCount = new Set(rows.map((row) => row.customer?.id ?? NONE)).size;
        const items: ListStat[] = [
            {
                id: 'total',
                icon: <Wallet aria-hidden />,
                label: m.writtenOffTotal,
                value: formatBDT(total, { locale }),
                tone: total > 0 ? 'warning' : 'default',
            },
            { id: 'count', icon: <ReceiptText aria-hidden />, label: m.writeOffs, value: rows.length.toLocaleString() },
            { id: 'customers', icon: <Users aria-hidden />, label: m.customers, value: customerCount.toLocaleString() },
            {
                id: 'largest',
                icon: <ArrowUpRight aria-hidden />,
                label: m.largest,
                value: rows.length > 0 ? formatBDT(largest, { locale }) : '—',
            },
        ];
        return { items, loading: loading && writeOffs.length === 0, label: m.statsLabel };
    }, [rows, total, loading, writeOffs.length, locale, m]);

    return (
        <PageShell>
            <PageHeader
                title={title}
                subtitle={t.sales.hub.links.badDebts.description}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    title,
                    'sales',
                )}
                actions={
                    <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()}>
                        {t.common.refresh}
                    </Button>
                }
            />

            <DataTable<WriteOff>
                title={title}
                tableId="sales-bad-debts"
                columns={columns}
                data={rows}
                getRowId={(row) => row.id}
                isLoading={loading}
                emptyMessage={t.common.noData}
                emptyIcon={<FileX className="h-16 w-16 text-gray-200" />}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
            />

            {confirming && (
                <ConfirmDialog
                    open
                    danger
                    title={m.reverse}
                    prompt={m.reverseConfirm}
                    confirmLabel={m.reverse}
                    cancelLabel={m.cancel}
                    loading={reversing === confirming.id}
                    onConfirm={() => void handleReverse(confirming)}
                    onCancel={() => setConfirming(null)}
                />
            )}
        </PageShell>
    );
}
