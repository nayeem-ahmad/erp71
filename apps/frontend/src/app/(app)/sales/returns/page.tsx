'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDownToLine, Calculator, Eye, Pencil, Plus, Printer, RotateCcw, Scale, Trash2, Undo2 } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, createdAtColumn, type ListFilter, type ListStat } from '@/components/data-table';
import { api, type SalesDocumentListFilterParams, type SalesReturnListSummary } from '@/lib/api';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import { routes } from '@/lib/routes';
import { PostingBadge } from '@/components/PostingBadge';
import { formatBDT, formatDate, formatDateTime } from '@/lib/format';
import { SIMPLE_DOC_STYLES, openPrintWindow, renderHeaderHtml, sheetPaper } from '@/lib/print';
import type { HeaderContext } from '@/lib/print';
import { usePrintHeader } from '@/lib/print/use-print-header';
import { useSalePrintPrefs } from '@/lib/hooks/useSalePrintPrefs';
import { useI18n, formatMessage } from '@/lib/i18n';
import type { NumberCondition } from '@/lib/number-condition';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { BranchFilter, ConfirmDialog, PageShell, StatusBadge, buttonClassName, type StatusBadgeTone } from '@/components/ui';
import { RowActions, RowActionButton } from '@/components/table';
import { useBranchForbiddenReset, useBranchScope } from '@/lib/branch-scope';
import { toast } from '@/lib/toast';
import { useServerList } from '@/hooks/useServerList';
import { useListSummary } from '@/hooks/useListSummary';
import { customerListFilter } from '../components/customer-list-filter';

interface SalesReturn {
    id: string;
    return_number: string;
    created_at: string;
    total_refund: string;
    reason?: string;
    status?: string;
    items: any[];
    sale?: { serial_number: string; customer?: { id: string; name: string } | null } | null;
    posting_status?: string | null;
    voucher_number?: string | null;
    store_id?: string;
}

const statusTones: Record<string, StatusBadgeTone> = {
    COMPLETED: 'success',
    PENDING: 'warning',
    CANCELLED: 'neutral',
};

const columnHelper = createColumnHelper<SalesReturn>();

