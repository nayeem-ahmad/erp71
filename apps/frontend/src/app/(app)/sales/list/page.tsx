'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Receipt, Eye, Edit2, FileText, Printer, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT, formatDate, formatDateTime } from '@/lib/format';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, createdAtColumn, type ListFilter } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import { applyCreatedRangeQuery, applyDateRangeQuery, type CreatedRange } from '@/lib/created-range';
import { PostingBadge } from '@/components/PostingBadge';
import { useI18n, formatMessage } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { BranchFilter, ConfirmDialog, PageShell, StatusBadge, buttonClassName, type StatusBadgeTone } from '@/components/ui';
import { useBranchForbiddenReset, useBranchScope } from '@/lib/branch-scope';
import { useServerList } from '@/hooks/useServerList';
import { toast } from '@/lib/toast';
import { CancelEntryModal } from '@/components/CancelEntryModal';
import { useTenantPlanFeatures } from '@/lib/use-tenant-plan-features';
import { hasPermission, isOwner } from '@/lib/permissions';
import SaleRowPrintButtons from '../components/SaleRowPrintButtons';
import SaleRowOverflowMenu from '../components/SaleRowOverflowMenu';
import PrintSettingsModal from '../components/PrintSettingsModal';
import { useSalePrinting, fetchPrintableSale } from '@/lib/hooks/useSalePrinting';
import { useInvoicePrintPrefs } from '@/lib/hooks/useInvoicePrintPrefs';

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

const SALE_STATUSES = ['DRAFT', 'COMPLETED', 'REFUNDED', 'PARTIAL_REFUND', 'CANCELLED'] as const;

const statusTones: Record<string, StatusBadgeTone> = {
    DRAFT: 'neutral',
    COMPLETED: 'success',
    REFUNDED: 'danger',
    PARTIAL_REFUND: 'warning',
    // Neutral rather than red: a cancelled entry is void, not an error, and the
    // red tone is already carrying "refunded" on this table.
    CANCELLED: 'neutral',
};

const columnHelper = createColumnHelper<Sale>();

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A sale's date with the minute it was rung up. A sale synced from Dizi or
 * Express arrives with a date only, stored at UTC midnight; printing that
 * midnight in the shop's zone would invent a time (06:00 in Dhaka), so those
 * show the day alone.
 */
function formatSaleDate(value: string | null | undefined, locale: string): string {
    if (!value) return formatDate(value, locale);
    const instant = new Date(value).getTime();
    return instant % DAY_MS === 0 ? formatDate(value, locale) : formatDateTime(value, locale);
}

