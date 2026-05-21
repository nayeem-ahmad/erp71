'use client';

import { useState, useEffect } from 'react';
import { X, Search, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { formatBDT } from '../../../lib/format';
import { isCompoundUnit, CompoundUnitType } from '../../../lib/compound-units';
import CompoundUnitInput from '../../../components/CompoundUnitInput';

interface CreateOrderModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

interface OrderItem {
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    priceAtOrder: number;
    unitType: string;
}

export default function CreateOrderModal({ isOpen, onClose, onSuccess }: CreateOrderModalProps) {
    const [customers, setCustomers] = useState<any[]>([]);
    const [products, setProducts] = useState<any[]>([]);
    const [customerId, setCustomerId] = useState('');
    const [items, setItems] = useState<OrderItem[]>([]);
    const [deliveryDate, setDeliveryDate] = useState('');
    const [productSearch, setProductSearch] = useState('');
    const [showProductDropdown, setShowProductDropdown] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (isOpen) {
            api.getCustomers().then(setCustomers).catch(() => {});
            api.getProducts().then(setProducts).catch(() => {});
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const filteredProducts = products
        .filter(
            (p) =>
                p.name?.toLowerCase().includes(productSearch.toLowerCase()) ||
                p.sku?.toLowerCase().includes(productSearch.toLowerCase()),
        )
        .slice(0, 8);

    const addItem = (product: any) => {
        const existing = items.find((i) => i.productId === product.id);
        if (existing) {
            setItems(items.map((i) => (i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i)));
        } else {
            setItems([
                ...items,
                {
                    productId: product.id,
                    productName: product.name,
                    sku: product.sku || '',
                    quantity: 1,
                    priceAtOrder: parseFloat(product.price),
                    unitType: product.unit_type || 'none',
                },
            ]);
        }
        setProductSearch('');
        setShowProductDropdown(false);
    };

    const removeItem = (index: number) => setItems(items.filter((_, i) => i !== index));

    const updateItem = (index: number, field: 'quantity' | 'priceAtOrder', value: number) => {
        setItems(items.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
    };

    const total = items.reduce((sum, i) => sum + i.quantity * i.priceAtOrder, 0);

    const handleSubmit = async () => {
        if (items.length === 0) {
            setError('Add at least one item.');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const storeId = typeof window !== 'undefined' ? localStorage.getItem('store_id') : null;
            await api.createOrder({
                storeId: storeId || '',
                customerId: customerId || undefined,
                items: items.map((i) => ({
                    productId: i.productId,
                    quantity: i.quantity,
                    priceAtOrder: i.priceAtOrder,
                })),
                totalAmount: total,
                status: 'DRAFT',
                deliveryDate: deliveryDate || undefined,
            });
            onSuccess();
            onClose();
            // Reset form
            setItems([]);
            setCustomerId('');
            setDeliveryDate('');
        } catch (err: any) {
            setError(err.message || 'Failed to create order');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl flex flex-col max-h-[90vh]">
                <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-black tracking-tight">New Sales Order</h2>
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-0.5">Create a draft order</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-50 rounded-xl text-gray-400">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto space-y-6">
                    {error && (
                        <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold">{error}</div>
                    )}

                    {/* Customer & Delivery Date */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-2">Customer</label>
                            <select
                                value={customerId}
                                onChange={(e) => setCustomerId(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
                            >
                                <option value="">Walk-in Customer</option>
                                {customers.map((c: any) => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-2">Delivery Date</label>
                            <input
                                type="date"
                                value={deliveryDate}
                                onChange={(e) => setDeliveryDate(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
                            />
                        </div>
                    </div>

                    {/* Product search */}
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-2">Add Products</label>
                        <div className="relative">
                            <div className="flex items-center space-x-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
                                <Search className="w-4 h-4 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder="Search products by name or SKU..."
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
                                            <span className="text-sm font-bold text-blue-600">{formatBDT(parseFloat(p.price))}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Items table */}
                    {items.length > 0 && (
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
                                {items.map((item, idx) => (
                                    <tr key={idx}>
                                        <td className="py-3">
                                            <span className="text-sm font-bold">{item.productName}</span>
                                            <span className="text-xs text-gray-400 ml-2">{item.sku}</span>
                                        </td>
                                        <td className="py-3">
                                            {isCompoundUnit(item.unitType) ? (
                                                <CompoundUnitInput
                                                    unitType={item.unitType as CompoundUnitType}
                                                    value={item.quantity}
                                                    onChange={(val) => updateItem(idx, 'quantity', Math.max(1, val))}
                                                    inputClassName="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                                                />
                                            ) : (
                                                <input
                                                    type="number"
                                                    min={1}
                                                    value={item.quantity}
                                                    onChange={(e) => updateItem(idx, 'quantity', Math.max(1, parseInt(e.target.value) || 1))}
                                                    className="w-full text-center bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                                                />
                                            )}
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
                                            {formatBDT(item.quantity * item.priceAtOrder)}
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
                                    <td colSpan={3} className="pt-3 text-right text-sm font-black uppercase tracking-widest">Total</td>
                                    <td className="pt-3 text-right text-xl font-black text-blue-600">{formatBDT(total)}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    )}
                </div>

                <div className="p-6 border-t border-gray-100 flex justify-end space-x-3">
                    <button
                        onClick={onClose}
                        className="px-6 py-3 bg-white border border-gray-200 text-gray-700 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-gray-50 transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={loading || items.length === 0}
                        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-md transition-all hover:-translate-y-0.5 disabled:opacity-50"
                    >
                        {loading ? 'Creating...' : 'Create Order'}
                    </button>
                </div>
            </div>
        </div>
    );
}
