'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Eye, Pencil, Plus, Printer, RotateCcw, Trash2 } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { api } from '../../../lib/api';
import CreatePurchaseReturnModal from './CreatePurchaseReturnModal';
import { PostingBadge } from '@/components/PostingBadge';
import { formatBDT, formatDate } from '../../../lib/format';

interface PurchaseReturnRecord {
    id: string;
    return_number: string;
    created_at: string;
    total_amount: string | number;
    notes?: string | null;
    supplier?: {
        name: string;
    } | null;
    purchase?: {
        id: string;
        purchase_number: string;
    } | null;
    items: Array<{ id: string }>;
    posting_status?: string | null;
    voucher_number?: string | null;
}

const columnHelper = createColumnHelper<PurchaseReturnRecord>();

export default function PurchaseReturnsPage() {
    const [purchaseReturns, setPurchaseReturns] = useState<PurchaseReturnRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [initialPurchaseId, setInitialPurchaseId] = useState<string | null>(null);

    useEffect(() => {
        loadPurchaseReturns();
    }, []);

    const loadPurchaseReturns = async () => {
        try {
            const data = await api.getPurchaseReturns();
            setPurchaseReturns(data);
        } catch (error) {
            console.error('Failed to load purchase returns', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Are you sure you want to delete this purchase return?')) {
            return;
        }

        try {
            await api.deletePurchaseReturn(id);
            setPurchaseReturns((current) => current.filter((purchaseReturn) => purchaseReturn.id !== id));
        } catch (error) {
            console.error('Failed to delete purchase return', error);
            window.alert('Failed to delete purchase return. Please try again.');
        }
    };

    const handlePrint = (id: string) => {
        window.open(`/dashboard/purchase-returns/${id}?print=true`, '_blank');
    };

    const openCreateModal = (purchaseId?: string | null) => {
        setInitialPurchaseId(purchaseId || null);
        setIsModalOpen(true);
    };

    const columns: ColumnDef<PurchaseReturnRecord, any>[] = useMemo(
        () => [
            columnHelper.accessor('return_number', {
                header: 'Return #',
                cell: (info) => <span className="text-sm font-black text-gray-900">{info.getValue()}</span>,
                size: 150,
            }),
            columnHelper.accessor((row) => row.purchase?.purchase_number ?? '-', {
                id: 'purchase_number',
                header: 'Source Purchase',
                cell: (info) => <span className="text-sm font-bold text-gray-700">{info.getValue()}</span>,
                size: 160,
            }),
            columnHelper.accessor((row) => row.supplier?.name ?? 'Unlinked', {
                id: 'supplier',
                header: 'Supplier',
                cell: (info) => <span className="text-sm font-bold text-gray-700">{info.getValue()}</span>,
                size: 190,
            }),
            columnHelper.accessor((row) => row.items?.length ?? 0, {
                id: 'item_count',
                header: 'Items',
                cell: (info) => <span className="text-sm font-bold text-gray-700">{info.getValue()} lines</span>,
                size: 100,
            }),
            columnHelper.accessor('total_amount', {
                header: 'Total',
                cell: (info) => (
                    <span className="text-sm font-black text-emerald-600">
                        {formatBDT(Number(info.getValue() || 0))}
                    </span>
                ),
                sortingFn: (a, b) => Number(a.getValue('total_amount') || 0) - Number(b.getValue('total_amount') || 0),
                size: 120,
            }),
            columnHelper.accessor('created_at', {
                header: 'Created',
                cell: (info) => {
                    const date = new Date(info.getValue());
                    return (
                        <div>
                            <span className="text-sm text-gray-600">{formatDate(info.getValue())}</span>
                            <span className="text-xs text-gray-400 block">{date.toLocaleTimeString()}</span>
                        </div>
                    );
                },
                sortingFn: 'datetime',
                size: 150,
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
                            <button
                                onClick={() => openCreateModal(row.purchase?.id)}
                                className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
                                title="Create another return from this purchase"
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                            <Link
                                href={`/dashboard/purchase-returns/${row.id}`}
                                className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                                title="View"
                            >
                                <Eye className="w-4 h-4" />
                            </Link>
                            <Link
                                href={`/dashboard/purchase-returns/${row.id}?edit=true`}
                                className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50 transition-colors"
                                title="Edit"
                            >
                                <Pencil className="w-4 h-4" />
                            </Link>
                            <button
                                onClick={() => handlePrint(row.id)}
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
                size: 180,
            }),
        ],
        [],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1400px] mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">Purchase Returns</h1>
                        <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                            Track supplier returns and start new returns from original purchase receipts
                        </p>
                    </div>
                    <button
                        onClick={() => openCreateModal()}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm flex items-center shadow-lg shadow-emerald-200 transition-all hover:-translate-y-0.5 active:translate-y-0"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        New Return
                    </button>
                </div>

                <CreatePurchaseReturnModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    onSuccess={loadPurchaseReturns}
                    initialPurchaseId={initialPurchaseId}
                />

                <DataTable<PurchaseReturnRecord>
                    tableId="purchase-returns"
                    columns={columns}
                    data={purchaseReturns}
                    title="Purchase Returns"
                    isLoading={loading}
                    emptyMessage="No purchase returns recorded yet"
                    emptyIcon={<RotateCcw className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder="Search by return #, source purchase, or supplier..."
                    enableRowSelection
                />
            </div>
        </div>
    );
}