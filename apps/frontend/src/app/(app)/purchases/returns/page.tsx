'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDownToLine, Calculator, Eye, Pencil, Plus, Printer, RotateCcw, Scale, Trash2, Undo2 } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, createdAtColumn, type ListFilter, type ListStat } from '@/components/data-table';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import { api, type PurchaseDocumentListFilterParams, type PurchaseReturnListSummary } from '@/lib/api';
import { BranchFilter, ConfirmDialog, PageShell, buttonClassName } from '@/components/ui';
import { RowActions, RowActionButton } from '@/components/table';
import { useBranchForbiddenReset, useBranchScope } from '@/lib/branch-scope';
import CreatePurchaseReturnModal from './CreatePurchaseReturnModal';
import { PostingBadge } from '@/components/PostingBadge';
import { formatBDT } from '@/lib/format';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { useI18n, formatMessage } from '@/lib/i18n';
import type { NumberCondition } from '@/lib/number-condition';
import { toast } from '@/lib/toast';
import { useServerList } from '@/hooks/useServerList';
import { useListSummary } from '@/hooks/useListSummary';
import { supplierListFilter } from '../components/supplier-list-filter';

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
    const branch = useBranchScope();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [initialPurchaseId, setInitialPurchaseId] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<PurchaseReturnRecord | null>(null);
    const [deleting, setDeleting] = useState(false);

    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [supplierIds, setSupplierIds] = useState<string[]>([]);
    const [totalFilter, setTotalFilter] = useState<NumberCondition | null>(null);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    // A return is dated when it is recorded, so its one date is `created_at`.
    const filterParams = useMemo<PurchaseDocumentListFilterParams>(
        () => ({
            search: debouncedSearch || undefined,
            ...applyCreatedRangeQuery(createdRange),
            storeId: branch.apiStoreId,
            supplierIds,
            total: totalFilter,
        }),
        [debouncedSearch, createdRange, branch.apiStoreId, supplierIds, totalFilter],
    );

    const { items: purchaseReturns, loading, error: listError, serverPagination, reload } = useServerList<PurchaseReturnRecord>({
        tableId: 'purchase-returns',
        initialSort: { id: 'created_at', desc: true },
        deps: [filterParams],
        enabled: branch.ready,
        fetch: (params) => api.getPurchaseReturnsList({ ...params, ...filterParams }),
    });
    useBranchForbiddenReset(listError, branch, t.dashboardLayout.branchFilterForbidden);

    const { summary, loading: summaryLoading, reload: reloadSummary } = useListSummary<
        PurchaseDocumentListFilterParams,
        PurchaseReturnListSummary
    >({ fetch: api.getPurchaseReturnsListSummary, params: filterParams, enabled: branch.ready });

    const refresh = () => {
        void reload();
        reloadSummary();
    };

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        setDeleting(true);
        try {
            await api.deletePurchaseReturn(pendingDelete.id);
            setPendingDelete(null);
            refresh();
            toast.success(t.purchaseShared.lists.returns.deleted);
        } catch (error: any) {
            console.error('Failed to delete purchase return', error);
            toast.error(error?.message || t.purchaseReturns.deleteFailed);
        } finally {
            setDeleting(false);
        }
    };

    const openCreateModal = (purchaseId?: string | null) => {
        setInitialPurchaseId(purchaseId || null);
        setIsModalOpen(true);
    };

    const columns: ColumnDef<PurchaseReturnRecord, any>[] = useMemo(
        () => [
            columnHelper.accessor('return_number', {
                header: t.purchaseReturns.columns.returnNumber,
                cell: (info) => (
                    <Link
                        href={routes.purchases.returnDetail(info.row.original.id)}
                        className="font-medium text-gray-900 hover:text-blue-600 hover:underline"
                    >
                        {info.getValue()}
                    </Link>
                ),
                size: 150,
            }),
            createdAtColumn(columnHelper, { header: t.common.date, locale, enableColumnFilter: false }),
            columnHelper.accessor((row) => row.purchase?.purchase_number ?? '', {
                id: 'purchase_number',
                header: t.purchaseReturns.columns.sourcePurchase,
                enableSorting: false,
                cell: (info) => {
                    const purchase = info.row.original.purchase;
                    return purchase ? (
                        <Link href={routes.purchases.purchaseDetail(purchase.id)} className="text-blue-600 hover:underline">
                            {purchase.purchase_number}
                        </Link>
                    ) : (
                        <span className="text-gray-400">—</span>
                    );
                },
                size: 160,
            }),
            columnHelper.accessor((row) => row.supplier?.name ?? '', {
                id: 'supplier',
                header: t.purchaseReturns.columns.supplier,
                cell: (info) => info.getValue() || <span className="text-gray-400">{t.purchaseShared.unlinked}</span>,
                size: 190,
            }),
            columnHelper.accessor((row) => row.items?.length ?? 0, {
                id: 'item_count',
                header: t.purchaseReturns.columns.items,
                enableSorting: false,
                cell: (info) => formatMessage(t.purchaseShared.linesCount, { count: info.getValue() }),
                size: 100,
                meta: { align: 'end', hideOnMobile: true },
            }),
            columnHelper.accessor('total_amount', {
                header: t.purchaseReturns.columns.total,
                cell: (info) => formatBDT(Number(info.getValue() || 0), { locale }),
                size: 120,
                meta: { align: 'end' },
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
                meta: { hideOnMobile: true },
            }),
            columnHelper.display({
                id: 'actions',
                header: t.purchaseReturns.columns.actions,
                cell: (info) => {
                    const row = info.row.original;
                    return (
                        <RowActions>
                            <RowActionButton icon={<Eye />} label={t.common.view} href={routes.purchases.returnDetail(row.id)} />
                            <RowActionButton
                                icon={<Printer />}
                                label={t.purchaseReturns.detail.print}
                                onClick={() => window.open(`${routes.purchases.returnDetail(row.id)}?print=true`, '_blank')}
                            />
                            <RowActionButton
                                icon={<Pencil />}
                                label={t.common.edit}
                                href={`${routes.purchases.returnDetail(row.id)}?edit=true`}
                            />
                            <RowActionButton
                                icon={<Plus />}
                                label={t.purchaseReturns.createAnother}
                                onClick={() => openCreateModal(row.purchase?.id)}
                            />
                            <RowActionButton
                                icon={<Trash2 />}
                                label={t.common.delete}
                                intent="danger"
                                onClick={() => setPendingDelete(row)}
                            />
                        </RowActions>
                    );
                },
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 190,
            }),
        ],
        [t, locale],
    );

    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'created',
                type: 'date-range',
                label: t.common.date,
                value: createdRange,
                onChange: setCreatedRange,
                operators: true,
            },
            supplierListFilter({
                label: t.purchaseReturns.columns.supplier,
                noSupplierLabel: t.purchaseShared.noSupplierShort,
                value: supplierIds,
                onChange: setSupplierIds,
            }),
            {
                id: 'total',
                type: 'number',
                label: t.purchaseReturns.columns.total,
                value: totalFilter,
                onChange: setTotalFilter,
                money: true,
            },
        ],
        [t, createdRange, supplierIds, totalFilter],
    );

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const copy = t.purchaseShared.lists.returns.stats;
        const dash = '—';
        const items: ListStat[] = [
            {
                id: 'count',
                icon: <RotateCcw aria-hidden />,
                label: copy.returns,
                value: summary ? summary.count.toLocaleString(locale) : dash,
            },
            { id: 'amount', icon: <Undo2 aria-hidden />, label: copy.amount, value: summary ? money(summary.amount) : dash },
            {
                id: 'refunded',
                icon: <ArrowDownToLine aria-hidden />,
                label: copy.refunded,
                value: summary ? money(summary.refunded) : dash,
                hint: summary && summary.amount > 0
                    ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(summary.refunded / summary.amount)
                    : undefined,
            },
            { id: 'adjusted', icon: <Scale aria-hidden />, label: copy.adjusted, value: summary ? money(summary.adjusted) : dash },
            { id: 'average', icon: <Calculator aria-hidden />, label: copy.average, value: summary ? money(summary.average) : dash },
        ];
        return { items, loading: summaryLoading && !summary, label: t.purchaseShared.lists.returns.statsLabel };
    }, [summary, summaryLoading, locale, t]);

    return (
        <PageShell>
            <PageHeader
                title={t.purchaseReturns.title}
                subtitle={t.purchaseReturns.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.purchase,
                    t.purchaseReturns.title,
                    'purchases',
                )}
                actions={(
                    <>
                        <BranchFilter scope={branch} />
                        <button type="button" onClick={() => openCreateModal()} className={buttonClassName()}>
                            <Plus className="w-4 h-4" />
                            {t.purchaseReturns.newReturn}
                        </button>
                    </>
                )}
            />

            <CreatePurchaseReturnModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSuccess={refresh}
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
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                serverPagination={serverPagination}
            />

            <ConfirmDialog
                open={pendingDelete !== null}
                title={t.common.delete}
                prompt={t.purchaseReturns.deleteConfirm}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                loading={deleting}
                danger
                onConfirm={() => void confirmDelete()}
                onCancel={() => { if (!deleting) setPendingDelete(null); }}
            />
        </PageShell>
    );
}
