'use client';

import { useState, useEffect, Suspense } from 'react';
import { Package, FileText, ClipboardList, PlusCircle, Printer, Pencil, Share2, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { PageShell } from '@/components/ui';
import ShareModal from '@/components/share/ShareModal';
import { useQuotationShare } from '@/components/share/use-quotation-share';

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

    const handleDelete = async () => {
        if (!quote) return;
        if (!window.confirm(t.shared.confirm.deleteQuotation)) return;

        setActionLoading(true);
        try {
            await api.deleteQuotation(quote.id);
            router.push('/sales/quotes');
        } catch (error: any) {
            alert(error.message || t.shared.errors.deleteQuotation);
        } finally {
            setActionLoading(false);
        }
    };

    const handleRevise = async () => {
        setActionLoading(true);
        try {
             const newQuote = await api.reviseQuotation(id as string);
             router.push(`/sales/quotes/${newQuote.id}`);
        } catch (error: any) {
             alert(formatMessage(t.shared.errors.duplicateRevision, { message: error.message }));
        } finally {
             setActionLoading(false);
        }
    };

    const handleConvertToOrder = async () => {
        setActionLoading(true);
        try {
             const order = await api.convertQuotation(id as string);
             alert(formatMessage(t.shared.success.convertedOrder, { orderNumber: order.order_number }));
             await loadQuote(); // Reload to show CONVERTED status
             router.push(`/sales/orders/${order.id}`); // Auto jump into active orders
        } catch (error: any) {
             alert(formatMessage(t.shared.errors.convertQuote, { message: error.message }));
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
            alert(formatMessage(t.shared.errors.updateStatus, { message: error.message || t.common.error }));
        } finally {
            setActionLoading(false);
        }
    };

    if (loading) {
        return <div className="p-8 font-bold text-gray-400">{t.shared.loading.quote}</div>;
    }

    if (!quote) {
        return <div className="p-8 font-bold text-danger">{t.shared.notFound.quote}</div>;
    }

    const totalAmount = Number(quote.total_amount);

    return (
        <PageShell>
            <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
                <div className="px-8 py-6">
                    <PageHeader
                        title={
                            <span className="inline-flex items-center gap-3">
                                <FileText className="w-8 h-8 text-blue-600" />
                                <span>
                                    {quote.quote_number}{' '}
                                    <span className="text-lg bg-gray-100 text-gray-500 px-2 rounded-lg font-bold ms-1">v{quote.version}</span>
                                </span>
                            </span>
                        }
                        subtitle={
                            <span className="inline-flex items-center gap-3">
                                <span
                                    className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${
                                        isProforma
                                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                                            : 'bg-gray-50 text-gray-600 border-gray-200'
                                    }`}
                                >
                                    {isProforma ? t.quotes.detail.docKind.PROFORMA : t.quotes.detail.docKind.QUOTE}
                                </span>
                                <span className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-800">
                                    {formatMessage(t.quotes.detail.statusLabel, {
                                        status: t.shared.statuses.quote[quote.status as keyof typeof t.shared.statuses.quote] ?? quote.status,
                                    })}
                                </span>
                                <span className="text-sm font-bold text-gray-400">
                                    {quote.valid_until
                                        ? formatMessage(t.quotes.detail.expires, { date: formatDate(quote.valid_until, locale) })
                                        : formatMessage(t.quotes.detail.expires, { date: t.quotes.detail.expiresNever })}
                                </span>
                            </span>
                        }
                        breadcrumbs={nestedPageBreadcrumbs(
                            t.dashboardHome.breadcrumbHome,
                            t.sidebar.modules.sales,
                            'sales',
                            [{ label: t.quotes.title, href: routes.sales.quotes }],
                            quote.quote_number,
                        )}
                        actions={
                            <>
                                <button onClick={() => window.print()} className="bg-white border border-gray-200 text-gray-900 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center hover:bg-gray-50 shadow-sm transition-all">
                                    <Printer className="w-4 h-4 me-2 text-gray-400" />
                                    {t.quotes.detail.printPdf}
                                </button>
                                <button
                                    onClick={() => void openShare(quote)}
                                    disabled={sharingId === quote.id}
                                    className="bg-white border border-gray-200 text-gray-900 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center hover:bg-gray-50 shadow-sm transition-all disabled:opacity-50"
                                >
                                    <Share2 className="w-4 h-4 me-2 text-gray-400" />
                                    {t.quotes.detail.share}
                                </button>
                                <button
                                    onClick={() => router.push(routes.sales.quoteEdit(quote.id))}
                                    className="bg-white border border-gray-200 text-gray-900 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center hover:bg-gray-50 shadow-sm transition-all"
                                >
                                    <Pencil className="w-4 h-4 me-2 text-gray-400" />
                                    {t.quotes.detail.edit}
                                </button>
                                <button
                                    onClick={handleDelete}
                                    disabled={actionLoading}
                                    className="bg-red-50 border border-red-100 text-red-600 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center hover:bg-red-100 transition-all disabled:opacity-50"
                                >
                                    <Trash2 className="w-4 h-4 me-2" />
                                    {t.quotes.detail.delete}
                                </button>
                                {quote.status === 'DRAFT' && (
                                    <button onClick={() => handleUpdateStatus('SENT')} disabled={actionLoading} className="bg-blue-50 border border-blue-200 text-blue-700 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center hover:bg-blue-100 transition-all disabled:opacity-50">
                                        {t.quotes.detail.markSent}
                                    </button>
                                )}
                                {quote.status === 'SENT' && (
                                    <>
                                        <button onClick={() => handleUpdateStatus('ACCEPTED')} disabled={actionLoading} className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center hover:bg-emerald-100 transition-all disabled:opacity-50">
                                            {t.quotes.detail.accept}
                                        </button>
                                        <button onClick={() => handleUpdateStatus('REJECTED')} disabled={actionLoading} className="bg-red-50 border border-red-200 text-red-700 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center hover:bg-red-100 transition-all disabled:opacity-50">
                                            {t.quotes.detail.reject}
                                        </button>
                                        <button onClick={() => handleUpdateStatus('EXPIRED')} disabled={actionLoading} className="bg-gray-100 border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center hover:bg-gray-200 transition-all disabled:opacity-50">
                                            {t.quotes.detail.markExpired}
                                        </button>
                                    </>
                                )}
                                {quote.status !== 'REVISED' && quote.status !== 'CONVERTED' && (
                                    <button onClick={handleRevise} disabled={actionLoading} className="bg-amber-100 text-amber-700 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center hover:bg-amber-200 transition-all">
                                        <PlusCircle className="w-4 h-4 me-2" />
                                        {t.quotes.detail.revise}
                                    </button>
                                )}
                                {quote.status !== 'REVISED' && quote.status !== 'CONVERTED' && (
                                    <button onClick={handleConvertToOrder} disabled={actionLoading} className="bg-blue-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm flex items-center hover:bg-blue-700 shadow-sm transition-all">
                                        <ClipboardList className="w-4 h-4 me-2" />
                                        {t.quotes.detail.convertToOrder}
                                    </button>
                                )}
                            </>
                        }
                    />
                </div>
            </header>

            <div className="p-8 max-w-5xl mx-auto space-y-8 print:p-0 print:block">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 print:block print:w-full">
                    <div className="lg:col-span-2 space-y-8">
                        <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden print:shadow-none print:border-none">
                            <div className="p-6 border-b border-gray-100 print:px-0">
                                <h2 className="font-bold tracking-tight">{t.quotes.detail.proposedItems}</h2>
                            </div>
                                <div className="divide-y divide-gray-50">
                                    {quote.items.map((item: any) => (
                                        <div key={item.id} className="p-6 flex items-center justify-between print:px-0">
                                            <div className="flex items-center space-x-4 rtl:space-x-reverse">
                                                <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center">
                                                    <Package className="w-5 h-5 text-gray-400" />
                                                </div>
                                                <div>
                                                    <p className="font-bold text-sm tracking-tight">{item.product?.name || t.shared.item}</p>
                                                    <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-0.5">{formatMessage(t.quotes.detail.qtyLabel, { count: item.quantity })}</p>
                                                </div>
                                            </div>
                                            <div className="text-end">
                                                <p className="font-bold">{formatBDT(Number(item.unit_price) * item.quantity, { locale })}</p>
                                                <p className="text-[10px] text-gray-400 font-bold tracking-widest uppercase">{formatBDT(Number(item.unit_price), { locale })}{t.shared.perEa}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                        </div>

                        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 print:shadow-none print:border-none print:px-0">
                            <h2 className="font-bold tracking-tight mb-4">{t.quotes.detail.targetAccount}</h2>
                            {quote.customer ? (
                                <div className="bg-purple-50 border border-purple-100 rounded-xl p-4">
                                    <p className="font-bold text-lg text-purple-900">{quote.customer.name}</p>
                                    <p className="text-sm font-bold text-purple-600 uppercase tracking-widest mt-1">{quote.customer.phone}</p>
                                </div>
                            ) : (
                                <p className="text-sm font-medium text-gray-400">{t.shared.walkInDraft}</p>
                            )}
                        </div>
                        
                        {isProforma && (
                            <div className="rounded-lg border border-gray-200 bg-white p-4">
                                <p className="mb-3 text-xs font-semibold uppercase text-gray-500">
                                    {t.quotes.detail.terms.heading}
                                </p>
                                <dl className="grid grid-cols-2 gap-3">
                                    <ReadOnlyTerm label={t.quotes.detail.terms.currency} value={quote.currency} />
                                    <ReadOnlyTerm label={t.quotes.detail.terms.incoterm} value={quote.incoterm} />
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
                                        label={t.quotes.detail.terms.advance}
                                        value={quote.advance_percent ? `${quote.advance_percent}%` : null}
                                    />
                                    <ReadOnlyTerm
                                        label={t.quotes.detail.terms.paymentTerms}
                                        value={quote.payment_terms}
                                    />
                                </dl>
                            </div>
                        )}

                        {quote.notes && (
                            <div className="bg-yellow-50 text-yellow-800 p-6 rounded-lg text-sm font-medium italic">
                                &quot;{quote.notes}&quot;
                            </div>
                        )}
                    </div>

                    <div className="space-y-8">
                        <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden print:shadow-none print:border border-gray-400 print:mt-12">
                            <div className="p-6 border-b border-gray-100 bg-gray-900 text-white print:bg-white print:text-black print:border-b-2">
                                <h2 className="font-bold tracking-tight uppercase tracking-widest text-sm">{t.quotes.detail.quoteNetWrapUp}</h2>
                            </div>
                            <div className="p-6 space-y-4">
                                {/* VAT added on top of before-VAT prices is part of the
                                    total, so it is shown with it. */}
                                {Number(quote.vat_amount ?? 0) > 0.005 && (
                                    <div className="flex justify-between items-center text-sm text-gray-600">
                                        <span>{t.sales.invoice.vat}</span>
                                        <span>{formatBDT(Number(quote.vat_amount), { locale })}</span>
                                    </div>
                                )}
                                <div className="pt-2 flex justify-between items-center text-gray-900">
                                    <span className="text-xs font-bold uppercase tracking-widest text-gray-400">{t.quotes.detail.grandTotal}</span>
                                    <span className="font-bold text-3xl tracking-tight">{formatBDT(totalAmount, { locale })}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

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

export default function QuoteDetailsPage() {
    return (
        <Suspense>
            <QuoteDetailsPageContent />
        </Suspense>
    );
}
