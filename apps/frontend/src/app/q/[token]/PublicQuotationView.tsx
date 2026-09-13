'use client';

import { useState } from 'react';
import { Download, Loader2, Printer } from 'lucide-react';
import { formatCurrency, formatDate as formatDisplayDate } from '@/lib/format';
import {
    headerCss,
    renderFooterHtml,
    renderHeaderHtml,
    type DeepPartial,
    type HeaderContext,
    type PrintHeaderConfig,
} from '@/lib/print';

type Item = { product_name: string; quantity: number; unit_price: number; line_total: number };

type BeneficiaryBank = {
    bank_name: string | null;
    bank_branch: string | null;
    account_name: string | null;
    account_number: string | null;
    routing_number: string | null;
    swift_code: string | null;
};

/**
 * The seller's letterhead, exactly as the backend serves it: the stored print
 * template plus only the {{tokens}} that template prints. Both halves are
 * optional — an older payload, or a tenant whose template could not be
 * resolved, simply has no letterhead and gets the plain header below.
 */
export type PublicLetterhead = {
    config?: DeepPartial<PrintHeaderConfig>;
    context?: {
        company_name?: string;
        store_name?: string;
        address?: string;
        vat_reg_no?: string;
        tin?: string;
    };
};

export type PublicQuotation = {
    quote_number: string;
    version: number;
    status: string;
    created_at: string;
    valid_until: string | null;
    customer_name: string;
    seller_name: string;
    notes: string | null;
    items: Item[];
    total_amount: number;

    doc_kind: string;
    currency: string;
    incoterm: string | null;
    port_of_loading: string | null;
    port_of_discharge: string | null;
    payment_terms: string | null;
    advance_percent: number | null;
    advance_amount: number | null;
    delivery_lead_time_days: number | null;
    country_of_origin: string | null;
    beneficiary_bank: BeneficiaryBank | null;
    letterhead?: PublicLetterhead | null;
};

const formatDate = (value: string | null) => formatDisplayDate(value, 'en');

/** One label/value row, rendered only when there is a value to show. */
function Term({ label, value }: { label: string; value: string | null }) {
    if (!value) return null;
    return (
        <div>
            <dt className="text-xs text-gray-500">{label}</dt>
            <dd className="text-sm text-gray-900">{value}</dd>
        </div>
    );
}

/** The pairs a section shows, with the empty ones dropped once for both renderers. */
const pairs = (entries: Array<[string, string | null]>) =>
    entries
        .filter((entry): entry is [string, string] => !!entry[1])
        .map(([label, value]) => ({ label, value }));

/**
 * Screen, paper and file all render from this one component.
 *
 * Print is offered first and is the faithful one: the browser's own renderer
 * draws the letterhead exactly as the tenant designed it, in whatever script
 * the document is written in. Download produces an actual `.pdf` file, which is
 * what a buyer forwarding this to their bank actually needs — see
 * `lib/public-quotation-pdf.ts` for what that path can and cannot draw.
 *
 * Money goes through `formatCurrency`, not `formatBDT`. This is the one page in
 * the app that can legitimately be denominated in something other than taka —
 * a proforma is written in the currency the buyer will remit — and printing a ৳
 * against a USD figure would misstate the amount owed rather than merely look
 * wrong. See docs/ui-design-guidelines.md.
 */
