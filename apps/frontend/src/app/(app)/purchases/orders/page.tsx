'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { AlarmClock, Eye, FileText, PackageCheck, Plus, Printer, Truck, Wallet } from 'lucide-react';
import Link from 'next/link';
import { DataTable, createdAtColumn, type ListFilter, type ListStat } from '@/components/data-table';
import { applyCreatedRangeQuery, applyDateRangeQuery, type CreatedRange } from '@/lib/created-range';
import { api, type PurchaseDocumentListFilterParams, type PurchaseOrderListSummary } from '@/lib/api';
import { BranchFilter, PageShell, StatusBadge, buttonClassName, type StatusBadgeTone } from '@/components/ui';
import { RowActions, RowActionButton } from '@/components/table';
import { useBranchForbiddenReset, useBranchScope } from '@/lib/branch-scope';
import { formatBDT, formatDate } from '@/lib/format';
import CreatePurchaseOrderModal from './CreatePurchaseOrderModal';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { useI18n, formatMessage } from '@/lib/i18n';
import type { NumberCondition } from '@/lib/number-condition';
import { useServerList } from '@/hooks/useServerList';
import { useListSummary } from '@/hooks/useListSummary';
import { supplierListFilter } from '../components/supplier-list-filter';

interface POItem {
    id: string;
    quantity: number;
    product?: { name: string } | null;
}

interface PurchaseOrder {
    id: string;
    po_number: string;
    status: string;
    total_amount: string | number;
    expected_date: string | null;
    created_at: string;
    supplier?: { name: string } | null;
    store?: { name: string } | null;
    items: POItem[];
}

const PO_STATUSES = ['DRAFT', 'SENT', 'RECEIVED', 'CANCELLED'] as const;
/** Still waiting on the goods — the ones an expected date can make late. */
const OPEN_STATUSES = new Set(['DRAFT', 'SENT']);

const statusTones: Record<string, StatusBadgeTone> = {
    DRAFT: 'neutral',
    SENT: 'info',
    RECEIVED: 'success',
    // Neutral rather than red: a cancelled order is void, not an error.
    CANCELLED: 'neutral',
};

const columnHelper = createColumnHelper<PurchaseOrder>();

