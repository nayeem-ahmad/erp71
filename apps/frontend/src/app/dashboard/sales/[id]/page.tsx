'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Printer, Save, Package, CreditCard, FileText, Pencil, Plus, Trash2, X, Search, User, Download } from 'lucide-react';
import { api } from '../../../../lib/api';
import { formatBDT } from '../../../../lib/format';
import { printPOSReceipt } from '../../../../lib/pos-receipt-printer';
import Link from 'next/link';

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

export default function SaleDetailPage() {
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
    const [editItems, setEditItems] = useState<EditItem[]>([]);
    const [editPayments, setEditPayments] = useState<EditPayment[]>([]);

    // Lookups
    const [customers, setCustomers] = useState<any[]>([]);
    const [products, setProducts] = useState<any[]>([]);
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
        }
    }, [isEditMode]);

    // Populate edit state from sale
    useEffect(() => {
        if (isEditMode && sale) {
            setEditCustomerId(sale.customer_id || null);
            setEditStatus(sale.status);
            setEditNote(sale.note || '');
            setEditItems(
                (sale.items || []).map((item: any) => ({
                    productId: item.product_id,
                    productName: item.product?.name || 'Unknown',
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
            router.push(`/dashboard/sales/${sale.id}`);
        } catch (error) {
            console.error('Failed to save sale', error);
            alert('Failed to save sale. Please check your changes and try again.');
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
                <div class="footer">Thank you for your purchase!</div>
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
                name: item.product?.name || 'Unknown',
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
            <div className="flex items-center justify-center h-full bg-[#f3f4f6]">
                <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">Loading sale...</p>
            </div>
        );
    }

    if (!sale) {
        return (
            <div className="flex items-center justify-center h-full bg-[#f3f4f6]">
                <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">Sale not found</p>
            </div>
        );
    }

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-4xl mx-auto space-y-6">
                {/* Edit Mode Banner */}
                {isEditMode && (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3 flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <Pencil className="w-4 h-4 text-amber-600" />
                            <span className="text-sm font-bold text-amber-800">
                                Edit Mode — Modify items, payments, customer, status, and note
                            </span>
                        </div>
                        <div className="flex items-center space-x-3">
                            <button
                                onClick={handleSave}
                                disabled={saving || editItems.length === 0}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg font-bold text-xs uppercase tracking-widest shadow-sm flex items-center space-x-1.5 transition-all disabled:opacity-50"
                            >
                                <Save className="w-3.5 h-3.5" />
                                <span>{saving ? 'Saving...' : 'Save Changes'}</span>
                            </button>
                            <button
                                onClick={() => router.push(`/dashboard/sales/${sale.id}`)}
                                className="text-xs font-bold uppercase tracking-widest text-amber-600 hover:text-amber-800 transition-colors flex items-center space-x-1"
                            >
                                <X className="w-3.5 h-3.5" />
                                <span>Cancel</span>
                            </button>
                        </div>
                    </div>
                )}

                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                        <button
                            onClick={() => router.push('/dashboard/sales')}
                            className="p-2 bg-white rounded-xl shadow-sm hover:shadow-md transition-all text-gray-400 hover:text-gray-900"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <div>
                            <h1 className="text-2xl font-black tracking-tight">{sale.serial_number}</h1>
                            <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                                {new Date(sale.created_at).toLocaleString()}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center space-x-3">
                        {!isEditMode && (
                            <>
                                <button
                                    onClick={() => router.push(`/dashboard/sales/${sale.id}?edit=true`)}
                                    className="bg-white hover:bg-amber-50 text-gray-700 hover:text-amber-700 border border-gray-200 hover:border-amber-300 px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-sm flex items-center space-x-2 transition-all hover:-translate-y-0.5"
                                >
                                    <Pencil className="w-4 h-4" />
                                    <span>Edit</span>
                                </button>
                                <button
                                    onClick={handlePOSPrint}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-md flex items-center space-x-2 transition-all hover:-translate-y-0.5"
                                >
                                    <Printer className="w-4 h-4" />
                                    <span>POS Receipt</span>
                                </button>
                                <button
                                    onClick={handlePrint}
                                    className="bg-gray-900 hover:bg-gray-700 text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-md flex items-center space-x-2 transition-all hover:-translate-y-0.5"
                                >
                                    <Printer className="w-4 h-4" />
                                    <span>Print Preview</span>
                                </button>
                                <Link
                                    href={`/dashboard/sales/${sale.id}/invoice`}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-md flex items-center space-x-2 transition-all hover:-translate-y-0.5"
                                >
                                    <Download className="w-4 h-4" />
                                    <span>Invoice PDF</span>
                                </Link>
                            </>
                        )}
                    </div>
                </div>

                {/* Status & Summary (edit or view) */}
                {isEditMode ? (
                    <div className="grid grid-cols-3 gap-4">
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-2">Status</label>
                            <select
                                value={editStatus}
                                onChange={e => setEditStatus(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
                            >
                                {SALE_STATUSES.map(s => (
                                    <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                                ))}
                            </select>
                        </div>
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-2">Customer</label>
                            <select
                                value={editCustomerId || ''}
                                onChange={e => setEditCustomerId(e.target.value || null)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
                            >
                                <option value="">Walk-in Customer</option>
                                {customers.map((c: any) => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">New Total</span>
                            <span className="text-xl font-black text-blue-600">{formatBDT(editTotal)}</span>
                            {Math.abs(editPaid - editTotal) > 0.01 && (
                                <span className={`block text-xs font-bold mt-1 ${editPaid >= editTotal ? 'text-green-600' : 'text-red-500'}`}>
                                    Paid: {formatBDT(editPaid)} ({editPaid >= editTotal ? 'OK' : `Short ${formatBDT(editTotal - editPaid)}`})
                                </span>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-4 gap-4">
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Status</span>
                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                                sale.status === 'COMPLETED' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-700 border-gray-200'
                            }`}>
                                {sale.status}
                            </span>
                        </div>
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Total</span>
                            <span className="text-xl font-black text-blue-600">{formatBDT(parseFloat(sale.total_amount))}</span>
                        </div>
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Paid</span>
                            <span className="text-xl font-black text-gray-900">{formatBDT(parseFloat(sale.amount_paid))}</span>
                        </div>
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Items</span>
                            <span className="text-xl font-black text-gray-900">{sale.items?.length || 0}</span>
                        </div>
                    </div>
                )}

                {/* Print-ready content (hidden on screen, used for print) */}
                <div ref={printRef} className="hidden">
                    <h1>{sale.serial_number}</h1>
                    <div className="subtitle">Date: {new Date(sale.created_at).toLocaleString()} | Status: {sale.status}</div>
                    <table>
                        <thead>
                            <tr>
                                <th>Product</th>
                                <th>Qty</th>
                                <th>Price</th>
                                <th>Subtotal</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sale.items?.map((item: any) => (
                                <tr key={item.id}>
                                    <td>{item.product?.name || 'Unknown'}</td>
                                    <td>{item.quantity}</td>
                                    <td>{formatBDT(parseFloat(item.price_at_sale))}</td>
                                    <td>{formatBDT(item.quantity * parseFloat(item.price_at_sale))}</td>
                                </tr>
                            ))}
                            <tr className="total-row">
                                <td colSpan={3}>Total</td>
                                <td>{formatBDT(parseFloat(sale.total_amount))}</td>
                            </tr>
                        </tbody>
                    </table>
                    <div className="payment-section">
                        <strong>Payments:</strong>
                        <ul>
                            {sale.payments?.map((p: any, i: number) => (
                                <li key={i}>{p.payment_method}: {formatBDT(parseFloat(p.amount))}</li>
                            ))}
                        </ul>
                    </div>
                    {sale.note && (
                        <div className="note-section">
                            <strong>Note:</strong> {sale.note}
                        </div>
                    )}
                </div>

                {/* Items Section */}
                <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <div className="p-2 bg-blue-50 rounded-xl text-blue-600">
                                <Package className="w-5 h-5" />
                            </div>
                            <h2 className="text-lg font-black tracking-tight">Line Items</h2>
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
                                        placeholder="Search products to add..."
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
                                                <span className="text-sm font-bold text-blue-600">{formatBDT(parseFloat(p.price))}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Editable items list */}
                            {editItems.length === 0 ? (
                                <div className="text-center py-8 text-gray-300">
                                    <Package className="w-8 h-8 mx-auto mb-2" />
                                    <p className="text-xs font-bold uppercase tracking-widest">Search and add products above</p>
                                </div>
                            ) : (
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-gray-100">
                                            <th className="text-left pb-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Product</th>
                                            <th className="text-center pb-2 text-[10px] font-black uppercase tracking-widest text-gray-400 w-24">Qty</th>
                                            <th className="text-right pb-2 text-[10px] font-black uppercase tracking-widest text-gray-400 w-32">Price</th>
                                            <th className="text-right pb-2 text-[10px] font-black uppercase tracking-widest text-gray-400 w-28">Subtotal</th>
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
                                                <td className="py-3 text-right text-sm font-black text-blue-600">
                                                    {formatBDT(item.quantity * item.priceAtSale)}
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
                                            <td colSpan={3} className="pt-3 text-right text-sm font-black uppercase tracking-widest">Total</td>
                                            <td className="pt-3 text-right text-xl font-black text-blue-600">{formatBDT(editTotal)}</td>
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
                                        <th className="text-left p-4 text-[10px] font-black uppercase tracking-widest text-gray-400">Product</th>
                                        <th className="text-left p-4 text-[10px] font-black uppercase tracking-widest text-gray-400">SKU</th>
                                        <th className="text-center p-4 text-[10px] font-black uppercase tracking-widest text-gray-400">Qty</th>
                                        <th className="text-right p-4 text-[10px] font-black uppercase tracking-widest text-gray-400">Unit Price</th>
                                        <th className="text-right p-4 text-[10px] font-black uppercase tracking-widest text-gray-400">Subtotal</th>
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
                                                    <span className="text-sm font-black text-gray-900">{item.product?.name || 'Unknown'}</span>
                                                </div>
                                            </td>
                                            <td className="p-4 text-xs font-bold text-gray-400 uppercase">{item.product?.sku || 'N/A'}</td>
                                            <td className="p-4 text-center text-sm font-black">{item.quantity}</td>
                                            <td className="p-4 text-right text-sm font-bold text-gray-700">{formatBDT(parseFloat(item.price_at_sale))}</td>
                                            <td className="p-4 text-right text-sm font-black text-blue-600">{formatBDT(item.quantity * parseFloat(item.price_at_sale))}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="border-t-2 border-gray-200">
                                        <td colSpan={4} className="p-4 text-right text-sm font-black uppercase tracking-widest">Total</td>
                                        <td className="p-4 text-right text-xl font-black text-blue-600">{formatBDT(parseFloat(sale.total_amount))}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </>
                    )}
                </div>

                {/* Payments Section */}
                <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <div className="p-2 bg-green-50 rounded-xl text-green-600">
                                <CreditCard className="w-5 h-5" />
                            </div>
                            <h2 className="text-lg font-black tracking-tight">Payment Records</h2>
                        </div>
                        {isEditMode && (
                            <button
                                onClick={addPayment}
                                className="flex items-center space-x-1.5 text-blue-600 hover:text-blue-800 font-bold text-xs uppercase tracking-widest transition-colors"
                            >
                                <Plus className="w-4 h-4" />
                                <span>Add Payment</span>
                            </button>
                        )}
                    </div>

                    {isEditMode ? (
                        <div className="p-6 space-y-3">
                            {editPayments.length === 0 ? (
                                <div className="text-center py-6 text-gray-300">
                                    <CreditCard className="w-6 h-6 mx-auto mb-2" />
                                    <p className="text-xs font-bold uppercase tracking-widest">No payments — click Add Payment above</p>
                                </div>
                            ) : (
                                editPayments.map((p, idx) => (
                                    <div key={idx} className="flex items-center space-x-3">
                                        <select
                                            value={p.paymentMethod}
                                            onChange={e => updatePayment(idx, 'paymentMethod', e.target.value)}
                                            className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-blue-500/20 w-48"
                                        >
                                            {PAYMENT_METHODS.map(m => (
                                                <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>
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
                                    <span className="text-sm font-black">Total Paid: <span className={editPaid >= editTotal ? 'text-green-600' : 'text-red-500'}>{formatBDT(editPaid)}</span></span>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-50">
                            {sale.payments?.map((payment: any, index: number) => (
                                <div key={index} className="p-4 flex items-center justify-between">
                                    <div className="flex items-center space-x-3">
                                        <span className="bg-gray-100 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest text-gray-600">
                                            {payment.payment_method}
                                        </span>
                                        <span className="text-xs text-gray-400">{new Date(payment.created_at).toLocaleString()}</span>
                                    </div>
                                    <span className="text-sm font-black text-gray-900">{formatBDT(parseFloat(payment.amount))}</span>
                                </div>
                            ))}
                            {(!sale.payments || sale.payments.length === 0) && (
                                <div className="p-8 text-center text-gray-300">
                                    <p className="text-xs font-black uppercase tracking-widest">No payment records</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Note Section */}
                <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-gray-100 flex items-center space-x-3">
                        <div className="p-2 bg-amber-50 rounded-xl text-amber-600">
                            <FileText className="w-5 h-5" />
                        </div>
                        <h2 className="text-lg font-black tracking-tight">Note</h2>
                    </div>
                    <div className="p-6">
                        {isEditMode ? (
                            <textarea
                                value={editNote}
                                onChange={(e) => setEditNote(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all shadow-sm resize-none"
                                rows={4}
                                placeholder="Add a note about this sale..."
                            />
                        ) : (
                            <p className="text-sm text-gray-600">
                                {sale.note || <span className="text-gray-300 italic">No note added</span>}
                            </p>
                        )}
                    </div>
                </div>

                {/* Bottom Save Bar in edit mode */}
                {isEditMode && (
                    <div className="flex justify-end space-x-3 pb-6">
                        <button
                            onClick={() => router.push(`/dashboard/sales/${sale.id}`)}
                            className="px-6 py-3 bg-white border border-gray-200 text-gray-700 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-gray-50 transition-all"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving || editItems.length === 0}
                            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-md flex items-center space-x-2 transition-all hover:-translate-y-0.5 disabled:opacity-50"
                        >
                            <Save className="w-4 h-4" />
                            <span>{saving ? 'Saving...' : 'Save All Changes'}</span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}