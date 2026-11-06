'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarX, CheckCircle2, Eye, FileSearch, Hourglass, Plus, ShoppingCart, Trash2, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, createdAtColumn, type ListFilter, type ListStat } from '@/components/data-table';
import { applyCreatedRangeQuery, applyDateRangeQuery, type CreatedRange } from '@/lib/created-range';
import { api, type PurchaseDocumentListFilterParams, type PurchaseQuotationListSummary } from '@/lib/api';
import { BranchFilter, ConfirmDialog, PageShell, StatusBadge, buttonClassName, type StatusBadgeTone } from '@/components/ui';
import { RowActions, RowActionButton } from '@/components/table';
import { useBranchForbiddenReset, useBranchScope } from '@/lib/branch-scope';
import { formatBDT, formatDate } from '@/lib/format';
import CreatePurchaseQuotationModal from './CreatePurchaseQuotationModal';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { useI18n, formatMessage } from '@/lib/i18n';
import type { NumberCondition } from '@/lib/number-condition';
import { toast } from '@/lib/toast';
import { useServerList } from '@/hooks/useServerList';
import { useListSummary } from '@/hooks/useListSummary';
import { supplierListFilter } from '../components/supplier-list-filter';

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

const RFQ_STATUSES = ['DRAFT', 'SENT', 'RECEIVED', 'ACCEPTED', 'REJECTED', 'CONVERTED', 'CANCELLED'] as const;
/** A quotation the validity date still matters for. */
const LIVE_STATUSES = new Set(['DRAFT', 'SENT', 'RECEIVED', 'ACCEPTED']);
/** Statuses the API refuses to convert from. */
const UNCONVERTIBLE = new Set(['CONVERTED', 'CANCELLED', 'REJECTED']);

const statusTones: Record<string, StatusBadgeTone> = {
    DRAFT: 'neutral',
    SENT: 'info',
    // A quote is back from the supplier and waits on a decision.
    RECEIVED: 'warning',
    ACCEPTED: 'success',
    REJECTED: 'danger',
    CONVERTED: 'success',
    CANCELLED: 'neutral',
};

const columnHelper = createColumnHelper<PurchaseQuotation>();

