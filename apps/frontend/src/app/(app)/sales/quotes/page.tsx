'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    CalendarX,
    CheckCircle2,
    Edit2,
    Eye,
    FileText,
    Hourglass,
    Link2,
    Plus,
    Printer,
    ReceiptText,
    Trash2,
    Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { api, type QuotationListFilterParams, type QuotationListSummary } from '@/lib/api';
import { formatBDT, formatCurrency, formatDate } from '@/lib/format';
import { DataTable, createdAtColumn, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import { applyCreatedRangeQuery, applyDateRangeQuery, type CreatedRange } from '@/lib/created-range';
import { routes } from '@/lib/routes';
import { useI18n, formatMessage } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useQuotationPrinting } from '@/lib/hooks/useQuotationPrinting';
import { BranchFilter, ConfirmDialog, PageShell, StatusBadge, buttonClassName, type StatusBadgeTone } from '@/components/ui';
import { useBranchForbiddenReset, useBranchScope } from '@/lib/branch-scope';
import type { NumberCondition } from '@/lib/number-condition';
import { toast } from '@/lib/toast';
import { useServerList } from '@/hooks/useServerList';
import { useListSummary } from '@/hooks/useListSummary';
import ShareModal from '@/components/share/ShareModal';
import { useQuotationShare } from '@/components/share/use-quotation-share';
import ConvertToSalesModal from './ConvertToSalesModal';
import { customerListFilter } from '../components/customer-list-filter';

interface Quotation {
    id: string;
    quote_number: string;
    created_at: string;
    valid_until?: string | null;
    total_amount: string;
    /** VAT added on top of the lines; part of `total_amount`. */
    vat_amount?: string | null;
    status: string;
    version: number;
    doc_kind?: string;
    currency?: string;
    exchange_rate?: string | null;
    notes?: string | null;
    items: any[];
    customer_id?: string | null;
    customer?: { name: string; phone?: string } | null;
    store_id?: string;
}

const QUOTE_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED', 'REVISED'] as const;
const DOC_KINDS = ['QUOTE', 'PROFORMA'] as const;
/** A quotation the valid-until date still matters for. */
const LIVE_STATUSES = new Set(['DRAFT', 'SENT', 'ACCEPTED']);

const statusTones: Record<string, StatusBadgeTone> = {
    DRAFT: 'neutral',
    SENT: 'info',
    ACCEPTED: 'success',
    REJECTED: 'danger',
    CONVERTED: 'success',
    // Superseded by a newer version: the customer is looking at that one now.
    REVISED: 'warning',
    EXPIRED: 'neutral',
};

const columnHelper = createColumnHelper<Quotation>();

