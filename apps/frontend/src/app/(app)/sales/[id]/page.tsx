'use client';

import { useState, useEffect, useMemo, useRef, useCallback, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Printer, Save, Package, CreditCard, FileText, Pencil, Plus, Trash2, X, Search, User, Download } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT, toDatetimeLocal } from '@/lib/format';
import { printPOSReceipt } from '@/lib/pos-receipt-printer';
import Link from 'next/link';
import { useI18n, formatMessage } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { PageShell } from '@/components/ui';

interface EditItem {
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    priceAtSale: number;
}

interface EditPayment {
    paymentMethod: string;
    amount: number;
}

const PAYMENT_METHODS = ['CASH', 'CARD', 'BANK_TRANSFER', 'MOBILE_PAYMENT', 'OTHER'];
const SALE_STATUSES = ['COMPLETED', 'REFUNDED', 'PARTIAL_REFUND'];

// Backend classifies a payment for accounting by substring-matching the method
// string (bank/card/wallet/credit → "bank", else "cash") on the sale CREATE
// path. Keep the submitted value canonical per payment-method `type` so
// accounting classification stays correct if/when the update path adopts the
// same posting logic (mirrors sales/new/components/PaymentSection.tsx).
// Keyed by the `type` values stored on PaymentMethod (the backend
// PaymentMethodType enum values); legacy uppercase keys retained for rows
// written before the settings form was aligned to the enum.
const TYPE_TO_CANONICAL: Record<string, string> = {
    'Cash': 'Cash',
    'Mobile Wallet': 'Mobile Wallet',
    'Card': 'Card',
    'Bank': 'Bank',
    CASH: 'Cash',
    MOBILE_WALLET: 'Mobile Wallet',
    CARD: 'Card',
    BANK: 'Bank',
};
const canonicalFor = (type: string) => TYPE_TO_CANONICAL[type] ?? 'Cash';

