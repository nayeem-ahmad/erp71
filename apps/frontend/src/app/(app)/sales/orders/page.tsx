'use client';

import { useState, useEffect, useMemo } from 'react';
import { ClipboardList, Plus, Eye, Edit2, Printer, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import CreateOrderModal from './CreateOrderModal';
import { useI18n, formatMessage } from '@/lib/i18n';

interface SalesOrder {
    id: string;
    order_number: string;
    created_at: string;
    total_amount: string;
    amount_paid: string;
    status: string;
    payment_status: string;
    delivery_date?: string;
    items: any[];
    deposits: any[];
    customer?: { name: string; phone?: string };
}

const statusColors: Record<string, string> = {
    DRAFT: 'bg-gray-50 text-gray-600 border-gray-200',
    CONFIRMED: 'bg-blue-50 text-blue-700 border-blue-200',
    PROCESSING: 'bg-amber-50 text-amber-700 border-amber-200',
    DELIVERED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    CANCELLED: 'bg-red-50 text-red-700 border-red-200',
};

const paymentColors: Record<string, string> = {
    UNPAID: 'bg-gray-100 text-gray-600',
    PARTIAL: 'bg-purple-100 text-purple-700',
    PAID: 'bg-emerald-100 text-emerald-700',
};

const columnHelper = createColumnHelper<SalesOrder>();

export default function OrdersPage() {
    const { t, locale } = useI18n();
    const [orders, setOrders] = useState<SalesOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);

    useEffect(() => {
        loadOrders();
    }, []);

    const loadOrders = async () => {
        try {
            const data = await api.getOrders();
            setOrders(data);
        } catch (error) {
            console.error('Failed to load orders', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm(t.shared.confirm.deleteOrder)) return;
        try {
            await api.deleteOrder(id);
            setOrders((prev) => prev.filter((o) => o.id !== id));
        } catch (error: any) {
            alert(error.message || t.shared.errors.deleteOrder);
        }
    };

    const handlePrint = (order: SalesOrder) => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;
        printWindow.document.write(`
            <html>
            <head>
                <title>${order.order_number}</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; color: #111; }
                    h1 { font-size: 24px; margin-bottom: 4px; }
                    .subtitle { color: #666; font-size: 12px; margin-bottom: 20px; }
                    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
                    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #eee; }
                    th { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #999; }
                    .total-row { font-weight: bold; border-top: 2px solid #333; }
                    .footer { margin-top: 40px; text-align: center; color: #999; font-size: 11px; }
                </style>
            </head>
            <body>
                <h1>${order.order_number}</h1>
                <div class="subtitle">${formatMessage(t.shared.print.datePayment, {
                    date: new Date(order.created_at).toLocaleString(),
                    status: t.shared.statuses.order[order.status as keyof typeof t.shared.statuses.order] ?? order.status,
                    payment: t.shared.statuses.payment[order.payment_status as keyof typeof t.shared.statuses.payment] ?? order.payment_status,
                })}</div>
                <p><strong>${t.shared.print.customer}</strong> ${order.customer?.name || t.shared.walkIn}</p>
                <table>
                    <thead><tr><th>${t.shared.print.product}</th><th>${t.shared.print.qty}</th><th>${t.shared.print.price}</th><th>${t.shared.print.subtotal}</th></tr></thead>
                    <tbody>
                        ${order.items.map((item: any) => `<tr><td>${item.product?.name || t.shared.item}</td><td>${item.quantity}</td><td>${formatBDT(Number(item.price_at_order), { locale })}</td><td>${formatBDT(item.quantity * Number(item.price_at_order), { locale })}</td></tr>`).join('')}
                        <tr class="total-row"><td colspan="3">${t.shared.print.total}</td><td>${formatBDT(Number(order.total_amount), { locale })}</td></tr>
                    </tbody>
                </table>
                <p><strong>${t.shared.print.paid}</strong> ${formatBDT(Number(order.amount_paid), { locale })} | <strong>${t.shared.print.due}</strong> ${formatBDT(Number(order.total_amount) - Number(order.amount_paid), { locale })}</p>
                <div class="footer">${t.shared.print.salesOrder}</div>
            </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.print();
    };

    const columns: ColumnDef<SalesOrder, any>[] = useMemo(
        () => [
            columnHelper.accessor('order_number', {
                header: t.orders.columns.orderNumber,
                cell: (info) => (
                    <span className="text-sm font-black text-gray-900">{info.getValue()}</span>
                ),
                size: 140,
            }),
            columnHelper.accessor('created_at', {
                header: t.orders.columns.date,
                cell: (info) => {
                    const d = new Date(info.getValue());
                    return (
                        <div>
                            <span className="text-sm text-gray-600">{formatDate(info.getValue(), locale)}</span>
                            <span className="text-xs text-gray-400 block">{d.toLocaleTimeString()}</span>
                        </div>
                    );
                },
                sortingFn: 'datetime',
                size: 150,
            }),
            columnHelper.accessor((row) => row.customer?.name ?? '', {
                id: 'customer',
                header: t.orders.columns.customer,
                cell: (info) => (
                    <span className="text-sm text-gray-700 font-medium">
                        {info.getValue() || <span className="text-gray-300">{t.shared.walkIn}</span>}
                    </span>
                ),
                size: 150,
            }),
            columnHelper.accessor('total_amount', {
                header: t.orders.columns.total,
                cell: (info) => (
                    <span className="text-sm font-black text-blue-600">
                        {formatBDT(parseFloat(info.getValue()), { locale })}
                    </span>
                ),
                sortingFn: (a, b) =>
                    parseFloat(a.getValue('total_amount')) - parseFloat(b.getValue('total_amount')),
                size: 110,
            }),
            columnHelper.accessor('payment_status', {
                header: t.orders.columns.payment,
                cell: (info) => {
                    const status = info.getValue();
                    return (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${paymentColors[status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {t.shared.statuses.payment[status as keyof typeof t.shared.statuses.payment] ?? status}
                        </span>
                    );
                },
                size: 100,
            }),
            columnHelper.accessor('status', {
                header: t.orders.columns.status,
                cell: (info) => {
                    const status = info.getValue();
                    return (
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${statusColors[status] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`}>
                            {t.shared.statuses.order[status as keyof typeof t.shared.statuses.order] ?? status}
                        </span>
                    );
                },
                size: 130,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.orders.columns.actions,
                cell: (info) => {
                    const row = info.row.original;
                    return (
                        <div className="flex items-center justify-end space-x-1">
                            <Link
                                href={`/sales/orders/${row.id}`}
                                className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                                title={t.common.view}
                            >
                                <Eye className="w-4 h-4" />
                            </Link>
                            <Link
                                href={`/sales/orders/${row.id}?edit=true`}
                                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                                title={t.common.edit}
                            >
                                <Edit2 className="w-4 h-4" />
                            </Link>
                            <button
                                onClick={() => handlePrint(row)}
                                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                                title={t.common.print}
                            >
                                <Printer className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => handleDelete(row.id)}
                                className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                                title={t.common.delete}
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    );
                },
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 160,
            }),
        ],
        [t, locale],
    );

    const filterPresets = useMemo(
        () => [
            { label: t.orders.filterPresets.draft, filters: [{ id: 'status', value: 'DRAFT' }] },
            { label: t.orders.filterPresets.confirmed, filters: [{ id: 'status', value: 'CONFIRMED' }] },
            { label: t.orders.filterPresets.processing, filters: [{ id: 'status', value: 'PROCESSING' }] },
            { label: t.orders.filterPresets.delivered, filters: [{ id: 'status', value: 'DELIVERED' }] },
        ],
        [t],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.orders.title}</h1>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {t.orders.subtitle}
                        </p>
                    </div>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 active:translate-y-0"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        {t.orders.newOrder}
                    </button>
                </div>

                <CreateOrderModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSuccess={loadOrders} />

                <DataTable<SalesOrder>
                    tableId="sales-orders"
                    columns={columns}
                    data={orders}
                    title={t.orders.dataTable.title}
                    isLoading={loading}
                    emptyMessage={t.orders.dataTable.emptyMessage}
                    emptyIcon={<ClipboardList className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.orders.dataTable.searchPlaceholder}
                    filterPresets={filterPresets}
                    enableRowSelection
                />
            </div>
        </div>
    );
}