export default function SalesPage() {
    const { t, locale } = useI18n();
    const branch = useBranchScope();
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [cancelTarget, setCancelTarget] = useState<Sale | null>(null);

    // Cancelling reverses stock, balances and the ledger, so the action is
    // hidden without CANCEL_ENTRY rather than shown and left to 403. OWNER
    // bypasses the guard server-side and may hold no grant rows at all.
    const { permissions, role } = useTenantPlanFeatures();
    const canCancel = isOwner(role) || hasPermission(permissions, 'CANCEL_ENTRY');
    // Return and exchange share the grant, as on the sale's own page.
    const canCreateReturn = isOwner(role) || hasPermission(permissions, 'CREATE_RETURN');

    // A list row carries no line items, so each document is printed from a
    // freshly fetched sale rather than from the row — an invoice built off the
    // row alone would come out with no goods on it.
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
        batchBusy,
        printInvoice,
        printChallan,
        printReceipt,
        printInvoices,
    } = useSalePrinting({ resolve: fetchPrintableSale });
    // The member's own invoice layout — edited in the same Print settings.
    const invoiceLayout = useInvoicePrintPrefs();

    // Paper size and the preview opt-out are settings, not per-row choices, so
    // they are set once from the header rather than re-picked on every print.
    const [printSettingsOpen, setPrintSettingsOpen] = useState(false);

    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string | null>(null);
    const [dateRange, setDateRange] = useState<CreatedRange | null>(null);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [selectedSales, setSelectedSales] = useState<Sale[]>([]);
    const [pendingDelete, setPendingDelete] = useState<Sale | null>(null);

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
        error: listError,
        serverPagination,
        reload,
        setItems: setSales,
    } = useServerList<Sale>({
        tableId: 'sales',
        initialSort: { id: 'created_at', desc: true },
        // The branch filter is a filter like the rest: a change is page 1 of a
        // fresh query, and the export walks the same filtered query.
        deps: [debouncedSearch, statusFilter, dateRange, createdRange, branch.apiStoreId],
        enabled: branch.ready,
        columnFilters: true,
        fetch: (params) =>
            api.getSalesList({
                ...params,
                search: debouncedSearch || undefined,
                status: statusFilter || undefined,
                ...applyDateRangeQuery(dateRange),
                ...applyCreatedRangeQuery(createdRange),
                storeId: branch.apiStoreId,
            }),
    });
    useBranchForbiddenReset(listError, branch, t.dashboardLayout.branchFilterForbidden);

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        setDeletingId(pendingDelete.id);
        try {
            await api.deleteSale(pendingDelete.id);
            setSales((prev) => prev.filter((s) => s.id !== pendingDelete.id));
            setPendingDelete(null);
            void reload();
            toast.success(t.sales.detail.deleted);
        } catch (error: any) {
            console.error('Failed to delete sale', error);
            toast.error(error?.message || t.shared.errors.deleteSale);
        } finally {
            setDeletingId(null);
        }
    };

    const handleCancel = useCallback(async (sale: Sale, note: string) => {
        const updated = await api.cancelSale(sale.id, note);
        setSales((prev) =>
            prev.map((row) => (row.id === sale.id ? { ...row, status: updated?.status ?? 'CANCELLED' } : row)),
        );
        setCancelTarget(null);
        void reload();
        toast.success(t.entryCancellation.saleCancelled);
    }, [reload, setSales, t]);

    const columns: ColumnDef<Sale, any>[] = useMemo(
        () => [
            columnHelper.accessor('serial_number', {
                header: t.sales.columns.serialNumber,
                size: 140,
            }),
            columnHelper.accessor((row) => row.sale_date ?? row.created_at, {
                id: 'sale_date',
                header: t.sales.columns.saleDate,
                // The toolbar date chip filters this on the server.
                enableColumnFilter: false,
                cell: (info) => formatSaleDate(info.getValue(), locale),
                size: 150,
            }),
            createdAtColumn(columnHelper, { header: t.common.createdAt, locale, enableColumnFilter: false }),
            columnHelper.accessor((row) => row.customer?.name ?? '', {
                id: 'customer',
                header: t.sales.columns.customer,
                cell: (info) => info.getValue() || <span className="text-gray-400">{t.shared.walkIn}</span>,
                size: 150,
            }),
            columnHelper.accessor((row) => row.items?.length ?? 0, {
                id: 'item_count',
                header: t.sales.columns.items,
                // A count of the lines, not a stored value the query could match.
                enableColumnFilter: false,
                cell: (info) => formatMessage(t.shared.itemsCount, { count: info.getValue() }),
                size: 90,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('total_amount', {
                header: t.sales.columns.total,
                cell: (info) => formatBDT(parseFloat(info.getValue()), { locale }),
                sortingFn: (a, b) =>
                    parseFloat(a.getValue('total_amount')) - parseFloat(b.getValue('total_amount')),
                size: 120,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('amount_paid', {
                header: t.sales.columns.paid,
                cell: (info) => formatBDT(parseFloat(info.getValue()), { locale }),
                sortingFn: (a, b) =>
                    parseFloat(a.getValue('amount_paid')) - parseFloat(b.getValue('amount_paid')),
                size: 120,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('status', {
                header: t.sales.columns.status,
                // The toolbar select sends an exact status. A second contains-filter here would only confuse it.
                enableColumnFilter: false,
                cell: (info) => {
                    const status = info.getValue();
                    return (
                        <StatusBadge tone={statusTones[status] ?? 'neutral'}>
                            {t.shared.statuses.sale[status as keyof typeof t.shared.statuses.sale] ?? status}
                        </StatusBadge>
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
                                    <span key={i} className="rounded bg-gray-100 px-1.5 text-gray-600">
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
                cell: (info) => {
                    const sale = info.row.original;
                    // A cancelled entry has had every impact reversed, so the
                    // API refuses to edit or re-cancel it — don't offer the door.
                    const isCancelled = sale.status === 'CANCELLED';
                    return (
                        <RowActions>
                            <RowActionButton icon={<Eye />} label={t.common.view} href={`/sales/${sale.id}`} />
                            {/* One click each, straight from the row. Both used
                                to sit behind a split button with the paper
                                sizes and the rarer documents, which made the
                                chalan — printed on every delivery — a menu
                                scan. Cancelled sales keep both icons: the
                                column width stays put, and a void sale's
                                paperwork is still sometimes reprinted for
                                the file. */}
                            <SaleRowPrintButtons
                                paperSize={paperSize}
                                onPrintInvoice={(size) => void printInvoice(sale.id, size)}
                                onPrintChallan={(size) => void printChallan(sale.id, size)}
                                busy={busyId === sale.id}
                            />
                            {!isCancelled && (
                                <RowActionButton icon={<Edit2 />} label={t.common.edit} href={`/sales/${sale.id}?edit=true`} />
                            )}
                            {/* Deleting reverses a posted sale, so it needs the same
                                permission as cancelling one — `DELETE /sales/:id` answers
                                403 without it, and a button that can only fail is noise. */}
                            {canCancel && (
                                <RowActionButton
                                    icon={<Trash2 />}
                                    label={t.common.delete}
                                    intent="danger"
                                    disabled={deletingId === sale.id}
                                    onClick={() => setPendingDelete(sale)}
                                />
                            )}
                            <SaleRowOverflowMenu
                                saleId={sale.id}
                                label={t.sales.printMenu.moreActions}
                                paperSize={paperSize}
                                onPrintReceipt={(size) => void printReceipt(sale.id, size)}
                                // A row carries no return history, so a fully
                                // returned sale still shows these; the entry
                                // screen says nothing is left to return.
                                canReturn={canCreateReturn && !isCancelled && sale.status !== 'DRAFT'}
                                onCancel={
                                    canCancel && !isCancelled
                                        ? () => setCancelTarget(sale)
                                        : undefined
                                }
                            />
                        </RowActions>
                    );
                },
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 220,
            }),
        ],
        [t, locale, deletingId, canCancel, canCreateReturn, paperSize, busyId, printInvoice, printChallan, printReceipt],
    );

    // Tick the rows, print them as one job — the day's invoices for the file,
    // or a delivery run's, without a popup per sale. A selection can span
    // branches: each invoice keeps its own letterhead. Selection covers the
    // page on screen, which the server caps at the 100 the endpoint accepts.
    const bulkActions = useMemo(
        () =>
            selectedSales.length === 0
                ? []
                : [
                    {
                        label: formatMessage(t.sales.printMenu.printSelected, { count: selectedSales.length }),
                        icon: <Printer className="w-4 h-4" />,
                        onClick: (rows: Sale[]) => void printInvoices(rows.map((row) => row.id)),
                    },
                ],
        [t, printInvoices, selectedSales],
    );

    // Page-owned, not bound to a column: these go to the server with the page
    // query. A column filter would only narrow the rows already on screen.
    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'status',
                type: 'select',
                label: t.sales.columns.status,
                value: statusFilter,
                onChange: setStatusFilter,
                options: SALE_STATUSES.map((value) => ({
                    value,
                    label: t.shared.statuses.sale[value] ?? value,
                })),
            },
            {
                id: 'saleDate',
                type: 'date-range',
                label: t.common.date,
                value: dateRange,
                onChange: setDateRange,
                withTime: true,
            },
            { id: 'created', type: 'date-range', value: createdRange, onChange: setCreatedRange },
        ],
        [t, statusFilter, dateRange, createdRange],
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
                            <Link href={routes.sales.new} className={buttonClassName()}>
                                <FileText className="w-4 h-4" />
                                {t.sidebar.items.newSalesEntry}
                            </Link>
                        </>
                    }
                />

                <DataTable<Sale>
                    tableId="sales"
                    columns={columns}
                    data={sales}
                    title={t.sales.dataTable.title}
                    isLoading={loading}
                    emptyMessage={t.sales.dataTable.emptyMessage}
                    emptyIcon={<Receipt className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.sales.dataTable.searchPlaceholder}
                    onSearchChange={setSearch}
                    filters={filters}
                    viewOptions
                    serverPagination={serverPagination}
                    enableRowSelection
                    getRowId={(sale) => sale.id}
                    onRowSelectionChange={setSelectedSales}
                    bulkActions={bulkActions}
                    bulkActionsDisabled={batchBusy}
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
                        invoiceLayout={invoiceLayout}
                    />
                )}

                <ConfirmDialog
                    open={pendingDelete !== null}
                    title={t.common.delete}
                    prompt={t.shared.confirm.deleteSale}
                    confirmLabel={t.common.delete}
                    cancelLabel={t.common.cancel}
                    loading={deletingId !== null}
                    danger
                    onConfirm={() => void confirmDelete()}
                    onCancel={() => { if (deletingId === null) setPendingDelete(null); }}
                />

                {cancelTarget && (
                    <CancelEntryModal
                        entryLabel={cancelTarget.serial_number}
                        entryAmount={formatBDT(parseFloat(cancelTarget.total_amount), { locale })}
                        onConfirm={(note) => handleCancel(cancelTarget, note)}
                        onClose={() => setCancelTarget(null)}
                    />
                )}

        </PageShell>
    );
}