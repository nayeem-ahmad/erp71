'use client';

import { useState, useEffect, useMemo } from 'react';
import { RotateCcw, Plus, Eye, Edit2, Printer, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import IssueReturnModal from './IssueReturnModal';
import { PostingBadge } from '@/components/PostingBadge';
import { formatBDT } from '../../../lib/format';

interface SalesReturn {
    id: string;
    return_number: string;
    created_at: string;
    total_refund: string;
    reason?: string;
    status?: string;
    items: any[];
    sale?: { serial_number: string };
    posting_status?: string | null;
    voucher_number?: string | null;
}

const statusColors: Record<string, string> = {
    COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
    CANCELLED: 'bg-red-50 text-red-700 border-red-200',
};

const columnHelper = createColumnHelper<SalesReturn>();

export default function ReturnsPage() {
    const [returns, setReturns] = useState<SalesReturn[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);

    useEffect(() => {
        loadReturns();
    }, []);

    const loadReturns = async () => {
        try {
            const data = await api.getReturns();
            setReturns(data);
        } catch (error) {
            console.error('Failed to load returns', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Are you sure you want to delete this return?')) return;
        try {
            await api.deleteReturn(id);
            setReturns((prev) => prev.filter((r) => r.id !== id));
        } catch (error) {
            console.error('Failed to delete return', error);
        }
    };

    const handlePrint = (ret: SalesReturn) => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;
        printWindow.document.write(`
            <html>
            <head>
                <title>Return ${ret.return_number}</title>
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
                <h1>${ret.return_number}</h1>
                <div class="subtitle">Date: ${new Date(ret.created_at).toLocaleString()} | Original Receipt: ${ret.sale?.serial_number || '-'}</div>
                <table>
                    <thead><tr><th>Product</th><th>Qty</th><th>Refund</th></tr></thead>
                    <tbody>
                        ${ret.items.map((item: any) => `<tr><td>${item.product?.name || 'Item'}</td><td>${item.quantity}</td><td>${formatBDT(Number(item.refund_amount || item.price_at_sale * item.quantity))}</td></tr>`).join('')}
                        <tr class="total-row"><td colspan="2">Total Refund</td><td>${formatBDT(Number(ret.total_refund))}</td></tr>
                    </tbody>
                </table>
                ${ret.reason ? `<p><strong>Reason:</strong> ${ret.reason}</p>` : ''}
                <div class="footer">Return processed</div>
            </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.print();
    };

    const columns: ColumnDef<SalesReturn, any>[] = useMemo(
        () => [
            columnHelper.accessor('return_number', {
                header: 'Return #',
                cell: (info) => (
                    <span className="text-sm font-black text-gray-900">{info.getValue()}</span>
                ),
                size: 140,
            }),
            columnHelper.accessor((row) => row.sale?.serial_number ?? '', {
                id: 'receipt',
                header: 'Original Receipt',
                cell: (info) => (
                    <span className="text-sm font-mono text-gray-500">{info.getValue() || '-'}</span>
                ),
                size: 150,
            }),
            columnHelper.accessor('total_refund', {
                header: 'Refund Amount',
                cell: (info) => (
                    <span className="text-sm font-black text-rose-600">
                        {formatBDT(parseFloat(info.getValue()))}
                    </span>
                ),
                sortingFn: (a, b) =>
                    parseFloat(a.getValue('total_refund')) - parseFloat(b.getValue('total_refund')),
                size: 130,
            }),
            columnHelper.accessor((row) => row.items?.length ?? 0, {
                id: 'item_count',
                header: 'Items',
                cell: (info) => (
                    <span className="text-sm font-bold text-gray-700">{info.getValue()} returned</span>
                ),
                size: 90,
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
            columnHelper.accessor((row) => row.status ?? 'COMPLETED', {
                id: 'status',
                header: 'Status',
                cell: (info) => {
                    const status = info.getValue();
                    return (
                        <span
                            className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                                statusColors[status] ?? 'bg-gray-50 text-gray-700 border-gray-200'
                            }`}
                        >
                            {status}
                        </span>
                    );
                },
                size: 120,
            }),
            columnHelper.display({
                id: 'posting',
                header: 'Voucher',
                cell: ({ row }) => (
                    <PostingBadge
                        status={row.original.posting_status}
                        voucherNumber={row.original.voucher_number}
                    />
                ),
                size: 120,
            }),
            columnHelper.display({
                id: 'actions',
                header: 'Actions',
                cell: (info) => {
                    const row = info.row.original;
                    return (
                        <div className="flex items-center justify-end space-x-1">
                            <Link
                                href={`/dashboard/returns/${row.id}`}
                                className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                                title="View"
                            >
                                <Eye className="w-4 h-4" />
                            </Link>
                            <Link
                                href={`/dashboard/returns/${row.id}?edit=true`}
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
            { label: 'Completed', filters: [{ id: 'status', value: 'COMPLETED' }] },
            { label: 'Pending', filters: [{ id: 'status', value: 'PENDING' }] },
        ],
        [],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1400px] mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">Sales Returns</h1>
                        <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                            Process refunds and re-increment stock
                        </p>
                    </div>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm flex items-center shadow-lg shadow-rose-200 transition-all hover:-translate-y-0.5 active:translate-y-0"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        Process Return
                    </button>
                </div>

                <IssueReturnModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSuccess={loadReturns} />

                {/* DataTable */}
                <DataTable<SalesReturn>
                    tableId="sales-returns"
                    columns={columns}
                    data={returns}
                    title="Sales Returns"
                    isLoading={loading}
                    emptyMessage="No returns found"
                    emptyIcon={<RotateCcw className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder="Search by return #, receipt, amount..."
                    filterPresets={filterPresets}
                    enableRowSelection
                />
            </div>
        </div>
    );
}
