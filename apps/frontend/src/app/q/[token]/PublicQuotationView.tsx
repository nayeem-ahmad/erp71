'use client';

import { Printer } from 'lucide-react';
import { formatCurrency } from '@/lib/format';

type Item = { product_name: string; quantity: number; unit_price: number; line_total: number };

type BeneficiaryBank = {
    bank_name: string | null;
    bank_branch: string | null;
    account_name: string | null;
    account_number: string | null;
    routing_number: string | null;
    swift_code: string | null;
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
};

const formatDate = (value: string | null) =>
    value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

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

/**
 * Print rather than a server-generated PDF: the internal quotation page already
 * produces its PDF through the browser print dialog, so this reuses the same
 * mechanism instead of adding a rendering dependency for one page.
 *
 * Money goes through `formatCurrency`, not `formatBDT`. This is the one page in
 * the app that can legitimately be denominated in something other than taka —
 * a proforma is written in the currency the buyer will remit — and printing a ৳
 * against a USD figure would misstate the amount owed rather than merely look
 * wrong. See docs/ui-design-guidelines.md.
 */
export default function PublicQuotationView({ quotation }: { quotation: PublicQuotation }) {
    const isProforma = quotation.doc_kind === 'PROFORMA';
    const title = isProforma ? 'Proforma Invoice' : 'Quotation';
    const money = (value: number) => formatCurrency(value, { currency: quotation.currency });
    const bank = quotation.beneficiary_bank;

    const hasTerms =
        isProforma &&
        Boolean(
            quotation.incoterm ||
                quotation.port_of_loading ||
                quotation.port_of_discharge ||
                quotation.payment_terms ||
                quotation.delivery_lead_time_days ||
                quotation.country_of_origin,
        );

    return (
        <main className="min-h-screen bg-gray-50 p-3 md:p-4 print:bg-white print:p-0">
            <div className="mx-auto max-w-3xl space-y-4">
                <div className="flex items-center justify-between print:hidden">
                    <h1 className="text-sm font-semibold text-gray-900">
                        {title} {quotation.quote_number}
                    </h1>
                    <button
                        onClick={() => window.print()}
                        className="inline-flex min-h-touch items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                    >
                        <Printer className="h-4 w-4" />
                        Print / Save as PDF
                    </button>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-4 print:border-0 print:shadow-none">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-3">
                        <div>
                            <p className="text-base font-semibold text-gray-900">{quotation.seller_name}</p>
                            <p className="text-xs text-gray-500">
                                {title} for {quotation.customer_name || 'Customer'}
                            </p>
                        </div>
                        <div className="text-right text-xs text-gray-600">
                            <p className="font-semibold text-gray-900">
                                {quotation.quote_number}
                                {quotation.version > 1 ? ` (v${quotation.version})` : ''}
                            </p>
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
                                <tr className="border-b border-gray-100 text-left text-xs uppercase text-gray-500">
                                    <th className="py-2">Item</th>
                                    <th className="py-2 text-right">Qty</th>
                                    <th className="py-2 text-right">Unit price</th>
                                    <th className="py-2 text-right">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {quotation.items.map((item, index) => (
                                    <tr key={index} className="border-b border-gray-50">
                                        <td className="py-2 text-gray-900">{item.product_name}</td>
                                        <td className="py-2 text-right text-gray-700">{item.quantity}</td>
                                        <td className="py-2 text-right text-gray-700">{money(item.unit_price)}</td>
                                        <td className="py-2 text-right font-medium text-gray-900">
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

                    {hasTerms && (
                        <div className="mt-4 border-t border-gray-100 pt-3">
                            <p className="mb-2 text-xs font-semibold uppercase text-gray-500">Terms</p>
                            <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
                                <Term label="Incoterm" value={quotation.incoterm} />
                                <Term label="Port of loading" value={quotation.port_of_loading} />
                                <Term label="Port of discharge" value={quotation.port_of_discharge} />
                                <Term label="Country of origin" value={quotation.country_of_origin} />
                                <Term
                                    label="Delivery"
                                    value={
                                        quotation.delivery_lead_time_days
                                            ? `${quotation.delivery_lead_time_days} days from order`
                                            : null
                                    }
                                />
                                <Term label="Payment terms" value={quotation.payment_terms} />
                            </dl>
                        </div>
                    )}

                    {bank && (
                        <div className="mt-4 border-t border-gray-100 pt-3">
                            <p className="mb-2 text-xs font-semibold uppercase text-gray-500">Remit to</p>
                            <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
                                <Term label="Bank" value={bank.bank_name} />
                                <Term label="Branch" value={bank.bank_branch} />
                                <Term label="Account name" value={bank.account_name} />
                                <Term label="Account number" value={bank.account_number} />
                                <Term label="Routing number" value={bank.routing_number} />
                                <Term label="SWIFT" value={bank.swift_code} />
                            </dl>
                        </div>
                    )}

                    {quotation.notes && (
                        <p className="mt-4 border-t border-gray-100 pt-3 text-xs text-gray-600">{quotation.notes}</p>
                    )}
                </div>
            </div>
        </main>
    );
}
