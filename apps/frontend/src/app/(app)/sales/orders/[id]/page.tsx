'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { ArrowLeft, Package, DollarSign, Printer, Save, Pencil, X, Trash2, Search, PackageCheck } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

interface EditItem {
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    priceAtOrder: number;
}

function formatDateForInput(value?: string | Date | null) {
    if (!value) return '';

    if (typeof value === 'string') {
        const dateOnlyMatch = value.match(/^\d{4}-\d{2}-\d{2}/);
        if (dateOnlyMatch) {
            return dateOnlyMatch[0];
        }
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return '';
    }

    return parsed.toISOString().split('T')[0];
}

function OrderDetailsPageContent() {
    const { t, locale } = useI18n();
    const { id } = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const printRef = useRef<HTMLDivElement>(null);
    const [order, setOrder] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [depositModalOpen, setDepositModalOpen] = useState(false);
    const [depositAmount, setDepositAmount] = useState('');
    const [statusUpdating, setStatusUpdating] = useState(false);
    const isEditMode = searchParams.get('edit') === 'true';

    // Edit state
    const [editCustomerId, setEditCustomerId] = useState('');
    const [editDeliveryDate, setEditDeliveryDate] = useState('');
    const [editItems, setEditItems] = useState<EditItem[]>([]);
    const [customers, setCustomers] = useState<any[]>([]);
    const [products, setProducts] = useState<any[]>([]);
    const [productSearch, setProductSearch] = useState('');
    const [showProductDropdown, setShowProductDropdown] = useState(false);

    useEffect(() => {
        loadOrder();
    }, [id]);

    useEffect(() => {
        if (isEditMode) {
            api.getCustomers().then(setCustomers).catch(() => {});
            api.getProducts().then(setProducts).catch(() => {});
        }
    }, [isEditMode]);

    useEffect(() => {
        if (isEditMode && order) {
            setEditCustomerId(order.customer_id || '');
            setEditDeliveryDate(formatDateForInput(order.delivery_date));
            setEditItems(
                (order.items || []).map((item: any) => ({
                    productId: item.product_id,
                    productName: item.product?.name || t.shared.unknown,
                    sku: item.product?.sku || '',
                    quantity: item.quantity,
                    priceAtOrder: parseFloat(item.price_at_order),
                })),
            );
        }
    }, [isEditMode, order]);

    const loadOrder = async () => {
        try {
            const data = await api.getOrder(id as string);
            setOrder(data);
        } catch (error) {
            console.error('Failed to load order', error);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateStatus = async (newStatus: string) => {
        setStatusUpdating(true);
        try {
            await api.updateOrderStatus(id as string, newStatus);
            await loadOrder();
        } catch (error: any) {
            alert(formatMessage(t.shared.errors.updateStatus, { message: error.message || t.shared.errors.updateStatusStock }));
        } finally {
            setStatusUpdating(false);
        }
    };

    const handleAddDeposit = async () => {
        const amt = parseFloat(depositAmount);
        if (!amt || amt <= 0) return;
        setDepositModalOpen(false);
        try {
            await api.addOrderDeposit(id as string, { amount: amt, paymentMethod: 'CASH' });
            await loadOrder();
            setDepositAmount('');
        } catch (err: any) {
            alert(formatMessage(t.shared.errors.addDeposit, { message: err.message }));
        }
    };

    // Edit helpers
    const editTotal = editItems.reduce((sum, i) => sum + i.quantity * i.priceAtOrder, 0);

    const filteredProducts = products
        .filter(
            (p) =>
                p.name?.toLowerCase().includes(productSearch.toLowerCase()) ||
                p.sku?.toLowerCase().includes(productSearch.toLowerCase()),
        )
        .slice(0, 8);

    const addItem = (product: any) => {
        const existing = editItems.findIndex((i) => i.productId === product.id);
        if (existing >= 0) {
            setEditItems(editItems.map((i, idx) => (idx === existing ? { ...i, quantity: i.quantity + 1 } : i)));
        } else {
            setEditItems([
                ...editItems,
                {
                    productId: product.id,
                    productName: product.name,
                    sku: product.sku || '',
                    quantity: 1,
                    priceAtOrder: parseFloat(product.price),
                },
            ]);
        }
        setProductSearch('');
        setShowProductDropdown(false);
    };

    const removeItem = (index: number) => setEditItems(editItems.filter((_, i) => i !== index));

    const updateItem = (index: number, field: 'quantity' | 'priceAtOrder', value: number) => {
        setEditItems(editItems.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
    };

    const handleSave = async () => {
        if (editItems.length === 0) {
            alert(t.shared.form.atLeastOneItemRequired);
            return;
        }
        setSaving(true);
        try {
            await api.updateOrder(id as string, {
                customerId: editCustomerId || null,
                deliveryDate: editDeliveryDate || null,
                items: editItems.map((i) => ({
                    productId: i.productId,
                    quantity: i.quantity,
                    priceAtOrder: i.priceAtOrder,
                })),
                totalAmount: editTotal,
            });
            await loadOrder();
            router.push(`/sales/orders/${id}`);
        } catch (error: any) {
            alert(formatMessage(t.shared.errors.saveOrder, { message: error.message || t.common.error }));
        } finally {
            setSaving(false);
        }
    };

    const handlePrint = () => {
        const printContent = printRef.current;
        if (!printContent) return;
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;
        printWindow.document.write(`
            <html>
            <head>
                <title>Order ${order?.order_number}</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; color: #111; }
                    h1 { font-size: 24px; margin-bottom: 4px; }
                    .subtitle { color: #666; font-size: 12px; margin-bottom: 20px; }
                    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
                    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #eee; }
                    th { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #999; }
                    .total-row { font-weight: bold; border-top: 2px solid #333; }
                    .section { margin-top: 20px; padding: 12px; background: #f9f9f9; border-radius: 8px; }
                    .footer { margin-top: 40px; text-align: center; color: #999; font-size: 11px; }
                </style>
            </head>
            <body>
                ${printContent.innerHTML}
                <div class="footer">{t.shared.print.salesOrder}</div>
            </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.print();
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full bg-[#f3f4f6]">
                <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">{t.shared.loading.order}</p>
            </div>
        );
    }

    if (!order) {
        return (
            <div className="flex items-center justify-center h-full bg-[#f3f4f6]">
                <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">{t.shared.notFound.order}</p>
            </div>
        );
    }

    const totalAmount = Number(order.total_amount);
    const amountPaid = Number(order.amount_paid);
    const amountDue = totalAmount - amountPaid;
    const canEdit = order.status === 'DRAFT' || order.status === 'CONFIRMED';

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="max-w-5xl mx-auto space-y-6">
                {/* Edit Mode Banner */}
                {isEditMode && (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3 flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <Pencil className="w-4 h-4 text-amber-600" />
                            <span className="text-sm font-bold text-amber-800">{t.shared.editMode.order}</span>
                        </div>
                        <div className="flex items-center space-x-3">
                            <button
                                onClick={handleSave}
                                disabled={saving || editItems.length === 0}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg font-bold text-xs uppercase tracking-widest shadow-sm flex items-center space-x-1.5 transition-all disabled:opacity-50"
                            >
                                <Save className="w-3.5 h-3.5" />
                                <span>{saving ? t.orders.detail.saving : t.orders.detail.saveChanges}</span>
                            </button>
                            <button
                                onClick={() => router.push(`/sales/orders/${id}`)}
                                className="text-xs font-bold uppercase tracking-widest text-amber-600 hover:text-amber-800 transition-colors flex items-center space-x-1"
                            >
                                <X className="w-3.5 h-3.5" />
                                <span>{t.common.cancel}</span>
                            </button>
                        </div>
                    </div>
                )}

                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                        <button onClick={() => router.push('/sales/orders')} className="p-2 bg-white rounded-xl shadow-sm hover:shadow-md transition-all text-gray-400 hover:text-gray-900">
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <div>
                            <h1 className="text-lg font-bold tracking-tight text-gray-950">{order.order_number}</h1>
                            <div className="flex items-center space-x-3 mt-1">
                                <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-gray-100 text-gray-800">
                                    {t.shared.statuses.order[order.status as keyof typeof t.shared.statuses.order] ?? order.status}
                                </span>
                                <span className="text-xs font-bold text-gray-400">
                                    {new Date(order.created_at).toLocaleString()}
                                </span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center space-x-3">
                        {!isEditMode && (
                            <>
                                {canEdit && (
                                    <button
                                        onClick={() => router.push(`/sales/orders/${id}?edit=true`)}
                                        className="bg-white hover:bg-amber-50 text-gray-700 hover:text-amber-700 border border-gray-200 hover:border-amber-300 px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-sm flex items-center space-x-2 transition-all hover:-translate-y-0.5"
                                    >
                                        <Pencil className="w-4 h-4" />
                                        <span>{t.common.edit}</span>
                                    </button>
                                )}
                                <button
                                    onClick={handlePrint}
                                    className="bg-gray-900 hover:bg-blue-600 text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-md flex items-center space-x-2 transition-all hover:-translate-y-0.5"
                                >
                                    <Printer className="w-4 h-4" />
                                    <span>{t.common.print}</span>
                                </button>
                            </>
                        )}
                        {!isEditMode && order.status === 'DRAFT' && (
                            <button onClick={() => handleUpdateStatus('CONFIRMED')} disabled={statusUpdating} className="bg-blue-600 text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-md hover:bg-blue-700 transition-all">
                                {t.orders.detail.confirmOrder}
                            </button>
                        )}
                        {!isEditMode && order.status === 'CONFIRMED' && (
                            <button onClick={() => handleUpdateStatus('PROCESSING')} disabled={statusUpdating} className="bg-amber-500 text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-md hover:bg-amber-600 transition-all">
                                {t.orders.detail.startProcessing}
                            </button>
                        )}
                        {!isEditMode && order.status === 'PROCESSING' && (
                            <button onClick={() => handleUpdateStatus('DELIVERED')} disabled={statusUpdating} className="bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-md flex items-center space-x-2 hover:bg-emerald-700 transition-all">
                                <PackageCheck className="w-4 h-4" />
                                <span>{t.orders.detail.markDelivered}</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* Summary cards */}
                <div className="grid grid-cols-4 gap-4">
                    <div className="bg-white p-4 rounded-2xl shadow-sm">
                        <span className="text-xs font-medium text-gray-500 block mb-1">{t.common.status}</span>
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-gray-100 text-gray-800">
                            {t.shared.statuses.order[order.status as keyof typeof t.shared.statuses.order] ?? order.status}
                        </span>
                    </div>
                    <div className="bg-white p-4 rounded-2xl shadow-sm">
                        <span className="text-xs font-medium text-gray-500 block mb-1">{t.orders.detail.totalAmount}</span>
                        <span className="text-xl font-black text-blue-600">{formatBDT(totalAmount, { locale })}</span>
                    </div>
                    <div className="bg-white p-4 rounded-2xl shadow-sm">
                        <span className="text-xs font-medium text-gray-500 block mb-1">{t.shared.columns.payment}</span>
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-gray-100 text-gray-800">
                            {t.shared.statuses.payment[order.payment_status as keyof typeof t.shared.statuses.payment] ?? order.payment_status}
                        </span>
                    </div>
                    <div className="bg-white p-4 rounded-2xl shadow-sm">
                        <span className="text-xs font-medium text-gray-500 block mb-1">{t.orders.detail.amountDue}</span>
                        <span className={`text-xl font-black ${amountDue > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {amountDue > 0 ? formatBDT(amountDue, { locale }) : formatBDT(0, { locale })}
                        </span>
                    </div>
                </div>

                {/* Print-ready content (hidden) */}
                <div ref={printRef} className="hidden">
                    <h1>{order.order_number}</h1>
                    <div className="subtitle">
                        {formatMessage(t.shared.print.datePayment, {
                            date: new Date(order.created_at).toLocaleString(),
                            status: t.shared.statuses.order[order.status as keyof typeof t.shared.statuses.order] ?? order.status,
                            payment: t.shared.statuses.payment[order.payment_status as keyof typeof t.shared.statuses.payment] ?? order.payment_status,
                        })}
                        {order.customer && ` | ${t.shared.print.customer} ${order.customer.name}`}
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th>{t.shared.columns.product}</th>
                                <th>{t.shared.columns.qty}</th>
                                <th>{t.shared.columns.unitPrice}</th>
                                <th>{t.common.total}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {order.items?.map((item: any) => (
                                <tr key={item.id}>
                                    <td>{item.product?.name || t.shared.item}</td>
                                    <td>{item.quantity}</td>
                                    <td>{formatBDT(Number(item.price_at_order), { locale })}</td>
                                    <td>{formatBDT(Number(item.price_at_order) * item.quantity, { locale })}</td>
                                </tr>
                            ))}
                            <tr className="total-row">
                                <td colSpan={3}>{t.common.total}</td>
                                <td>{formatBDT(totalAmount, { locale })}</td>
                            </tr>
                        </tbody>
                    </table>
                    {amountPaid > 0 && (
                        <div className="section">
                            <strong>{t.orders.detail.amountPaid}:</strong> {formatBDT(amountPaid, { locale })} | <strong>{t.orders.detail.amountDue}:</strong> {amountDue > 0 ? formatBDT(amountDue, { locale }) : formatBDT(0, { locale })}
                        </div>
                    )}
                    {order.delivery_date && (
                        <div className="section">
                            <strong>{t.shared.form.deliveryDate}:</strong> {formatDate(order.delivery_date, locale)}
                        </div>
                    )}
                </div>

                {/* Edit mode: Customer & Delivery Date */}
                {isEditMode && (
                    <div className="bg-white rounded-3xl shadow-sm p-6">
                        <h2 className="text-lg font-black tracking-tight mb-4">{t.orders.detail.orderDetails}</h2>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-2">{t.common.customer}</label>
                                <select
                                    value={editCustomerId}
                                    onChange={(e) => setEditCustomerId(e.target.value)}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
                                >
                                    <option value="">{t.shared.walkInCustomer}</option>
                                    {customers.map((c: any) => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-2">{t.shared.form.deliveryDate}</label>
                                <input
                                    type="date"
                                    value={editDeliveryDate}
                                    onChange={(e) => setEditDeliveryDate(e.target.value)}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* {t.orders.detail.orderItems} Section */}
                <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-gray-100 flex items-center space-x-3">
                        <div className="p-2 bg-blue-50 rounded-xl text-blue-600">
                            <Package className="w-5 h-5" />
                        </div>
                        <h2 className="text-lg font-black tracking-tight">{t.orders.detail.orderItems}</h2>
                    </div>

                    {isEditMode ? (
                        <div className="p-6 space-y-4">
                            {/* Product search */}
                            <div className="relative">
                                <div className="flex items-center space-x-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
                                    <Search className="w-4 h-4 text-gray-400" />
                                    <input
                                        type="text"
                                        placeholder={t.shared.form.searchProductsAdd}
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
                                        {filteredProducts.map((p) => (
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

                            {editItems.length === 0 ? (
                                <div className="text-center py-8 text-gray-300">
                                    <Package className="w-8 h-8 mx-auto mb-2" />
                                    <p className="text-xs font-bold uppercase tracking-widest">{t.shared.empty.noItemsSearchAdd}</p>
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
                                                        onChange={(e) => updateItem(idx, 'quantity', Math.max(1, parseInt(e.target.value) || 1))}
                                                        className="w-full text-center bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                                                    />
                                                </td>
                                                <td className="py-3">
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step={0.01}
                                                        value={item.priceAtOrder}
                                                        onChange={(e) => updateItem(idx, 'priceAtOrder', parseFloat(e.target.value) || 0)}
                                                        className="w-full text-right bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                                                    />
                                                </td>
                                                <td className="py-3 text-right text-sm font-black text-blue-600">
                                                    {formatBDT(item.quantity * item.priceAtOrder, { locale })}
                                                </td>
                                                <td className="py-3 text-center">
                                                    <button onClick={() => removeItem(idx)} className="p-1 text-gray-300 hover:text-red-500 transition-colors">
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr className="border-t-2 border-gray-200">
                                            <td colSpan={3} className="pt-3 text-right text-sm font-black uppercase tracking-widest">{t.common.total}</td>
                                            <td className="pt-3 text-right text-xl font-black text-blue-600">{formatBDT(editTotal, { locale })}</td>
                                            <td></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            )}
                        </div>
                    ) : (
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-gray-100">
                                    <th className="text-left p-4 text-xs font-medium text-gray-500">{t.shared.columns.product}</th>
                                    <th className="text-center p-4 text-xs font-medium text-gray-500">{t.shared.columns.qty}</th>
                                    <th className="text-right p-4 text-xs font-medium text-gray-500">{t.shared.columns.unitPrice}</th>
                                    <th className="text-right p-4 text-xs font-medium text-gray-500">{t.common.total}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {order.items?.map((item: any) => (
                                    <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                                        <td className="p-4">
                                            <div className="flex items-center space-x-3">
                                                <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center">
                                                    <Package className="w-4 h-4 text-gray-200" />
                                                </div>
                                                <span className="text-sm font-black text-gray-900">{item.product?.name || t.shared.item}</span>
                                            </div>
                                        </td>
                                        <td className="p-4 text-center text-sm font-black">{item.quantity}</td>
                                        <td className="p-4 text-right text-sm font-bold text-gray-500">{formatBDT(Number(item.price_at_order), { locale })}</td>
                                        <td className="p-4 text-right text-sm font-black text-blue-600">{formatBDT(Number(item.price_at_order) * item.quantity, { locale })}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="border-t-2 border-gray-200">
                                    <td colSpan={3} className="p-4 text-right text-sm font-black uppercase tracking-widest">{t.common.total}</td>
                                    <td className="p-4 text-right text-xl font-black text-blue-600">{formatBDT(totalAmount, { locale })}</td>
                                </tr>
                            </tfoot>
                        </table>
                    )}
                </div>

                {/* Customer (view mode) */}
                {!isEditMode && (
                    <div className="bg-white rounded-3xl shadow-sm p-6">
                        <h2 className="font-black tracking-tight mb-4">{t.orders.detail.customerDetails}</h2>
                        {order.customer ? (
                            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                                <p className="font-black text-lg text-blue-900">{order.customer.name}</p>
                                {order.customer.phone && (
                                    <p className="text-sm font-bold text-blue-600 uppercase tracking-widest mt-1">{order.customer.phone}</p>
                                )}
                            </div>
                        ) : (
                            <p className="text-sm font-medium text-gray-400">{t.shared.walkInCustomer}</p>
                        )}
                        {order.delivery_date && (
                            <div className="mt-4 pt-4 border-t border-gray-100">
                                <span className="text-xs font-medium text-gray-500">{t.shared.form.deliveryDate}</span>
                                <p className="text-sm font-black mt-1">{formatDate(order.delivery_date, locale)}</p>
                            </div>
                        )}
                    </div>
                )}

                {/* Payment Tracker (view mode) */}
                {!isEditMode && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
                            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-900 text-white rounded-t-3xl">
                                <h2 className="font-bold tracking-tight">{t.orders.detail.paymentTracker}</h2>
                                <span className="bg-white/20 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest">
                                    {t.shared.statuses.payment[order.payment_status as keyof typeof t.shared.statuses.payment] ?? order.payment_status}
                                </span>
                            </div>
                            <div className="p-6 space-y-4">
                                <div className="flex justify-between items-center">
                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{t.orders.detail.totalAmount}</span>
                                    <span className="font-black">{formatBDT(totalAmount, { locale })}</span>
                                </div>
                                <div className="flex justify-between items-center text-emerald-600">
                                    <span className="text-xs font-bold uppercase tracking-widest">{t.orders.detail.amountPaid}</span>
                                    <span className="font-black">{formatBDT(amountPaid, { locale })}</span>
                                </div>
                                <div className="pt-4 border-t border-gray-100 flex justify-between items-center text-rose-600">
                                    <span className="text-xs font-bold uppercase tracking-widest">{t.orders.detail.amountDue}</span>
                                    <span className="font-black text-xl">{amountDue > 0 ? formatBDT(amountDue, { locale }) : formatBDT(0, { locale })}</span>
                                </div>
                                {amountDue > 0 && order.status !== 'CANCELLED' && (
                                    <button onClick={() => setDepositModalOpen(true)} className="w-full mt-4 bg-gray-100 hover:bg-gray-200 text-gray-900 font-bold text-sm py-3 rounded-xl transition-colors">
                                        {t.orders.detail.recordPaymentDeposit}
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* {t.orders.detail.depositHistory} */}
                        {order.deposits?.length > 0 && (
                            <div className="bg-white rounded-3xl shadow-sm p-6">
                                <h2 className="font-bold tracking-tight mb-4 text-sm uppercase tracking-widest text-gray-400">{t.orders.detail.depositHistory}</h2>
                                <div className="space-y-3">
                                    {order.deposits.map((dep: any) => (
                                        <div key={dep.id} className="flex justify-between items-center p-3 border border-emerald-100 bg-emerald-50 rounded-xl">
                                            <div>
                                                <p className="text-xs font-black uppercase text-emerald-700">{dep.payment_method}</p>
                                                <p className="text-[10px] font-bold text-emerald-600/60 mt-0.5">{formatDate(dep.created_at, locale)}</p>
                                            </div>
                                            <span className="font-black text-emerald-700">{formatBDT(Number(dep.amount), { locale })}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Bottom Save Bar in edit mode */}
                {isEditMode && (
                    <div className="flex justify-end space-x-3 pb-6">
                        <button
                            onClick={() => router.push(`/sales/orders/${id}`)}
                            className="px-6 py-3 bg-white border border-gray-200 text-gray-700 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-gray-50 transition-all"
                        >
                            {t.common.cancel}
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving || editItems.length === 0}
                            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-md flex items-center space-x-2 transition-all hover:-translate-y-0.5 disabled:opacity-50"
                        >
                            <Save className="w-4 h-4" />
                            <span>{saving ? t.orders.detail.saving : t.orders.detail.saveChanges}</span>
                        </button>
                    </div>
                )}
            </div>

            {/* Deposit Modal */}
            {depositModalOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-sm rounded-3xl p-6 relative">
                        <h3 className="font-black text-lg mb-1">{t.orders.detail.addDeposit}</h3>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-6">{formatMessage(t.orders.detail.dueAmount, { amount: formatBDT(amountDue, { locale }) })}</p>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-2">{t.orders.detail.amountToPay}</label>
                        <div className="relative mb-6">
                            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <input
                                type="number"
                                max={amountDue}
                                value={depositAmount}
                                onChange={(e) => setDepositAmount(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl py-4 pl-10 pr-4 font-black text-2xl focus:ring-2 focus:ring-emerald-500/20"
                                placeholder={t.shared.form.amountPlaceholder}
                            />
                        </div>
                        <div className="flex space-x-3">
                            <button onClick={() => setDepositModalOpen(false)} className="flex-1 bg-gray-100 hover:bg-gray-200 font-bold text-gray-600 rounded-xl py-3 transition-colors">{t.common.cancel}</button>
                            <button onClick={handleAddDeposit} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl py-3 shadow-lg shadow-emerald-200 transition-colors">{t.orders.detail.confirm}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function OrderDetailsPage() {
    return (
        <Suspense>
            <OrderDetailsPageContent />
        </Suspense>
    );
}