export default function PublicQuotationView({ quotation }: { quotation: PublicQuotation }) {
    const [downloading, setDownloading] = useState(false);
    const [downloadFailed, setDownloadFailed] = useState(false);

    const isProforma = quotation.doc_kind === 'PROFORMA';
    const title = isProforma ? 'Proforma Invoice' : 'Quotation';
    const money = (value: number) => formatCurrency(value, { currency: quotation.currency });
    const bank = quotation.beneficiary_bank;
    const documentNumber = `${quotation.quote_number}${quotation.version > 1 ? ` (v${quotation.version})` : ''}`;

    const termPairs = isProforma
        ? pairs([
              ['Incoterm', quotation.incoterm],
              ['Port of loading', quotation.port_of_loading],
              ['Port of discharge', quotation.port_of_discharge],
              ['Country of origin', quotation.country_of_origin],
              [
                  'Delivery',
                  quotation.delivery_lead_time_days
                      ? `${quotation.delivery_lead_time_days} days from order`
                      : null,
              ],
              ['Payment terms', quotation.payment_terms],
          ])
        : [];

    const bankPairs = bank
        ? pairs([
              ['Bank', bank.bank_name],
              ['Branch', bank.bank_branch],
              ['Account name', bank.account_name],
              ['Account number', bank.account_number],
              ['Routing number', bank.routing_number],
              ['SWIFT', bank.swift_code],
          ])
        : [];

    /*
     * The letterhead bands. Rendered by the same pure functions the app's print
     * windows use, so a tenant editing their template in settings changes this
     * page too — there is no second design to keep in step. Every value the
     * renderer emits is escaped or sanitised by it, which is what makes the
     * `dangerouslySetInnerHTML` below safe.
     */
    const letterhead = quotation.letterhead ?? null;
    const headerContext: HeaderContext = {
        docTitle: title,
        docNumber: documentNumber,
        docDate: formatDate(quotation.created_at),
        companyName: letterhead?.context?.company_name || quotation.seller_name,
        storeName: letterhead?.context?.store_name || quotation.seller_name,
        address: letterhead?.context?.address,
        vatRegNo: letterhead?.context?.vat_reg_no,
        tin: letterhead?.context?.tin,
    };
    const letterheadHtml = letterhead ? renderHeaderHtml(letterhead.config, headerContext, 'A4') : '';
    const letterheadFooterHtml = letterhead
        ? renderFooterHtml(letterhead.config, headerContext, 'A4')
        : '';
    const letterheadStyles = letterhead ? headerCss(letterhead.config, 'A4') : '';

    const handleDownload = async () => {
        setDownloading(true);
        setDownloadFailed(false);
        try {
            const { downloadQuotationPdf } = await import('@/lib/public-quotation-pdf');
            await downloadQuotationPdf({
                title,
                documentNumber,
                issuedOn: formatDate(quotation.created_at),
                validUntil: formatDate(quotation.valid_until),
                customerName: quotation.customer_name,
                currency: quotation.currency,
                items: quotation.items,
                totalLabel: 'Total',
                total: quotation.total_amount,
                advance:
                    quotation.advance_amount != null
                        ? {
                              label: `Advance due (${quotation.advance_percent}%)`,
                              amount: quotation.advance_amount,
                          }
                        : undefined,
                terms: termPairs,
                bank: bankPairs,
                notes: quotation.notes,
                letterhead: letterhead
                    ? { config: letterhead.config, context: headerContext }
                    : null,
                labels: {
                    preparedFor: 'Prepared for',
                    issued: 'Issued',
                    validUntil: 'Valid until',
                    item: 'Item',
                    quantity: 'Qty',
                    unitPrice: 'Unit price',
                    lineTotal: 'Total',
                    terms: 'Terms',
                    remitTo: 'Remit to',
                    notes: 'Notes',
                },
            });
        } catch {
            // No Toaster outside the app shell, and a failed download has to say
            // so somewhere — the Print button beside it still works.
            setDownloadFailed(true);
        } finally {
            setDownloading(false);
        }
    };

    return (
        <main className="min-h-screen bg-gray-50 p-3 md:p-4 print:bg-white print:p-0">
            <style
                dangerouslySetInnerHTML={{
                    __html: `${letterheadStyles}
                    /* The letterhead is laid out in mm for paper; a phone needs
                       the two halves of the band stacked rather than squeezed. */
                    @media (max-width: 640px) {
                        .p71-hd { flex-direction: column; align-items: flex-start; gap: 3mm; }
                        .p71-hd-doc { text-align: left; }
                        .p71-hd-logo { max-width: 40mm; }
                    }
                    @media print {
                        @page { size: A4 portrait; margin: 15mm; }
                    }`,
                }}
            />

            <div className="mx-auto max-w-3xl space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
                    <h1 className="text-sm font-semibold text-gray-900">
                        {title} {quotation.quote_number}
                    </h1>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => window.print()}
                            className="inline-flex min-h-touch items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                        >
                            <Printer className="h-4 w-4" />
                            Print
                        </button>
                        <button
                            onClick={handleDownload}
                            disabled={downloading}
                            className="inline-flex min-h-touch items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-60"
                        >
                            {downloading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Download className="h-4 w-4" />
                            )}
                            Download PDF
                        </button>
                    </div>
                </div>

                {downloadFailed && (
                    <p className="text-xs text-red-600 print:hidden" role="alert">
                        The PDF could not be prepared. Use Print to save this document instead.
                    </p>
                )}

                <div className="rounded-lg border border-gray-200 bg-white p-4 print:border-0 print:shadow-none">
                    {letterheadHtml ? (
                        <div dangerouslySetInnerHTML={{ __html: letterheadHtml }} />
                    ) : (
                        // No letterhead resolved: the seller's name is still the
                        // top of their document, so the page prints a plain one.
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-3">
                            <div>
                                <p className="text-base font-semibold text-gray-900">{quotation.seller_name}</p>
                                <p className="text-xs text-gray-500">{title}</p>
                            </div>
                            <div className="text-end text-xs text-gray-600">
                                <p className="font-semibold text-gray-900">{documentNumber}</p>
                                <p>Issued {formatDate(quotation.created_at)}</p>
                            </div>
                        </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <p className="text-xs text-gray-500">Prepared for</p>
                            <p className="text-sm font-semibold text-gray-900">
                                {quotation.customer_name || 'Customer'}
                            </p>
                        </div>
                        <div className="text-end text-xs text-gray-600">
                            <p>Issued {formatDate(quotation.created_at)}</p>
                            <p>Valid until {formatDate(quotation.valid_until)}</p>
                            {quotation.currency !== 'BDT' && (
                                <p className="font-medium text-gray-900">All amounts in {quotation.currency}</p>
                            )}
                        </div>
                    </div>

                    <div className="mt-3 overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100 text-start text-xs uppercase text-gray-500">
                                    <th className="py-2">Item</th>
                                    <th className="py-2 text-end">Qty</th>
                                    <th className="py-2 text-end">Unit price</th>
                                    <th className="py-2 text-end">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {quotation.items.map((item, index) => (
                                    <tr key={index} className="border-b border-gray-50">
                                        <td className="py-2 text-gray-900">{item.product_name}</td>
                                        <td className="py-2 text-end text-gray-700">{item.quantity}</td>
                                        <td className="py-2 text-end text-gray-700">{money(item.unit_price)}</td>
                                        <td className="py-2 text-end font-medium text-gray-900">
                                            {money(item.line_total)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="mt-3 flex justify-end">
                        <div className="w-full max-w-xs space-y-1 text-sm">
                            <div className="flex justify-between border-t border-gray-200 pt-2 font-semibold text-gray-900">
                                <span>Total</span>
                                <span>{money(quotation.total_amount)}</span>
                            </div>
                            {quotation.advance_amount != null && (
                                <div className="flex justify-between text-gray-700">
                                    <span>Advance due ({quotation.advance_percent}%)</span>
                                    <span className="font-medium">{money(quotation.advance_amount)}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {termPairs.length > 0 && (
                        <div className="mt-4 border-t border-gray-100 pt-3">
                            <p className="mb-2 text-xs font-semibold uppercase text-gray-500">Terms</p>
                            <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
                                {termPairs.map((term) => (
                                    <Term key={term.label} label={term.label} value={term.value} />
                                ))}
                            </dl>
                        </div>
                    )}

                    {bankPairs.length > 0 && (
                        <div className="mt-4 border-t border-gray-100 pt-3">
                            <p className="mb-2 text-xs font-semibold uppercase text-gray-500">Remit to</p>
                            <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
                                {bankPairs.map((entry) => (
                                    <Term key={entry.label} label={entry.label} value={entry.value} />
                                ))}
                            </dl>
                        </div>
                    )}

                    {quotation.notes && (
                        <p className="mt-4 border-t border-gray-100 pt-3 text-xs text-gray-600">{quotation.notes}</p>
                    )}

                    {letterheadFooterHtml && (
                        <div className="mt-4" dangerouslySetInnerHTML={{ __html: letterheadFooterHtml }} />
                    )}
                </div>
            </div>
        </main>
    );
}
