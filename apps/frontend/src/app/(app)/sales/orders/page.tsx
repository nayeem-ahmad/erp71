'use client';

import { useState, useEffect, useMemo } from 'react';
import {
    AlarmClock,
    CheckCircle2,
    ClipboardList,
    Eye,
    HandCoins,
    PackageCheck,
    Pencil,
    PlayCircle,
    Plus,
    Printer,
    ReceiptText,
    Trash2,
    Truck,
    Wallet,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
    api,
    type SalesOrderListFilterParams,
    type SalesOrderListSummary,
    type SalesOrderPaymentStatus,
} from '@/lib/api';
import { formatBDT, formatDate, formatDateTime } from '@/lib/format';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, createdAtColumn, type BulkAction, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import { applyCreatedRangeQuery, applyDateRangeQuery, type CreatedRange } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';
import { useServerList } from '@/hooks/useServerList';
import { useListSummary } from '@/hooks/useListSummary';
import { customerListFilter } from '../components/customer-list-filter';
import { toast } from '@/lib/toast';
import { SIMPLE_DOC_STYLES, openPrintWindow, renderHeaderHtml, sheetPaper } from '@/lib/print';
import type { HeaderContext, PrintSheet } from '@/lib/print';
import { usePrintHeader } from '@/lib/print/use-print-header';
import { useSalePrintPrefs } from '@/lib/hooks/useSalePrintPrefs';
import { useI18n, formatMessage } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { BranchFilter, ConfirmDialog, PageShell, StatusBadge, buttonClassName, type StatusBadgeTone } from '@/components/ui';
import { useBranchForbiddenReset, useBranchScope } from '@/lib/branch-scope';

interface SalesOrder {
    id: string;
    order_number: string;
    created_at: string;
    total_amount: string;
    /** VAT added on top of the lines; part of `total_amount`. */
    vat_amount?: string | null;
    amount_paid: string;
    status: string;
    payment_status: string;
    delivery_date?: string | null;
    items: any[];
    deposits: any[];
    customer?: { name: string; phone?: string } | null;
    store_id?: string;
}

const ORDER_STATUSES = ['DRAFT', 'CONFIRMED', 'PROCESSING', 'DELIVERED', 'CANCELLED'] as const;
const PAYMENT_STATUSES: readonly SalesOrderPaymentStatus[] = ['UNPAID', 'PARTIAL', 'PAID'];
/** Still to be delivered — the ones a delivery date can make late. */
const OPEN_STATUSES = new Set(['DRAFT', 'CONFIRMED', 'PROCESSING']);

const statusTones: Record<string, StatusBadgeTone> = {
    DRAFT: 'neutral',
    CONFIRMED: 'info',
    PROCESSING: 'warning',
    DELIVERED: 'success',
    CANCELLED: 'danger',
};

const paymentTones: Record<string, StatusBadgeTone> = {
    UNPAID: 'neutral',
    PARTIAL: 'warning',
    PAID: 'success',
};

const columnHelper = createColumnHelper<SalesOrder>();

