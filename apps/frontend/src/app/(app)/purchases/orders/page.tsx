'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { FileText, Plus, Printer } from 'lucide-react';
import Link from 'next/link';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import CreatePurchaseOrderModal from './CreatePurchaseOrderModal';
import { useI18n, formatMessage } from '@/lib/i18n';

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

const statusStyles: Record<string, string> = {
    DRAFT:     'bg-gray-100 text-gray-600',
    SENT:      'bg-blue-100 text-blue-700',
    RECEIVED:  'bg-emerald-100 text-emerald-700',
    CANCELLED: 'bg-red-100 text-red-600',
};

const columnHelper = createColumnHelper<PurchaseOrder>();

export default function PurchaseOrdersPage() {
    const { t, locale } = useI18n();
    const [orders, setOrders] = useState<PurchaseOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);

    useEffect(() => { void load(); }, []);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getPurchaseOrders();
            setOrders(data);
        } catch (err) {
            console.error('Failed to load purchase orders', err);
        } finally {
            setLoading(false);
        }
    };

    const columns: ColumnDef<PurchaseOrder, any>[] = useMemo(() => [
        columnHelper.accessor('po_number', {
            header: t.purchaseOrders.columns.poNumber,
            cell: (info) => (
                <Link href={`/purchases/orders/${info.row.original.id}`}
                    className="text-sm font-black text-blue-700 hover:underline">
                    {info.getValue()}
                </Link>
            ),
            size: 130,
        }),
        columnHelper.accessor('status', {
            header: t.purchaseOrders.columns.status,
            cell: (info) => {
                const status = info.getValue() as keyof typeof t.purchaseShared.status;
                return (
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${statusStyles[info.getValue()] ?? 'bg-gray-100 text-gray-600'}`}>
                        {t.purchaseShared.status[status] ?? info.getValue()}
                    </span>
                );
            },
            size: 110,
        }),
        columnHelper.accessor((row) => row.supplier?.name ?? t.purchaseOrders.noSupplier, {
            id: 'supplier',
            header: t.purchaseOrders.columns.supplier,
            size: 180,
        }),
        columnHelper.accessor((row) => row.items?.length ?? 0, {
            id: 'item_count',
            header: t.purchaseOrders.columns.items,
            cell: (info) => (
                <span className="text-sm text-gray-600">
                    {formatMessage(t.purchaseShared.itemsCount, { count: info.getValue() })}
                </span>
            ),
            size: 80,
        }),
        columnHelper.accessor('total_amount', {
            header: t.purchaseOrders.columns.total,
            cell: (info) => (
                <span className="text-sm font-black text-emerald-600">{formatBDT(Number(info.getValue() || 0), { locale })}</span>
            ),
            size: 130,
        }),
        columnHelper.accessor('expected_date', {
            header: t.purchaseOrders.columns.expected,
            cell: (info) => (
                <span className="text-sm text-gray-500">{info.getValue() ? formatDate(info.getValue()!, locale) : '—'}</span>
            ),
            size: 120,
        }),
        columnHelper.accessor('created_at', {
            header: t.purchaseOrders.columns.created,
            cell: (info) => <span className="text-sm text-gray-500">{formatDate(info.getValue(), locale)}</span>,
            sortingFn: 'datetime',
            size: 120,
        }),
        columnHelper.display({
            id: 'actions',
            header: '',
            cell: ({ row }) => (
                <div className="flex items-center gap-1">
                    <Link href={`/purchases/orders/${row.original.id}`}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        title={t.purchaseOrders.view}>
                        <FileText className="w-4 h-4" />
                    </Link>
                    <Link href={`/purchases/orders/${row.original.id}/invoice`}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                        title={t.purchaseOrders.print}>
                        <Printer className="w-4 h-4" />
                    </Link>
                </div>
            ),
            enableSorting: false,
            enableResizing: false,
            size: 80,
        }),
    ], [t, locale]);

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.purchaseOrders.title}</h1>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {t.purchaseOrders.subtitle}
                        </p>
                    </div>
                    <button
                        onClick={() => setModalOpen(true)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        {t.purchaseOrders.newPo}
                    </button>
                </div>

                <CreatePurchaseOrderModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSuccess={load} />

                <DataTable<PurchaseOrder>
                    tableId="purchase-orders"
                    columns={columns}
                    data={orders}
                    title={t.purchaseOrders.tableTitle}
                    isLoading={loading}
                    emptyMessage={t.purchaseOrders.emptyMessage}
                    emptyIcon={<FileText className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.purchaseOrders.searchPlaceholder}
                />
            </div>
        </div>
    );
}