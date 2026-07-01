'use client';

import { useState, useEffect, Suspense } from 'react';
import { ArrowLeft, Package, FileText, ClipboardList, PlusCircle, Printer, Pencil, Save, X, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

interface EditQuoteItem {
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    unitPrice: number;
}

function QuoteDetailsPageContent() {
    const { t, locale } = useI18n();
    const { id } = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [quote, setQuote] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const isEditMode = searchParams.get('edit') === 'true';

    const [customers, setCustomers] = useState<any[]>([]);
    const [products, setProducts] = useState<any[]>([]);
    const [editCustomerId, setEditCustomerId] = useState<string>('');
    const [editValidUntil, setEditValidUntil] = useState('');
    const [editNotes, setEditNotes] = useState('');
    const [editItems, setEditItems] = useState<EditQuoteItem[]>([]);
    const [productSearch, setProductSearch] = useState('');
    const [showProductDropdown, setShowProductDropdown] = useState(false);

    useEffect(() => {
        loadQuote();
    }, [id]);

    useEffect(() => {
        if (isEditMode) {
            api.getCustomers().then(setCustomers).catch(() => {});
            api.getProducts().then(setProducts).catch(() => {});
        }
    }, [isEditMode]);

    useEffect(() => {
        if (isEditMode && quote) {
            setEditCustomerId(quote.customer_id || '');
            setEditValidUntil(quote.valid_until ? new Date(quote.valid_until).toISOString().slice(0, 10) : '');
            setEditNotes(quote.notes || '');
            setEditItems((quote.items || []).map((item: any) => ({
                productId: item.product_id,
                productName: item.product?.name || t.shared.item,
                sku: item.product?.sku || '',
                quantity: item.quantity,
                unitPrice: Number(item.unit_price),
            })));
        }
    }, [isEditMode, quote]);

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

    const filteredProducts = products.filter((product) =>
        product.name?.toLowerCase().includes(productSearch.toLowerCase()) ||
        product.sku?.toLowerCase().includes(productSearch.toLowerCase()),
    ).slice(0, 8);

    const addItem = (product: any) => {
        const existing = editItems.find((item) => item.productId === product.id);
        if (existing) {
            setEditItems(editItems.map((item) => (
                item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item
            )));
        } else {
            setEditItems([
                ...editItems,
                {
                    productId: product.id,
                    productName: product.name,
                    sku: product.sku || '',
                    quantity: 1,
                    unitPrice: parseFloat(product.price),
                },
            ]);
        }
        setProductSearch('');
        setShowProductDropdown(false);
    };

    const updateItem = (index: number, field: 'quantity' | 'unitPrice', value: number) => {
        setEditItems(editItems.map((item, itemIndex) => (
            itemIndex === index ? { ...item, [field]: value } : item
        )));
    };

    const removeItem = (index: number) => {
        setEditItems(editItems.filter((_, itemIndex) => itemIndex !== index));
    };

    const editTotalAmount = editItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

    const handleSave = async () => {
        if (!quote || editItems.length === 0) return;

        setSaving(true);
        try {
            await api.updateQuotation(quote.id, {
                customerId: editCustomerId || undefined,
                validUntil: editValidUntil || undefined,
                notes: editNotes || undefined,
                items: editItems.map((item) => ({
                    productId: item.productId,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                })),
                totalAmount: editTotalAmount,
            });
            await loadQuote();
            router.push(`/sales/quotes/${quote.id}`);
        } catch (error) {
            console.error('Failed to save quotation', error);
            alert(t.shared.errors.saveQuotation);
        } finally {
            setSaving(false);
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
        return <div className="p-8 font-bold text-rose-500">{t.shared.notFound.quote}</div>;
    }

    const totalAmount = Number(quote.total_amount);

    return (
        <div className="overflow-y-auto h-full bg-[#f9fafb]">
            {isEditMode && (
                <div className="px-8 pt-6">
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3 flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <Pencil className="w-4 h-4 text-amber-600" />
                            <span className="text-sm font-bold text-amber-800">
                                {t.shared.editMode.quote}
                            </span>
                        </div>
                        <div className="flex items-center space-x-3">
                            <button
                                onClick={handleSave}
                                disabled={saving || editItems.length === 0}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg font-bold text-xs uppercase tracking-widest shadow-sm flex items-center space-x-1.5 transition-all disabled:opacity-50"
                            >
                                <Save className="w-3.5 h-3.5" />
                                <span>{saving ? t.quotes.detail.saving : t.quotes.detail.saveChanges}</span>
                            </button>
                            <button
                                onClick={() => router.push(`/sales/quotes/${quote.id}`)}
                                className="text-xs font-bold uppercase tracking-widest text-amber-600 hover:text-amber-800 transition-colors flex items-center space-x-1"
                            >
                                <X className="w-3.5 h-3.5" />
                                <span>{t.common.cancel}</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
                <div className="px-8 py-6">
                    <Link href="/sales/quotes" className="flex items-center space-x-2 text-gray-500 hover:text-gray-900 transition-colors w-fit mb-4">
                        <ArrowLeft className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase tracking-widest">{t.quotes.detail.backToQuotes}</span>
                    </Link>
                    <div className="flex justify-between items-start">
                        <div>
                            <div className="flex items-center space-x-3">
                                <FileText className="w-8 h-8 text-purple-600" />
                                <div>
                                    <h1 className="text-lg font-bold tracking-tight text-gray-950">{quote.quote_number} <span className="text-lg bg-gray-100 text-gray-500 px-2 rounded-lg font-black ml-1">v{quote.version}</span></h1>
                                </div>
                            </div>
                            <div className="flex items-center space-x-3 mt-3">
                                <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-gray-100 text-gray-800`}>
                                    {formatMessage(t.quotes.detail.statusLabel, {
                                        status: t.shared.statuses.quote[quote.status as keyof typeof t.shared.statuses.quote] ?? quote.status,
                                    })}
                                </span>
                                <span className="text-sm font-bold text-gray-400">
                                    {quote.valid_until
                                        ? formatMessage(t.quotes.detail.expires, { date: formatDate(quote.valid_until, locale) })
                                        : formatMessage(t.quotes.detail.expires, { date: t.quotes.detail.expiresNever })}
                                </span>
                            </div>
                        </div>
                        
                        <div className="flex flex-wrap gap-3 justify-end">
                            <button onClick={() => window.print()} className="bg-white border border-gray-200 text-gray-900 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center hover:bg-gray-50 shadow-sm transition-all">
                                <Printer className="w-4 h-4 mr-2 text-gray-400" />
                                {t.quotes.detail.printPdf}
                            </button>
                            <button
                                onClick={() => router.push(`/sales/quotes/${quote.id}?edit=true`)}
                                className="bg-white border border-gray-200 text-gray-900 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center hover:bg-gray-50 shadow-sm transition-all"
                            >
                                <Pencil className="w-4 h-4 mr-2 text-gray-400" />
                                {t.quotes.detail.edit}
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={actionLoading}
                                className="bg-red-50 border border-red-100 text-red-600 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center hover:bg-red-100 transition-all disabled:opacity-50"
                            >
                                <Trash2 className="w-4 h-4 mr-2" />
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
                                    <PlusCircle className="w-4 h-4 mr-2" />
                                    {t.quotes.detail.revise}
                                </button>
                            )}
                            {quote.status !== 'REVISED' && quote.status !== 'CONVERTED' && (
                                <button onClick={handleConvertToOrder} disabled={actionLoading} className="bg-blue-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm flex items-center hover:bg-blue-700 shadow-xl shadow-blue-500/20 transition-all">
                                    <ClipboardList className="w-4 h-4 mr-2" />
                                    {t.quotes.detail.convertToOrder}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            <div className="p-8 max-w-5xl mx-auto space-y-8 print:p-0 print:block">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 print:block print:w-full">
                    <div className="lg:col-span-2 space-y-8">
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden print:shadow-none print:border-none">
                            <div className="p-6 border-b border-gray-100 print:px-0">
                                <h2 className="font-bold tracking-tight">{t.quotes.detail.proposedItems}</h2>
                            </div>
                            {isEditMode ? (
                                <div className="p-6 space-y-6 print:hidden">
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-2">{t.shared.form.addProducts}</label>
                                        <div className="relative">
                                            <div className="flex items-center space-x-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
                                                <Search className="w-4 h-4 text-gray-400" />
                                                <input
                                                    type="text"
                                                    placeholder={t.shared.form.searchProducts}
                                                    value={productSearch}
                                                    onChange={(e) => {
                                                        setProductSearch(e.target.value);
                                                        setShowProductDropdown(true);
                                                    }}
                                                    onFocus={() => setShowProductDropdown(true)}
                                                    className="flex-1 bg-transparent text-sm font-medium outline-none"
                                                />
                                            </div>
                                            {showProductDropdown && productSearch.length > 0 && filteredProducts.length > 0 && (
                                                <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                                                    {filteredProducts.map((product) => (
                                                        <button
                                                            key={product.id}
                                                            onClick={() => addItem(product)}
                                                            className="w-full text-left px-4 py-3 hover:bg-blue-50 flex items-center justify-between transition-colors"
                                                        >
                                                            <div>
                                                                <span className="text-sm font-bold">{product.name}</span>
                                                                <span className="text-xs text-gray-400 ml-2">{product.sku}</span>
                                                            </div>
                                                            <span className="text-sm font-bold text-blue-600">{formatBDT(parseFloat(product.price), { locale })}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-gray-100">
                                                <th className="text-left pb-2 text-xs font-medium text-gray-500">{t.shared.columns.product}</th>
                                                <th className="text-center pb-2 text-xs font-medium text-gray-500 w-24">{t.shared.columns.qty}</th>
                                                <th className="text-right pb-2 text-xs font-medium text-gray-500 w-32">{t.shared.columns.unitPrice}</th>
                                                <th className="text-right pb-2 text-xs font-medium text-gray-500 w-28">{t.shared.columns.subtotal}</th>
                                                <th className="w-10"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                            {editItems.map((item, index) => (
                                                <tr key={`${item.productId}-${index}`}>
                                                    <td className="py-3">
                                                        <span className="text-sm font-bold">{item.productName}</span>
                                                        <span className="text-xs text-gray-400 ml-2">{item.sku}</span>
                                                    </td>
                                                    <td className="py-3">
                                                        <input
                                                            type="number"
                                                            min={1}
                                                            value={item.quantity}
                                                            onChange={(e) => updateItem(index, 'quantity', Math.max(1, parseInt(e.target.value, 10) || 1))}
                                                            className="w-full text-center bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                                                        />
                                                    </td>
                                                    <td className="py-3">
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            step={0.01}
                                                            value={item.unitPrice}
                                                            onChange={(e) => updateItem(index, 'unitPrice', parseFloat(e.target.value) || 0)}
                                                            className="w-full text-right bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                                                        />
                                                    </td>
                                                    <td className="py-3 text-right text-sm font-black text-blue-600">
                                                        {formatBDT(item.quantity * item.unitPrice, { locale })}
                                                    </td>
                                                    <td className="py-3 text-center">
                                                        <button onClick={() => removeItem(index)} className="p-1 text-gray-300 hover:text-red-500 transition-colors">
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="divide-y divide-gray-50">
                                    {quote.items.map((item: any) => (
                                        <div key={item.id} className="p-6 flex items-center justify-between print:px-0">
                                            <div className="flex items-center space-x-4">
                                                <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center">
                                                    <Package className="w-5 h-5 text-gray-400" />
                                                </div>
                                                <div>
                                                    <p className="font-bold text-sm tracking-tight">{item.product?.name || t.shared.item}</p>
                                                    <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-0.5">{formatMessage(t.quotes.detail.qtyLabel, { count: item.quantity })}</p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className="font-black">{formatBDT(Number(item.unit_price) * item.quantity, { locale })}</p>
                                                <p className="text-[10px] text-gray-400 font-bold tracking-widest uppercase">{formatBDT(Number(item.unit_price), { locale })}{t.shared.perEa}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 print:shadow-none print:border-none print:px-0">
                            <h2 className="font-bold tracking-tight mb-4">{t.quotes.detail.targetAccount}</h2>
                            {isEditMode ? (
                                <div className="space-y-4 print:hidden">
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-2">{t.common.customer}</label>
                                        <select
                                            value={editCustomerId}
                                            onChange={(e) => setEditCustomerId(e.target.value)}
                                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
                                        >
                                            <option value="">{t.shared.walkInCustomer}</option>
                                            {customers.map((customer: any) => (
                                                <option key={customer.id} value={customer.id}>{customer.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-2">{t.shared.form.validUntil}</label>
                                        <input
                                            type="date"
                                            value={editValidUntil}
                                            onChange={(e) => setEditValidUntil(e.target.value)}
                                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-2">{t.shared.form.notes}</label>
                                        <textarea
                                            value={editNotes}
                                            onChange={(e) => setEditNotes(e.target.value)}
                                            rows={4}
                                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 resize-none"
                                        />
                                    </div>
                                </div>
                            ) : quote.customer ? (
                                <div className="bg-purple-50 border border-purple-100 rounded-xl p-4">
                                    <p className="font-black text-lg text-purple-900">{quote.customer.name}</p>
                                    <p className="text-sm font-bold text-purple-600 uppercase tracking-widest mt-1">{quote.customer.phone}</p>
                                </div>
                            ) : (
                                <p className="text-sm font-medium text-gray-400">{t.shared.walkInDraft}</p>
                            )}
                        </div>
                        
                        {!isEditMode && quote.notes && (
                            <div className="bg-yellow-50 text-yellow-800 p-6 rounded-2xl text-sm font-medium italic">
                                &quot;{quote.notes}&quot;
                            </div>
                        )}
                    </div>

                    <div className="space-y-8">
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden print:shadow-none print:border border-gray-400 print:mt-12">
                            <div className="p-6 border-b border-gray-100 bg-gray-900 text-white print:bg-white print:text-black print:border-b-2">
                                <h2 className="font-bold tracking-tight uppercase tracking-widest text-sm">{t.quotes.detail.quoteNetWrapUp}</h2>
                            </div>
                            <div className="p-6 space-y-4">
                                <div className="pt-2 flex justify-between items-center text-gray-900">
                                    <span className="text-xs font-bold uppercase tracking-widest text-gray-400">{t.quotes.detail.grandTotal}</span>
                                    <span className="font-black text-3xl tracking-tight">{formatBDT(isEditMode ? editTotalAmount : totalAmount, { locale })}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function QuoteDetailsPage() {
    return (
        <Suspense>
            <QuoteDetailsPageContent />
        </Suspense>
    );
}
