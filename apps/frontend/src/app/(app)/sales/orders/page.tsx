'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ClipboardList, Plus, Eye, Pencil, Printer, Trash2, ReceiptText } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { formatBDT, formatDate, formatDateTime } from '@/lib/format';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, createdAtColumn, type ListFilter } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import { toast } from '@/lib/toast';
import StorefrontOrdersPanel from './StorefrontOrdersPanel';
import { SIMPLE_DOC_STYLES, openPrintWindow, renderHeaderHtml, sheetPaper } from '@/lib/print';
import type { HeaderContext } from '@/lib/print';
import { usePrintHeader } from '@/lib/print/use-print-header';
import { useSalePrintPrefs } from '@/lib/hooks/useSalePrintPrefs';
import { useI18n, formatMessage } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { BranchFilter, ConfirmDialog, PageShell, StatusBadge, buttonClassName, type StatusBadgeTone } from '@/components/ui';
import { Tabs } from '@/components/ui/compact/Tabs';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';

type OrdersTab = 'sales' | 'online';

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
    delivery_date?: string;
    items: any[];
    deposits: any[];
    customer?: { name: string; phone?: string };
    store_id?: string;
}

const ORDER_STATUSES = ['DRAFT', 'CONFIRMED', 'PROCESSING', 'DELIVERED', 'CANCELLED'] as const;
const PAYMENT_STATUSES = ['UNPAID', 'PARTIAL', 'PAID'] as const;

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