function startOfToday(): number {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export default function PurchaseOrdersPage() {
    const { t, locale, fmt } = useI18n();
    const branch = useBranchScope();
    const [modalOpen, setModalOpen] = useState(false);

    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [expectedRange, setExpectedRange] = useState<CreatedRange | null>(null);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [statusExclude, setStatusExclude] = useState(false);
    const [supplierIds, setSupplierIds] = useState<string[]>([]);
    const [totalFilter, setTotalFilter] = useState<NumberCondition | null>(null);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    // The order's own date is when the goods are expected.
    const filterParams = useMemo<PurchaseDocumentListFilterParams>(
        () => ({
            search: debouncedSearch || undefined,
            status: statusFilter.length ? statusFilter.join(',') : undefined,
            statusExclude,
            ...applyDateRangeQuery(expectedRange),
            ...applyCreatedRangeQuery(createdRange),
            storeId: branch.apiStoreId,
            supplierIds,
            total: totalFilter,
        }),
        [debouncedSearch, statusFilter, statusExclude, expectedRange, createdRange, branch.apiStoreId, supplierIds, totalFilter],
    );

    const { items: orders, loading, error: listError, serverPagination, reload } = useServerList<PurchaseOrder>({
        tableId: 'purchase-orders',
        initialSort: { id: 'created_at', desc: true },
        deps: [filterParams],
        enabled: branch.ready,
        fetch: (params) => api.getPurchaseOrdersList({ ...params, ...filterParams }),
    });
    useBranchForbiddenReset(listError, branch, t.dashboardLayout.branchFilterForbidden);

    const { summary, loading: summaryLoading, reload: reloadSummary } = useListSummary<
        PurchaseDocumentListFilterParams,
        PurchaseOrderListSummary
    >({ fetch: api.getPurchaseOrdersListSummary, params: filterParams, enabled: branch.ready });

    const columns: ColumnDef<PurchaseOrder, any>[] = useMemo(() => {
        const today = startOfToday();
        return [
            columnHelper.accessor('po_number', {
                header: t.purchaseOrders.columns.poNumber,
                cell: (info) => (
                    <Link
                        href={routes.purchases.orderDetail(info.row.original.id)}
                        className="font-medium text-gray-900 hover:text-blue-600 hover:underline"
                    >
                        {info.getValue()}
                    </Link>
                ),
                size: 140,
            }),
            columnHelper.accessor('expected_date', {
                header: t.purchaseOrders.columns.expected,
                enableColumnFilter: false,
                cell: (info) => {
                    const value = info.getValue();
                    if (!value) return <span className="text-gray-400">—</span>;
                    // An open order past its date is the one to chase.
                    const late = OPEN_STATUSES.has(info.row.original.status) && new Date(value).getTime() < today;
                    return (
                        <span className={late ? 'font-medium text-amber-700' : undefined}>
                            {formatDate(value, locale)}
                        </span>
                    );
                },
                size: 130,
            }),
            createdAtColumn(columnHelper, { header: t.common.createdAt, locale, enableColumnFilter: false }),
            columnHelper.accessor((row) => row.supplier?.name ?? '', {
                id: 'supplier',
                header: t.purchaseOrders.columns.supplier,
                cell: (info) => info.getValue() || <span className="text-gray-400">{t.purchaseOrders.noSupplier}</span>,
                size: 180,
            }),
            columnHelper.accessor((row) => row.items?.length ?? 0, {
                id: 'item_count',
                header: t.purchaseOrders.columns.items,
                enableSorting: false,
                cell: (info) => formatMessage(t.purchaseShared.itemsCount, { count: info.getValue() }),
                size: 90,
                meta: { align: 'end', hideOnMobile: true },
            }),
            columnHelper.accessor('total_amount', {
                header: t.purchaseOrders.columns.total,
                cell: (info) => formatBDT(Number(info.getValue() || 0), { locale }),
                size: 130,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('status', {
                header: t.purchaseOrders.columns.status,
                enableColumnFilter: false,
                cell: (info) => {
                    const status = info.getValue() as keyof typeof t.purchaseShared.status;
                    return (
                        <StatusBadge tone={statusTones[status] ?? 'neutral'}>
                            {t.purchaseShared.status[status] ?? status}
                        </StatusBadge>
                    );
                },
                size: 120,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.purchaseQuotations.columns.actions,
                cell: ({ row }) => (
                    <RowActions>
                        <RowActionButton
                            icon={<Eye />}
                            label={t.purchaseOrders.view}
                            href={routes.purchases.orderDetail(row.original.id)}
                        />
                        <RowActionButton
                            icon={<Printer />}
                            label={t.purchaseOrders.print}
                            href={routes.purchases.orderInvoice(row.original.id)}
                        />
                    </RowActions>
                ),
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 100,
            }),
        ];
    }, [t, locale]);

    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'expected',
                type: 'date-range',
                label: t.purchaseShared.lists.orders.expectedDate,
                value: expectedRange,
                onChange: setExpectedRange,
                operators: true,
            },
            {
                id: 'status',
                type: 'multi-select',
                label: t.purchaseOrders.columns.status,
                value: statusFilter,
                onChange: setStatusFilter,
                exclude: { value: statusExclude, onChange: setStatusExclude },
                options: PO_STATUSES.map((value) => ({ value, label: t.purchaseShared.status[value] ?? value })),
            },
            supplierListFilter({
                label: t.purchaseOrders.columns.supplier,
                noSupplierLabel: t.purchaseOrders.noSupplier,
                value: supplierIds,
                onChange: setSupplierIds,
            }),
            {
                id: 'total',
                type: 'number',
                label: t.purchaseOrders.columns.total,
                value: totalFilter,
                onChange: setTotalFilter,
                money: true,
            },
            { id: 'created', type: 'date-range', value: createdRange, onChange: setCreatedRange, operators: true, more: true },
        ],
        [t, expectedRange, statusFilter, statusExclude, supplierIds, totalFilter, createdRange],
    );

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const copy = t.purchaseShared.lists.orders.stats;
        const dash = '—';
        const items: ListStat[] = [
            {
                id: 'count',
                icon: <FileText aria-hidden />,
                label: copy.orders,
                value: summary ? summary.count.toLocaleString(locale) : dash,
                hint: summary?.cancelledCount ? fmt(copy.cancelled, { count: summary.cancelledCount }) : undefined,
            },
            { id: 'value', icon: <Wallet aria-hidden />, label: copy.value, value: summary ? money(summary.value) : dash },
            {
                id: 'open',
                icon: <Truck aria-hidden />,
                label: copy.open,
                value: summary ? money(summary.open.amount) : dash,
                hint: summary?.open.count ? fmt(copy.openCount, { count: summary.open.count }) : undefined,
            },
            {
                id: 'received',
                icon: <PackageCheck aria-hidden />,
                label: copy.received,
                value: summary ? money(summary.received.amount) : dash,
                hint: summary?.received.count ? fmt(copy.receivedCount, { count: summary.received.count }) : undefined,
            },
            {
                id: 'overdue',
                icon: <AlarmClock aria-hidden />,
                label: copy.overdue,
                value: summary ? summary.overdue.toLocaleString(locale) : dash,
                tone: summary && summary.overdue > 0 ? 'warning' : 'default',
            },
        ];
        return { items, loading: summaryLoading && !summary, label: t.purchaseShared.lists.orders.statsLabel };
    }, [summary, summaryLoading, locale, t, fmt]);

    return (
        <PageShell>
            <PageHeader
                title={t.purchaseOrders.title}
                subtitle={t.purchaseOrders.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.purchase,
                    t.purchaseOrders.title,
                    'purchases',
                )}
                actions={(
                    <>
                        <BranchFilter scope={branch} />
                        <button type="button" onClick={() => setModalOpen(true)} className={buttonClassName()}>
                            <Plus className="w-4 h-4" />
                            {t.purchaseOrders.newPo}
                        </button>
                    </>
                )}
            />

            <CreatePurchaseOrderModal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                onSuccess={() => {
                    void reload();
                    reloadSummary();
                }}
            />

            <DataTable<PurchaseOrder>
                tableId="purchase-orders"
                columns={columns}
                data={orders}
                title={t.purchaseOrders.tableTitle}
                isLoading={loading}
                emptyMessage={t.purchaseOrders.emptyMessage}
                emptyIcon={<FileText className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={t.purchaseOrders.searchPlaceholder}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                serverPagination={serverPagination}
            />
        </PageShell>
    );
}
