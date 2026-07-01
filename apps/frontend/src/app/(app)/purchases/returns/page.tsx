'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Eye, Pencil, Plus, Printer, RotateCcw, Trash2 } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import CreatePurchaseReturnModal from './CreatePurchaseReturnModal';
import { PostingBadge } from '@/components/PostingBadge';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

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
    const { t, locale } = useI18n();
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
        if (!window.confirm(t.purchaseReturns.deleteConfirm)) {
            return;
        }

        try {
            await api.deletePurchaseReturn(id);
            setPurchaseReturns((current) => current.filter((purchaseReturn) => purchaseReturn.id !== id));
        } catch (error) {
            console.error('Failed to delete purchase return', error);
            window.alert(t.purchaseReturns.deleteFailed);
        }
    };

    const handlePrint = (id: string) => {
        window.open(`/purchases/returns/${id}?print=true`, '_blank');
    };

    const openCreateModal = (purchaseId?: string | null) => {
        setInitialPurchaseId(purchaseId || null);
        setIsModalOpen(true);
    };

    const columns: ColumnDef<PurchaseReturnRecord, any>[] = useMemo(
        () => [
            columnHelper.accessor('return_number', {
                header: t.purchaseReturns.columns.returnNumber,
                cell: (info) => <span className="text-sm font-black text-gray-900">{info.getValue()}</span>,
                size: 150,
            }),
            columnHelper.accessor((row) => row.purchase?.purchase_number ?? '-', {
                id: 'purchase_number',
                header: t.purchaseReturns.columns.sourcePurchase,
                cell: (info) => <span className="text-sm font-bold text-gray-700">{info.getValue()}</span>,
                size: 160,
            }),
            columnHelper.accessor((row) => row.supplier?.name ?? t.purchaseShared.unlinked, {
                id: 'supplier',
                header: t.purchaseQuotations.columns.supplier,
                cell: (info) => <span className="text-sm font-bold text-gray-700">{info.getValue()}</span>,
                size: 190,
            }),
            columnHelper.accessor((row) => row.items?.length ?? 0, {
                id: 'item_count',
                header: t.purchaseReturns.columns.items,
                cell: (info) => (
                    <span className="text-sm font-bold text-gray-700">
                        {formatMessage(t.purchaseShared.linesCount, { count: info.getValue() })}
                    </span>
                ),
                size: 100,
            }),
            columnHelper.accessor('total_amount', {
                header: t.purchaseQuotations.columns.total,
                cell: (info) => (
                    <span className="text-sm font-black text-emerald-600">
                        {formatBDT(Number(info.getValue() || 0), { locale })}
                    </span>
                ),
                sortingFn: (a, b) => Number(a.getValue('total_amount') || 0) - Number(b.getValue('total_amount') || 0),
                size: 120,
            }),
            columnHelper.accessor('created_at', {
                header: t.purchaseReturns.columns.created,
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
            columnHelper.display({
                id: 'posting',
                header: t.purchaseReturns.columns.voucher,
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
                header: t.purchaseQuotations.columns.actions,
                cell: (info) => {
                    const row = info.row.original;
                    return (
                        <div className="flex items-center justify-end space-x-1">
                            <button
                                onClick={() => openCreateModal(row.purchase?.id)}
                                className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
                                title={t.purchaseReturns.createAnother}
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                            <Link
                                href={`/purchases/returns/${row.id}`}
                                className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                                title={t.common.view}
                            >
                                <Eye className="w-4 h-4" />
                            </Link>
                            <Link
                                href={`/purchases/returns/${row.id}?edit=true`}
                                className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50 transition-colors"
                                title={t.common.edit}
                            >
                                <Pencil className="w-4 h-4" />
                            </Link>
                            <button
                                onClick={() => handlePrint(row.id)}
                                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                                title={t.purchaseReturns.detail.print}
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
                size: 180,
            }),
        ],
        [t, locale],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.purchaseReturns.title}</h1>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {t.purchaseReturns.subtitle}
                        </p>
                    </div>
                    <button
                        onClick={() => openCreateModal()}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-lg shadow-emerald-200 transition-all hover:-translate-y-0.5 active:translate-y-0"
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
                    title={t.purchaseReturns.tableTitle}
                    isLoading={loading}
                    emptyMessage={t.purchaseReturns.emptyMessage}
                    emptyIcon={<RotateCcw className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.purchaseReturns.searchPlaceholder}
                    enableRowSelection
                />
            </div>
        </div>
    );
}