function startOfToday(): number {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export default function QuotesPage() {
    const { t, locale, fmt } = useI18n();
    const branch = useBranchScope();
    const { printQuotation, printingId } = useQuotationPrinting();
    // Same endpoint and same modal the detail page uses, so a link minted from a
    // row and one minted from the quotation itself are the one link.
    const { share, sharingId, openShare, revokeShare, closeShare } = useQuotationShare();
    // The rows "Convert to sales" was pressed on. Captured when the modal opens,
    // so reloading the list behind it once sales exist cannot change what the
    // open modal is reporting on.
    const [converting, setConverting] = useState<Quotation[] | null>(null);
    const [clearSelectionSignal, setClearSelectionSignal] = useState(0);
    const [pendingDelete, setPendingDelete] = useState<Quotation | null>(null);
    const [deleting, setDeleting] = useState(false);

    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [validRange, setValidRange] = useState<CreatedRange | null>(null);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [statusExclude, setStatusExclude] = useState(false);
    const [customerIds, setCustomerIds] = useState<string[]>([]);
    const [totalFilter, setTotalFilter] = useState<NumberCondition | null>(null);
    const [docKind, setDocKind] = useState<string | null>(null);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    // The quotation's own date is how long the customer has to take the price.
    const filterParams = useMemo<QuotationListFilterParams>(
        () => ({
            search: debouncedSearch || undefined,
            status: statusFilter.length ? statusFilter.join(',') : undefined,
            statusExclude,
            ...applyDateRangeQuery(validRange),
            ...applyCreatedRangeQuery(createdRange),
            storeId: branch.apiStoreId,
            customerIds,
            total: totalFilter,
            docKind: (docKind ?? undefined) as QuotationListFilterParams['docKind'],
        }),
        [debouncedSearch, statusFilter, statusExclude, validRange, createdRange, branch.apiStoreId, customerIds, totalFilter, docKind],
    );

    const { items: quotes, loading, error: listError, serverPagination, reload } = useServerList<Quotation>({
        tableId: 'sales-quotations',
        initialSort: { id: 'created_at', desc: true },
        deps: [filterParams],
        enabled: branch.ready,
        fetch: (params) => api.getQuotationsList({ ...params, ...filterParams }),
    });
    useBranchForbiddenReset(listError, branch, t.dashboardLayout.branchFilterForbidden);

    const { summary, loading: summaryLoading, reload: reloadSummary } = useListSummary<
        QuotationListFilterParams,
        QuotationListSummary
    >({ fetch: api.getQuotationsListSummary, params: filterParams, enabled: branch.ready });

    const refresh = () => {
        void reload();
        reloadSummary();
    };

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        setDeleting(true);
        try {
            await api.deleteQuotation(pendingDelete.id);
            setPendingDelete(null);
            refresh();
            toast.success(t.quotes.deleted);
        } catch (error: any) {
            toast.error(error?.message || t.shared.errors.deleteQuotation);
        } finally {
            setDeleting(false);
        }
    };

    const columns: ColumnDef<Quotation, any>[] = useMemo(() => {
        const today = startOfToday();
        return [
            columnHelper.accessor('quote_number', {
                header: t.quotes.columns.quoteNumber,
                cell: (info) => (
                    <span className="whitespace-nowrap">
                        <Link
                            href={routes.sales.quoteDetail(info.row.original.id)}
                            className="font-medium text-gray-900 hover:text-blue-600 hover:underline"
                        >
                            {info.getValue()}
                        </Link>
                        <span className="ms-1.5 text-xs text-gray-400">
                            {formatMessage(t.shared.version, { version: info.row.original.version })}
                        </span>
                    </span>
                ),
                size: 170,
            }),
            columnHelper.accessor((row) => row.doc_kind ?? 'QUOTE', {
                id: 'doc_kind',
                header: t.quotes.columns.docKind,
                cell: (info) => {
                    const kind = info.getValue() as keyof typeof t.quotes.detail.docKind;
                    // A classification, not a state: proformas stand out in blue, quotes stay quiet.
                    return (
                        <StatusBadge tone={kind === 'PROFORMA' ? 'info' : 'neutral'}>
                            {t.quotes.detail.docKind[kind] ?? kind}
                        </StatusBadge>
                    );
                },
                size: 110,
                meta: { hideOnMobile: true },
            }),
            createdAtColumn(columnHelper, { header: t.common.createdAt, locale, enableColumnFilter: false }),
            columnHelper.accessor((row) => row.customer?.name ?? '', {
                id: 'customer',
                header: t.quotes.columns.customer,
                cell: (info) => {
                    const name = info.getValue();
                    if (!name) return <span className="text-gray-400">{t.shared.walkIn}</span>;
                    const phone = info.row.original.customer?.phone;
                    return (
                        <div>
                            <div>{name}</div>
                            {phone ? <div className="text-xs text-gray-500">{phone}</div> : null}
                        </div>
                    );
                },
                size: 170,
            }),
            columnHelper.accessor((row) => row.items?.length ?? 0, {
                id: 'items',
                header: t.quotes.columns.items,
                enableSorting: false,
                cell: (info) => formatMessage(t.shared.itemsCount, { count: info.getValue() }),
                size: 90,
                meta: { align: 'end', hideOnMobile: true },
            }),
            columnHelper.accessor('valid_until', {
                header: t.quotes.columns.validUntil,
                cell: (info) => {
                    const value = info.getValue();
                    if (!value) return <span className="text-gray-400">{t.shared.open}</span>;
                    // A live quote past its date may no longer hold its price.
                    const lapsed = LIVE_STATUSES.has(info.row.original.status) && new Date(value).getTime() < today;
                    return <span className={lapsed ? 'font-medium text-amber-700' : undefined}>{formatDate(value, locale)}</span>;
                },
                size: 130,
            }),
            columnHelper.accessor('total_amount', {
                header: t.quotes.columns.total,
                cell: (info) => {
                    const currency = info.row.original.currency;
                    const amount = parseFloat(info.getValue());
                    // A proforma written in dollars says dollars: a ৳ in front of it would misstate what is owed.
                    return currency && currency !== 'BDT'
                        ? formatCurrency(amount, { locale, currency })
                        : formatBDT(amount, { locale });
                },
                size: 120,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('status', {
                header: t.quotes.columns.status,
                cell: (info) => {
                    const status = info.getValue() as keyof typeof t.shared.statuses.quote;
                    return (
                        <StatusBadge tone={statusTones[status] ?? 'neutral'}>
                            {t.shared.statuses.quote[status] ?? status}
                        </StatusBadge>
                    );
                },
                size: 120,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.quotes.columns.actions,
                cell: (info) => {
                    const quote = info.row.original;
                    return (
                        <RowActions>
                            <RowActionButton icon={<Eye />} label={t.common.view} href={routes.sales.quoteDetail(quote.id)} />
                            <RowActionButton icon={<Edit2 />} label={t.common.edit} href={routes.sales.quoteEdit(quote.id)} />
                            {/* Opens the sale entry screen seeded from this
                                quotation; the sale records the link back when
                                it is saved. */}
                            <RowActionButton
                                icon={<ReceiptText />}
                                label={t.quotes.convertToSale}
                                intent="success"
                                href={`${routes.sales.new}?quotationId=${quote.id}`}
                            />
                            {/* Mints (or reopens) the /s/<code> short link for
                                this quotation and hands it over ready to send —
                                the same link the detail page's Share button
                                produces, since the endpoint reuses the
                                quotation's existing token and code. */}
                            <RowActionButton
                                icon={<Link2 />}
                                label={t.quotes.shortLink}
                                disabled={sharingId === quote.id}
                                onClick={() => void openShare(quote)}
                            />
                            <RowActionButton
                                icon={<Printer />}
                                label={t.common.print}
                                disabled={printingId === quote.id}
                                onClick={() => void printQuotation(quote)}
                            />
                            <RowActionButton
                                icon={<Trash2 />}
                                label={t.common.delete}
                                intent="danger"
                                onClick={() => setPendingDelete(quote)}
                            />
                        </RowActions>
                    );
                },
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 210,
            }),
        ];
    }, [t, locale, openShare, sharingId, printQuotation, printingId]);

    const bulkActions = useMemo(
        () => [
            {
                label: t.quotes.bulkConvert.action,
                icon: <ReceiptText className="w-4 h-4" />,
                onClick: (rows: Quotation[]) => setConverting(rows),
            },
        ],
        [t],
    );

    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'validUntil',
                type: 'date-range',
                label: t.quotes.columns.validUntil,
                value: validRange,
                onChange: setValidRange,
                operators: true,
            },
            {
                id: 'status',
                type: 'multi-select',
                label: t.quotes.columns.status,
                value: statusFilter,
                onChange: setStatusFilter,
                exclude: { value: statusExclude, onChange: setStatusExclude },
                options: QUOTE_STATUSES.map((value) => ({ value, label: t.shared.statuses.quote[value] ?? value })),
            },
            customerListFilter({
                label: t.quotes.columns.customer,
                walkInLabel: t.shared.walkIn,
                value: customerIds,
                onChange: setCustomerIds,
                storeId: branch.apiStoreId,
            }),
            {
                id: 'total',
                type: 'number',
                label: t.quotes.columns.total,
                value: totalFilter,
                onChange: setTotalFilter,
                money: true,
            },
            {
                id: 'docKind',
                type: 'select',
                label: t.quotes.columns.docKind,
                value: docKind,
                onChange: setDocKind,
                options: DOC_KINDS.map((value) => ({ value, label: t.quotes.detail.docKind[value] })),
            },
            { id: 'created', type: 'date-range', value: createdRange, onChange: setCreatedRange, operators: true, more: true },
        ],
        [t, branch.apiStoreId, validRange, statusFilter, statusExclude, customerIds, totalFilter, docKind, createdRange],
    );

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const copy = t.quotes.stats;
        const dash = '—';
        const count = (value: number | undefined) => (value === undefined ? dash : value.toLocaleString(locale));
        const items: ListStat[] = [
            { id: 'count', icon: <FileText aria-hidden />, label: copy.quotations, value: count(summary?.count) },
            { id: 'value', icon: <Wallet aria-hidden />, label: copy.value, value: summary ? money(summary.value) : dash },
            { id: 'awaiting', icon: <Hourglass aria-hidden />, label: copy.awaiting, value: count(summary?.awaiting) },
            {
                id: 'accepted',
                icon: <CheckCircle2 aria-hidden />,
                label: copy.accepted,
                value: summary ? money(summary.accepted.amount) : dash,
                hint: summary?.accepted.count ? fmt(copy.acceptedCount, { count: summary.accepted.count }) : undefined,
            },
            { id: 'converted', icon: <ReceiptText aria-hidden />, label: copy.converted, value: count(summary?.converted) },
            {
                id: 'expired',
                icon: <CalendarX aria-hidden />,
                label: copy.expired,
                value: count(summary?.expired),
                tone: summary && summary.expired > 0 ? 'warning' : 'default',
            },
        ];
        return { items, loading: summaryLoading && !summary, label: t.quotes.statsLabel };
    }, [summary, summaryLoading, locale, t, fmt]);

    return (
        <PageShell>
            <PageHeader
                title={t.quotes.title}
                subtitle={t.quotes.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    t.quotes.title,
                    'sales',
                )}
                actions={(
                    <>
                        <BranchFilter scope={branch} />
                        <Link href={`${routes.sales.quoteNew}?kind=PROFORMA`} className={buttonClassName({ variant: 'secondary' })}>
                            <Plus className="w-4 h-4" />
                            {t.quotes.newProforma}
                        </Link>
                        <Link href={routes.sales.quoteNew} className={buttonClassName()}>
                            <Plus className="w-4 h-4" />
                            {t.quotes.newQuotation}
                        </Link>
                    </>
                )}
            />

            <DataTable<Quotation>
                tableId="sales-quotations"
                columns={columns}
                data={quotes}
                title={t.quotes.dataTable.title}
                isLoading={loading}
                emptyMessage={t.quotes.dataTable.emptyMessage}
                emptyIcon={<FileText className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={t.quotes.dataTable.searchPlaceholder}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                // The filter row covers what the per-column boxes did, and sends it to the server.
                enableColumnFilters={false}
                viewOptions
                serverPagination={serverPagination}
                enableRowSelection
                getRowId={(quote) => quote.id}
                bulkActions={bulkActions}
                clearSelectionSignal={clearSelectionSignal}
            />

            {converting && (
                <ConvertToSalesModal
                    quotes={converting}
                    onClose={() => setConverting(null)}
                    onConverted={() => {
                        setClearSelectionSignal((signal) => signal + 1);
                        refresh();
                    }}
                />
            )}

            {share && (
                <ShareModal
                    subject={share.subject}
                    shortPath={share.path}
                    onRevoke={revokeShare}
                    showPrintLink
                    onClose={closeShare}
                />
            )}

            <ConfirmDialog
                open={pendingDelete !== null}
                title={t.common.delete}
                prompt={t.shared.confirm.deleteQuotation}
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
