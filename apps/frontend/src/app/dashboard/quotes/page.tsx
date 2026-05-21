'use client';

import { useState, useEffect, useMemo } from 'react';
import { FileText, Plus, Eye, Edit2, Printer, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { formatBDT } from '../../../lib/format';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import CreateQuotationModal from './CreateQuotationModal';

interface Quotation {
    id: string;
    quote_number: string;
    created_at: string;
    valid_until?: string | null;
    total_amount: string;
    status: string;
    version: number;
    notes?: string | null;
    items: any[];
    customer?: { name: string; phone?: string };
}

const statusColors: Record<string, string> = {
    DRAFT: 'bg-gray-50 text-gray-600 border-gray-200',
    SENT: 'bg-blue-50 text-blue-700 border-blue-200',
    ACCEPTED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    REJECTED: 'bg-red-50 text-red-700 border-red-200',
    CONVERTED: 'bg-violet-50 text-violet-700 border-violet-200',
    REVISED: 'bg-amber-50 text-amber-700 border-amber-200',
    EXPIRED: 'bg-gray-100 text-gray-500 border-gray-200',
};

const columnHelper = createColumnHelper<Quotation>();

export default function QuotesPage() {
    const [quotes, setQuotes] = useState<Quotation[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);

    useEffect(() => {
        loadQuotes();
    }, []);

    const loadQuotes = async () => {
        try {
            const data = await api.getQuotations();
            setQuotes(data);
        } catch (error) {
            console.error('Failed to load quotes', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Are you sure you want to delete this quotation?')) return;
        try {
            await api.deleteQuotation(id);
            setQuotes((prev) => prev.filter((quote) => quote.id !== id));
        } catch (error: any) {
            alert(error.message || 'Failed to delete quotation');
        }
    };

    const handlePrint = (quote: Quotation) => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;

        printWindow.document.write(`
            <html>
            <head>
                <title>Quotation ${quote.quote_number}</title>
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
                <h1>${quote.quote_number} (v${quote.version})</h1>
                <div class="subtitle">Created: ${new Date(quote.created_at).toLocaleString()} | Status: ${quote.status} | Valid Until: ${quote.valid_until ? new Date(quote.valid_until).toLocaleDateString() : 'Open'}</div>
                <p><strong>Customer:</strong> ${quote.customer?.name || 'Walk-in'}</p>
                <table>
                    <thead><tr><th>Product</th><th>Qty</th><th>Unit Price</th><th>Subtotal</th></tr></thead>
                    <tbody>
                        ${quote.items.map((item: any) => `<tr><td>${item.product?.name || 'Item'}</td><td>${item.quantity}</td><td>${formatBDT(Number(item.unit_price))}</td><td>${formatBDT(item.quantity * Number(item.unit_price))}</td></tr>`).join('')}
                        <tr class="total-row"><td colspan="3">Total</td><td>${formatBDT(Number(quote.total_amount))}</td></tr>
                    </tbody>
                </table>
                ${quote.notes ? `<p><strong>Notes:</strong> ${quote.notes}</p>` : ''}
                <div class="footer">Sales Quotation</div>
            </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.print();
    };

    const columns: ColumnDef<Quotation, any>[] = useMemo(
        () => [
            columnHelper.accessor('quote_number', {
                header: 'Quote #',
                cell: (info) => (
                    <div>
                        <span className="text-sm font-black text-gray-900">{info.getValue()}</span>
                        <span className="ml-2 inline-flex rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-gray-500">
                            v{info.row.original.version}
                        </span>
                    </div>
                ),
                size: 180,
            }),
            columnHelper.accessor('created_at', {
                header: 'Date',
                cell: (info) => {
                    const date = new Date(info.getValue());
                    return (
                        <div>
                            <span className="text-sm text-gray-600">{date.toLocaleDateString()}</span>
                            <span className="text-xs text-gray-400 block">{date.toLocaleTimeString()}</span>
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
                    <div>
                        <span className="text-sm text-gray-700 font-medium">
                            {info.getValue() || <span className="text-gray-300">Walk-in</span>}
                        </span>
                        <span className="block text-xs text-gray-400">{info.row.original.customer?.phone || 'No phone'}</span>
                    </div>
                ),
                size: 160,
            }),
            columnHelper.accessor((row) => row.items?.length ?? 0, {
                id: 'items',
                header: 'Items',
                cell: (info) => <span className="text-sm font-bold text-gray-700">{info.getValue()} items</span>,
                size: 90,
            }),
            columnHelper.accessor('valid_until', {
                header: 'Valid Until',
                cell: (info) => (
                    <span className="text-sm font-medium text-gray-600">
                        {info.getValue() ? new Date(info.getValue() as string).toLocaleDateString() : 'Open'}
                    </span>
                ),
                size: 130,
            }),
            columnHelper.accessor('total_amount', {
                header: 'Total',
                cell: (info) => (
                    <span className="text-sm font-black text-blue-600">{formatBDT(parseFloat(info.getValue()))}</span>
                ),
                sortingFn: (a, b) => parseFloat(a.getValue('total_amount')) - parseFloat(b.getValue('total_amount')),
                size: 110,
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
                    const quote = info.row.original;
                    return (
                        <div className="flex items-center justify-end space-x-1">
                            <Link
                                href={`/dashboard/quotes/${quote.id}`}
                                className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                                title="View"
                            >
                                <Eye className="w-4 h-4" />
                            </Link>
                            <Link
                                href={`/dashboard/quotes/${quote.id}?edit=true`}
                                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                                title="Edit"
                            >
                                <Edit2 className="w-4 h-4" />
                            </Link>
                            <button
                                onClick={() => handlePrint(quote)}
                                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                                title="Print"
                            >
                                <Printer className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => handleDelete(quote.id)}
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
                size: 170,
            }),
        ],
        [quotes],
    );

    const filterPresets = useMemo(
        () => [
            { label: 'Draft', filters: [{ id: 'status', value: 'DRAFT' }] },
            { label: 'Sent', filters: [{ id: 'status', value: 'SENT' }] },
            { label: 'Accepted', filters: [{ id: 'status', value: 'ACCEPTED' }] },
            { label: 'Converted', filters: [{ id: 'status', value: 'CONVERTED' }] },
        ],
        [],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1400px] mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">Sales Quotations</h1>
                        <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                            Build estimates and track expirations
                        </p>
                    </div>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm flex items-center shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 active:translate-y-0"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        New Quotation
                    </button>
                </div>

                <CreateQuotationModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSuccess={loadQuotes} />

                <DataTable<Quotation>
                    tableId="sales-quotations"
                    columns={columns}
                    data={quotes}
                    title="Sales Quotations"
                    isLoading={loading}
                    emptyMessage="No quotations found"
                    emptyIcon={<FileText className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder="Search by quote #, customer, status..."
                    filterPresets={filterPresets}
                    enableRowSelection
                />
            </div>
        </div>
    );
}
