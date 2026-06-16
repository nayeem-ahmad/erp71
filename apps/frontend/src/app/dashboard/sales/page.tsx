'use client';

import { useState, useEffect, useMemo } from 'react';
import { Receipt, Eye, Edit2, Plus } from 'lucide-react';
import { api } from '../../../lib/api';
import { formatBDT, formatDate } from '../../../lib/format';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { PostingBadge } from '@/components/PostingBadge';
import { useI18n, formatMessage } from '@/lib/i18n';

interface Sale {
    id: string;
    serial_number: string;
    created_at: string;
    items: any[];
    total_amount: string;
    amount_paid: string;
    status: string;
    payments: { payment_method: string; amount: string }[];
    customer?: { name: string };
    note?: string;
    posting_status?: string | null;
    voucher_number?: string | null;
}

const statusColors: Record<string, string> = {
    COMPLETED: 'bg-green-50 text-green-700 border-green-200',
    REFUNDED: 'bg-rose-50 text-rose-700 border-rose-200',
    PARTIAL_REFUND: 'bg-amber-50 text-amber-700 border-amber-200',
};

const columnHelper = createColumnHelper<Sale>();

export default function SalesPage() {
    const { t, locale } = useI18n();
    const [sales, setSales] = useState<Sale[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadSales();
    }, []);

    const loadSales = async () => {
        try {
            const data = await api.getSales();
            setSales(data);
        } catch (error) {
            console.error('Failed to load sales', error);
        } finally {
            setLoading(false);
        }
    };

    const columns: ColumnDef<Sale, any>[] = useMemo(
        () => [
            columnHelper.accessor('serial_number', {
                header: t.sales.columns.serialNumber,
                cell: (info) => (
                    <span className="text-sm font-black text-gray-900">{info.getValue()}</span>
                ),
                size: 140,
            }),
            columnHelper.accessor('created_at', {
                header: t.sales.columns.date,
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
            columnHelper.accessor((row) => row.customer?.name ?? '', {
                id: 'customer',
                header: t.sales.columns.customer,
                cell: (info) => (
                    <span className="text-sm text-gray-700 font-medium">
                        {info.getValue() || <span className="text-gray-300">{t.shared.walkIn}</span>}
                    </span>
                ),
                size: 150,
            }),
            columnHelper.accessor((row) => row.items?.length ?? 0, {
                id: 'item_count',
                header: t.sales.columns.items,
                cell: (info) => (
                    <span className="text-sm font-bold text-gray-700">
                        {formatMessage(t.shared.itemsCount, { count: info.getValue() })}
                    </span>
                ),
                size: 80,
            }),
            columnHelper.accessor('total_amount', {
                header: t.sales.columns.total,
                cell: (info) => (
                    <span className="text-sm font-black text-blue-600">
                        {formatBDT(parseFloat(info.getValue()), { locale })}
                    </span>
                ),
                sortingFn: (a, b) =>
                    parseFloat(a.getValue('total_amount')) - parseFloat(b.getValue('total_amount')),
                size: 110,
            }),
            columnHelper.accessor('amount_paid', {
                header: t.sales.columns.paid,
                cell: (info) => (
                    <span className="text-sm font-bold text-gray-700">
                        {formatBDT(parseFloat(info.getValue()), { locale })}
                    </span>
                ),
                sortingFn: (a, b) =>
                    parseFloat(a.getValue('amount_paid')) - parseFloat(b.getValue('amount_paid')),
                size: 110,
            }),
            columnHelper.accessor('status', {
                header: t.sales.columns.status,
                cell: (info) => {
                    const status = info.getValue();
                    return (
                        <span
                            className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                                statusColors[status] ?? 'bg-gray-50 text-gray-700 border-gray-200'
                            }`}
                        >
                            {t.shared.statuses.sale[status as keyof typeof t.shared.statuses.sale] ?? status}
                        </span>
                    );
                },
                size: 130,
            }),
            columnHelper.accessor(
                (row) => row.payments?.map((p) => p.payment_method).join(', ') ?? '',
                {
                    id: 'payments',
                    header: t.sales.columns.payments,
                    cell: (info) => {
                        const row = info.row.original;
                        return (
                            <div className="flex flex-wrap gap-1">
                                {row.payments?.map((p, i) => (
                                    <span
                                        key={i}
                                        className="bg-gray-100 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider text-gray-500"
                                    >
                                        {p.payment_method}
                                    </span>
                                ))}
                            </div>
                        );
                    },
                    size: 150,
                },
            ),
            columnHelper.display({
                id: 'posting',
                header: t.sales.columns.voucher,
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
                header: t.sales.columns.actions,
                cell: (info) => (
                    <div className="flex items-center justify-end space-x-1">
                        <Link
                            href={`/dashboard/sales/${info.row.original.id}`}
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                            title={t.common.view}
                        >
                            <Eye className="w-4 h-4" />
                        </Link>
                        <Link
                            href={`/dashboard/sales/${info.row.original.id}?edit=true`}
                            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                            title={t.common.edit}
                        >
                            <Edit2 className="w-4 h-4" />
                        </Link>
                    </div>
                ),
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 90,
            }),
        ],
        [t, locale],
    );

    const filterPresets = useMemo(
        () => [
            { label: t.sales.filterPresets.completed, filters: [{ id: 'status', value: 'COMPLETED' }] },
            { label: t.sales.filterPresets.refunded, filters: [{ id: 'status', value: 'REFUNDED' }] },
            { label: t.sales.filterPresets.partialRefund, filters: [{ id: 'status', value: 'PARTIAL_REFUND' }] },
        ],
        [t],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="w-full space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">{t.sales.title}</h1>
                        <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                            {t.sales.subtitle}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Link
                            href="/dashboard/sales/new"
                            className="bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center transition-all hover:-translate-y-0.5 active:translate-y-0"
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            New Sales Entry
                        </Link>
                        <Link
                            href="/dashboard/pos"
                            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm flex items-center shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 active:translate-y-0"
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            {t.sales.newSale}
                        </Link>
                    </div>
                </div>

                <DataTable<Sale>
                    tableId="sales"
                    columns={columns}
                    data={sales}
                    title={t.sales.dataTable.title}
                    isLoading={loading}
                    emptyMessage={t.sales.dataTable.emptyMessage}
                    emptyIcon={<Receipt className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.sales.dataTable.searchPlaceholder}
                    filterPresets={filterPresets}
                    enableRowSelection
                />
            </div>
        </div>
    );
}