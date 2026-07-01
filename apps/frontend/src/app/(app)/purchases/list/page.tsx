'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ClipboardList, Plus, Printer } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import CreatePurchaseModal from '../CreatePurchaseModal';
import { PostingBadge } from '@/components/PostingBadge';
import { useI18n, formatMessage } from '@/lib/i18n';

interface PurchaseItem {
    id: string;
    quantity: number;
    unit_cost: string | number;
    product?: {
        name: string;
        sku?: string | null;
    };
}

interface Purchase {
    id: string;
    purchase_number: string;
    total_amount: string | number;
    subtotal_amount: string | number;
    created_at: string;
    supplier?: {
        name: string;
    } | null;
    items: PurchaseItem[];
    posting_status?: string | null;
    voucher_number?: string | null;
}

const columnHelper = createColumnHelper<Purchase>();

export default function PurchasesPage() {
    const { t, locale } = useI18n();
    const searchParams = useSearchParams();
    const [purchases, setPurchases] = useState<Purchase[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);

    useEffect(() => {
        loadPurchases();
    }, []);

    useEffect(() => {
        if (searchParams.get('new') === '1') {
            setIsModalOpen(true);
        }
    }, [searchParams]);

    const loadPurchases = async () => {
        try {
            const data = await api.getPurchases();
            setPurchases(data);
        } catch (error) {
            console.error('Failed to load purchases', error);
        } finally {
            setLoading(false);
        }
    };

    const columns: ColumnDef<Purchase, any>[] = useMemo(
        () => [
            columnHelper.accessor('purchase_number', {
                header: t.purchases.columns.purchaseNumber,
                cell: (info) => (
                    <span className="text-sm font-black text-gray-900">{info.getValue()}</span>
                ),
                size: 150,
            }),
            columnHelper.accessor((row) => row.supplier?.name ?? t.purchaseShared.unlinked, {
                id: 'supplier',
                header: t.purchases.columns.supplier,
                cell: (info) => (
                    <span className="text-sm font-bold text-gray-700">{info.getValue()}</span>
                ),
                size: 180,
            }),
            columnHelper.accessor((row) => row.items?.length ?? 0, {
                id: 'item_count',
                header: t.purchases.columns.items,
                cell: (info) => (
                    <span className="text-sm font-bold text-gray-700">
                        {formatMessage(t.purchaseShared.itemsCount, { count: info.getValue() })}
                    </span>
                ),
                size: 90,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => row.items.map((item) => item.product?.name).filter(Boolean).join(', '), {
                id: 'products',
                header: t.purchases.columns.products,
                cell: (info) => (
                    <span className="text-sm text-gray-500 line-clamp-2">{info.getValue() || '-'}</span>
                ),
                size: 320,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('total_amount', {
                header: t.purchases.columns.total,
                cell: (info) => (
                    <span className="text-sm font-black text-emerald-600">
                        {formatBDT(Number(info.getValue() || 0), { locale })}
                    </span>
                ),
                sortingFn: (a, b) =>
                    Number(a.getValue('total_amount') || 0) - Number(b.getValue('total_amount') || 0),
                size: 120,
            }),
            columnHelper.accessor('created_at', {
                header: t.purchases.columns.received,
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
                meta: { hideOnMobile: true },
            }),
            columnHelper.display({
                id: 'posting',
                header: t.purchases.columns.voucher,
                cell: ({ row }) => (
                    <PostingBadge
                        status={row.original.posting_status}
                        voucherNumber={row.original.voucher_number}
                    />
                ),
                size: 120,
                meta: { hideOnMobile: true },
            }),
            columnHelper.display({
                id: 'actions',
                header: '',
                cell: ({ row }) => (
                    <Link
                        href={`/purchases/${row.original.id}/invoice`}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors inline-flex"
                        title={t.purchases.printInvoice}
                    >
                        <Printer className="w-4 h-4" />
                    </Link>
                ),
                enableSorting: false,
                enableResizing: false,
                size: 50,
            }),
        ],
        [t, locale],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-4 md:p-6 font-sans text-gray-900">
            <div className="w-full space-y-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">{t.purchases.title}</h1>
                        <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                            {t.purchases.subtitle}
                        </p>
                    </div>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm flex items-center shadow-lg shadow-emerald-200 transition-all hover:-translate-y-0.5 active:translate-y-0"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        {t.purchases.recordPurchase}
                    </button>
                </div>

                <CreatePurchaseModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    onSuccess={loadPurchases}
                />

                <DataTable<Purchase>
                    tableId="purchases"
                    columns={columns}
                    data={purchases}
                    title={t.purchases.tableTitle}
                    isLoading={loading}
                    emptyMessage={t.purchases.emptyMessage}
                    emptyIcon={<ClipboardList className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.purchases.searchPlaceholder}
                    enableRowSelection
                />
            </div>
        </div>
    );
}