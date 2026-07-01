'use client';

import { useState, useEffect, useMemo } from 'react';
import { FileSearch, Plus, Eye, Trash2, ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import CreatePurchaseQuotationModal from './CreatePurchaseQuotationModal';
import { useI18n, formatMessage } from '@/lib/i18n';

interface PurchaseQuotation {
    id: string;
    rfq_number: string;
    status: string;
    valid_until: string | null;
    total_amount: string;
    created_at: string;
    notes: string | null;
    supplier?: { id: string; name: string } | null;
    store?: { name: string } | null;
    items: { id: string }[];
}

const statusColors: Record<string, string> = {
    DRAFT:     'bg-gray-50 text-gray-600 border-gray-200',
    SENT:      'bg-blue-50 text-blue-700 border-blue-200',
    RECEIVED:  'bg-amber-50 text-amber-700 border-amber-200',
    ACCEPTED:  'bg-emerald-50 text-emerald-700 border-emerald-200',
    REJECTED:  'bg-red-50 text-red-700 border-red-200',
    CONVERTED: 'bg-violet-50 text-violet-700 border-violet-200',
    CANCELLED: 'bg-gray-100 text-gray-500 border-gray-200',
};

const columnHelper = createColumnHelper<PurchaseQuotation>();

export default function PurchaseQuotationsPage() {
    const { t, locale } = useI18n();
    const router = useRouter();
    const [rfqs, setRfqs] = useState<PurchaseQuotation[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);

    useEffect(() => { void load(); }, []);

    const load = async () => {
        try {
            const data = await api.getPurchaseQuotations();
            setRfqs(data);
        } catch {
            // silent
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm(t.purchaseQuotations.deleteConfirm)) return;
        try {
            await api.deletePurchaseQuotation(id);
            setRfqs((prev) => prev.filter((r) => r.id !== id));
        } catch (err: any) {
            alert(err.message || t.purchaseQuotations.deleteFailed);
        }
    };

    const handleConvert = async (rfq: PurchaseQuotation) => {
        if (!window.confirm(formatMessage(t.purchaseQuotations.convertConfirm, { rfqNumber: rfq.rfq_number }))) return;
        try {
            const po = await api.convertPurchaseQuotation(rfq.id);
            alert(formatMessage(t.purchaseQuotations.convertSuccess, { poNumber: po.po_number }));
            void load();
            router.push(`/purchases/orders/${po.id}`);
        } catch (err: any) {
            alert(err.message || t.purchaseQuotations.convertFailed);
        }
    };

    const columns: ColumnDef<PurchaseQuotation, any>[] = useMemo(() => [
        columnHelper.accessor('rfq_number', {
            header: t.purchaseQuotations.columns.rfqNumber,
            cell: (info) => <span className="text-sm font-black text-gray-900">{info.getValue()}</span>,
            size: 130,
        }),
        columnHelper.accessor('created_at', {
            header: t.purchaseQuotations.columns.date,
            cell: (info) => <span className="text-sm text-gray-600">{formatDate(info.getValue(), locale)}</span>,
            sortingFn: 'datetime',
            size: 120,
        }),
        columnHelper.accessor((row) => row.supplier?.name ?? '', {
            id: 'supplier',
            header: t.purchaseQuotations.columns.supplier,
            cell: (info) => (
                <span className="text-sm text-gray-700 font-medium">
                    {info.getValue() || <span className="text-gray-300 italic">{t.purchaseShared.noSupplierShort}</span>}
                </span>
            ),
            size: 180,
        }),
        columnHelper.accessor((row) => row.items?.length ?? 0, {
            id: 'items',
            header: t.purchaseQuotations.columns.items,
            cell: (info) => (
                <span className="text-sm font-bold text-gray-700">
                    {formatMessage(t.purchaseShared.itemsCount, { count: info.getValue() })}
                </span>
            ),
            size: 80,
        }),
        columnHelper.accessor('valid_until', {
            header: t.purchaseQuotations.columns.validUntil,
            cell: (info) => (
                <span className="text-sm text-gray-600">
                    {info.getValue() ? formatDate(info.getValue() as string, locale) : '—'}
                </span>
            ),
            size: 120,
        }),
        columnHelper.accessor('total_amount', {
            header: t.purchaseQuotations.columns.total,
            cell: (info) => <span className="text-sm font-black text-blue-600">{formatBDT(parseFloat(info.getValue()), { locale })}</span>,
            size: 120,
        }),
        columnHelper.accessor('status', {
            header: t.purchaseQuotations.columns.status,
            cell: (info) => {
                const s = info.getValue();
                return (
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${statusColors[s] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`}>
                        {s}
                    </span>
                );
            },
            size: 120,
        }),
        columnHelper.display({
            id: 'actions',
            header: t.purchaseQuotations.columns.actions,
            cell: (info) => {
                const rfq = info.row.original;
                const canConvert = rfq.status !== 'CONVERTED' && rfq.status !== 'CANCELLED' && rfq.status !== 'REJECTED';
                return (
                    <div className="flex items-center justify-end gap-1">
                        <Link href={`/purchases/quotations/${rfq.id}`}
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors" title={t.common.view}>
                            <Eye className="w-4 h-4" />
                        </Link>
                        {canConvert && (
                            <button onClick={() => handleConvert(rfq)}
                                className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors" title={t.purchaseQuotations.convertToPo}>
                                <ShoppingCart className="w-4 h-4" />
                            </button>
                        )}
                        <button onClick={() => handleDelete(rfq.id)}
                            className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors" title={t.common.delete}>
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                );
            },
            enableSorting: false,
            enableColumnFilter: false,
            size: 120,
        }),
    ], [t, locale, rfqs]);

    const filterPresets = useMemo(() => [
        { label: t.purchaseShared.status.DRAFT, filters: [{ id: 'status', value: 'DRAFT' }] },
        { label: t.purchaseShared.status.SENT, filters: [{ id: 'status', value: 'SENT' }] },
        { label: t.purchaseShared.status.RECEIVED, filters: [{ id: 'status', value: 'RECEIVED' }] },
        { label: t.purchaseShared.status.ACCEPTED, filters: [{ id: 'status', value: 'ACCEPTED' }] },
        { label: t.purchaseShared.status.CONVERTED, filters: [{ id: 'status', value: 'CONVERTED' }] },
    ], []);

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.purchaseQuotations.title}</h1>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {t.purchaseQuotations.subtitle}
                        </p>
                    </div>
                    <button onClick={() => setIsModalOpen(true)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5">
                        <Plus className="w-4 h-4 mr-2" />
                        New RFQ
                    </button>
                </div>

                <CreatePurchaseQuotationModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    onSuccess={load}
                />

                <DataTable<PurchaseQuotation>
                    tableId="purchase-quotations"
                    columns={columns}
                    data={rfqs}
                    title={t.purchaseQuotations.tableTitle}
                    isLoading={loading}
                    emptyMessage={t.purchaseQuotations.emptyMessage}
                    emptyIcon={<FileSearch className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.purchaseQuotations.searchPlaceholder}
                    filterPresets={filterPresets}
                    enableRowSelection
                />
            </div>
        </div>
    );
}