export default function OrdersPage() {
    const { t, locale } = useI18n();
    const branch = useBranchScope();
    const printHeader = usePrintHeader('SALES_ORDER');
    // This browser's paper, as invoices print on; A4 for a till roll.
    const paper = sheetPaper(useSalePrintPrefs().paperSize);
    const router = useRouter();
    const searchParams = useSearchParams();
    const activeTab: OrdersTab = searchParams.get('tab') === 'online' ? 'online' : 'sales';
    const [orders, setOrders] = useState<SalesOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [pendingDelete, setPendingDelete] = useState<SalesOrder | null>(null);
    const [deleting, setDeleting] = useState(false);

    const setActiveTab = useCallback((tab: OrdersTab) => {
        const params = new URLSearchParams(searchParams.toString());
        if (tab === 'online') {
            params.set('tab', 'online');
        } else {
            params.delete('tab');
        }
        const query = params.toString();
        router.replace(query ? `${routes.sales.orders}?${query}` : routes.sales.orders);
    }, [router, searchParams]);

    useEffect(() => {
        if (activeTab === 'sales' && branch.ready) {
            loadOrders();
        }
    }, [activeTab, createdRange, branch.ready, branch.apiStoreId]);

    const loadOrders = async () => {
        setLoading(true);
        try {
            const data = await api.getOrders({ ...applyCreatedRangeQuery(createdRange), storeId: branch.apiStoreId });
            setOrders(data);
        } catch (error) {
            if (handleBranchForbidden(error, branch, t.dashboardLayout.branchFilterForbidden)) return;
            console.error('Failed to load orders', error);
        } finally {
            setLoading(false);
        }
    };

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        setDeleting(true);
        try {
            await api.deleteOrder(pendingDelete.id);
            setOrders((prev) => prev.filter((o) => o.id !== pendingDelete.id));
            setPendingDelete(null);
        } catch (error: any) {
            toast.error(error?.message || t.shared.errors.deleteOrder);
        } finally {
            setDeleting(false);
        }
    };

    const handlePrint = async (order: SalesOrder) => {
        // The order's own branch letterhead, not the one resolved on mount.
        const header = await printHeader.resolve(order.store_id);
        const headerContext: HeaderContext = {
            docTitle: t.shared.print.salesOrder,
            docNumber: order.order_number,
            docDate: formatDate(order.created_at, locale),
            companyName: header.companyName,
        };

        openPrintWindow({
            context: headerContext,
            title: order.order_number,
            paperSize: paper,
            headerConfig: header.headerConfig,
            headerHtml: renderHeaderHtml(header.headerConfig, headerContext, paper),
            styles: SIMPLE_DOC_STYLES,
            compactable: true,
            repeatHeader: true,
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
        });
    };

    const columns: ColumnDef<SalesOrder, any>[] = useMemo(
        () => [
            columnHelper.accessor('order_number', {
                header: t.orders.columns.orderNumber,
                size: 140,
            }),
            createdAtColumn(columnHelper, { header: t.common.createdAt, locale }),
            columnHelper.accessor((row) => row.customer?.name ?? '', {
                id: 'customer',
                header: t.orders.columns.customer,
                cell: (info) => info.getValue() || <span className="text-gray-400">{t.shared.walkIn}</span>,
                size: 150,
            }),
            columnHelper.accessor('total_amount', {
                header: t.orders.columns.total,
                cell: (info) => formatBDT(parseFloat(info.getValue()), { locale }),
                sortingFn: (a, b) =>
                    parseFloat(a.getValue('total_amount')) - parseFloat(b.getValue('total_amount')),
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
                filterFn: 'equalsString',
                size: 100,
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
                filterFn: 'equalsString',
                size: 120,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.orders.columns.actions,
                cell: (info) => {
                    const row = info.row.original;
                    return (
                        <RowActions>
                            <RowActionButton icon={<Eye />} label={t.common.view} href={`/sales/orders/${row.id}`} />
                            <RowActionButton icon={<Pencil />} label={t.common.edit} href={`/sales/orders/${row.id}?edit=true`} />
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
        ],
        [t, locale],
    );

    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'status',
                type: 'select',
                label: t.orders.columns.status,
                columnId: 'status',
                options: ORDER_STATUSES.map((value) => ({ value, label: t.shared.statuses.order[value] ?? value })),
            },
            {
                id: 'payment',
                type: 'select',
                label: t.orders.columns.payment,
                columnId: 'payment_status',
                options: PAYMENT_STATUSES.map((value) => ({ value, label: t.shared.statuses.payment[value] ?? value })),
            },
            { id: 'created', type: 'date-range', value: createdRange, onChange: setCreatedRange },
        ],
        [t, createdRange],
    );

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
                        // The online tab is the storefront's queue, which the
                        // branch filter does not narrow.
                        activeTab === 'sales' ? (
                            <>
                                <BranchFilter scope={branch} />
                                <Link href={routes.sales.orderNew} className={buttonClassName()}>
                                    <Plus className="w-4 h-4" />
                                    {t.orders.newOrder}
                                </Link>
                            </>
                        ) : null
                    }
                />

                <Tabs<OrdersTab>
                    idPrefix="sales-orders"
                    label={t.orders.title}
                    tabs={[
                        { key: 'sales', label: t.orders.tabs.salesOrders },
                        { key: 'online', label: t.orders.tabs.onlineOrders },
                    ]}
                    value={activeTab}
                    // Clicking the open tab keeps it open: a list page always shows one.
                    onChange={(next) => setActiveTab(next ?? activeTab)}
                />

                {activeTab === 'online' ? (
                    <StorefrontOrdersPanel
                        storeId={branch.apiStoreId}
                        // Web orders belong to the online branch; on a shop's branch say so.
                        onShopBranch={Boolean(branch.branches.find((b) => b.id === branch.apiStoreId && !b.is_online))}
                    />
                ) : (
                    <>
                        <DataTable<SalesOrder>
                            tableId="sales-orders"
                            columns={columns}
                            data={orders}
                            title={t.orders.dataTable.title}
                            isLoading={loading}
                            emptyMessage={t.orders.dataTable.emptyMessage}
                            emptyIcon={<ClipboardList className="w-16 h-16 text-gray-200" />}
                            searchPlaceholder={t.orders.dataTable.searchPlaceholder}
                            filters={filters}
                            viewOptions
                        />
                    </>
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

        </PageShell>
    );
}