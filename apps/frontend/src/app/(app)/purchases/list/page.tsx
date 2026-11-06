'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
    Ban, Calculator, ClipboardList, Clock, Copy, Eye, Pencil, Plus, Printer, RotateCcw, ShoppingBag, Undo2, Wallet,
} from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { DataTable, createdAtColumn, type ListFilter, type ListStat } from '@/components/data-table';
import {
    api,
    type PurchaseListFilterParams,
    type PurchaseListSummary,
    type PurchasePaymentStatus,
} from '@/lib/api';
import { BranchFilter, PageShell, StatusBadge, buttonClassName, type StatusBadgeTone } from '@/components/ui';
import { RowActions, RowActionButton } from '@/components/table';
import { useBranchForbiddenReset, useBranchScope } from '@/lib/branch-scope';
import { formatBDT, formatDateTime } from '@/lib/format';
import { PostingBadge } from '@/components/PostingBadge';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { useI18n, formatMessage } from '@/lib/i18n';
import { applyCreatedRangeQuery, applyDateRangeQuery, type CreatedRange } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';
import { toast } from '@/lib/toast';
import { CancelEntryModal } from '@/components/CancelEntryModal';
import { useTenantPlanFeatures } from '@/lib/use-tenant-plan-features';
import { hasPermission, isOwner } from '@/lib/permissions';
import { useServerList } from '@/hooks/useServerList';
import { useListSummary } from '@/hooks/useListSummary';
import PrintSettingsModal from '../../sales/components/PrintSettingsModal';
import PurchaseReturnsModal, { type PurchaseReturnSummary } from '../components/PurchaseReturnsModal';
import { supplierListFilter } from '../components/supplier-list-filter';
import { usePurchasePrinting } from '@/lib/hooks/usePurchasePrinting';

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
    paid_amount?: string | number;
    subtotal_amount: string | number;
    created_at: string;
    purchase_date?: string | null;
    status?: string;
    cancellation_note?: string | null;
    supplier?: {
        name: string;
    } | null;
    items: PurchaseItem[];
    posting_status?: string | null;
    voucher_number?: string | null;
    /** Purchase returns raised against this bill — present on the list payload. */
    returns?: PurchaseReturnSummary[];
}

const PURCHASE_STATUSES = ['RECORDED', 'CANCELLED'] as const;
const PAYMENT_STATUSES: readonly PurchasePaymentStatus[] = ['PAID', 'PARTIAL', 'UNPAID'];

const statusTones: Record<string, StatusBadgeTone> = {
    RECORDED: 'success',
    // Neutral rather than red: a cancelled entry is void, not an error.
    CANCELLED: 'neutral',
};

const columnHelper = createColumnHelper<Purchase>();