function SaleDetailPageContent() {
    const { t, locale } = useI18n();
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const printRef = useRef<HTMLDivElement>(null);
    const [sale, setSale] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const isEditMode = searchParams.get('edit') === 'true';

    // Edit state
    const [editCustomerId, setEditCustomerId] = useState<string | null>(null);
    const [editStatus, setEditStatus] = useState('');
    const [editNote, setEditNote] = useState('');
    const [editSaleDate, setEditSaleDate] = useState('');
    const [editItems, setEditItems] = useState<EditItem[]>([]);
    const [editPayments, setEditPayments] = useState<EditPayment[]>([]);

    // Lookups
    const [customers, setCustomers] = useState<any[]>([]);
    const [products, setProducts] = useState<any[]>([]);
    const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
    const [productSearch, setProductSearch] = useState('');
    const [showProductDropdown, setShowProductDropdown] = useState(false);

    useEffect(() => {
        if (params.id) {
            loadSale(params.id as string);
        }
    }, [params.id]);

    // Load lookups when entering edit mode
    useEffect(() => {
        if (isEditMode) {
            api.getCustomers().then(setCustomers).catch(() => {});
            api.getProducts().then(setProducts).catch(() => {});
            api.getPaymentMethods().then(setPaymentMethods).catch(() => {});
        }
    }, [isEditMode]);

    // Populate edit state from sale
    useEffect(() => {
        if (isEditMode && sale) {
            setEditCustomerId(sale.customer_id || null);
            setEditStatus(sale.status);
            setEditNote(sale.note || '');
            setEditSaleDate(toDatetimeLocal(new Date(sale.sale_date ?? sale.created_at)));
            setEditItems(
                (sale.items || []).map((item: any) => ({
                    productId: item.product_id,
                    productName: item.product?.name || t.shared.unknown,
                    sku: item.product?.sku || '',
                    quantity: item.quantity,
                    priceAtSale: parseFloat(item.price_at_sale),
                }))
            );
            setEditPayments(
                (sale.payments || []).map((p: any) => ({
                    paymentMethod: p.payment_method,
                    amount: parseFloat(p.amount),
                }))
            );
        }
    }, [isEditMode, sale]);

    const loadSale = async (id: string) => {
        try {
            const data = await api.getSale(id);
            setSale(data);
        } catch (error) {
            console.error('Failed to load sale', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!sale || editItems.length === 0) return;
        setSaving(true);
        try {
            await api.updateSale(sale.id, {
                customerId: editCustomerId,
                status: editStatus,
                note: editNote,
                saleDate: editSaleDate ? new Date(editSaleDate).toISOString() : undefined,
                items: editItems.map(i => ({
                    productId: i.productId,
                    quantity: i.quantity,
                    priceAtSale: i.priceAtSale,
                })),
                payments: editPayments.map(p => ({
                    paymentMethod: p.paymentMethod,
                    amount: p.amount,
                })),
            });
            await loadSale(sale.id);
            router.push(`/sales/${sale.id}`);
        } catch (error) {
            console.error('Failed to save sale', error);
            alert(t.shared.errors.saveSale);
        } finally {
            setSaving(false);
        }
    };

    // Item helpers
    const addItem = (product: any) => {
        const existing = editItems.find(i => i.productId === product.id);
        if (existing) {
            setEditItems(editItems.map(i =>
                i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i
            ));
        } else {
            setEditItems([...editItems, {
                productId: product.id,
                productName: product.name,
                sku: product.sku || '',
                quantity: 1,
                priceAtSale: parseFloat(product.price),
            }]);
        }
        setProductSearch('');
        setShowProductDropdown(false);
    };

    const removeItem = (index: number) => {
        setEditItems(editItems.filter((_, i) => i !== index));
    };

    const updateItem = (index: number, field: 'quantity' | 'priceAtSale', value: number) => {
        setEditItems(editItems.map((item, i) => i === index ? { ...item, [field]: value } : item));
    };

    // Payment helpers
    const addPayment = () => {
        setEditPayments([...editPayments, { paymentMethod: 'CASH', amount: 0 }]);
    };

    const removePayment = (index: number) => {
        setEditPayments(editPayments.filter((_, i) => i !== index));
    };

    const updatePayment = (index: number, field: 'paymentMethod' | 'amount', value: string | number) => {
        setEditPayments(editPayments.map((p, i) => i === index ? { ...p, [field]: value } : p));
    };

    const editTotal = editItems.reduce((s, i) => s + i.quantity * i.priceAtSale, 0);
    const editPaid = editPayments.reduce((s, p) => s + p.amount, 0);

    // Payment method options for the edit-row selects: tenant-defined methods
    // (active, sorted by sort_order, show_on_entry first), submitted as the
    // canonical classification string with the method name as the label.
    // Falls back to the generic hardcoded list when no active methods are
    // defined. Any value already saved on the sale (legacy or custom) is kept
    // selectable so existing payments round-trip unchanged.
    const paymentMethodOptions = useMemo(() => {
        const active = paymentMethods.filter((m: any) => m.is_active);
        const sorted = active.slice().sort((a: any, b: any) => {
            const aVisible = a.show_on_entry ? 0 : 1;
            const bVisible = b.show_on_entry ? 0 : 1;
            if (aVisible !== bVisible) return aVisible - bVisible;
            return (a.sort_order ?? 0) - (b.sort_order ?? 0);
        });
        const rawOptions: { value: string; label: string }[] = sorted.length > 0
            ? sorted.map((m: any) => ({ value: canonicalFor(m.type), label: m.name }))
            : PAYMENT_METHODS.map(m => ({ value: m, label: m.replace(/_/g, ' ') }));

        // Multiple tenant-defined methods can share a `type` (e.g. two bank
        // accounts), which collapses to the same canonical value — dedupe so
        // the <select> doesn't offer indistinguishable duplicate options.
        const options: { value: string; label: string }[] = [];
        const seen = new Set<string>();
        for (const o of rawOptions) {
            if (seen.has(o.value)) continue;
            seen.add(o.value);
            options.push(o);
        }

        // Preserve any already-saved values not present among the fetched/derived options.
        const known = new Set(options.map(o => o.value));
        for (const p of editPayments) {
            if (p.paymentMethod && !known.has(p.paymentMethod)) {
                known.add(p.paymentMethod);
                options.push({ value: p.paymentMethod, label: p.paymentMethod.replace(/_/g, ' ') });
            }
        }
        return options;
    }, [paymentMethods, editPayments]);

    const filteredProducts = products.filter(p =>
        p.name?.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.sku?.toLowerCase().includes(productSearch.toLowerCase())
    ).slice(0, 8);

    const handlePrint = () => {
        const printContent = printRef.current;
        if (!printContent) return;

        const printWindow = window.open('', '_blank');
        if (!printWindow) return;

        printWindow.document.write(`
            <html>
            <head>
                <title>Sale ${sale?.serial_number}</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; color: #111; }
                    h1 { font-size: 24px; margin-bottom: 4px; }
                    .subtitle { color: #666; font-size: 12px; margin-bottom: 20px; }
                    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
                    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #eee; }
                    th { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #999; }
                    .total-row { font-weight: bold; border-top: 2px solid #333; }
                    .payment-section { margin-top: 20px; }
                    .note-section { margin-top: 20px; padding: 12px; background: #f9f9f9; border-radius: 8px; }
                    .footer { margin-top: 40px; text-align: center; color: #999; font-size: 11px; }
                </style>
            </head>
            <body>
                ${printContent.innerHTML}
                <div class="footer">{t.shared.print.thankYouPurchase}</div>
            </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.print();
    };

    const handlePOSPrint = async () => {
        if (!sale) return;

        const subtotal = (sale.items || []).reduce(
            (sum: number, item: any) => sum + item.quantity * parseFloat(item.price_at_sale),
            0
        );
        const total = parseFloat(sale.total_amount);
        const tax = total - subtotal;

        await printPOSReceipt({
            invoiceId: sale.id,
            serialNumber: sale.serial_number,
            date: new Date(sale.created_at).toLocaleString(),
            customerName: sale.customer?.name,
            items: (sale.items || []).map((item: any) => ({
                name: item.product?.name || t.shared.unknown,
                sku: item.product?.sku,
                quantity: item.quantity,
                unitPrice: parseFloat(item.price_at_sale),
            })),
            payments: (sale.payments || []).map((p: any) => ({
                method: p.payment_method,
                amount: parseFloat(p.amount),
            })),
            subtotal,
            tax: tax > 0 ? tax : 0,
            total,
            amountPaid: parseFloat(sale.amount_paid),
            note: sale.note,
        });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full bg-canvas">
                <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">{t.shared.loading.sale}</p>
            </div>
        );
    }

    if (!sale) {
        return (
            <div className="flex items-center justify-center h-full bg-canvas">
                <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">{t.shared.notFound.sale}</p>
            </div>
        );
    }

    return (
        <PageShell>
            <div className="max-w-4xl mx-auto space-y-6">
                {/* Edit Mode Banner */}
                {isEditMode && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-5 py-3 flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <Pencil className="w-4 h-4 text-amber-600" />
                            <span className="text-sm font-bold text-amber-800">
                                {t.shared.editMode.sale}
                            </span>
                        </div>
                        <div className="flex items-center space-x-3">
                            <button
                                onClick={handleSave}
                                disabled={saving || editItems.length === 0}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg font-bold text-xs uppercase tracking-widest shadow-sm flex items-center space-x-1.5 transition-all disabled:opacity-50"
                            >
                                <Save className="w-3.5 h-3.5" />
                                <span>{saving ? t.sales.detail.saving : t.common.saveChanges}</span>
                            </button>
                            <button
                                onClick={() => router.push(`/sales/${sale.id}`)}
                                className="text-xs font-bold uppercase tracking-widest text-amber-600 hover:text-amber-800 transition-colors flex items-center space-x-1"
                            >
                                <X className="w-3.5 h-3.5" />
                                <span>{t.common.cancel}</span>
                            </button>
                        </div>
                    </div>
                )}

                <PageHeader
                    title={sale.serial_number}
                    subtitle={new Date(sale.created_at).toLocaleString()}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.sales,
                        'sales',
                        [{ label: t.sales.list.title, href: routes.sales.list }],
                        sale.serial_number,
                    )}
                    actions={
                        !isEditMode ? (
                            <>
                                <button
                                    onClick={() => router.push(`/sales/${sale.id}?edit=true`)}
                                    className="bg-white hover:bg-amber-50 text-gray-700 hover:text-amber-700 border border-gray-200 hover:border-amber-300 px-5 py-2.5 rounded-xl text-xs font-semibold shadow-sm flex items-center space-x-2 transition-all"
                                >
                                    <Pencil className="w-4 h-4" />
                                    <span>{t.common.edit}</span>
                                </button>
                                <button
                                    onClick={handlePOSPrint}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-xs font-semibold shadow-md flex items-center space-x-2 transition-all"
                                >
                                    <Printer className="w-4 h-4" />
                                    <span>{t.sales.detail.posReceipt}</span>
                                </button>
                                <button
                                    onClick={handlePrint}
                                    className="bg-gray-900 hover:bg-gray-700 text-white px-5 py-2.5 rounded-xl text-xs font-semibold shadow-md flex items-center space-x-2 transition-all"
                                >
                                    <Printer className="w-4 h-4" />
                                    <span>{t.sales.detail.printPreview}</span>
                                </button>
                                <Link
                                    href={`/sales/${sale.id}/invoice`}
                                    className="bg-primary hover:bg-primary-hover text-white px-5 py-2.5 rounded-xl text-xs font-semibold shadow-md flex items-center space-x-2 transition-all"
                                >
                                    <Download className="w-4 h-4" />
                                    <span>{t.sales.detail.invoicePdf}</span>
                                </Link>
                            </>
                        ) : null
                    }
                />

                {/* Status & Summary (edit or view) */}
                {isEditMode ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-white p-4 rounded-lg shadow-sm">
                            <label className="text-xs font-medium text-gray-500 block mb-2">{t.common.status}</label>
                            <select
                                value={editStatus}
                                onChange={e => setEditStatus(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
                            >
                                {SALE_STATUSES.map(s => (
                                    <option key={s} value={s}>
                                        {t.shared.statuses.sale[s as keyof typeof t.shared.statuses.sale] ?? s.replace(/_/g, ' ')}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="bg-white p-4 rounded-lg shadow-sm">
                            <label className="text-xs font-medium text-gray-500 block mb-2">{t.common.date}</label>
                            <input
                                type="datetime-local"
                                value={editSaleDate}
                                onChange={e => setEditSaleDate(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
                            />
                        </div>
                        <div className="bg-white p-4 rounded-lg shadow-sm">
                            <label className="text-xs font-medium text-gray-500 block mb-2">{t.common.customer}</label>
                            <select
                                value={editCustomerId || ''}
                                onChange={e => setEditCustomerId(e.target.value || null)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
                            >
                                <option value="">{t.shared.walkInCustomer}</option>
                                {customers.map((c: any) => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="bg-white p-4 rounded-lg shadow-sm">
                            <span className="text-xs font-medium text-gray-500 block mb-1">{t.sales.detail.newTotal}</span>
                            <span className="text-xl font-bold text-blue-600">{formatBDT(editTotal, { locale })}</span>
                            {Math.abs(editPaid - editTotal) > 0.01 && (
                                <span className={`block text-xs font-bold mt-1 ${editPaid >= editTotal ? 'text-green-600' : 'text-red-500'}`}>
                                    {t.sales.columns.paid}: {formatBDT(editPaid, { locale })} ({editPaid >= editTotal ? t.shared.ok : formatMessage(t.shared.short, { amount: formatBDT(editTotal - editPaid, { locale }) })})
                                </span>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-4 gap-4">
                        <div className="bg-white p-4 rounded-lg shadow-sm">
                            <span className="text-xs font-medium text-gray-500 block mb-1">{t.common.status}</span>
                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${
                                sale.status === 'COMPLETED' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-700 border-gray-200'
                            }`}>
                                {t.shared.statuses.sale[sale.status as keyof typeof t.shared.statuses.sale] ?? sale.status}
                            </span>
                        </div>
                        <div className="bg-white p-4 rounded-lg shadow-sm">
                            <span className="text-xs font-medium text-gray-500 block mb-1">{t.common.total}</span>
                            <span className="text-xl font-bold text-blue-600">{formatBDT(parseFloat(sale.total_amount), { locale })}</span>
                        </div>
                        <div className="bg-white p-4 rounded-lg shadow-sm">
                            <span className="text-xs font-medium text-gray-500 block mb-1">{t.sales.columns.paid}</span>
                            <span className="text-xl font-bold text-gray-900">{formatBDT(parseFloat(sale.amount_paid), { locale })}</span>
                        </div>
                        <div className="bg-white p-4 rounded-lg shadow-sm">
                            <span className="text-xs font-medium text-gray-500 block mb-1">{t.sales.columns.items}</span>
                            <span className="text-xl font-bold text-gray-900">{sale.items?.length || 0}</span>
                        </div>
                    </div>
                )}

                {/* Print-ready content (hidden on screen, used for print) */}
                <div ref={printRef} className="hidden">
                    <h1>{sale.serial_number}</h1>
                    <div className="subtitle">
                        {formatMessage(t.shared.print.dateStatus, {
                            date: new Date(sale.created_at).toLocaleString(),
                            status: t.shared.statuses.sale[sale.status as keyof typeof t.shared.statuses.sale] ?? sale.status,
                        })}
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th>{t.shared.columns.product}</th>
                                <th>{t.shared.columns.qty}</th>
                                <th>{t.shared.columns.price}</th>
                                <th>{t.shared.columns.subtotal}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sale.items?.map((item: any) => (
                                <tr key={item.id}>
                                    <td>{item.product?.name || t.shared.unknown}</td>
                                    <td>{item.quantity}</td>
                                    <td>{formatBDT(parseFloat(item.price_at_sale), { locale })}</td>
                                    <td>{formatBDT(item.quantity * parseFloat(item.price_at_sale), { locale })}</td>
                                </tr>
                            ))}
                            <tr className="total-row">
                                <td colSpan={3}>{t.common.total}</td>
                                <td>{formatBDT(parseFloat(sale.total_amount), { locale })}</td>
                            </tr>
                        </tbody>
                    </table>
                    <div className="payment-section">
                        <strong>{t.shared.print.payments}</strong>
                        <ul>
                            {sale.payments?.map((p: any, i: number) => (
                                <li key={i}>{p.payment_method}: {formatBDT(parseFloat(p.amount), { locale })}</li>
                            ))}
                        </ul>
                    </div>
                    {sale.note && (
                        <div className="note-section">
                            <strong>{t.sales.detail.note}:</strong> {sale.note}
                        </div>
                    )}
                </div>

                {/* Items Section */}
                <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <div className="p-2 bg-blue-50 rounded-xl text-blue-600">
                                <Package className="w-5 h-5" />
                            </div>
                            <h2 className="text-lg font-bold tracking-tight">{t.sales.detail.lineItems}</h2>
                        </div>
                    </div>

                    {isEditMode ? (
                        <div className="p-6 space-y-4">
                            {/* Product search */}
                            <div className="relative">
                                <div className="flex items-center space-x-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                                    <Search className="w-4 h-4 text-gray-400" />
                                    <input
                                        type="text"
                                        placeholder={t.shared.form.searchProductsAdd}
                                        value={productSearch}
                                        onChange={e => { setProductSearch(e.target.value); setShowProductDropdown(true); }}
                                        onFocus={() => setShowProductDropdown(true)}
                                        className="flex-1 bg-transparent text-sm outline-none"
                                    />
                                </div>
                                {showProductDropdown && productSearch.length > 0 && filteredProducts.length > 0 && (
                                    <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                                        {filteredProducts.map(p => (
                                            <button
                                                key={p.id}
                                                onClick={() => addItem(p)}
                                                className="w-full text-left px-4 py-3 hover:bg-blue-50 flex items-center justify-between transition-colors"
                                            >
                                                <div>
                                                    <span className="text-sm font-bold">{p.name}</span>
                                                    <span className="text-xs text-gray-400 ml-2">{p.sku}</span>
                                                </div>
                                                <span className="text-sm font-bold text-blue-600">{formatBDT(parseFloat(p.price), { locale })}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Editable items list */}
                            {editItems.length === 0 ? (
                                <div className="text-center py-8 text-gray-300">
                                    <Package className="w-8 h-8 mx-auto mb-2" />
                                    <p className="text-xs font-bold uppercase tracking-widest">{t.shared.empty.noItemsSearch}</p>
                                </div>
                            ) : (
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-gray-100">
                                            <th className="text-left pb-2 text-xs font-medium text-gray-500">{t.shared.columns.product}</th>
                                            <th className="text-center pb-2 text-xs font-medium text-gray-500 w-24">{t.shared.columns.qty}</th>
                                            <th className="text-right pb-2 text-xs font-medium text-gray-500 w-32">{t.shared.columns.price}</th>
                                            <th className="text-right pb-2 text-xs font-medium text-gray-500 w-28">{t.shared.columns.subtotal}</th>
                                            <th className="w-10"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {editItems.map((item, idx) => (
                                            <tr key={idx}>
                                                <td className="py-3">
                                                    <span className="text-sm font-bold">{item.productName}</span>
                                                    <span className="text-xs text-gray-400 ml-2">{item.sku}</span>
                                                </td>
                                                <td className="py-3">
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        value={item.quantity}
                                                        onChange={e => updateItem(idx, 'quantity', Math.max(1, parseInt(e.target.value) || 1))}
                                                        className="w-full text-center bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                                                    />
                                                </td>
                                                <td className="py-3">
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step={0.01}
                                                        value={item.priceAtSale}
                                                        onChange={e => updateItem(idx, 'priceAtSale', parseFloat(e.target.value) || 0)}
                                                        className="w-full text-right bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                                                    />
                                                </td>
                                                <td className="py-3 text-right text-sm font-bold text-blue-600">
                                                    {formatBDT(item.quantity * item.priceAtSale, { locale })}
                                                </td>
                                                <td className="py-3 text-center">
                                                    <button
                                                        onClick={() => removeItem(idx)}
                                                        className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr className="border-t-2 border-gray-200">
                                            <td colSpan={3} className="pt-3 text-right text-sm font-semibold">{t.common.total}</td>
                                            <td className="pt-3 text-right text-xl font-bold text-blue-600">{formatBDT(editTotal, { locale })}</td>
                                            <td></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            )}
                        </div>
                    ) : (
                        <>
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-gray-100">
                                        <th className="text-left p-4 text-xs font-medium text-gray-500">{t.shared.columns.product}</th>
                                        <th className="text-left p-4 text-xs font-medium text-gray-500">{t.shared.columns.sku}</th>
                                        <th className="text-center p-4 text-xs font-medium text-gray-500">{t.shared.columns.qty}</th>
                                        <th className="text-right p-4 text-xs font-medium text-gray-500">{t.shared.columns.unitPrice}</th>
                                        <th className="text-right p-4 text-xs font-medium text-gray-500">{t.shared.columns.subtotal}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {sale.items?.map((item: any) => (
                                        <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                                            <td className="p-4">
                                                <div className="flex items-center space-x-3">
                                                    <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center">
                                                        {item.product?.image_url ? (
                                                            <img src={item.product.image_url} alt={item.product.name} className="w-full h-full object-cover rounded-xl" />
                                                        ) : (
                                                            <Package className="w-4 h-4 text-gray-200" />
                                                        )}
                                                    </div>
                                                    <span className="text-sm font-bold text-gray-900">{item.product?.name || t.shared.unknown}</span>
                                                </div>
                                            </td>
                                            <td className="p-4 text-xs font-bold text-gray-400 uppercase">{item.product?.sku || t.shared.notAvailable}</td>
                                            <td className="p-4 text-center text-sm font-bold">{item.quantity}</td>
                                            <td className="p-4 text-right text-sm font-bold text-gray-700">{formatBDT(parseFloat(item.price_at_sale), { locale })}</td>
                                            <td className="p-4 text-right text-sm font-bold text-blue-600">{formatBDT(item.quantity * parseFloat(item.price_at_sale), { locale })}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="border-t-2 border-gray-200">
                                        <td colSpan={4} className="p-4 text-right text-sm font-semibold">{t.common.total}</td>
                                        <td className="p-4 text-right text-xl font-bold text-blue-600">{formatBDT(parseFloat(sale.total_amount), { locale })}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </>
                    )}
                </div>

                {/* Payments Section */}
                <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <div className="p-2 bg-green-50 rounded-xl text-green-600">
                                <CreditCard className="w-5 h-5" />
                            </div>
                            <h2 className="text-lg font-bold tracking-tight">{t.sales.detail.paymentRecords}</h2>
                        </div>
                        {isEditMode && (
                            <button
                                onClick={addPayment}
                                className="flex items-center space-x-1.5 text-blue-600 hover:text-blue-800 font-bold text-xs uppercase tracking-widest transition-colors"
                            >
                                <Plus className="w-4 h-4" />
                                <span>{t.sales.detail.addPayment}</span>
                            </button>
                        )}
                    </div>

                    {isEditMode ? (
                        <div className="p-6 space-y-3">
                            {editPayments.length === 0 ? (
                                <div className="text-center py-6 text-gray-300">
                                    <CreditCard className="w-6 h-6 mx-auto mb-2" />
                                    <p className="text-xs font-bold uppercase tracking-widest">{t.shared.empty.noPayments}</p>
                                </div>
                            ) : (
                                editPayments.map((p, idx) => (
                                    <div key={idx} className="flex items-center space-x-3">
                                        <select
                                            value={p.paymentMethod}
                                            onChange={e => updatePayment(idx, 'paymentMethod', e.target.value)}
                                            className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-blue-500/20 w-48"
                                        >
                                            {paymentMethodOptions.map((m, i) => (
                                                <option key={`${m.value}-${i}`} value={m.value}>{m.label}</option>
                                            ))}
                                        </select>
                                        <div className="flex items-center bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 flex-1">
                                            <span className="text-sm text-gray-400 mr-1">$</span>
                                            <input
                                                type="number"
                                                min={0}
                                                step={0.01}
                                                value={p.amount}
                                                onChange={e => updatePayment(idx, 'amount', parseFloat(e.target.value) || 0)}
                                                className="w-full bg-transparent text-sm font-bold outline-none"
                                            />
                                        </div>
                                        <button
                                            onClick={() => removePayment(idx)}
                                            className="p-2 text-gray-300 hover:text-red-500 transition-colors"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))
                            )}
                            {editPayments.length > 0 && (
                                <div className="flex justify-end pt-2 border-t border-gray-100">
                                    <span className="text-sm font-bold">{t.sales.detail.totalPaid} <span className={editPaid >= editTotal ? 'text-green-600' : 'text-red-500'}>{formatBDT(editPaid, { locale })}</span></span>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-50">
                            {sale.payments?.map((payment: any, index: number) => (
                                <div key={index} className="p-4 flex items-center justify-between">
                                    <div className="flex items-center space-x-3">
                                        <span className="bg-gray-100 px-3 py-1 rounded-full text-[10px] font-semibold text-gray-600">
                                            {payment.payment_method}
                                        </span>
                                        <span className="text-xs text-gray-400">{new Date(payment.created_at).toLocaleString()}</span>
                                    </div>
                                    <span className="text-sm font-bold text-gray-900">{formatBDT(parseFloat(payment.amount), { locale })}</span>
                                </div>
                            ))}
                            {(!sale.payments || sale.payments.length === 0) && (
                                <div className="p-8 text-center text-gray-300">
                                    <p className="text-xs font-semibold">{t.shared.empty.noPaymentRecords}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Note Section */}
                <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-gray-100 flex items-center space-x-3">
                        <div className="p-2 bg-amber-50 rounded-xl text-amber-600">
                            <FileText className="w-5 h-5" />
                        </div>
                        <h2 className="text-lg font-bold tracking-tight">{t.sales.detail.note}</h2>
                    </div>
                    <div className="p-6">
                        {isEditMode ? (
                            <textarea
                                value={editNote}
                                onChange={(e) => setEditNote(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all shadow-sm resize-none"
                                rows={4}
                                placeholder={t.sales.detail.notePlaceholder}
                            />
                        ) : (
                            <p className="text-sm text-gray-600">
                                {sale.note || <span className="text-gray-300 italic">{t.shared.empty.noNote}</span>}
                            </p>
                        )}
                    </div>
                </div>

                {/* Bottom Save Bar in edit mode */}
                {isEditMode && (
                    <div className="flex justify-end space-x-3 pb-6">
                        <button
                            onClick={() => router.push(`/sales/${sale.id}`)}
                            className="px-6 py-3 bg-white border border-gray-200 text-gray-700 rounded-xl text-xs font-semibold hover:bg-gray-50 transition-all"
                        >
                            {t.common.cancel}
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving || editItems.length === 0}
                            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-md flex items-center space-x-2 transition-all disabled:opacity-50"
                        >
                            <Save className="w-4 h-4" />
                            <span>{saving ? t.sales.detail.saving : t.sales.detail.saveAllChanges}</span>
                        </button>
                    </div>
                )}
            </div>
        </PageShell>
    );
}

export default function SaleDetailPage() {
    return (
        <Suspense>
            <SaleDetailPageContent />
        </Suspense>
    );
}