function startOfToday(): number {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export default function OrdersPage() {
    const { t, locale, fmt } = useI18n();
    const branch = useBranchScope();
    const printHeader = usePrintHeader('SALES_ORDER');
    // This browser's paper, as invoices print on; A4 for a till roll.
    const paper = sheetPaper(useSalePrintPrefs().paperSize);
    const router = useRouter();
    const searchParams = useSearchParams();
    // Bookmarks from when online orders shared this page as `?tab=online`.
    const redirectingOnline = searchParams.get('tab') === 'online';
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [deliveryRange, setDeliveryRange] = useState<CreatedRange | null>(null);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [statusExclude, setStatusExclude] = useState(false);
    const [customerIds, setCustomerIds] = useState<string[]>([]);
    const [paymentStatus, setPaymentStatus] = useState<string[]>([]);
    const [totalFilter, setTotalFilter] = useState<NumberCondition | null>(null);
    const [pendingDelete, setPendingDelete] = useState<SalesOrder | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [selectedOrders, setSelectedOrders] = useState<SalesOrder[]>([]);
    const [clearSelectionSignal, setClearSelectionSignal] = useState(0);
    const [bulkBusy, setBulkBusy] = useState(false);
    /** A bulk step that needs a yes first: delivery moves stock, delete is final. */
    const [pendingBulk, setPendingBulk] = useState<{ kind: 'deliver' | 'delete'; rows: SalesOrder[] } | null>(null);

    useEffect(() => {
        if (redirectingOnline) router.replace(routes.storefront.root);
    }, [redirectingOnline, router]);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    // The order's own date is the day it is promised to the customer.
    const filterParams = useMemo<SalesOrderListFilterParams>(
        () => ({
            search: debouncedSearch || undefined,
            status: statusFilter.length ? statusFilter.join(',') : undefined,
            statusExclude,
            ...applyDateRangeQuery(deliveryRange),
            ...applyCreatedRangeQuery(createdRange),
            storeId: branch.apiStoreId,
            customerIds,
            paymentStatus: paymentStatus as SalesOrderPaymentStatus[],
            total: totalFilter,
        }),
        [
            debouncedSearch, statusFilter, statusExclude, deliveryRange, createdRange, branch.apiStoreId,
            customerIds, paymentStatus, totalFilter,
        ],
    );

    const listEnabled = branch.ready && !redirectingOnline;
    const { items: orders, loading, error: listError, serverPagination, reload } = useServerList<SalesOrder>({
        tableId: 'sales-orders',
        initialSort: { id: 'created_at', desc: true },
        deps: [filterParams],
        enabled: listEnabled,
        fetch: (params) => api.getOrdersList({ ...params, ...filterParams }),
    });
    useBranchForbiddenReset(listError, branch, t.dashboardLayout.branchFilterForbidden);

    const { summary, loading: summaryLoading, reload: reloadSummary } = useListSummary<
        SalesOrderListFilterParams,
        SalesOrderListSummary
    >({ fetch: api.getOrdersListSummary, params: filterParams, enabled: listEnabled });

    const refresh = async () => {
        reloadSummary();
        await reload();
    };

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        setDeleting(true);
        try {
            await api.deleteOrder(pendingDelete.id);
            setPendingDelete(null);
            toast.success(t.orders.deleted);
            void refresh();
        } catch (error: any) {
            toast.error(error?.message || t.shared.errors.deleteOrder);
        } finally {
            setDeleting(false);
        }
    };

    /**
     * One step over the ticked orders, one request at a time — delivery moves
     * stock in a transaction per order, and a burst of them would only queue
     * behind each other on the server anyway. Orders that fail are named; the
     * rest stay done.
     */
    const runBulk = async (rows: SalesOrder[], step: (order: SalesOrder) => Promise<unknown>, doneMessage: string) => {
        setBulkBusy(true);
        const failed: string[] = [];
        for (const order of rows) {
            try {
                await step(order);
            } catch {
                failed.push(order.order_number);
            }
        }
        const done = rows.length - failed.length;
        if (done > 0) toast.success(formatMessage(doneMessage, { count: done }));
        if (failed.length > 0) toast.error(formatMessage(t.orders.bulk.failed, { numbers: failed.join(', ') }));
        setBulkBusy(false);
        setPendingBulk(null);
        setClearSelectionSignal((n) => n + 1);
        await refresh();
    };

    const advance = (rows: SalesOrder[], status: string) =>
        runBulk(rows, (order) => api.updateOrderStatus(order.id, status), t.orders.bulk.updated);

    const confirmBulk = () => {
        if (!pendingBulk) return;
        if (pendingBulk.kind === 'deliver') void advance(pendingBulk.rows, 'DELIVERED');
        else void runBulk(pendingBulk.rows, (order) => api.deleteOrder(order.id), t.orders.bulk.deleted);
    };

    /** One order as it prints, on the letterhead it was given. */
    const orderSheet = (order: SalesOrder, header: Awaited<ReturnType<typeof printHeader.resolve>>): PrintSheet => {
        const context: HeaderContext = {
            docTitle: t.shared.print.salesOrder,
            docNumber: order.order_number,
            docDate: formatDate(order.created_at, locale),
            companyName: header.companyName,
        };
        return {
            context,
            headerConfig: header.headerConfig,
            headerHtml: renderHeaderHtml(header.headerConfig, context, paper),
            bodyHtml: `
                <h1>${order.order_number}</h1>
                <div class="subtitle">${formatMessage(t.shared.print.datePayment, {
                    date: formatDateTime(order.created_at, locale),
                    status: t.shared.statuses.order[order.status as keyof typeof t.shared.statuses.order] ?? order.status,
                    payment: t.shared.statuses.payment[order.payment_status as keyof typeof t.shared.statuses.payment] ?? order.payment_status,
                })}</div>
                <p><strong>${t.shared.print.customer}</strong> ${order.customer?.name || t.shared.walkIn}</p>
                <table>
                    <thead><tr><th>${t.shared.print.product}</th><th>${t.shared.print.qty}</th><th>${t.shared.print.price}</th><th>${t.shared.print.subtotal}</th></tr></thead>
                    <tbody>
                        ${order.items.map((item: any) => `<tr><td>${item.product?.name || t.shared.item}</td><td>${item.quantity}</td><td>${formatBDT(Number(item.price_at_order), { locale })}</td><td>${formatBDT(item.quantity * Number(item.price_at_order), { locale })}</td></tr>`).join('')}
                        ${Number(order.vat_amount ?? 0) > 0.005 ? `<tr><td colspan="3">${t.sales.invoice.vat}</td><td>${formatBDT(Number(order.vat_amount), { locale })}</td></tr>` : ''}
                        <tr class="total-row"><td colspan="3">${t.shared.print.total}</td><td>${formatBDT(Number(order.total_amount), { locale })}</td></tr>
                    </tbody>
                </table>
                <p><strong>${t.shared.print.paid}</strong> ${formatBDT(Number(order.amount_paid), { locale })} | <strong>${t.shared.print.due}</strong> ${formatBDT(Number(order.total_amount) - Number(order.amount_paid), { locale })}</p>`,
            footerHtml: `<div class="footer">${t.shared.print.salesOrder}</div>`,
        };
    };

    const handlePrint = async (order: SalesOrder) => {
        // The order's own branch letterhead, not the one resolved on mount.
        const header = await printHeader.resolve(order.store_id);
        const sheet = orderSheet(order, header);
        openPrintWindow({
            ...sheet,
            title: order.order_number,
            paperSize: paper,
            styles: SIMPLE_DOC_STYLES,
            compactable: true,
            repeatHeader: true,
        });
    };

    /**
     * The ticked orders as one print job, each on a page of its own. Offered
     * only when they share a branch, so the whole job is on one letterhead.
     */
    const printSelected = async (rows: SalesOrder[]) => {
        if (rows.length === 0) return;
        const header = await printHeader.resolve(rows[0].store_id);
        openPrintWindow({
            title: `${t.orders.title} (${rows.length})`,
            paperSize: paper,
            headerConfig: header.headerConfig,
            styles: SIMPLE_DOC_STYLES,
            compactable: true,
            repeatHeader: true,
            sheets: rows.map((order) => orderSheet(order, header)),
        });
    };

    const columns: ColumnDef<SalesOrder, any>[] = useMemo(() => {
        const today = startOfToday();
        return [
            columnHelper.accessor('order_number', {
                header: t.orders.columns.orderNumber,
                cell: (info) => (
                    <Link
                        href={routes.sales.orderDetail(info.row.original.id)}
                        className="font-medium text-gray-900 hover:text-blue-600 hover:underline"
                    >
                        {info.getValue()}
                    </Link>
                ),
                size: 140,
            }),
            columnHelper.accessor('delivery_date', {
                header: t.shared.form.deliveryDate,
                cell: (info) => {
                    const value = info.getValue();
                    if (!value) return <span className="text-gray-400">—</span>;
                    // An order still to go out past its promised day is late.
                    const late = OPEN_STATUSES.has(info.row.original.status) && new Date(value).getTime() < today;
                    return <span className={late ? 'font-medium text-amber-700' : undefined}>{formatDate(value, locale)}</span>;
                },
                size: 130,
            }),
            createdAtColumn(columnHelper, { header: t.common.createdAt, locale, enableColumnFilter: false }),
            columnHelper.accessor((row) => row.customer?.name ?? '', {
                id: 'customer',
                header: t.orders.columns.customer,
                cell: (info) => info.getValue() || <span className="text-gray-400">{t.shared.walkIn}</span>,
                size: 150,
            }),
            columnHelper.accessor('total_amount', {
                header: t.orders.columns.total,
                cell: (info) => formatBDT(parseFloat(info.getValue()), { locale }),
                size: 130,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('payment_status', {
                header: t.orders.columns.payment,
                cell: (info) => {
                    const status = info.getValue();
                    return (
                        <StatusBadge tone={paymentTones[status] ?? 'neutral'}>
                            {t.shared.statuses.payment[status as keyof typeof t.shared.statuses.payment] ?? status}
                        </StatusBadge>
                    );
                },
                size: 100,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('status', {
                header: t.orders.columns.status,
                cell: (info) => {
                    const status = info.getValue();
                    return (
                        <StatusBadge tone={statusTones[status] ?? 'neutral'}>
                            {t.shared.statuses.order[status as keyof typeof t.shared.statuses.order] ?? status}
                        </StatusBadge>
                    );
                },
                size: 120,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.orders.columns.actions,
                cell: (info) => {
                    const row = info.row.original;
                    return (
                        <RowActions>
                            <RowActionButton icon={<Eye />} label={t.common.view} href={routes.sales.orderDetail(row.id)} />
                            <RowActionButton icon={<Pencil />} label={t.common.edit} href={`${routes.sales.orderDetail(row.id)}?edit=true`} />
                            {/* Opens the sale entry screen seeded from this
                                order; the sale records the link back when it is
                                saved. */}
                            <RowActionButton
                                icon={<ReceiptText />}
                                label={t.orders.convertToSale}
                                intent="success"
                                href={`${routes.sales.new}?salesOrderId=${row.id}`}
                            />
                            <RowActionButton icon={<Printer />} label={t.common.print} onClick={() => void handlePrint(row)} />
                            <RowActionButton icon={<Trash2 />} label={t.common.delete} intent="danger" onClick={() => setPendingDelete(row)} />
                        </RowActions>
                    );
                },
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 168,
            }),
        ];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [t, locale]);

    /*
     * The same forward steps the order page offers, each applied only to the
     * ticked orders it fits — its count says how many that is, and a step none
     * of them fits is not offered.
     */
    const bulkActions = useMemo<BulkAction<SalesOrder>[]>(() => {
        const inStatus = (rows: SalesOrder[], status: string) => rows.filter((o) => o.status === status);
        const deletable = (rows: SalesOrder[]) => rows.filter((o) => o.status !== 'DELIVERED');
        const steps: { rows: (r: SalesOrder[]) => SalesOrder[]; action: Omit<BulkAction<SalesOrder>, 'label'>; label: string }[] = [
            {
                rows: (r) => inStatus(r, 'DRAFT'),
                label: t.orders.bulk.confirm,
                action: { icon: <CheckCircle2 className="w-4 h-4" />, onClick: (r) => void advance(inStatus(r, 'DRAFT'), 'CONFIRMED') },
            },
            {
                rows: (r) => inStatus(r, 'CONFIRMED'),
                label: t.orders.bulk.startProcessing,
                action: { icon: <PlayCircle className="w-4 h-4" />, onClick: (r) => void advance(inStatus(r, 'CONFIRMED'), 'PROCESSING') },
            },
            {
                rows: (r) => inStatus(r, 'PROCESSING'),
                label: t.orders.bulk.markDelivered,
                action: {
                    icon: <PackageCheck className="w-4 h-4" />,
                    onClick: (r) => setPendingBulk({ kind: 'deliver', rows: inStatus(r, 'PROCESSING') }),
                },
            },
            {
                // One branch, one letterhead: mixed branches print one by one.
                rows: (r) => (r.length > 0 && r.every((o) => o.store_id === r[0].store_id) ? r : []),
                label: t.orders.bulk.print,
                action: { icon: <Printer className="w-4 h-4" />, onClick: (r) => void printSelected(r) },
            },
            {
                rows: deletable,
                label: t.orders.bulk.delete,
                action: {
                    icon: <Trash2 className="w-4 h-4" />,
                    tone: 'danger',
                    onClick: (r) => setPendingBulk({ kind: 'delete', rows: deletable(r) }),
                },
            },
        ];
        return steps
            .map((step) => ({ step, count: step.rows(selectedOrders).length }))
            .filter(({ count }) => count > 0)
            .map(({ step, count }) => ({ ...step.action, label: formatMessage(step.label, { count }) }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [t, selectedOrders]);

    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'deliveryDate',
                type: 'date-range',
                label: t.shared.form.deliveryDate,
                value: deliveryRange,
                onChange: setDeliveryRange,
                operators: true,
            },
            {
                id: 'status',
                type: 'multi-select',
                label: t.orders.columns.status,
                value: statusFilter,
                onChange: setStatusFilter,
                exclude: { value: statusExclude, onChange: setStatusExclude },
                options: ORDER_STATUSES.map((value) => ({ value, label: t.shared.statuses.order[value] ?? value })),
            },
            customerListFilter({
                label: t.orders.columns.customer,
                walkInLabel: t.shared.walkIn,
                value: customerIds,
                onChange: setCustomerIds,
                storeId: branch.apiStoreId,
            }),
            {
                id: 'payment',
                type: 'multi-select',
                label: t.orders.columns.payment,
                value: paymentStatus,
                onChange: setPaymentStatus,
                options: PAYMENT_STATUSES.map((value) => ({ value, label: t.shared.statuses.payment[value] ?? value })),
            },
            {
                id: 'total',
                type: 'number',
                label: t.orders.columns.total,
                value: totalFilter,
                onChange: setTotalFilter,
                money: true,
            },
            { id: 'created', type: 'date-range', value: createdRange, onChange: setCreatedRange, operators: true, more: true },
        ],
        [t, branch.apiStoreId, deliveryRange, statusFilter, statusExclude, customerIds, paymentStatus, totalFilter, createdRange],
    );

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const copy = t.orders.stats;
        const dash = '—';
        const items: ListStat[] = [
            {
                id: 'count',
                icon: <ClipboardList aria-hidden />,
                label: copy.orders,
                value: summary ? summary.count.toLocaleString(locale) : dash,
                hint: summary?.cancelledCount ? fmt(copy.cancelled, { count: summary.cancelledCount }) : undefined,
            },
            { id: 'value', icon: <Wallet aria-hidden />, label: copy.value, value: summary ? money(summary.value) : dash },
            {
                id: 'advance',
                icon: <HandCoins aria-hidden />,
                label: copy.advance,
                value: summary ? money(summary.advance) : dash,
                hint: summary && summary.value > 0
                    ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(summary.advance / summary.value)
                    : undefined,
            },
            {
                id: 'open',
                icon: <Truck aria-hidden />,
                label: copy.open,
                value: summary ? money(summary.open.amount) : dash,
                hint: summary?.open.count ? fmt(copy.openCount, { count: summary.open.count }) : undefined,
            },
            {
                id: 'delivered',
                icon: <PackageCheck aria-hidden />,
                label: copy.delivered,
                value: summary ? money(summary.delivered.amount) : dash,
                hint: summary?.delivered.count ? fmt(copy.deliveredCount, { count: summary.delivered.count }) : undefined,
            },
            {
                id: 'overdue',
                icon: <AlarmClock aria-hidden />,
                label: copy.overdue,
                value: summary ? summary.overdue.toLocaleString(locale) : dash,
                tone: summary && summary.overdue > 0 ? 'warning' : 'default',
            },
        ];
        return { items, loading: summaryLoading && !summary, label: t.orders.statsLabel };
    }, [summary, summaryLoading, locale, t, fmt]);

    return (
        <PageShell>
                <PageHeader
                    title={t.orders.title}
                    subtitle={t.orders.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.sales,
                        t.orders.title,
                        'sales',
                    )}
                    actions={
                        <>
                            <BranchFilter scope={branch} />
                            <Link href={routes.sales.orderNew} className={buttonClassName()}>
                                <Plus className="w-4 h-4" />
                                {t.orders.newOrder}
                            </Link>
                        </>
                    }
                />

                {redirectingOnline ? null : (
                    <DataTable<SalesOrder>
                        tableId="sales-orders"
                        columns={columns}
                        data={orders}
                        title={t.orders.dataTable.title}
                        isLoading={loading}
                        emptyMessage={t.orders.dataTable.emptyMessage}
                        emptyIcon={<ClipboardList className="w-16 h-16 text-gray-200" />}
                        searchPlaceholder={t.orders.dataTable.searchPlaceholder}
                        onSearchChange={setSearch}
                        filters={filters}
                        filterLayout="row"
                        stats={stats}
                        // The filter row covers what the per-column boxes did, and sends it to the server.
                        enableColumnFilters={false}
                        viewOptions
                        serverPagination={serverPagination}
                        enableRowSelection
                        getRowId={(order) => order.id}
                        onRowSelectionChange={setSelectedOrders}
                        clearSelectionSignal={clearSelectionSignal}
                        bulkActions={bulkActions}
                        bulkActionsDisabled={bulkBusy}
                    />
                )}

                <ConfirmDialog
                    open={pendingDelete !== null}
                    title={t.common.delete}
                    prompt={t.shared.confirm.deleteOrder}
                    confirmLabel={t.common.delete}
                    cancelLabel={t.common.cancel}
                    loading={deleting}
                    danger
                    onConfirm={() => void confirmDelete()}
                    onCancel={() => { if (!deleting) setPendingDelete(null); }}
                />

                <ConfirmDialog
                    open={pendingBulk !== null}
                    title={pendingBulk?.kind === 'deliver' ? t.orders.bulk.deliverTitle : t.orders.bulk.deleteTitle}
                    prompt={formatMessage(
                        pendingBulk?.kind === 'deliver' ? t.orders.bulk.deliverPrompt : t.orders.bulk.deletePrompt,
                        { count: pendingBulk?.rows.length ?? 0 },
                    )}
                    confirmLabel={formatMessage(
                        pendingBulk?.kind === 'deliver' ? t.orders.bulk.markDelivered : t.orders.bulk.delete,
                        { count: pendingBulk?.rows.length ?? 0 },
                    )}
                    cancelLabel={t.common.cancel}
                    loading={bulkBusy}
                    danger={pendingBulk?.kind === 'delete'}
                    onConfirm={confirmBulk}
                    onCancel={() => { if (!bulkBusy) setPendingBulk(null); }}
                />

        </PageShell>
    );
}