export default function PurchasesPage() {
    const { t, locale, fmt } = useI18n();
    const branch = useBranchScope();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [cancelTarget, setCancelTarget] = useState<Purchase | null>(null);
    const [returnsTarget, setReturnsTarget] = useState<Purchase | null>(null);
    const [printSettingsOpen, setPrintSettingsOpen] = useState(false);

    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [dateRange, setDateRange] = useState<CreatedRange | null>(null);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [statusExclude, setStatusExclude] = useState(false);
    const [supplierIds, setSupplierIds] = useState<string[]>([]);
    const [totalFilter, setTotalFilter] = useState<NumberCondition | null>(null);
    const [paidFilter, setPaidFilter] = useState<NumberCondition | null>(null);
    const [paymentStatus, setPaymentStatus] = useState<string[]>([]);

    // Paper size and the preview opt-out are settings, not per-row choices, so
    // they are set once from the header rather than re-picked on every print.
    // Shared with sales: the printer next to this browser is one printer.
    const {
        paperSize,
        setPaperSize,
        skipPreview,
        setSkipPreview,
        density,
        setDensity,
        typeScale,
        setTypeScale,
        busyId,
        printInvoice,
    } = usePurchasePrinting();

    // Cancelling reverses stock, the payable and the ledger, so the action is
    // hidden without CANCEL_ENTRY rather than shown and left to 403. OWNER
    // bypasses the guard server-side and may hold no grant rows at all.
    const { permissions, role } = useTenantPlanFeatures();
    const canCancel = isOwner(role) || hasPermission(permissions, 'CANCEL_ENTRY');

    // Recording a purchase is its own screen now; keep the old ?new=1 deep
    // link (bookmarks, voice navigation) working by forwarding it there.
    useEffect(() => {
        if (searchParams.get('new') === '1') {
            router.replace(routes.purchases.newPurchase);
        }
    }, [router, searchParams]);

    // Typing must not fire a request per keystroke.
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    // One set of filters for the rows and the stats strip above them, so the
    // two always describe the same bills.
    const filterParams = useMemo<PurchaseListFilterParams>(
        () => ({
            search: debouncedSearch || undefined,
            status: statusFilter.length ? statusFilter.join(',') : undefined,
            statusExclude,
            ...applyDateRangeQuery(dateRange),
            ...applyCreatedRangeQuery(createdRange),
            storeId: branch.apiStoreId,
            supplierIds,
            total: totalFilter,
            paid: paidFilter,
            paymentStatus: paymentStatus as PurchasePaymentStatus[],
        }),
        [
            debouncedSearch, statusFilter, statusExclude, dateRange, createdRange, branch.apiStoreId,
            supplierIds, totalFilter, paidFilter, paymentStatus,
        ],
    );

    // Pages against the server: a migrated tenant can have thousands of bills.
    const { items: purchases, loading, error: listError, serverPagination, reload } = useServerList<Purchase>({
        tableId: 'purchases',
        initialSort: { id: 'created_at', desc: true },
        deps: [filterParams],
        enabled: branch.ready,
        fetch: (params) => api.getPurchasesList({ ...params, ...filterParams }),
    });
    useBranchForbiddenReset(listError, branch, t.dashboardLayout.branchFilterForbidden);

    const { summary, loading: summaryLoading, reload: reloadSummary } = useListSummary<
        PurchaseListFilterParams,
        PurchaseListSummary
    >({ fetch: api.getPurchasesListSummary, params: filterParams, enabled: branch.ready });

    const handleCancel = async (purchase: Purchase, note: string) => {
        await api.cancelPurchase(purchase.id, note);
        setCancelTarget(null);
        void reload();
        reloadSummary();
        toast.success(t.entryCancellation.purchaseCancelled);
    };

    const columns: ColumnDef<Purchase, any>[] = useMemo(
        () => [
            columnHelper.accessor('purchase_number', {
                header: t.purchases.columns.purchaseNumber,
                cell: (info) => {
                    const purchase = info.row.original;
                    const returns = purchase.returns ?? [];
                    return (
                        <span className="inline-flex items-center gap-1.5">
                            <Link
                                href={routes.purchases.purchaseDetail(purchase.id)}
                                className="font-medium text-gray-900 hover:text-blue-600 hover:underline"
                            >
                                {info.getValue()}
                            </Link>
                            {returns.length > 0 ? (
                                <button
                                    type="button"
                                    onClick={() => setReturnsTarget(purchase)}
                                    aria-label={formatMessage(t.purchases.returnsModal.viewReturns, {
                                        count: returns.length,
                                    })}
                                    title={formatMessage(t.purchases.returnsModal.viewReturns, {
                                        count: returns.length,
                                    })}
                                    className={
                                        'inline-flex h-7 min-w-7 items-center justify-center gap-0.5 rounded-md '
                                        + 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 '
                                        + 'hover:bg-amber-100 focus-visible:outline-none '
                                        + 'focus-visible:ring-2 focus-visible:ring-blue-600/30 '
                                        + 'max-md:min-h-touch max-md:min-w-touch'
                                    }
                                >
                                    <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                                    {returns.length > 1 ? (
                                        <span className="pe-1 text-[10px] font-semibold leading-none">
                                            {returns.length}
                                        </span>
                                    ) : null}
                                </button>
                            ) : null}
                        </span>
                    );
                },
                size: 170,
            }),
            columnHelper.accessor((row) => row.purchase_date ?? row.created_at, {
                id: 'purchase_date',
                header: t.purchases.columns.transactionDate,
                // The toolbar date chip filters this on the server.
                enableColumnFilter: false,
                cell: (info) => formatDateTime(info.getValue(), locale),
                size: 160,
            }),
            createdAtColumn(columnHelper, { header: t.common.createdAt, locale, enableColumnFilter: false }),
            columnHelper.accessor((row) => row.supplier?.name ?? '', {
                id: 'supplier',
                header: t.purchases.columns.supplier,
                cell: (info) => info.getValue() || <span className="text-gray-400">{t.purchaseShared.unlinked}</span>,
                size: 180,
            }),
            columnHelper.accessor((row) => row.items?.length ?? 0, {
                id: 'item_count',
                header: t.purchases.columns.items,
                // A count of the lines, not a stored value the server can sort.
                enableSorting: false,
                enableColumnFilter: false,
                cell: (info) => formatMessage(t.purchaseShared.itemsCount, { count: info.getValue() }),
                size: 90,
                meta: { align: 'end', hideOnMobile: true },
            }),
            columnHelper.accessor((row) => row.items.map((item) => item.product?.name).filter(Boolean).join(', '), {
                id: 'products',
                header: t.purchases.columns.products,
                enableSorting: false,
                cell: (info) => <span className="line-clamp-2 text-gray-500">{info.getValue() || '—'}</span>,
                size: 280,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('total_amount', {
                header: t.purchases.columns.total,
                cell: (info) => formatBDT(Number(info.getValue() || 0), { locale }),
                size: 120,
                meta: { align: 'end' },
            }),
            columnHelper.accessor((row) => row.paid_amount ?? 0, {
                id: 'paid_amount',
                header: t.purchaseShared.lists.purchases.filters.paid,
                cell: (info) => formatBDT(Number(info.getValue() || 0), { locale }),
                size: 120,
                meta: { align: 'end', hideOnMobile: true },
            }),
            columnHelper.accessor((row) => row.status ?? 'RECORDED', {
                id: 'status',
                header: t.purchases.columns.status,
                // The toolbar chip filters the status on the server.
                enableColumnFilter: false,
                cell: (info) => {
                    const status = info.getValue() as string;
                    return (
                        <span title={info.row.original.cancellation_note ?? undefined}>
                            <StatusBadge tone={statusTones[status] ?? 'neutral'}>
                                {t.purchases.statuses[status as keyof typeof t.purchases.statuses] ?? status}
                            </StatusBadge>
                        </span>
                    );
                },
                size: 120,
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
                header: t.purchaseQuotations.columns.actions,
                cell: ({ row }) => {
                    const purchase = row.original;
                    // A cancelled purchase has had every impact reversed and
                    // the API refuses to edit or re-cancel it.
                    const isCancelled = (purchase.status ?? 'RECORDED') === 'CANCELLED';
                    return (
                        <RowActions>
                            <RowActionButton
                                icon={<Eye />}
                                label={t.purchases.detail.view}
                                href={routes.purchases.purchaseDetail(purchase.id)}
                            />
                            <RowActionButton
                                icon={<Printer className={busyId === purchase.id ? 'animate-pulse' : undefined} />}
                                label={t.purchases.printInvoice}
                                disabled={busyId === purchase.id}
                                onClick={() => void printInvoice(purchase.id, paperSize)}
                            />
                            {!isCancelled && (
                                <RowActionButton
                                    icon={<Pencil />}
                                    label={t.purchases.detail.edit}
                                    href={`${routes.purchases.purchaseDetail(purchase.id)}?edit=true`}
                                />
                            )}
                            <RowActionButton
                                icon={<Copy />}
                                label={t.purchases.duplicate}
                                href={`/purchases/new?duplicate=${purchase.id}`}
                            />
                            {canCancel && !isCancelled && (
                                <RowActionButton
                                    icon={<Ban />}
                                    label={t.entryCancellation.action}
                                    intent="danger"
                                    onClick={() => setCancelTarget(purchase)}
                                />
                            )}
                        </RowActions>
                    );
                },
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 190,
            }),
        ],
        [t, locale, canCancel, paperSize, busyId, printInvoice],
    );

    // Page-owned, not bound to a column: these go to the server with the page
    // query. The row holds the five people reach for; the rest wait behind More.
    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'purchaseDate',
                type: 'date-range',
                label: t.common.date,
                value: dateRange,
                onChange: setDateRange,
                withTime: true,
                operators: true,
            },
            {
                id: 'status',
                type: 'multi-select',
                label: t.purchases.columns.status,
                value: statusFilter,
                onChange: setStatusFilter,
                exclude: { value: statusExclude, onChange: setStatusExclude },
                options: PURCHASE_STATUSES.map((value) => ({ value, label: t.purchases.statuses[value] ?? value })),
            },
            supplierListFilter({
                label: t.purchases.columns.supplier,
                noSupplierLabel: t.purchaseShared.noSupplierShort,
                value: supplierIds,
                onChange: setSupplierIds,
            }),
            {
                id: 'paymentStatus',
                type: 'multi-select',
                label: t.purchaseShared.lists.purchases.filters.paymentStatus,
                value: paymentStatus,
                onChange: setPaymentStatus,
                options: PAYMENT_STATUSES.map((value) => ({
                    value,
                    label: t.purchaseShared.lists.purchases.filters.paymentStatuses[value],
                })),
            },
            {
                id: 'total',
                type: 'number',
                label: t.purchases.columns.total,
                value: totalFilter,
                onChange: setTotalFilter,
                money: true,
            },
            {
                id: 'paid',
                type: 'number',
                label: t.purchaseShared.lists.purchases.filters.paid,
                value: paidFilter,
                onChange: setPaidFilter,
                money: true,
                more: true,
            },
            { id: 'created', type: 'date-range', value: createdRange, onChange: setCreatedRange, operators: true, more: true },
        ],
        [t, dateRange, statusFilter, statusExclude, supplierIds, paymentStatus, totalFilter, paidFilter, createdRange],
    );

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const copy = t.purchaseShared.lists.purchases.stats;
        const dash = '—';
        const items: ListStat[] = [
            {
                id: 'count',
                icon: <ClipboardList aria-hidden />,
                label: copy.bills,
                value: summary ? summary.count.toLocaleString(locale) : dash,
                hint: summary?.cancelledCount ? fmt(copy.cancelled, { count: summary.cancelledCount }) : undefined,
            },
            { id: 'total', icon: <ShoppingBag aria-hidden />, label: copy.total, value: summary ? money(summary.total) : dash },
            {
                id: 'paid',
                icon: <Wallet aria-hidden />,
                label: copy.paid,
                value: summary ? money(summary.paid) : dash,
                hint: summary && summary.total > 0
                    ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(summary.paid / summary.total)
                    : undefined,
            },
            {
                id: 'due',
                icon: <Clock aria-hidden />,
                label: copy.due,
                value: summary ? money(summary.due) : dash,
                tone: summary && summary.due > 0 ? 'warning' : 'default',
            },
            { id: 'average', icon: <Calculator aria-hidden />, label: copy.average, value: summary ? money(summary.average) : dash },
            {
                id: 'returns',
                icon: <Undo2 aria-hidden />,
                label: copy.returns,
                value: summary ? money(summary.returns.amount) : dash,
                hint: summary?.returns.count ? fmt(copy.returnsCount, { count: summary.returns.count }) : undefined,
                tone: summary && summary.returns.amount > 0 ? 'danger' : 'default',
            },
        ];
        return { items, loading: summaryLoading && !summary, label: t.purchaseShared.lists.purchases.statsLabel };
    }, [summary, summaryLoading, locale, t, fmt]);

    return (
        <PageShell>
            <PageHeader
                title={t.purchases.title}
                subtitle={t.purchases.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.purchase,
                    t.purchases.title,
                    'purchases',
                )}
                actions={(
                    <>
                        <BranchFilter scope={branch} />
                        <button
                            type="button"
                            onClick={() => setPrintSettingsOpen(true)}
                            className={buttonClassName({ variant: 'secondary' })}
                        >
                            <Printer className="w-4 h-4" />
                            {t.sales.printSettings.action}
                        </button>
                        <Link href={routes.purchases.newPurchase} className={buttonClassName()}>
                            <Plus className="w-4 h-4" />
                            {t.purchases.recordPurchase}
                        </Link>
                    </>
                )}
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
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                // The filter row covers what the per-column boxes did, and sends it to the server.
                enableColumnFilters={false}
                viewOptions
                serverPagination={serverPagination}
            />

            {printSettingsOpen && (
                <PrintSettingsModal
                    paperSize={paperSize}
                    skipPreview={skipPreview}
                    density={density}
                    typeScale={typeScale}
                    onSave={(next) => {
                        setPaperSize(next.paperSize);
                        setSkipPreview(next.skipPreview);
                        setDensity(next.density);
                        setTypeScale(next.typeScale);
                        toast.success(t.sales.printSettings.saved);
                    }}
                    onClose={() => setPrintSettingsOpen(false)}
                />
            )}

            {cancelTarget && (
                <CancelEntryModal
                    entryLabel={cancelTarget.purchase_number}
                    entryAmount={formatBDT(Number(cancelTarget.total_amount || 0), { locale })}
                    onConfirm={(note) => handleCancel(cancelTarget, note)}
                    onClose={() => setCancelTarget(null)}
                />
            )}

            {returnsTarget && (
                <PurchaseReturnsModal
                    purchaseNumber={returnsTarget.purchase_number}
                    returns={returnsTarget.returns ?? []}
                    onClose={() => setReturnsTarget(null)}
                />
            )}
        </PageShell>
    );
}
