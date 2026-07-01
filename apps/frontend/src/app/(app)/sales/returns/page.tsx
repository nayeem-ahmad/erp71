'use client';

import { useState, useEffect, useMemo } from 'react';
import { RotateCcw, Plus, Eye, Edit2, Printer, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import IssueReturnModal from './IssueReturnModal';
import { PostingBadge } from '@/components/PostingBadge';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

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
    const { t, locale } = useI18n();
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
        if (!window.confirm(t.shared.confirm.deleteReturn)) return;
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
                <title>${ret.return_number}</title>
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
                <div class="subtitle">${formatMessage(t.shared.print.originalReceipt, {
                    date: new Date(ret.created_at).toLocaleString(),
                    receipt: ret.sale?.serial_number || t.shared.dash,
                })}</div>
                <table>
                    <thead><tr><th>${t.shared.print.product}</th><th>${t.shared.print.qty}</th><th>${t.shared.print.refund}</th></tr></thead>
                    <tbody>
                        ${ret.items.map((item: any) => `<tr><td>${item.product?.name || t.shared.item}</td><td>${item.quantity}</td><td>${formatBDT(Number(item.refund_amount || item.price_at_sale * item.quantity), { locale })}</td></tr>`).join('')}
                        <tr class="total-row"><td colspan="2">${t.shared.print.totalRefund}</td><td>${formatBDT(Number(ret.total_refund), { locale })}</td></tr>
                    </tbody>
                </table>
                ${ret.reason ? `<p><strong>${t.shared.columns.reason}:</strong> ${ret.reason}</p>` : ''}
                <div class="footer">${t.shared.print.returnProcessed}</div>
            </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.print();
    };

    const columns: ColumnDef<SalesReturn, any>[] = useMemo(
        () => [
            columnHelper.accessor('return_number', {
                header: t.returns.columns.returnNumber,
                cell: (info) => (
                    <span className="text-sm font-black text-gray-900">{info.getValue()}</span>
                ),
                size: 140,
            }),
            columnHelper.accessor((row) => row.sale?.serial_number ?? '', {
                id: 'receipt',
                header: t.returns.columns.originalReceipt,
                cell: (info) => (
                    <span className="text-sm font-mono text-gray-500">{info.getValue() || t.shared.dash}</span>
                ),
                size: 150,
            }),
            columnHelper.accessor('total_refund', {
                header: t.returns.columns.refundAmount,
                cell: (info) => (
                    <span className="text-sm font-black text-rose-600">
                        {formatBDT(parseFloat(info.getValue()), { locale })}
                    </span>
                ),
                sortingFn: (a, b) =>
                    parseFloat(a.getValue('total_refund')) - parseFloat(b.getValue('total_refund')),
                size: 130,
            }),
            columnHelper.accessor((row) => row.items?.length ?? 0, {
                id: 'item_count',
                header: t.returns.columns.items,
                cell: (info) => (
                    <span className="text-sm font-bold text-gray-700">
                        {formatMessage(t.shared.itemsReturned, { count: info.getValue() })}
                    </span>
                ),
                size: 90,
            }),
            columnHelper.accessor('created_at', {
                header: t.returns.columns.date,
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
            columnHelper.accessor((row) => row.status ?? 'COMPLETED', {
                id: 'status',
                header: t.returns.columns.status,
                cell: (info) => {
                    const status = info.getValue();
                    return (
                        <span
                            className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                                statusColors[status] ?? 'bg-gray-50 text-gray-700 border-gray-200'
                            }`}
                        >
                            {t.shared.statuses.return[status as keyof typeof t.shared.statuses.return] ?? status}
                        </span>
                    );
                },
                size: 120,
            }),
            columnHelper.display({
                id: 'posting',
                header: t.returns.columns.voucher,
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
                header: t.returns.columns.actions,
                cell: (info) => {
                    const row = info.row.original;
                    return (
                        <div className="flex items-center justify-end space-x-1">
                            <Link
                                href={`/sales/returns/${row.id}`}
                                className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                                title={t.common.view}
                            >
                                <Eye className="w-4 h-4" />
                            </Link>
                            <Link
                                href={`/sales/returns/${row.id}?edit=true`}
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
            { label: t.returns.filterPresets.completed, filters: [{ id: 'status', value: 'COMPLETED' }] },
            { label: t.returns.filterPresets.pending, filters: [{ id: 'status', value: 'PENDING' }] },
        ],
        [t],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.returns.title}</h1>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {t.returns.subtitle}
                        </p>
                    </div>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-lg shadow-rose-200 transition-all hover:-translate-y-0.5 active:translate-y-0"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        {t.returns.processReturn}
                    </button>
                </div>

                <IssueReturnModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSuccess={loadReturns} />

                <DataTable<SalesReturn>
                    tableId="sales-returns"
                    columns={columns}
                    data={returns}
                    title={t.returns.dataTable.title}
                    isLoading={loading}
                    emptyMessage={t.returns.dataTable.emptyMessage}
                    emptyIcon={<RotateCcw className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.returns.dataTable.searchPlaceholder}
                    filterPresets={filterPresets}
                    enableRowSelection
                />
            </div>
        </div>
    );
}