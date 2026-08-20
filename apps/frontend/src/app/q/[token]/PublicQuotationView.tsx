'use client';

import { Printer } from 'lucide-react';
import { formatBDT } from '@/lib/format';

type Item = { product_name: string; quantity: number; unit_price: number; line_total: number };

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
};

const formatDate = (value: string | null) =>
    value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/**
 * Print rather than a server-generated PDF: the internal quotation page already
 * produces its PDF through the browser print dialog, so this reuses the same
 * mechanism instead of adding a rendering dependency for one page.
 */
export default function PublicQuotationView({ quotation }: { quotation: PublicQuotation }) {
    return (
        <main className="min-h-screen bg-gray-50 p-3 md:p-4 print:bg-white print:p-0">
            <div className="mx-auto max-w-3xl space-y-4">
                <div className="flex items-center justify-between print:hidden">
                    <h1 className="text-sm font-semibold text-gray-900">Quotation {quotation.quote_number}</h1>
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
                            <p className="text-xs text-gray-500">Quotation for {quotation.customer_name || 'Customer'}</p>
                        </div>
                        <div className="text-end text-xs text-gray-600">
                            <p className="font-semibold text-gray-900">
                                {quotation.quote_number}
                                {quotation.version > 1 ? ` (v${quotation.version})` : ''}
                            </p>
                            <p>Issued {formatDate(quotation.created_at)}</p>
                            <p>Valid until {formatDate(quotation.valid_until)}</p>
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
                                        <td className="py-2 text-end text-gray-700">{formatBDT(item.unit_price)}</td>
                                        <td className="py-2 text-end font-medium text-gray-900">
                                            {formatBDT(item.line_total)}
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
                                <span>{formatBDT(quotation.total_amount)}</span>
                            </div>
                        </div>
                    </div>

                    {quotation.notes && (
                        <p className="mt-4 border-t border-gray-100 pt-3 text-xs text-gray-600">{quotation.notes}</p>
                    )}
                </div>
            </div>
        </main>
    );
}