export default function ReturnsPage() {
    const { t, locale } = useI18n();
    const branch = useBranchScope();
    const printHeader = usePrintHeader('SALES_RETURN');
    // This browser's paper, as invoices print on; A4 for a till roll.
    const paper = sheetPaper(useSalePrintPrefs().paperSize);
    const copy = t.returns.list;
    const [pendingDelete, setPendingDelete] = useState<SalesReturn | null>(null);
    const [deleting, setDeleting] = useState(false);

    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [customerIds, setCustomerIds] = useState<string[]>([]);
    const [totalFilter, setTotalFilter] = useState<NumberCondition | null>(null);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    // A return is dated when it is recorded, so its one date is `created_at`.
    const filterParams = useMemo<SalesDocumentListFilterParams>(
        () => ({
            search: debouncedSearch || undefined,
            ...applyCreatedRangeQuery(createdRange),
            storeId: branch.apiStoreId,
            customerIds,
            total: totalFilter,
        }),
        [debouncedSearch, createdRange, branch.apiStoreId, customerIds, totalFilter],
    );

    const { items: returns, loading, error: listError, serverPagination, reload } = useServerList<SalesReturn>({
        tableId: 'sales-returns',
        initialSort: { id: 'created_at', desc: true },
        deps: [filterParams],
        enabled: branch.ready,
        fetch: (params) => api.getReturnsList({ ...params, ...filterParams }),
    });
    useBranchForbiddenReset(listError, branch, t.dashboardLayout.branchFilterForbidden);

    const { summary, loading: summaryLoading, reload: reloadSummary } = useListSummary<
        SalesDocumentListFilterParams,
        SalesReturnListSummary
    >({ fetch: api.getReturnsListSummary, params: filterParams, enabled: branch.ready });

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        setDeleting(true);
        try {
            await api.deleteReturn(pendingDelete.id);
            setPendingDelete(null);
            void reload();
            reloadSummary();
            toast.success(copy.deleted);
        } catch (error: any) {
            console.error('Failed to delete return', error);
            toast.error(error?.message || copy.deleteFailed);
        } finally {
            setDeleting(false);
        }
    };

    const handlePrint = async (ret: SalesReturn) => {
        // The return's own branch letterhead, not the one resolved on mount.
        const header = await printHeader.resolve(ret.store_id);
        const headerContext: HeaderContext = {
            docTitle: t.shared.print.returnProcessed,
            docNumber: ret.return_number,
            docDate: formatDate(ret.created_at, locale),
            companyName: header.companyName,
        };

        openPrintWindow({
            context: headerContext,
            title: ret.return_number,
            paperSize: paper,
            headerConfig: header.headerConfig,
            headerHtml: renderHeaderHtml(header.headerConfig, headerContext, paper),
            styles: SIMPLE_DOC_STYLES,
            compactable: true,
            repeatHeader: true,
            bodyHtml: `
                <h1>${ret.return_number}</h1>
                <div class="subtitle">${formatMessage(t.shared.print.originalReceipt, {
                    date: formatDateTime(ret.created_at),
                    receipt: ret.sale?.serial_number || t.shared.dash,
                })}</div>
                <table>
                    <thead><tr><th>${t.shared.print.product}</th><th>${t.shared.print.qty}</th><th>${t.shared.print.refund}</th></tr></thead>
                    <tbody>
                        ${ret.items.map((item: any) => `<tr><td>${item.product?.name || t.shared.item}</td><td>${item.quantity}</td><td>${formatBDT(Number(item.refund_amount || item.price_at_sale * item.quantity), { locale })}</td></tr>`).join('')}
                        <tr class="total-row"><td colspan="2">${t.shared.print.totalRefund}</td><td>${formatBDT(Number(ret.total_refund), { locale })}</td></tr>
                    </tbody>
                </table>
                ${ret.reason ? `<p><strong>${t.shared.columns.reason}:</strong> ${ret.reason}</p>` : ''}`,
            footerHtml: `<div class="footer">${t.shared.print.returnProcessed}</div>`,
        });
    };

    const columns: ColumnDef<SalesReturn, any>[] = useMemo(
        () => [
            columnHelper.accessor('return_number', {
                header: t.returns.columns.returnNumber,
                cell: (info) => (
                    <Link
                        href={routes.sales.returnDetail(info.row.original.id)}
                        className="font-medium text-gray-900 hover:text-blue-600 hover:underline"
                    >
                        {info.getValue()}
                    </Link>
                ),
                size: 140,
            }),
            createdAtColumn(columnHelper, { header: t.common.date, locale, enableColumnFilter: false }),
            columnHelper.accessor((row) => row.sale?.serial_number ?? '', {
                id: 'receipt',
                header: t.returns.columns.originalReceipt,
                cell: (info) => info.getValue() || <span className="text-gray-400">{t.shared.dash}</span>,
                size: 150,
            }),
            columnHelper.accessor((row) => row.sale?.customer?.name ?? '', {
                id: 'customer',
                header: t.returns.columns.customer,
                cell: (info) => info.getValue() || <span className="text-gray-400">{t.shared.walkIn}</span>,
                size: 170,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => row.items?.length ?? 0, {
                id: 'item_count',
                header: t.returns.columns.items,
                enableSorting: false,
                cell: (info) => formatMessage(t.shared.itemsReturned, { count: info.getValue() }),
                size: 100,
                meta: { align: 'end', hideOnMobile: true },
            }),
            columnHelper.accessor('total_refund', {
                header: t.returns.columns.refundAmount,
                cell: (info) => formatBDT(Number(info.getValue() || 0), { locale }),
                size: 130,
                meta: { align: 'end' },
            }),
            columnHelper.accessor((row) => row.status ?? 'COMPLETED', {
                id: 'status',
                header: t.returns.columns.status,
                enableSorting: false,
                cell: (info) => {
                    const status = info.getValue();
                    return (
                        <StatusBadge tone={statusTones[status] ?? 'neutral'}>
                            {t.shared.statuses.return[status as keyof typeof t.shared.statuses.return] ?? status}
                        </StatusBadge>
                    );
                },
                size: 120,
                meta: { hideOnMobile: true },
            }),
            columnHelper.display({
                id: 'posting',
                header: t.returns.columns.voucher,
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
                header: t.returns.columns.actions,
                cell: (info) => {
                    const row = info.row.original;
                    return (
                        <RowActions>
                            <RowActionButton icon={<Eye />} label={t.common.view} href={routes.sales.returnDetail(row.id)} />
                            <RowActionButton
                                icon={<Pencil />}
                                label={t.common.edit}
                                href={`${routes.sales.returnDetail(row.id)}?edit=true`}
                            />
                            <RowActionButton icon={<Printer />} label={t.common.print} onClick={() => void handlePrint(row)} />
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
                size: 160,
            }),
        ],
        // Rebuilt with the print paper, which the Print action reads.
        [t, locale, paper],
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
            customerListFilter({
                label: t.returns.columns.customer,
                walkInLabel: t.shared.walkIn,
                value: customerIds,
                onChange: setCustomerIds,
                storeId: branch.apiStoreId,
            }),
            {
                id: 'total',
                type: 'number',
                label: t.returns.columns.refundAmount,
                value: totalFilter,
                onChange: setTotalFilter,
                money: true,
            },
        ],
        [t, createdRange, customerIds, totalFilter, branch.apiStoreId],
    );

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const dash = '—';
        const items: ListStat[] = [
            {
                id: 'count',
                icon: <RotateCcw aria-hidden />,
                label: copy.stats.returns,
                value: summary ? summary.count.toLocaleString(locale) : dash,
            },
            {
                id: 'amount',
                icon: <Undo2 aria-hidden />,
                label: copy.stats.amount,
                value: summary ? money(summary.amount) : dash,
                tone: summary && summary.amount > 0 ? 'danger' : 'default',
            },
            {
                id: 'refunded',
                icon: <ArrowDownToLine aria-hidden />,
                label: copy.stats.refunded,
                value: summary ? money(summary.refunded) : dash,
                hint: summary && summary.amount > 0
                    ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(summary.refunded / summary.amount)
                    : undefined,
            },
            { id: 'adjusted', icon: <Scale aria-hidden />, label: copy.stats.adjusted, value: summary ? money(summary.adjusted) : dash },
            { id: 'average', icon: <Calculator aria-hidden />, label: copy.stats.average, value: summary ? money(summary.average) : dash },
        ];
        return { items, loading: summaryLoading && !summary, label: copy.statsLabel };
    }, [summary, summaryLoading, locale, copy]);

    return (
        <PageShell>
            <PageHeader
                title={t.returns.title}
                subtitle={t.returns.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    t.returns.title,
                    'sales',
                )}
                actions={
                    <>
                        <BranchFilter scope={branch} />
                        <Link href={routes.sales.returnNew} className={buttonClassName()}>
                            <Plus className="w-4 h-4" />
                            {t.returns.processReturn}
                        </Link>
                    </>
                }
            />

            <DataTable<SalesReturn>
                tableId="sales-returns"
                columns={columns}
                data={returns}
                title={t.returns.dataTable.title}
                isLoading={loading}
                emptyMessage={t.returns.dataTable.emptyMessage}
                emptyIcon={<RotateCcw className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={copy.searchPlaceholder}
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
                prompt={t.shared.confirm.deleteReturn}
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
