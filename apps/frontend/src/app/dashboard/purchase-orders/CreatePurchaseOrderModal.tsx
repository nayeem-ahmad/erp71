'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';

interface Product {
    id: string;
    name: string;
    sku?: string | null;
    price: string | number;
}

interface Supplier {
    id: string;
    name: string;
}

interface DraftItem {
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    unitCost: number;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export default function CreatePurchaseOrderModal({ isOpen, onClose, onSuccess }: Props) {
    const [products, setProducts] = useState<Product[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [items, setItems] = useState<DraftItem[]>([]);
    const [productSearch, setProductSearch] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const [supplierId, setSupplierId] = useState('');
    const [expectedDate, setExpectedDate] = useState('');
    const [taxAmount, setTaxAmount] = useState('0');
    const [discountAmount, setDiscountAmount] = useState('0');
    const [freightAmount, setFreightAmount] = useState('0');
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        void Promise.all([
            api.getProducts().then(setProducts).catch(() => {}),
            api.getSuppliers().then(setSuppliers).catch(() => {}),
        ]);
        setItems([]);
        setProductSearch('');
        setSupplierId('');
        setExpectedDate('');
        setTaxAmount('0');
        setDiscountAmount('0');
        setFreightAmount('0');
        setNotes('');
        setError('');
    }, [isOpen]);

