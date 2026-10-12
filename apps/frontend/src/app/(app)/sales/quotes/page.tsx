'use client';

import { useState, useEffect, useMemo } from 'react';
import { FileText, Plus, Eye, Edit2, Printer, Trash2, ReceiptText, Link2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, createdAtColumn, CreatedRangeFilter } from '@/components/data-table';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import { compactDensity } from '@/lib/ui/compact-density';
import { routes } from '@/lib/routes';
import { useI18n, formatMessage } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useQuotationPrinting } from '@/lib/hooks/useQuotationPrinting';
import { BranchFilter, PageShell } from '@/components/ui';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import ShareModal from '@/components/share/ShareModal';
import { useQuotationShare } from '@/components/share/use-quotation-share';
import ConvertToSalesModal from './ConvertToSalesModal';
import { quoteDocKindColors, quoteStatusColors } from './quote-badges';

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
    customer?: { name: string; phone?: string };
    store_id?: string;
}

const columnHelper = createColumnHelper<Quotation>();

export default function QuotesPage() {
    const { t, locale } = useI18n();
    const branch = useBranchScope();
    const { printQuotation, printingId } = useQuotationPrinting();
    const [quotes, setQuotes] = useState<Quotation[]>([]);
    const [loading, setLoading] = useState(true);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    // Same endpoint and same modal the detail page uses, so a link minted from a
    // row and one minted from the quotation itself are the one link.
    const { share, sharingId, openShare, revokeShare, closeShare } = useQuotationShare();
    // The rows "Convert to sales" was pressed on. Captured when the modal opens,
    // so reloading the list behind it once sales exist cannot change what the
    // open modal is reporting on.
    const [converting, setConverting] = useState<Quotation[] | null>(null);
    const [clearSelectionSignal, setClearSelectionSignal] = useState(0);

    useEffect(() => {
        if (!branch.ready) return;
        loadQuotes();
    }, [createdRange, branch.ready, branch.apiStoreId]);

    const loadQuotes = async () => {
        setLoading(true);
        try {
            const data = await api.getQuotations({ ...applyCreatedRangeQuery(createdRange), storeId: branch.apiStoreId });
            setQuotes(data);
        } catch (error) {
            if (handleBranchForbidden(error, branch, t.dashboardLayout.branchFilterForbidden)) return;
            console.error('Failed to load quotes', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm(t.shared.confirm.deleteQuotation)) return;
        try {
            await api.deleteQuotation(id);
            setQuotes((prev) => prev.filter((quote) => quote.id !== id));
        } catch (error: any) {
            alert(error.message || t.shared.errors.deleteQuotation);
        }
    };

    const columns: ColumnDef<Quotation, any>[] = useMemo(
        () => [
            columnHelper.accessor('quote_number', {
                header: t.quotes.columns.quoteNumber,
                cell: (info) => (
                    <div>
                        <span className="text-sm font-bold text-gray-900">{info.getValue()}</span>
                        <span className="ms-2 inline-flex rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                            {formatMessage(t.shared.version, { version: info.row.original.version })}
                        </span>
                    </div>
                ),
                size: 180,
            }),
            columnHelper.accessor((row) => row.doc_kind ?? 'QUOTE', {
                id: 'doc_kind',
                header: t.quotes.columns.docKind,
                cell: (info) => {
                    const kind = info.getValue();
                    return (
                        <span
                            className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${quoteDocKindColors[kind] ?? quoteDocKindColors.QUOTE}`}
                        >
                            {t.quotes.detail.docKind[kind as keyof typeof t.quotes.detail.docKind] ?? kind}
                        </span>
                    );
                },
                size: 110,
            }),
            createdAtColumn(columnHelper, { header: t.common.createdAt, locale }),
            columnHelper.accessor((row) => row.customer?.name ?? '', {
                id: 'customer',
                header: t.quotes.columns.customer,
                cell: (info) => (
                    <div>
                        <span className="text-sm text-gray-700 font-medium">
                            {info.getValue() || <span className="text-gray-300">{t.shared.walkIn}</span>}
                        </span>
                        <span className="block text-xs text-gray-400">{info.row.original.customer?.phone || t.shared.noPhone}</span>
                    </div>
                ),
                size: 160,
            }),
            columnHelper.accessor((row) => row.items?.length ?? 0, {
                id: 'items',
                header: t.quotes.columns.items,
                cell: (info) => (
                    <span className="text-sm font-bold text-gray-700">
                        {formatMessage(t.shared.itemsCount, { count: info.getValue() })}
                    </span>
                ),
                size: 90,
            }),
            columnHelper.accessor('valid_until', {
                header: t.quotes.columns.validUntil,
                cell: (info) => (
                    <span className="text-sm font-medium text-gray-600">
                        {info.getValue() ? formatDate(info.getValue() as string, locale) : t.shared.open}
                    </span>
                ),
                size: 130,
            }),
            columnHelper.accessor('total_amount', {
                header: t.quotes.columns.total,
                cell: (info) => (
                    <span className="text-sm font-bold text-blue-600">{formatBDT(parseFloat(info.getValue()), { locale })}</span>
                ),
                sortingFn: (a, b) => parseFloat(a.getValue('total_amount')) - parseFloat(b.getValue('total_amount')),
                size: 110,
            }),
            columnHelper.accessor('status', {
                header: t.quotes.columns.status,
                cell: (info) => {
                    const status = info.getValue();
                    return (
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${quoteStatusColors[status] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`}>
                            {t.shared.statuses.quote[status as keyof typeof t.shared.statuses.quote] ?? status}
                        </span>
                    );
                },
                size: 130,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.quotes.columns.actions,
                cell: (info) => {
                    const quote = info.row.original;
                    return (
                        <div className="flex items-center justify-end space-x-1 rtl:space-x-reverse">
                            <Link
                                href={`/sales/quotes/${quote.id}`}
                                className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                                title={t.common.view}
                            >
                                <Eye className="w-4 h-4" />
                            </Link>
                            <Link
                                href={routes.sales.quoteEdit(quote.id)}
                                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                                title={t.common.edit}
                            >
                                <Edit2 className="w-4 h-4" />
                            </Link>
                            {/* Opens the sale entry screen seeded from this
                                quotation; the sale records the link back when
                                it is saved. */}
                            <Link
                                href={`${routes.sales.new}?quotationId=${quote.id}`}
                                className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                                title={t.quotes.convertToSale}
                                aria-label={t.quotes.convertToSale}
                            >
                                <ReceiptText className="w-4 h-4" />
                            </Link>
                            {/* Mints (or reopens) the /s/<code> short link for
                                this quotation and hands it over ready to send —
                                the same link the detail page's Share button
                                produces, since the endpoint reuses the
                                quotation's existing token and code. */}
                            <button
                                onClick={() => void openShare(quote)}
                                disabled={sharingId === quote.id}
                                className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50"
                                title={t.quotes.shortLink}
                                aria-label={t.quotes.shortLink}
                            >
                                <Link2 className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => void printQuotation(quote)}
                                disabled={printingId === quote.id}
                                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors disabled:opacity-50"
                                title={t.common.print}
                                aria-label={t.common.print}
                            >
                                <Printer className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => handleDelete(quote.id)}
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
                size: 230,
            }),
        ],
        [t, locale, openShare, sharingId, printQuotation, printingId],
    );

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

    const filterPresets = useMemo(
        () => [
            { label: t.quotes.filterPresets.draft, filters: [{ id: 'status', value: 'DRAFT' }] },
            { label: t.quotes.filterPresets.sent, filters: [{ id: 'status', value: 'SENT' }] },
            { label: t.quotes.filterPresets.accepted, filters: [{ id: 'status', value: 'ACCEPTED' }] },
            { label: t.quotes.filterPresets.converted, filters: [{ id: 'status', value: 'CONVERTED' }] },
            { label: t.quotes.filterPresets.quotesOnly, filters: [{ id: 'doc_kind', value: 'QUOTE' }] },
            { label: t.quotes.filterPresets.proformas, filters: [{ id: 'doc_kind', value: 'PROFORMA' }] },
        ],
        [t],
    );

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
                    actions={
                        <div className="flex flex-wrap items-center gap-2">
                            <BranchFilter scope={branch} />
                            <Link
                                href={`${routes.sales.quoteNew}?kind=PROFORMA`}
                                className={`${compactDensity.btnSecondary}`}
                            >
                                <Plus className="w-4 h-4" />
                                {t.quotes.newProforma}
                            </Link>
                            <Link href={routes.sales.quoteNew} className={`${compactDensity.btnPrimary} bg-primary hover:bg-primary-hover text-white`}>
                                <Plus className="w-4 h-4" />
                                {t.quotes.newQuotation}
                            </Link>
                        </div>
                    }
                />


                <div className="flex flex-wrap items-center gap-2">
                    <CreatedRangeFilter value={createdRange} onChange={setCreatedRange} />
                </div>

                <DataTable<Quotation>
                    tableId="sales-quotations"
                    columns={columns}
                    data={quotes}
                    title={t.quotes.dataTable.title}
                    isLoading={loading}
                    emptyMessage={t.quotes.dataTable.emptyMessage}
                    emptyIcon={<FileText className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.quotes.dataTable.searchPlaceholder}
                    filterPresets={filterPresets}
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
                            void loadQuotes();
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

        </PageShell>
    );
}