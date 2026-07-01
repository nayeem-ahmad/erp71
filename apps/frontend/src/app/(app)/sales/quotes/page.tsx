'use client';

import { useState, useEffect, useMemo } from 'react';
import { FileText, Plus, Eye, Edit2, Printer, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import CreateQuotationModal from './CreateQuotationModal';
import { useI18n, formatMessage } from '@/lib/i18n';

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
    const { t, locale } = useI18n();
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
        if (!window.confirm(t.shared.confirm.deleteQuotation)) return;
        try {
            await api.deleteQuotation(id);
            setQuotes((prev) => prev.filter((quote) => quote.id !== id));
        } catch (error: any) {
            alert(error.message || t.shared.errors.deleteQuotation);
        }
    };

    const handlePrint = (quote: Quotation) => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;

        printWindow.document.write(`
            <html>
            <head>
                <title>${quote.quote_number}</title>
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
                <h1>${quote.quote_number} (${formatMessage(t.shared.version, { version: quote.version })})</h1>
                <div class="subtitle">${formatMessage(t.shared.print.createdMeta, {
                    date: new Date(quote.created_at).toLocaleString(),
                    status: t.shared.statuses.quote[quote.status as keyof typeof t.shared.statuses.quote] ?? quote.status,
                    validUntil: quote.valid_until ? formatDate(quote.valid_until, locale) : t.shared.open,
                })}</div>
                <p><strong>${t.shared.print.customer}</strong> ${quote.customer?.name || t.shared.walkIn}</p>
                <table>
                    <thead><tr><th>${t.shared.print.product}</th><th>${t.shared.print.qty}</th><th>${t.shared.print.unitPrice}</th><th>${t.shared.print.subtotal}</th></tr></thead>
                    <tbody>
                        ${quote.items.map((item: any) => `<tr><td>${item.product?.name || t.shared.item}</td><td>${item.quantity}</td><td>${formatBDT(Number(item.unit_price), { locale })}</td><td>${formatBDT(item.quantity * Number(item.unit_price), { locale })}</td></tr>`).join('')}
                        <tr class="total-row"><td colspan="3">${t.shared.print.total}</td><td>${formatBDT(Number(quote.total_amount), { locale })}</td></tr>
                    </tbody>
                </table>
                ${quote.notes ? `<p><strong>${t.shared.print.notes}</strong> ${quote.notes}</p>` : ''}
                <div class="footer">${t.shared.print.salesQuotation}</div>
            </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.print();
    };

    const columns: ColumnDef<Quotation, any>[] = useMemo(
        () => [
            columnHelper.accessor('quote_number', {
                header: t.quotes.columns.quoteNumber,
                cell: (info) => (
                    <div>
                        <span className="text-sm font-black text-gray-900">{info.getValue()}</span>
                        <span className="ml-2 inline-flex rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-gray-500">
                            {formatMessage(t.shared.version, { version: info.row.original.version })}
                        </span>
                    </div>
                ),
                size: 180,
            }),
            columnHelper.accessor('created_at', {
                header: t.quotes.columns.date,
                cell: (info) => {
                    const date = new Date(info.getValue());
                    return (
                        <div>
                            <span className="text-sm text-gray-600">{formatDate(info.getValue(), locale)}</span>
                            <span className="text-xs text-gray-400 block">{date.toLocaleTimeString()}</span>
                        </div>
                    );
                },
                sortingFn: 'datetime',
                size: 150,
            }),
            columnHelper.accessor((row) => row.customer?.name ?? '', {
                id: 'customer',
                header: t.quotes.columns.customer,
                cell: (info) => (
                    <div>
                        <span className="text-sm text-gray-700 font-medium">
                            {info.getValue() || <span className="text-gray-300">{t.shared.walkIn}</span>}
                        </span>
                        <span className="block text-xs text-gray-400">{info.row.original.customer?.phone || t.shared.noPhone}</span>
                    </div>
                ),
                size: 160,
            }),
            columnHelper.accessor((row) => row.items?.length ?? 0, {
                id: 'items',
                header: t.quotes.columns.items,
                cell: (info) => (
                    <span className="text-sm font-bold text-gray-700">
                        {formatMessage(t.shared.itemsCount, { count: info.getValue() })}
                    </span>
                ),
                size: 90,
            }),
            columnHelper.accessor('valid_until', {
                header: t.quotes.columns.validUntil,
                cell: (info) => (
                    <span className="text-sm font-medium text-gray-600">
                        {info.getValue() ? formatDate(info.getValue() as string, locale) : t.shared.open}
                    </span>
                ),
                size: 130,
            }),
            columnHelper.accessor('total_amount', {
                header: t.quotes.columns.total,
                cell: (info) => (
                    <span className="text-sm font-black text-blue-600">{formatBDT(parseFloat(info.getValue()), { locale })}</span>
                ),
                sortingFn: (a, b) => parseFloat(a.getValue('total_amount')) - parseFloat(b.getValue('total_amount')),
                size: 110,
            }),
            columnHelper.accessor('status', {
                header: t.quotes.columns.status,
                cell: (info) => {
                    const status = info.getValue();
                    return (
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${statusColors[status] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`}>
                            {t.shared.statuses.quote[status as keyof typeof t.shared.statuses.quote] ?? status}
                        </span>
                    );
                },
                size: 130,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.quotes.columns.actions,
                cell: (info) => {
                    const quote = info.row.original;
                    return (
                        <div className="flex items-center justify-end space-x-1">
                            <Link
                                href={`/sales/quotes/${quote.id}`}
                                className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                                title={t.common.view}
                            >
                                <Eye className="w-4 h-4" />
                            </Link>
                            <Link
                                href={`/sales/quotes/${quote.id}?edit=true`}
                                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                                title={t.common.edit}
                            >
                                <Edit2 className="w-4 h-4" />
                            </Link>
                            <button
                                onClick={() => handlePrint(quote)}
                                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                                title={t.common.print}
                            >
                                <Printer className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => handleDelete(quote.id)}
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
                size: 170,
            }),
        ],
        [t, locale],
    );

    const filterPresets = useMemo(
        () => [
            { label: t.quotes.filterPresets.draft, filters: [{ id: 'status', value: 'DRAFT' }] },
            { label: t.quotes.filterPresets.sent, filters: [{ id: 'status', value: 'SENT' }] },
            { label: t.quotes.filterPresets.accepted, filters: [{ id: 'status', value: 'ACCEPTED' }] },
            { label: t.quotes.filterPresets.converted, filters: [{ id: 'status', value: 'CONVERTED' }] },
        ],
        [t],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.quotes.title}</h1>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {t.quotes.subtitle}
                        </p>
                    </div>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 active:translate-y-0"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        {t.quotes.newQuotation}
                    </button>
                </div>

                <CreateQuotationModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSuccess={loadQuotes} />

                <DataTable<Quotation>
                    tableId="sales-quotations"
                    columns={columns}
                    data={quotes}
                    title={t.quotes.dataTable.title}
                    isLoading={loading}
                    emptyMessage={t.quotes.dataTable.emptyMessage}
                    emptyIcon={<FileText className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.quotes.dataTable.searchPlaceholder}
                    filterPresets={filterPresets}
                    enableRowSelection
                />
            </div>
        </div>
    );
}