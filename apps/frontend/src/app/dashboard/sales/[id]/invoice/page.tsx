'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { api } from '../../../../../lib/api';

function formatBDT(amount: number) {
    return new Intl.NumberFormat('en-BD', {
        style: 'currency',
        currency: 'BDT',
        minimumFractionDigits: 2,
    }).format(amount);
}

function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-BD', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

function formatDateTime(dateStr: string) {
    return new Date(dateStr).toLocaleString('en-BD', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

interface InvoiceData {
    sale: {
        id: string;
        serial_number: string;
        created_at: string;
        status: string;
        total_amount: string;
        amount_paid: string;
        note: string | null;
        store: { name: string } | null;
        customer: {
            name: string;
            email: string | null;
            phone: string | null;
            address: string | null;
        } | null;
        items: {
            id: string;
            quantity: number;
            price_at_sale: string;
            product: {
                name: string;
                sku: string | null;
                vat_rate: number | null;
            } | null;
        }[];
        payments: {
            payment_method: string;
            amount: string;
        }[];
    };
    tenant: {
        name: string;
        default_vat_rate: number | null;
        vat_registration_no: string | null;
        business_tin: string | null;
        brand_primary_color: string | null;
        brand_logo_url: string | null;
        brand_business_name: string | null;
    } | null;
}

export default function InvoicePage() {
    const params = useParams();
    const router = useRouter();
    const invoiceRef = useRef<HTMLDivElement>(null);
    const [data, setData] = useState<InvoiceData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!params.id) return;
        api.getSaleInvoice(params.id as string)
            .then((d: InvoiceData) => setData(d))
            .catch(() => setError('Failed to load invoice'))
            .finally(() => setLoading(false));
    }, [params.id]);

    const handlePrint = () => {
        window.print();
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <p className="text-gray-400 text-sm">Loading invoice…</p>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="flex items-center justify-center h-full">
                <p className="text-red-500 text-sm">{error || 'Invoice not found'}</p>
            </div>
        );
    }

    const { sale, tenant } = data;
    const businessName = tenant?.brand_business_name || tenant?.name || 'Business';
    const primaryColor = tenant?.brand_primary_color || '#1d4ed8';

    // Calculate line totals and VAT
    const defaultVatRate = tenant?.default_vat_rate ?? 0;
    const lineItems = sale.items.map(item => {
        const unitPrice = parseFloat(item.price_at_sale);
        const qty = item.quantity;
        const vatRate = item.product?.vat_rate ?? defaultVatRate;
        const lineTotal = unitPrice * qty;
        const vatAmount = vatRate > 0 ? lineTotal * (vatRate / (100 + vatRate)) : 0;
        const baseAmount = lineTotal - vatAmount;
        return {
            ...item,
            unitPrice,
            lineTotal,
            vatRate,
            vatAmount,
            baseAmount,
        };
    });

    const subtotal = lineItems.reduce((s, i) => s + i.baseAmount, 0);
    const totalVat = lineItems.reduce((s, i) => s + i.vatAmount, 0);
    const grandTotal = parseFloat(sale.total_amount);
    const amountPaid = parseFloat(sale.amount_paid);
    const balance = amountPaid - grandTotal;

    const hasVat = totalVat > 0.005;

    return (
        <>
            {/* Print styles injected globally */}
            <style jsx global>{`
                @media print {
                    body * { visibility: hidden !important; }
                    #invoice-printable, #invoice-printable * { visibility: visible !important; }
                    #invoice-printable { position: fixed; top: 0; left: 0; width: 100%; margin: 0; padding: 24px; }
                    .no-print { display: none !important; }
                    @page { size: A4; margin: 15mm; }
                }
            `}</style>

            <div className="min-h-full bg-gray-100 p-4 sm:p-8">
                {/* Toolbar */}
                <div className="no-print max-w-3xl mx-auto mb-4 flex items-center justify-between">
                    <button
                        onClick={() => router.push(`/dashboard/sales/${sale.id}`)}
                        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back to Sale
                    </button>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handlePrint}
                            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors shadow-sm"
                        >
                            <Printer className="h-4 w-4" />
                            Print
                        </button>
                        <button
                            onClick={handlePrint}
                            className="flex items-center gap-2 px-4 py-2 text-white rounded-lg text-sm font-medium shadow-sm transition-colors"
                            style={{ backgroundColor: primaryColor }}
                        >
                            <Download className="h-4 w-4" />
                            Download PDF
                        </button>
                    </div>
                </div>

                {/* Invoice Document */}
                <div
                    id="invoice-printable"
                    ref={invoiceRef}
                    className="max-w-3xl mx-auto bg-white shadow-xl rounded-2xl overflow-hidden"
                >
                    {/* Header bar */}
                    <div
                        className="px-8 py-6"
                        style={{ backgroundColor: primaryColor }}
                    >
                        <div className="flex items-start justify-between">
                            <div>
                                {tenant?.brand_logo_url ? (
                                    <img
                                        src={tenant.brand_logo_url}
                                        alt={businessName}
                                        className="h-12 object-contain mb-2 brightness-0 invert"
                                    />
                                ) : null}
                                <h1 className="text-2xl font-bold text-white">{businessName}</h1>
                            </div>
                            <div className="text-right">
                                <div className="text-white/70 text-xs uppercase tracking-widest font-semibold mb-1">
                                    {hasVat ? 'VAT Invoice (Mushak 6.3)' : 'Invoice'}
                                </div>
                                <div className="text-white text-2xl font-black">{sale.serial_number}</div>
                                <div className="text-white/80 text-sm mt-1">{formatDateTime(sale.created_at)}</div>
                            </div>
                        </div>
                    </div>

                    <div className="px-8 py-6 space-y-6">
                        {/* Business info + Customer info */}
                        <div className="grid grid-cols-2 gap-8">
                            <div>
                                <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Seller</div>
                                <div className="text-sm font-bold text-gray-900">{businessName}</div>
                                {sale.store && (
                                    <div className="text-sm text-gray-500">{sale.store.name}</div>
                                )}
                                {tenant?.vat_registration_no && (
                                    <div className="text-xs text-gray-500 mt-1">
                                        BIN (VAT Reg): <span className="font-mono font-semibold">{tenant.vat_registration_no}</span>
                                    </div>
                                )}
                                {tenant?.business_tin && (
                                    <div className="text-xs text-gray-500">
                                        TIN: <span className="font-mono font-semibold">{tenant.business_tin}</span>
                                    </div>
                                )}
                            </div>
                            <div>
                                <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
                                    {sale.customer ? 'Bill To' : 'Walk-in Customer'}
                                </div>
                                {sale.customer ? (
                                    <>
                                        <div className="text-sm font-bold text-gray-900">{sale.customer.name}</div>
                                        {sale.customer.email && (
                                            <div className="text-sm text-gray-500">{sale.customer.email}</div>
                                        )}
                                        {sale.customer.phone && (
                                            <div className="text-sm text-gray-500">{sale.customer.phone}</div>
                                        )}
                                        {sale.customer.address && (
                                            <div className="text-sm text-gray-500">{sale.customer.address}</div>
                                        )}
                                    </>
                                ) : (
                                    <div className="text-sm text-gray-400 italic">Walk-in Customer</div>
                                )}
                            </div>
                        </div>

                        {/* Invoice meta */}
                        <div className="grid grid-cols-3 gap-4 bg-gray-50 rounded-xl p-4 text-sm">
                            <div>
                                <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Invoice No.</div>
                                <div className="font-bold text-gray-800 mt-0.5">{sale.serial_number}</div>
                            </div>
                            <div>
                                <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Date</div>
                                <div className="font-bold text-gray-800 mt-0.5">{formatDate(sale.created_at)}</div>
                            </div>
                            <div>
                                <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Status</div>
                                <div className="mt-0.5">
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                                        sale.status === 'COMPLETED'
                                            ? 'bg-green-100 text-green-700'
                                            : sale.status === 'REFUNDED'
                                                ? 'bg-red-100 text-red-700'
                                                : 'bg-gray-100 text-gray-700'
                                    }`}>
                                        {sale.status}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Line Items Table */}
                        <div>
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b-2 border-gray-200">
                                        <th className="text-left py-3 text-xs font-bold uppercase tracking-widest text-gray-500">Description</th>
                                        <th className="text-left py-3 text-xs font-bold uppercase tracking-widest text-gray-500">SKU</th>
                                        <th className="text-center py-3 text-xs font-bold uppercase tracking-widest text-gray-500">Qty</th>
                                        <th className="text-right py-3 text-xs font-bold uppercase tracking-widest text-gray-500">Unit Price</th>
                                        {hasVat && (
                                            <th className="text-right py-3 text-xs font-bold uppercase tracking-widest text-gray-500">VAT</th>
                                        )}
                                        <th className="text-right py-3 text-xs font-bold uppercase tracking-widest text-gray-500">Amount</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {lineItems.map(item => (
                                        <tr key={item.id}>
                                            <td className="py-3 font-medium text-gray-900">{item.product?.name ?? 'Unknown Product'}</td>
                                            <td className="py-3 text-gray-400 font-mono text-xs">{item.product?.sku ?? '—'}</td>
                                            <td className="py-3 text-center text-gray-700">{item.quantity}</td>
                                            <td className="py-3 text-right text-gray-700">{formatBDT(item.unitPrice)}</td>
                                            {hasVat && (
                                                <td className="py-3 text-right text-gray-500 text-xs">
                                                    {item.vatRate > 0
                                                        ? `${item.vatRate}% / ${formatBDT(item.vatAmount)}`
                                                        : '—'}
                                                </td>
                                            )}
                                            <td className="py-3 text-right font-semibold text-gray-900">{formatBDT(item.lineTotal)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Totals */}
                        <div className="flex justify-end">
                            <div className="w-72 space-y-2 text-sm">
                                {hasVat && (
                                    <>
                                        <div className="flex justify-between text-gray-600">
                                            <span>Subtotal (excl. VAT)</span>
                                            <span>{formatBDT(subtotal)}</span>
                                        </div>
                                        <div className="flex justify-between text-gray-600">
                                            <span>VAT</span>
                                            <span>{formatBDT(totalVat)}</span>
                                        </div>
                                    </>
                                )}
                                <div
                                    className="flex justify-between font-bold text-base pt-2 border-t-2 border-gray-200"
                                >
                                    <span>Total</span>
                                    <span style={{ color: primaryColor }}>{formatBDT(grandTotal)}</span>
                                </div>
                                <div className="flex justify-between text-gray-600">
                                    <span>Amount Paid</span>
                                    <span>{formatBDT(amountPaid)}</span>
                                </div>
                                {Math.abs(balance) > 0.005 && (
                                    <div className={`flex justify-between font-bold ${balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        <span>{balance >= 0 ? 'Change' : 'Balance Due'}</span>
                                        <span>{formatBDT(Math.abs(balance))}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Payment methods */}
                        {sale.payments.length > 0 && (
                            <div>
                                <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Payment Details</div>
                                <div className="flex flex-wrap gap-2">
                                    {sale.payments.map((p, i) => (
                                        <div key={i} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs">
                                            <span className="font-semibold text-gray-700">{p.payment_method.replace(/_/g, ' ')}</span>
                                            <span className="text-gray-500 ml-2">{formatBDT(parseFloat(p.amount))}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Note */}
                        {sale.note && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                                <span className="font-semibold">Note: </span>{sale.note}
                            </div>
                        )}

                        {/* NBR compliance footer */}
                        {hasVat && (
                            <div className="border-t border-dashed border-gray-200 pt-4 text-xs text-gray-400 space-y-1">
                                <p className="font-semibold text-gray-500">NBR VAT Compliance (Mushak 6.3)</p>
                                {tenant?.vat_registration_no && (
                                    <p>Supplier BIN: {tenant.vat_registration_no}</p>
                                )}
                                <p>VAT calculated on the taxable value as per the VAT and Supplementary Duty Act 2012.</p>
                            </div>
                        )}

                        {/* Footer */}
                        <div className="text-center text-xs text-gray-400 pt-2 border-t border-gray-100">
                            Thank you for your business · {businessName}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
