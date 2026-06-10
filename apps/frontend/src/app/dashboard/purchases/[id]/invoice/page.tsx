'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { api } from '@/lib/api';

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
    purchase: {
        id: string;
        purchase_number: string;
        created_at: string;
        notes: string | null;
        subtotal_amount: string;
        tax_amount: string;
        discount_amount: string;
        freight_amount: string;
        total_amount: string;
        store: { name: string } | null;
        supplier: {
            name: string;
            phone: string | null;
            email: string | null;
            address: string | null;
        } | null;
        items: {
            id: string;
            quantity: number;
            unit_cost: string;
            line_total: string;
            product: {
                name: string;
                sku: string | null;
            } | null;
        }[];
    };
    tenant: {
        name: string;
        brand_primary_color: string | null;
        brand_logo_url: string | null;
        brand_business_name: string | null;
        vat_registration_no: string | null;
        business_tin: string | null;
    } | null;
}

export default function PurchaseInvoicePage() {
    const params = useParams();
    const router = useRouter();
    const invoiceRef = useRef<HTMLDivElement>(null);
    const [data, setData] = useState<InvoiceData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!params.id) return;
        api.getPurchaseInvoice(params.id as string)
            .then((d: InvoiceData) => setData(d))
            .catch(() => setError('Failed to load invoice'))
            .finally(() => setLoading(false));
    }, [params.id]);

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

    const { purchase, tenant } = data;
    const businessName = tenant?.brand_business_name || tenant?.name || 'Business';
    const primaryColor = tenant?.brand_primary_color || '#059669';

    const subtotal = parseFloat(purchase.subtotal_amount);
    const tax = parseFloat(purchase.tax_amount);
    const discount = parseFloat(purchase.discount_amount);
    const freight = parseFloat(purchase.freight_amount);
    const total = parseFloat(purchase.total_amount);

    const hasAdjustments = tax > 0 || discount > 0 || freight > 0;

    return (
        <>
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
                        onClick={() => router.push('/dashboard/purchases')}
                        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back to Purchases
                    </button>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => window.print()}
                            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors shadow-sm"
                        >
                            <Printer className="h-4 w-4" />
                            Print
                        </button>
                        <button
                            onClick={() => window.print()}
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
                    {/* Header */}
                    <div className="px-8 py-6" style={{ backgroundColor: primaryColor }}>
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
                                    Purchase Order
                                </div>
                                <div className="text-white text-2xl font-black">{purchase.purchase_number}</div>
                                <div className="text-white/80 text-sm mt-1">{formatDateTime(purchase.created_at)}</div>
                            </div>
                        </div>
                    </div>

                    <div className="px-8 py-6 space-y-6">
                        {/* Buyer + Supplier */}
                        <div className="grid grid-cols-2 gap-8">
                            <div>
                                <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Buyer</div>
                                <div className="text-sm font-bold text-gray-900">{businessName}</div>
                                {purchase.store && (
                                    <div className="text-sm text-gray-500">{purchase.store.name}</div>
                                )}
                                {tenant?.vat_registration_no && (
                                    <div className="text-xs text-gray-500 mt-1">
                                        BIN: <span className="font-mono font-semibold">{tenant.vat_registration_no}</span>
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
                                    {purchase.supplier ? 'Supplier' : 'Supplier'}
                                </div>
                                {purchase.supplier ? (
                                    <>
                                        <div className="text-sm font-bold text-gray-900">{purchase.supplier.name}</div>
                                        {purchase.supplier.phone && (
                                            <div className="text-sm text-gray-500">{purchase.supplier.phone}</div>
                                        )}
                                        {purchase.supplier.email && (
                                            <div className="text-sm text-gray-500">{purchase.supplier.email}</div>
                                        )}
                                        {purchase.supplier.address && (
                                            <div className="text-sm text-gray-500">{purchase.supplier.address}</div>
                                        )}
                                    </>
                                ) : (
                                    <div className="text-sm text-gray-400 italic">No supplier linked</div>
                                )}
                            </div>
                        </div>

                        {/* Meta */}
                        <div className="grid grid-cols-3 gap-4 bg-gray-50 rounded-xl p-4 text-sm">
                            <div>
                                <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Purchase No.</div>
                                <div className="font-bold text-gray-800 mt-0.5">{purchase.purchase_number}</div>
                            </div>
                            <div>
                                <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Date</div>
                                <div className="font-bold text-gray-800 mt-0.5">{formatDate(purchase.created_at)}</div>
                            </div>
                            <div>
                                <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Branch</div>
                                <div className="font-bold text-gray-800 mt-0.5">{purchase.store?.name ?? '—'}</div>
                            </div>
                        </div>

                        {/* Line Items */}
                        <div>
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b-2 border-gray-200">
                                        <th className="text-left py-3 text-xs font-bold uppercase tracking-widest text-gray-500">Description</th>
                                        <th className="text-left py-3 text-xs font-bold uppercase tracking-widest text-gray-500">SKU</th>
                                        <th className="text-center py-3 text-xs font-bold uppercase tracking-widest text-gray-500">Qty</th>
                                        <th className="text-right py-3 text-xs font-bold uppercase tracking-widest text-gray-500">Unit Cost</th>
                                        <th className="text-right py-3 text-xs font-bold uppercase tracking-widest text-gray-500">Line Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {purchase.items.map((item) => (
                                        <tr key={item.id}>
                                            <td className="py-3 font-medium text-gray-900">{item.product?.name ?? 'Unknown Product'}</td>
                                            <td className="py-3 text-gray-400 font-mono text-xs">{item.product?.sku ?? '—'}</td>
                                            <td className="py-3 text-center text-gray-700">{item.quantity}</td>
                                            <td className="py-3 text-right text-gray-700">{formatBDT(parseFloat(item.unit_cost))}</td>
                                            <td className="py-3 text-right font-semibold text-gray-900">{formatBDT(parseFloat(item.line_total))}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Totals */}
                        <div className="flex justify-end">
                            <div className="w-72 space-y-2 text-sm">
                                <div className="flex justify-between text-gray-600">
                                    <span>Subtotal</span>
                                    <span>{formatBDT(subtotal)}</span>
                                </div>
                                {hasAdjustments && (
                                    <>
                                        {tax > 0 && (
                                            <div className="flex justify-between text-gray-600">
                                                <span>Tax</span>
                                                <span>{formatBDT(tax)}</span>
                                            </div>
                                        )}
                                        {freight > 0 && (
                                            <div className="flex justify-between text-gray-600">
                                                <span>Freight</span>
                                                <span>{formatBDT(freight)}</span>
                                            </div>
                                        )}
                                        {discount > 0 && (
                                            <div className="flex justify-between text-gray-600">
                                                <span>Discount</span>
                                                <span className="text-red-500">−{formatBDT(discount)}</span>
                                            </div>
                                        )}
                                    </>
                                )}
                                <div
                                    className="flex justify-between font-bold text-base pt-2 border-t-2 border-gray-200"
                                >
                                    <span>Total</span>
                                    <span style={{ color: primaryColor }}>{formatBDT(total)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Notes */}
                        {purchase.notes && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                                <span className="font-semibold">Note: </span>{purchase.notes}
                            </div>
                        )}

                        {/* Footer */}
                        <div className="text-center text-xs text-gray-400 pt-2 border-t border-gray-100">
                            Purchase Order · {businessName}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
