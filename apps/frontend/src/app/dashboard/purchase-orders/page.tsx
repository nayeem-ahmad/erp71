'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { FileText, Plus, Printer } from 'lucide-react';
import Link from 'next/link';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import CreatePurchaseOrderModal from './CreatePurchaseOrderModal';

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
            header: 'PO #',
            cell: (info) => (
                <Link href={`/dashboard/purchase-orders/${info.row.original.id}`}
                    className="text-sm font-black text-blue-700 hover:underline">
                    {info.getValue()}
                </Link>
            ),
            size: 130,
        }),
        columnHelper.accessor('status', {
            header: 'Status',
            cell: (info) => (
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${statusStyles[info.getValue()] ?? 'bg-gray-100 text-gray-600'}`}>
                    {info.getValue()}
                </span>
            ),
            size: 110,
        }),
        columnHelper.accessor((row) => row.supplier?.name ?? 'No supplier', {
            id: 'supplier',
            header: 'Supplier',
            size: 180,
        }),
        columnHelper.accessor((row) => row.items?.length ?? 0, {
            id: 'item_count',
            header: 'Items',
            cell: (info) => <span className="text-sm text-gray-600">{info.getValue()} items</span>,
            size: 80,
        }),
        columnHelper.accessor('total_amount', {
            header: 'Total',
            cell: (info) => (
                <span className="text-sm font-black text-emerald-600">{formatBDT(Number(info.getValue() || 0))}</span>
            ),
            size: 130,
        }),
        columnHelper.accessor('expected_date', {
            header: 'Expected',
            cell: (info) => (
                <span className="text-sm text-gray-500">{info.getValue() ? formatDate(info.getValue()!) : '—'}</span>
            ),
            size: 120,
        }),
        columnHelper.accessor('created_at', {
            header: 'Created',
            cell: (info) => <span className="text-sm text-gray-500">{formatDate(info.getValue())}</span>,
            sortingFn: 'datetime',
            size: 120,
        }),
        columnHelper.display({
            id: 'actions',
            header: '',
            cell: ({ row }) => (
                <div className="flex items-center gap-1">
                    <Link href={`/dashboard/purchase-orders/${row.original.id}`}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        title="View">
                        <FileText className="w-4 h-4" />
                    </Link>
                    <Link href={`/dashboard/purchase-orders/${row.original.id}/invoice`}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                        title="Print">
                        <Printer className="w-4 h-4" />
                    </Link>
                </div>
            ),
            enableSorting: false,
            enableResizing: false,
            size: 80,
        }),
    ], []);

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1400px] mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">Purchase Orders</h1>
                        <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                            Draft, send, and receive orders from suppliers
                        </p>
                    </div>
                    <button
                        onClick={() => setModalOpen(true)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm flex items-center shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        New PO
                    </button>
                </div>

                <CreatePurchaseOrderModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSuccess={load} />

                <DataTable<PurchaseOrder>
                    tableId="purchase-orders"
                    columns={columns}
                    data={orders}
                    title="Purchase Orders"
                    isLoading={loading}
                    emptyMessage="No purchase orders yet"
                    emptyIcon={<FileText className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder="Search by PO #, supplier..."
                />
            </div>
        </div>
    );
}