function startOfToday(): number {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export default function PurchaseQuotationsPage() {
    const { t, locale, fmt } = useI18n();
    const branch = useBranchScope();
    const router = useRouter();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<PurchaseQuotation | null>(null);
    const [pendingConvert, setPendingConvert] = useState<PurchaseQuotation | null>(null);
    const [busy, setBusy] = useState(false);

    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [validRange, setValidRange] = useState<CreatedRange | null>(null);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [statusExclude, setStatusExclude] = useState(false);
    const [supplierIds, setSupplierIds] = useState<string[]>([]);
    const [totalFilter, setTotalFilter] = useState<NumberCondition | null>(null);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    // The quotation's own date is how long the supplier holds the price.
    const filterParams = useMemo<PurchaseDocumentListFilterParams>(
        () => ({
            search: debouncedSearch || undefined,
            status: statusFilter.length ? statusFilter.join(',') : undefined,
            statusExclude,
            ...applyDateRangeQuery(validRange),
            ...applyCreatedRangeQuery(createdRange),
            storeId: branch.apiStoreId,
            supplierIds,
            total: totalFilter,
        }),
        [debouncedSearch, statusFilter, statusExclude, validRange, createdRange, branch.apiStoreId, supplierIds, totalFilter],
    );

    const { items: rfqs, loading, error: listError, serverPagination, reload } = useServerList<PurchaseQuotation>({
        tableId: 'purchase-quotations',
        initialSort: { id: 'created_at', desc: true },
        deps: [filterParams],
        enabled: branch.ready,
        fetch: (params) => api.getPurchaseQuotationsList({ ...params, ...filterParams }),
    });
    useBranchForbiddenReset(listError, branch, t.dashboardLayout.branchFilterForbidden);

    const { summary, loading: summaryLoading, reload: reloadSummary } = useListSummary<
        PurchaseDocumentListFilterParams,
        PurchaseQuotationListSummary
    >({ fetch: api.getPurchaseQuotationsListSummary, params: filterParams, enabled: branch.ready });

    const refresh = () => {
        void reload();
        reloadSummary();
    };

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        setBusy(true);
        try {
            await api.deletePurchaseQuotation(pendingDelete.id);
            setPendingDelete(null);
            refresh();
            toast.success(t.purchaseShared.lists.quotations.deleted);
        } catch (err: any) {
            toast.error(err?.message || t.purchaseQuotations.deleteFailed);
        } finally {
            setBusy(false);
        }
    };

    const confirmConvert = async () => {
        if (!pendingConvert) return;
        setBusy(true);
        try {
            const po = await api.convertPurchaseQuotation(pendingConvert.id);
            setPendingConvert(null);
            toast.success(formatMessage(t.purchaseQuotations.convertSuccess, { poNumber: po.po_number }));
            router.push(routes.purchases.orderDetail(po.id));
        } catch (err: any) {
            toast.error(err?.message || t.purchaseQuotations.convertFailed);
        } finally {
            setBusy(false);
        }
    };

    const columns: ColumnDef<PurchaseQuotation, any>[] = useMemo(() => {
        const today = startOfToday();
        return [
            columnHelper.accessor('rfq_number', {
                header: t.purchaseQuotations.columns.rfqNumber,
                cell: (info) => (
                    <Link
                        href={routes.purchases.quotationDetail(info.row.original.id)}
                        className="font-medium text-gray-900 hover:text-blue-600 hover:underline"
                    >
                        {info.getValue()}
                    </Link>
                ),
                size: 140,
            }),
            columnHelper.accessor('valid_until', {
                header: t.purchaseQuotations.columns.validUntil,
                enableColumnFilter: false,
                cell: (info) => {
                    const value = info.getValue();
                    if (!value) return <span className="text-gray-400">—</span>;
                    // A live quote past its date may no longer hold its price.
                    const expired = LIVE_STATUSES.has(info.row.original.status) && new Date(value).getTime() < today;
                    return (
                        <span className={expired ? 'font-medium text-amber-700' : undefined}>
                            {formatDate(value, locale)}
                        </span>
                    );
                },
                size: 130,
            }),
            createdAtColumn(columnHelper, { header: t.common.createdAt, locale, enableColumnFilter: false }),
            columnHelper.accessor((row) => row.supplier?.name ?? '', {
                id: 'supplier',
                header: t.purchaseQuotations.columns.supplier,
                cell: (info) => info.getValue() || <span className="text-gray-400">{t.purchaseShared.noSupplierShort}</span>,
                size: 180,
            }),
            columnHelper.accessor((row) => row.items?.length ?? 0, {
                id: 'items',
                header: t.purchaseQuotations.columns.items,
                enableSorting: false,
                cell: (info) => formatMessage(t.purchaseShared.itemsCount, { count: info.getValue() }),
                size: 90,
                meta: { align: 'end', hideOnMobile: true },
            }),
            columnHelper.accessor('total_amount', {
                header: t.purchaseQuotations.columns.total,
                cell: (info) => formatBDT(parseFloat(info.getValue()), { locale }),
                size: 120,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('status', {
                header: t.purchaseQuotations.columns.status,
                enableColumnFilter: false,
                cell: (info) => {
                    const status = info.getValue() as keyof typeof t.purchaseShared.status;
                    return (
                        <StatusBadge tone={statusTones[status] ?? 'neutral'}>
                            {t.purchaseShared.status[status] ?? status}
                        </StatusBadge>
                    );
                },
                size: 120,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.purchaseQuotations.columns.actions,
                cell: (info) => {
                    const rfq = info.row.original;
                    return (
                        <RowActions>
                            <RowActionButton
                                icon={<Eye />}
                                label={t.common.view}
                                href={routes.purchases.quotationDetail(rfq.id)}
                            />
                            {!UNCONVERTIBLE.has(rfq.status) && (
                                <RowActionButton
                                    icon={<ShoppingCart />}
                                    label={t.purchaseQuotations.convertToPo}
                                    intent="success"
                                    onClick={() => setPendingConvert(rfq)}
                                />
                            )}
                            <RowActionButton
                                icon={<Trash2 />}
                                label={t.common.delete}
                                intent="danger"
                                onClick={() => setPendingDelete(rfq)}
                            />
                        </RowActions>
                    );
                },
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 130,
            }),
        ];
    }, [t, locale]);

    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'validUntil',
                type: 'date-range',
                label: t.purchaseQuotations.columns.validUntil,
                value: validRange,
                onChange: setValidRange,
                operators: true,
            },
            {
                id: 'status',
                type: 'multi-select',
                label: t.purchaseQuotations.columns.status,
                value: statusFilter,
                onChange: setStatusFilter,
                exclude: { value: statusExclude, onChange: setStatusExclude },
                options: RFQ_STATUSES.map((value) => ({ value, label: t.purchaseShared.status[value] ?? value })),
            },
            supplierListFilter({
                label: t.purchaseQuotations.columns.supplier,
                noSupplierLabel: t.purchaseShared.noSupplierShort,
                value: supplierIds,
                onChange: setSupplierIds,
            }),
            {
                id: 'total',
                type: 'number',
                label: t.purchaseQuotations.columns.total,
                value: totalFilter,
                onChange: setTotalFilter,
                money: true,
            },
            { id: 'created', type: 'date-range', value: createdRange, onChange: setCreatedRange, operators: true, more: true },
        ],
        [t, validRange, statusFilter, statusExclude, supplierIds, totalFilter, createdRange],
    );

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const copy = t.purchaseShared.lists.quotations.stats;
        const dash = '—';
        const count = (value: number | undefined) => (value === undefined ? dash : value.toLocaleString(locale));
        const items: ListStat[] = [
            { id: 'count', icon: <FileSearch aria-hidden />, label: copy.rfqs, value: count(summary?.count) },
            { id: 'value', icon: <Wallet aria-hidden />, label: copy.value, value: summary ? money(summary.value) : dash },
            { id: 'pending', icon: <Hourglass aria-hidden />, label: copy.pending, value: count(summary?.pending) },
            {
                id: 'accepted',
                icon: <CheckCircle2 aria-hidden />,
                label: copy.accepted,
                value: summary ? money(summary.accepted.amount) : dash,
                hint: summary?.accepted.count ? fmt(copy.acceptedCount, { count: summary.accepted.count }) : undefined,
            },
            { id: 'converted', icon: <ShoppingCart aria-hidden />, label: copy.converted, value: count(summary?.converted) },
            {
                id: 'expired',
                icon: <CalendarX aria-hidden />,
                label: copy.expired,
                value: count(summary?.expired),
                tone: summary && summary.expired > 0 ? 'warning' : 'default',
            },
        ];
        return { items, loading: summaryLoading && !summary, label: t.purchaseShared.lists.quotations.statsLabel };
    }, [summary, summaryLoading, locale, t, fmt]);

    return (
        <PageShell>
            <PageHeader
                title={t.purchaseQuotations.title}
                subtitle={t.purchaseQuotations.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.purchase,
                    t.purchaseQuotations.title,
                    'purchases',
                )}
                actions={(
                    <>
                        <BranchFilter scope={branch} />
                        <button type="button" onClick={() => setIsModalOpen(true)} className={buttonClassName()}>
                            <Plus className="w-4 h-4" />
                            {t.purchaseQuotations.newRfq}
                        </button>
                    </>
                )}
            />

            <CreatePurchaseQuotationModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSuccess={refresh}
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
                prompt={t.purchaseQuotations.deleteConfirm}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                loading={busy}
                danger
                onConfirm={() => void confirmDelete()}
                onCancel={() => { if (!busy) setPendingDelete(null); }}
            />

            <ConfirmDialog
                open={pendingConvert !== null}
                title={t.purchaseQuotations.convertToPo}
                prompt={pendingConvert
                    ? formatMessage(t.purchaseQuotations.convertConfirm, { rfqNumber: pendingConvert.rfq_number })
                    : ''}
                confirmLabel={t.purchaseQuotations.convertToPo}
                cancelLabel={t.common.cancel}
                loading={busy}
                onConfirm={() => void confirmConvert()}
                onCancel={() => { if (!busy) setPendingConvert(null); }}
            />
        </PageShell>
    );
}
