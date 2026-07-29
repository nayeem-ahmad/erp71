'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Receipt, Eye, Edit2, FileText, Search, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { PostingBadge } from '@/components/PostingBadge';
import { useI18n, formatMessage } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { PageShell, Input, Select } from '@/components/ui';
import { useServerList } from '@/hooks/useServerList';
import { toast } from '@/lib/toast';

interface Sale {
    id: string;
    serial_number: string;
    created_at: string;
    sale_date?: string | null;
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
    DRAFT: 'bg-gray-50 text-gray-600 border-gray-200',
    COMPLETED: 'bg-green-50 text-green-700 border-green-200',
    REFUNDED: 'bg-danger-light text-danger-text border-red-200',
    PARTIAL_REFUND: 'bg-amber-50 text-amber-700 border-amber-200',
};

const columnHelper = createColumnHelper<Sale>();

export default function SalesPage() {
    const { t, locale } = useI18n();
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    // Typing must not fire a request per keystroke against a table this large.
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    // Pages against the server. This list used to pull the tenant's entire
    // sales history and render 20 rows from it, which fell over once an
    // imported tenant had thousands.
    const {
        items: sales,
        loading,
        serverPagination,
        reload,
        setItems: setSales,
    } = useServerList<Sale>({
        tableId: 'sales',
        initialSort: { id: 'created_at', desc: true },
        deps: [debouncedSearch, statusFilter],
        fetch: (params) =>
            api.getSalesList({
                ...params,
                search: debouncedSearch || undefined,
                status: statusFilter || undefined,
            }),
    });

    const handleDelete = useCallback(async (sale: Sale) => {
        if (!window.confirm(t.shared.confirm.deleteSale)) return;

        setDeletingId(sale.id);
        try {
            await api.deleteSale(sale.id);
            setSales((prev) => prev.filter((s) => s.id !== sale.id));
            void reload();
            toast.success(t.sales.detail.deleted);
        } catch (error: any) {
            console.error('Failed to delete sale', error);
            toast.error(error?.message || t.shared.errors.deleteSale);
        } finally {
            setDeletingId(null);
        }
    }, [t]);

    const columns: ColumnDef<Sale, any>[] = useMemo(
        () => [
            columnHelper.accessor('serial_number', {
                header: t.sales.columns.serialNumber,
                cell: (info) => (
                    <span className="text-sm font-bold text-gray-900">{info.getValue()}</span>
                ),
                size: 140,
            }),
            columnHelper.accessor('created_at', {
                header: t.sales.columns.date,
                cell: (info) => {
                    // Display the (possibly back-dated) sale_date to agree with reports;
                    // ordering stays on created_at for cursor-pagination stability.
                    const displayDate = info.row.original.sale_date ?? info.getValue();
                    const d = new Date(displayDate);
                    return (
                        <div>
                            <span className="text-sm text-gray-600">{formatDate(displayDate, locale)}</span>
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
                    <span className="text-sm font-bold text-blue-600">
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
                            className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${
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
                            href={`/sales/${info.row.original.id}`}
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                            title={t.common.view}
                        >
                            <Eye className="w-4 h-4" />
                        </Link>
                        <Link
                            href={`/sales/${info.row.original.id}?edit=true`}
                            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                            title={t.common.edit}
                        >
                            <Edit2 className="w-4 h-4" />
                        </Link>
                        <button
                            type="button"
                            onClick={() => handleDelete(info.row.original)}
                            disabled={deletingId === info.row.original.id}
                            className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 disabled:text-gray-300 transition-colors"
                            title={t.common.delete}
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                ),
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 120,
            }),
        ],
        [t, locale, handleDelete, deletingId],
    );

    // Was a client-side preset over the whole downloaded set; with server
    // paging the filter has to reach the query or it would only ever narrow the
    // current page.
    const statusOptions = useMemo(
        () => [
            { value: 'DRAFT', label: t.sales.filterPresets.draft },
            { value: 'COMPLETED', label: t.sales.filterPresets.completed },
            { value: 'REFUNDED', label: t.sales.filterPresets.refunded },
            { value: 'PARTIAL_REFUND', label: t.sales.filterPresets.partialRefund },
        ],
        [t],
    );

    return (
        <PageShell>
                <PageHeader
                    title={t.sales.list.title}
                    subtitle={t.sales.list.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.sales,
                        t.sales.list.title,
                        'sales',
                    )}
                    actions={
                        <Link
                            href={routes.sales.new}
                            className="bg-primary hover:bg-primary-hover text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center transition-colors"
                        >
                            <FileText className="w-4 h-4 mr-2" />
                            {t.sidebar.items.newSalesEntry}
                        </Link>
                    }
                />

                <div className="flex flex-wrap items-center gap-2 mb-3">
                    <div className="relative flex-1 min-w-[220px]">
                        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={t.sales.dataTable.searchPlaceholder}
                            className="pl-9"
                        />
                    </div>
                    <Select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="w-auto max-w-[180px]"
                    >
                        <option value="">{t.sales.dataTable.allStatuses}</option>
                        {statusOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </Select>
                </div>

                <DataTable<Sale>
                    tableId="sales"
                    columns={columns}
                    data={sales}
                    title={t.sales.dataTable.title}
                    isLoading={loading}
                    emptyMessage={t.sales.dataTable.emptyMessage}
                    emptyIcon={<Receipt className="w-16 h-16 text-gray-200" />}
                    showSearch={false}
                    serverPagination={serverPagination}
                />
            
        </PageShell>
    );
}