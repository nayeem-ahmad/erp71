'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ClipboardList, Pencil, PlusCircle, Printer, Share2, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { routes } from '@/lib/routes';
import { formatDate } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import type { LineItem } from '@/lib/hooks/useNewSaleCart';
import DocumentEntryLayout from '@/components/document-entry/DocumentEntryLayout';
import DocumentMetaBar, { MetaField } from '@/components/document-entry/DocumentMetaBar';
import LineItemsTable from '@/components/document-entry/LineItemsTable';
import CustomerSelection from '../../components/CustomerSelection';
import TotalsFooter from '../../components/TotalsFooter';
import ShareModal from '@/components/share/ShareModal';
import { useQuotationShare } from '@/components/share/use-quotation-share';
import { useQuotationPrinting } from '@/lib/hooks/useQuotationPrinting';
import { quoteDocKindColors, quoteStatusColors } from '../quote-badges';

/** One term of a proforma, omitted entirely when it was never filled in. */
function ReadOnlyTerm({ label, value }: { label: string; value: string | number | null | undefined }) {
    if (value === null || value === undefined || value === '') return null;
    return (
        <div>
            <dt className="text-xs text-gray-500">{label}</dt>
            <dd className="text-sm text-gray-900">{value}</dd>
        </div>
    );
}

const noop = () => {};

/**
 * A quotation as the entry screen shows it, frozen — the same frame the sale
 * detail page uses, so opening a quotation looks like the screen it was typed
 * into rather than a different document. Editing happens on the entry screen
 * itself (`/edit`), not here.
 */
