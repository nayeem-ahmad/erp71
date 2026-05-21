'use client';

import { useState, useEffect, useMemo } from 'react';
import { ClipboardList, Plus, Eye, Edit2, Printer, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { formatBDT } from '../../../lib/format';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import CreateOrderModal from './CreateOrderModal';

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
        if (!window.confirm('Are you sure you want to delete this order?')) return;
        try {
            await api.deleteOrder(id);
            setOrders((prev) => prev.filter((o) => o.id !== id));
        } catch (error: any) {
            alert(error.message || 'Failed to delete order');
        }
    };

    const handlePrint = (order: SalesOrder) => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;
        printWindow.document.write(`
            <html>
            <head>
                <title>Order ${order.order_number}</title>
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
                <div class="subtitle">Date: ${new Date(order.created_at).toLocaleString()} | Status: ${order.status} | Payment: ${order.payment_status}</div>
                <p><strong>Customer:</strong> ${order.customer?.name || 'Walk-in'}</p>
                <table>
                    <thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Subtotal</th></tr></thead>
                    <tbody>
                        ${order.items.map((item: any) => `<tr><td>${item.product?.name || 'Item'}</td><td>${item.quantity}</td><td>${formatBDT(Number(item.price_at_order))}</td><td>${formatBDT(item.quantity * Number(item.price_at_order))}</td></tr>`).join('')}
                        <tr class="total-row"><td colspan="3">Total</td><td>${formatBDT(Number(order.total_amount))}</td></tr>
                    </tbody>
                </table>
                <p><strong>Paid:</strong> ${formatBDT(Number(order.amount_paid))} | <strong>Due:</strong> ${formatBDT(Number(order.total_amount) - Number(order.amount_paid))}</p>
                <div class="footer">Sales Order</div>
            </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.print();
    };

    const columns: ColumnDef<SalesOrder, any>[] = useMemo(
        () => [
            columnHelper.accessor('order_number', {
                header: 'Order #',
                cell: (info) => (
                    <span className="text-sm font-black text-gray-900">{info.getValue()}</span>
                ),
                size: 140,
            }),
            columnHelper.accessor('created_at', {
                header: 'Date',
                cell: (info) => {
                    const d = new Date(info.getValue());
                    return (
                        <div>
                            <span className="text-sm text-gray-600">{d.toLocaleDateString()}</span>
                            <span className="text-xs text-gray-400 block">{d.toLocaleTimeString()}</span>
                        </div>
                    );
                },
                sortingFn: 'datetime',
                size: 150,
            }),
            columnHelper.accessor((row) => row.customer?.name ?? '', {
                id: 'customer',
                header: 'Customer',
                cell: (info) => (
                    <span className="text-sm text-gray-700 font-medium">
                        {info.getValue() || <span className="text-gray-300">Walk-in</span>}
                    </span>
                ),
                size: 150,
            }),
            columnHelper.accessor('total_amount', {
                header: 'Total',
                cell: (info) => (
                    <span className="text-sm font-black text-blue-600">
                        {formatBDT(parseFloat(info.getValue()))}
                    </span>
                ),
                sortingFn: (a, b) =>
                    parseFloat(a.getValue('total_amount')) - parseFloat(b.getValue('total_amount')),
                size: 110,
            }),
            columnHelper.accessor('payment_status', {
                header: 'Payment',
                cell: (info) => {
                    const status = info.getValue();
                    return (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${paymentColors[status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {status}
                        </span>
                    );
                },
                size: 100,
            }),
            columnHelper.accessor('status', {
                header: 'Status',
                cell: (info) => {
                    const status = info.getValue();
                    return (
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${statusColors[status] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`}>
                            {status}
                        </span>
                    );
                },
                size: 130,
            }),
            columnHelper.display({
                id: 'actions',
                header: 'Actions',
                cell: (info) => {
                    const row = info.row.original;
                    return (
                        <div className="flex items-center justify-end space-x-1">
                            <Link
                                href={`/dashboard/orders/${row.id}`}
                                className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                                title="View"
                            >
                                <Eye className="w-4 h-4" />
                            </Link>
                            <Link
                                href={`/dashboard/orders/${row.id}?edit=true`}
                                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                                title="Edit"
                            >
                                <Edit2 className="w-4 h-4" />
                            </Link>
                            <button
                                onClick={() => handlePrint(row)}
                                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                                title="Print"
                            >
                                <Printer className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => handleDelete(row.id)}
                                className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                                title="Delete"
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
        [],
    );

    const filterPresets = useMemo(
        () => [
            { label: 'Draft', filters: [{ id: 'status', value: 'DRAFT' }] },
            { label: 'Confirmed', filters: [{ id: 'status', value: 'CONFIRMED' }] },
            { label: 'Processing', filters: [{ id: 'status', value: 'PROCESSING' }] },
            { label: 'Delivered', filters: [{ id: 'status', value: 'DELIVERED' }] },
        ],
        [],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1400px] mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">Sales Orders</h1>
                        <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                            Manage fulfillment and deposits
                        </p>
                    </div>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm flex items-center shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 active:translate-y-0"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        New Order
                    </button>
                </div>

                <CreateOrderModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSuccess={loadOrders} />

                {/* DataTable */}
                <DataTable<SalesOrder>
                    tableId="sales-orders"
                    columns={columns}
                    data={orders}
                    title="Sales Orders"
                    isLoading={loading}
                    emptyMessage="No orders found"
                    emptyIcon={<ClipboardList className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder="Search by order #, customer, status..."
                    filterPresets={filterPresets}
                    enableRowSelection
                />
            </div>
        </div>
    );
}