    const filteredProducts = useMemo(() =>
        products.filter((p) => {
            const q = productSearch.toLowerCase();
            return p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q);
        }).slice(0, 8),
        [products, productSearch],
    );

    const addItem = (product: Product) => {
        const existing = items.find((i) => i.productId === product.id);
        if (existing) {
            setItems(items.map((i) => i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i));
        } else {
            setItems([...items, {
                productId: product.id,
                productName: product.name,
                sku: product.sku ?? '',
                quantity: 1,
                unitCost: Number(product.price || 0),
            }]);
        }
        setProductSearch('');
        setShowDropdown(false);
    };

    const updateItem = (index: number, field: 'quantity' | 'unitCost', value: number) => {
        setItems(items.map((item, i) => i === index ? { ...item, [field]: value } : item));
    };

    const removeItem = (index: number) => setItems(items.filter((_, i) => i !== index));

    const subtotal = items.reduce((s, i) => s + i.quantity * i.unitCost, 0);
    const tax = Number(taxAmount || 0);
    const discount = Number(discountAmount || 0);
    const freight = Number(freightAmount || 0);
    const total = subtotal + tax + freight - discount;

    const handleSubmit = async () => {
        if (items.length === 0) { setError('Add at least one product.'); return; }
        setLoading(true);
        setError('');
        try {
            const storeId = typeof window !== 'undefined' ? localStorage.getItem('store_id') : null;
            await api.createPurchaseOrder({
                storeId: storeId || '',
                supplierId: supplierId || undefined,
                expectedDate: expectedDate || undefined,
                items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitCost: i.unitCost })),
                taxAmount: tax,
                discountAmount: discount,
                freightAmount: freight,
                notes: notes || undefined,
            });
            onSuccess();
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to create purchase order');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl flex flex-col max-h-[90vh]">
                <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-black tracking-tight">New Purchase Order</h2>
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                            Draft a PO to send to a supplier
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-50 rounded-xl text-gray-400">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto space-y-6">
                    {error && <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold">{error}</div>}

                    <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6">
                        {/* Left: products */}
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-black uppercase tracking-widest text-gray-500 block mb-2">Add Products</label>
                                <div className="relative">
                                    <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
                                        <Search className="w-4 h-4 text-gray-400" />
                                        <input
                                            type="text"
                                            placeholder="Search by name or SKU..."
                                            value={productSearch}
                                            onChange={(e) => { setProductSearch(e.target.value); setShowDropdown(true); }}
                                            onFocus={() => setShowDropdown(true)}
                                            className="flex-1 bg-transparent text-sm font-medium outline-none"
                                        />
                                    </div>
                                    {showDropdown && productSearch.length > 0 && filteredProducts.length > 0 && (
                                        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                                            {filteredProducts.map((p) => (
                                                <button key={p.id} onClick={() => addItem(p)}
                                                    className="w-full text-left px-4 py-3 hover:bg-blue-50 flex items-center justify-between">
                                                    <div>
                                                        <span className="text-sm font-bold">{p.name}</span>
                                                        <span className="text-xs text-gray-400 ml-2">{p.sku}</span>
                                                    </div>
                                                    <span className="text-sm font-bold text-blue-600">{formatBDT(Number(p.price || 0))}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {items.length > 0 && (
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-gray-100">
                                            <th className="text-left pb-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Product</th>
                                            <th className="text-center pb-2 text-[10px] font-black uppercase tracking-widest text-gray-400 w-24">Qty</th>
                                            <th className="text-right pb-2 text-[10px] font-black uppercase tracking-widest text-gray-400 w-32">Unit Cost</th>
                                            <th className="text-right pb-2 text-[10px] font-black uppercase tracking-widest text-gray-400 w-28">Total</th>
                                            <th className="w-10"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {items.map((item, idx) => (
                                            <tr key={item.productId}>
                                                <td className="py-3">
                                                    <span className="text-sm font-bold">{item.productName}</span>
                                                    <span className="text-xs text-gray-400 ml-2">{item.sku}</span>
                                                </td>
                                                <td className="py-3">
                                                    <input type="number" min={1} value={item.quantity}
                                                        onChange={(e) => updateItem(idx, 'quantity', Math.max(1, Number(e.target.value) || 1))}
                                                        className="w-full text-center bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold" />
                                                </td>
                                                <td className="py-3">
                                                    <input type="number" min={0} step={0.01} value={item.unitCost}
                                                        onChange={(e) => updateItem(idx, 'unitCost', Number(e.target.value) || 0)}
                                                        className="w-full text-right bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold" />
                                                </td>
                                                <td className="py-3 text-right text-sm font-black text-blue-600">
                                                    {formatBDT(item.quantity * item.unitCost)}
                                                </td>
                                                <td className="py-3 text-center">
                                                    <button onClick={() => removeItem(idx)} className="p-1 text-gray-300 hover:text-red-500">
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>

                        {/* Right: supplier + adjustments */}
                        <div className="space-y-5">
                            <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4 space-y-3">
                                <h3 className="text-sm font-black tracking-tight">Supplier</h3>
                                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
                                    className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20">
                                    <option value="">No supplier selected</option>
                                    {suppliers.map((s) => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Expected Delivery Date</label>
                                    <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)}
                                        className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-blue-500/20" />
                                </div>
                            </div>

                            <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4 space-y-3">
                                <h3 className="text-sm font-black tracking-tight">Cost Adjustments</h3>
                                <div className="grid grid-cols-3 gap-3">
                                    {[['Tax', taxAmount, setTaxAmount], ['Discount', discountAmount, setDiscountAmount], ['Freight', freightAmount, setFreightAmount]].map(([label, val, setter]) => (
                                        <div key={label as string}>
                                            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">{label as string}</label>
                                            <input type="number" min={0} step={0.01} value={val as string}
                                                onChange={(e) => (setter as any)(e.target.value)}
                                                className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20" />
                                        </div>
                                    ))}
                                </div>
                                <textarea placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)}
                                    rows={2} className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-blue-500/20" />
                            </div>

                            <div className="rounded-2xl bg-blue-950 text-white p-5 space-y-2">
                                <div className="flex justify-between text-sm font-bold text-blue-100">
                                    <span>Subtotal</span><span>{formatBDT(subtotal)}</span>
                                </div>
                                <div className="flex justify-between text-sm font-bold text-blue-100">
                                    <span>Tax</span><span>{formatBDT(tax)}</span>
                                </div>
                                <div className="flex justify-between text-sm font-bold text-blue-100">
                                    <span>Freight</span><span>{formatBDT(freight)}</span>
                                </div>
                                <div className="flex justify-between text-sm font-bold text-blue-100">
                                    <span>Discount</span><span>-{formatBDT(discount)}</span>
                                </div>
                                <div className="border-t border-blue-800 pt-2 flex justify-between">
                                    <span className="text-xs font-black uppercase tracking-widest text-blue-200">PO Total</span>
                                    <span className="text-2xl font-black">{formatBDT(total)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-6 border-t border-gray-100 flex justify-end gap-3">
                    <button onClick={onClose}
                        className="px-6 py-3 bg-white border border-gray-200 text-gray-700 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-gray-50">
                        Cancel
                    </button>
                    <button onClick={handleSubmit} disabled={loading || items.length === 0}
                        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-md disabled:opacity-50">
                        {loading ? 'Creating...' : 'Create PO'}
                    </button>
                </div>
            </div>
        </div>
    );
}