function QuoteDetailsPageContent() {
    const { t, locale } = useI18n();
    const { id } = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [quote, setQuote] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const isEditMode = searchParams.get('edit') === 'true';

    const isProforma = quote?.doc_kind === 'PROFORMA';
    /**
     * Shared with the quotations list so both mint the same link the same way.
     * Reloading after a revoke keeps the page honest about the share state.
     */
    const { share, sharingId, openShare, revokeShare, closeShare } = useQuotationShare(() => loadQuote());
    // The same detailed paper the quotations list prints, not this screen.
    const { printQuotation, printingId } = useQuotationPrinting();

    useEffect(() => {
        loadQuote();
    }, [id]);

    // Old `?edit=true` links land on the entry-style edit screen.
    useEffect(() => {
        if (isEditMode) router.replace(routes.sales.quoteEdit(id as string));
    }, [isEditMode, id, router]);

    const loadQuote = async () => {
        try {
            const data = await api.getQuotation(id as string);
            setQuote(data);
        } catch (error) {
            console.error('Failed to load quote', error);
        } finally {
            setLoading(false);
        }
    };

    // The lines in the shape the entry table reads. Only product, quantity and
    // price are stored on a quotation line, so that is all there is to show.
    const items: LineItem[] = useMemo(
        () => (quote?.items ?? []).map((item: any) => ({
            productId: item.product_id,
            name: item.product?.name || t.shared.item,
            price: Number(item.unit_price),
            group: item.product?.group?.name,
            subgroup: item.product?.subgroup?.name,
            quantity: item.quantity,
            discount: 0,
        })),
        [quote, t],
    );

    // The stored figures, not ones worked out again from today's product VAT
    // rates: the total is what the customer was quoted. VAT, where present, was
    // added on top and is part of that total.
    const totals = useMemo(() => ({
        subtotal: items.reduce((sum, item) => sum + item.quantity * item.price, 0),
        discount: 0,
        discountPercent: 0,
        vat: Number(quote?.vat_amount ?? 0),
        vatIncluded: false,
        vatRate: null,
        transportCost: 0,
        laborCost: 0,
        rounding: 0,
        total: Number(quote?.total_amount ?? 0),
    }), [items, quote]);

    const handleDelete = async () => {
        if (!quote) return;
        if (!window.confirm(t.shared.confirm.deleteQuotation)) return;

        setActionLoading(true);
        try {
            await api.deleteQuotation(quote.id);
            router.push(routes.sales.quotes);
        } catch (error: any) {
            toast.error(error.message || t.shared.errors.deleteQuotation);
        } finally {
            setActionLoading(false);
        }
    };

    const handleRevise = async () => {
        setActionLoading(true);
        try {
            const newQuote = await api.reviseQuotation(id as string);
            router.push(routes.sales.quoteDetail(newQuote.id));
        } catch (error: any) {
            toast.error(formatMessage(t.shared.errors.duplicateRevision, { message: error.message }));
        } finally {
            setActionLoading(false);
        }
    };

    const handleConvertToOrder = async () => {
        setActionLoading(true);
        try {
            const order = await api.convertQuotation(id as string);
            toast.success(formatMessage(t.shared.success.convertedOrder, { orderNumber: order.order_number }));
            router.push(`/sales/orders/${order.id}`);
        } catch (error: any) {
            toast.error(formatMessage(t.shared.errors.convertQuote, { message: error.message }));
        } finally {
            setActionLoading(false);
        }
    };

    const handleUpdateStatus = async (newStatus: string) => {
        setActionLoading(true);
        try {
            await api.updateQuotationStatus(id as string, newStatus);
            await loadQuote();
        } catch (error: any) {
            toast.error(formatMessage(t.shared.errors.updateStatus, { message: error.message || t.common.error }));
        } finally {
            setActionLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full bg-gray-50">
                <p className="text-sm text-gray-400">{t.shared.loading.quote}</p>
            </div>
        );
    }

    if (!quote) {
        return (
            <div className="flex items-center justify-center h-full bg-gray-50">
                <p className="text-sm text-gray-400">{t.shared.notFound.quote}</p>
            </div>
        );
    }

    const docKind = isProforma ? 'PROFORMA' : 'QUOTE';
    // A revised or converted quotation is history: its successor or its order
    // carries on, so it is neither revised again nor converted twice.
    const isOpen = quote.status !== 'REVISED' && quote.status !== 'CONVERTED';
    const statusButtonClass = 'px-2 py-1 border rounded text-xs font-medium disabled:opacity-50';

    const banner = (
        <div className="flex flex-wrap items-center gap-3 rounded border bg-white px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                {t.common.status}
            </span>
            <span
                className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${
                    quoteStatusColors[quote.status] ?? 'bg-gray-50 text-gray-700 border-gray-200'
                }`}
            >
                {t.shared.statuses.quote[quote.status as keyof typeof t.shared.statuses.quote] ?? quote.status}
            </span>
            <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${quoteDocKindColors[docKind]}`}>
                {t.quotes.detail.docKind[docKind]}
            </span>
            <span className="inline-flex rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                {formatMessage(t.shared.version, { version: quote.version })}
            </span>

            {/* Moving the quotation along its life sits beside the status it
                changes, rather than crowding the panel's save-or-delete row. */}
            {quote.status === 'DRAFT' && (
                <button
                    type="button"
                    onClick={() => handleUpdateStatus('SENT')}
                    disabled={actionLoading}
                    className={`${statusButtonClass} border-blue-200 text-blue-700 hover:bg-blue-50`}
                >
                    {t.quotes.detail.markSent}
                </button>
            )}
            {quote.status === 'SENT' && (
                <>
                    <button
                        type="button"
                        onClick={() => handleUpdateStatus('ACCEPTED')}
                        disabled={actionLoading}
                        className={`${statusButtonClass} border-emerald-200 text-emerald-700 hover:bg-emerald-50`}
                    >
                        {t.quotes.detail.accept}
                    </button>
                    <button
                        type="button"
                        onClick={() => handleUpdateStatus('REJECTED')}
                        disabled={actionLoading}
                        className={`${statusButtonClass} border-red-200 text-red-700 hover:bg-red-50`}
                    >
                        {t.quotes.detail.reject}
                    </button>
                    <button
                        type="button"
                        onClick={() => handleUpdateStatus('EXPIRED')}
                        disabled={actionLoading}
                        className={`${statusButtonClass} border-gray-200 text-gray-600 hover:bg-gray-50`}
                    >
                        {t.quotes.detail.markExpired}
                    </button>
                </>
            )}
        </div>
    );

    // Copies of the document — the printed paper and the customer's link — sit
    // up in the meta strip beside the number they carry, as on the sale screen.
    const headerActions = (
        <>
            <button
                type="button"
                onClick={() => void printQuotation(quote)}
                disabled={printingId === quote.id}
                className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 disabled:text-gray-300 text-sm flex items-center gap-1.5"
            >
                <Printer className="w-4 h-4" />
                {t.quotes.detail.printPdf}
            </button>
            <button
                type="button"
                onClick={() => void openShare(quote)}
                disabled={sharingId === quote.id}
                className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 disabled:text-gray-300 text-sm flex items-center gap-1.5"
            >
                <Share2 className="w-4 h-4" />
                {t.quotes.detail.share}
            </button>
        </>
    );

    const actions = (
        <>
            <Link
                href={routes.sales.quotes}
                className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 text-sm"
            >
                {t.common.back}
            </Link>
            {/* The API refuses to delete a converted quotation. */}
            {quote.status !== 'CONVERTED' && (
                <button
                    type="button"
                    onClick={handleDelete}
                    disabled={actionLoading}
                    className="px-3 py-2 border border-red-200 rounded text-red-600 hover:bg-red-50 disabled:text-gray-400 text-sm flex items-center gap-1.5"
                >
                    <Trash2 className="w-4 h-4" />
                    {t.quotes.detail.delete}
                </button>
            )}
            {isOpen && (
                <button
                    type="button"
                    onClick={handleRevise}
                    disabled={actionLoading}
                    className="px-3 py-2 border border-amber-200 rounded text-amber-700 hover:bg-amber-50 disabled:text-gray-400 text-sm flex items-center gap-1.5"
                >
                    <PlusCircle className="w-4 h-4" />
                    {t.quotes.detail.revise}
                </button>
            )}
            {isOpen && (
                <button
                    type="button"
                    onClick={handleConvertToOrder}
                    disabled={actionLoading}
                    className="px-3 py-2 border border-blue-200 rounded text-blue-700 hover:bg-blue-50 disabled:text-gray-400 text-sm flex items-center gap-1.5"
                >
                    <ClipboardList className="w-4 h-4" />
                    {t.quotes.detail.convertToOrder}
                </button>
            )}
            <button
                type="button"
                onClick={() => router.push(routes.sales.quoteEdit(quote.id))}
                className="flex-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium flex items-center justify-center gap-1.5"
            >
                <Pencil className="w-4 h-4" />
                {t.quotes.detail.edit}
            </button>
        </>
    );

    return (
        <>
            <DocumentEntryLayout
                title={quote.quote_number}
                backHref={routes.sales.quotes}
                banner={banner}
                metaBar={
                    <DocumentMetaBar
                        docLabel={isProforma ? 'Proforma #' : 'Quotation #'}
                        serialNumber={quote.quote_number}
                        currentUser={null}
                        showRefNumber={false}
                        documentDate={quote.created_at}
                        readOnly
                    >
                        <MetaField label={t.quotes.columns.validUntil}>
                            <span className="text-gray-700 font-medium">
                                {quote.valid_until ? formatDate(quote.valid_until, locale) : t.quotes.detail.expiresNever}
                            </span>
                        </MetaField>
                    </DocumentMetaBar>
                }
                headerActions={headerActions}
                partyPicker={
                    <CustomerSelection
                        customer={quote.customer ? { ...quote.customer, id: quote.customer_id } : null}
                        setCustomer={noop}
                        readOnly
                    />
                }
                table={
                    <LineItemsTable
                        items={items}
                        onUpdateItem={noop}
                        onRemoveItem={noop}
                        readOnly
                        showDiscount={false}
                        emptyMessage="No items on this quotation."
                    />
                }
                note={
                    <div className="space-y-2 flex-shrink-0">
                        {isProforma && (
                            <div className="rounded border bg-white p-3">
                                <p className="mb-2 text-xs font-semibold uppercase text-gray-500">
                                    {t.quotes.detail.terms.heading}
                                </p>
                                <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                    <ReadOnlyTerm label={t.quotes.detail.terms.currency} value={quote.currency} />
                                    <ReadOnlyTerm label={t.quotes.detail.terms.incoterm} value={quote.incoterm} />
                                    <ReadOnlyTerm
                                        label={t.quotes.detail.terms.advance}
                                        value={quote.advance_percent ? `${quote.advance_percent}%` : null}
                                    />
                                    <ReadOnlyTerm
                                        label={t.quotes.detail.terms.portOfLoading}
                                        value={quote.port_of_loading}
                                    />
                                    <ReadOnlyTerm
                                        label={t.quotes.detail.terms.portOfDischarge}
                                        value={quote.port_of_discharge}
                                    />
                                    <ReadOnlyTerm
                                        label={t.quotes.detail.terms.countryOfOrigin}
                                        value={quote.country_of_origin}
                                    />
                                    <ReadOnlyTerm
                                        label={t.quotes.detail.terms.deliveryLeadTime}
                                        value={
                                            quote.delivery_lead_time_days
                                                ? formatMessage(t.quotes.detail.terms.days, {
                                                      count: quote.delivery_lead_time_days,
                                                  })
                                                : null
                                        }
                                    />
                                    <ReadOnlyTerm
                                        label={t.quotes.detail.terms.paymentTerms}
                                        value={quote.payment_terms}
                                    />
                                </dl>
                            </div>
                        )}
                        <p className="w-full rounded border bg-white px-2 py-1.5 text-sm text-gray-600">
                            {quote.notes || <span className="text-gray-400">No note added</span>}
                        </p>
                    </div>
                }
                panel={
                    <TotalsFooter
                        totals={totals}
                        onTotalsChange={noop}
                        tenantVatRate={0}
                        readOnly
                        showAdjustments={false}
                    />
                }
                actions={actions}
            />

            {share && (
                <ShareModal
                    subject={share.subject}
                    shortPath={share.path}
                    onRevoke={revokeShare}
                    showPrintLink
                    onClose={closeShare}
                />
            )}
        </>
    );
}

export default function QuoteDetailsPage() {
    return (
        <Suspense>
            <QuoteDetailsPageContent />
        </Suspense>
    );
}
