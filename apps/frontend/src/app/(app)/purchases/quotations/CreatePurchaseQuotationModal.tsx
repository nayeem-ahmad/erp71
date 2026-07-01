'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import ModalShell from '@/components/ModalShell';
import VoiceEntryInput from '@/components/VoiceEntryInput';
import { useI18n, formatMessage } from '@/lib/i18n';
import { buildVoiceEntryMessages, type VoiceEntryResult } from '@/lib/voice-entry';

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

export default function CreatePurchaseQuotationModal({ isOpen, onClose, onSuccess }: Props) {
    const { t, locale } = useI18n();
    const [products, setProducts] = useState<Product[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [items, setItems] = useState<DraftItem[]>([]);
    const [productSearch, setProductSearch] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const [supplierId, setSupplierId] = useState('');
    const [validUntil, setValidUntil] = useState('');
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
        setValidUntil('');
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

    const addItem = (product: Product, quantity = 1) => {
        const existing = items.find((i) => i.productId === product.id);
        if (existing) {
            setItems(items.map((i) => i.productId === product.id ? { ...i, quantity: i.quantity + quantity } : i));
        } else {
            setItems([...items, {
                productId: product.id,
                productName: product.name,
                sku: product.sku ?? '',
                quantity,
                unitCost: Number(product.price || 0),
            }]);
        }
        setProductSearch('');
        setShowDropdown(false);
    };

    const handleVoiceQuote = (result: VoiceEntryResult) => {
        let added = 0;
        for (const item of result.items) {
            if (item.matched && item.product) {
                addItem({
                    id: item.product.id,
                    name: item.product.name,
                    price: item.product.price,
                }, item.quantity);
                added++;
            }
        }
        if (result.note && !notes) setNotes(result.note);
        const messages = buildVoiceEntryMessages(result, added);
        if (messages.length > 0) alert(messages.join('\n'));
    };

    const updateItem = (index: number, field: 'quantity' | 'unitCost', value: number) => {
        setItems(items.map((item, i) => i === index ? { ...item, [field]: value } : item));
    };

    const removeItem = (index: number) => setItems(items.filter((_, i) => i !== index));

    const total = items.reduce((s, i) => s + i.quantity * i.unitCost, 0);

    const handleSubmit = async () => {
        if (items.length === 0) { setError(t.purchaseShared.addOneProduct); return; }
        setLoading(true);
        setError('');
        try {
            const storeId = typeof window !== 'undefined' ? localStorage.getItem('store_id') : null;
            await api.createPurchaseQuotation({
                storeId: storeId || '',
                supplierId: supplierId || undefined,
                validUntil: validUntil || undefined,
                items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitCost: i.unitCost })),
                notes: notes || undefined,
            });
            onSuccess();
            onClose();
        } catch (err: any) {
            setError(err.message || t.purchaseShared.failedCreateRfq);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <ModalShell size="xl" onBackdropClick={onClose}>
                <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-black tracking-tight">New Purchase Quotation (RFQ)</h2>
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                            Request prices from a supplier
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
                                <VoiceEntryInput entryType="purchase_quote" onResult={handleVoiceQuote} inline>
                                    <div className="relative">
                                        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
                                            <Search className="w-4 h-4 text-gray-400" />
                                            <input
                                                type="text"
                                                placeholder={t.purchaseShared.searchProductsShort}
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
                                                        <span className="text-sm font-bold text-blue-600">{formatBDT(Number(p.price || 0), { locale })}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </VoiceEntryInput>
                            </div>

                            {items.length > 0 && (
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-gray-100">
                                            <th className="text-left pb-2 text-[10px] font-black uppercase tracking-widest text-gray-400">{t.common.product}</th>
                                            <th className="text-center pb-2 text-[10px] font-black uppercase tracking-widest text-gray-400 w-24">{t.purchaseShared.qty}</th>
                                            <th className="text-right pb-2 text-[10px] font-black uppercase tracking-widest text-gray-400 w-32">{t.purchaseShared.unitCost}</th>
                                            <th className="text-right pb-2 text-[10px] font-black uppercase tracking-widest text-gray-400 w-28">{t.common.total}</th>
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
                                                    {formatBDT(item.quantity * item.unitCost, { locale })}
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

                        {/* Right: supplier + validity */}
                        <div className="space-y-5">
                            <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4 space-y-3">
                                <h3 className="text-sm font-black tracking-tight">{t.common.supplier}</h3>
                                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
                                    className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20">
                                    <option value="">{t.purchaseShared.noSupplier}</option>
                                    {suppliers.map((s) => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Valid Until</label>
                                    <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)}
                                        className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-blue-500/20" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Notes</label>
                                    <textarea placeholder={t.purchaseShared.notesRequirementsPlaceholder} value={notes} onChange={(e) => setNotes(e.target.value)}
                                        rows={3} className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-blue-500/20" />
                                </div>
                            </div>

                            <div className="rounded-2xl bg-blue-950 text-white p-5">
                                <div className="flex justify-between items-center">
                                    <span className="text-xs font-black uppercase tracking-widest text-blue-200">RFQ Total</span>
                                    <span className="text-2xl font-black">{formatBDT(total, { locale })}</span>
                                </div>
                                <p className="text-xs text-blue-300 mt-2">{t.purchaseShared.rfqTotalHint}</p>
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
                        {loading ? 'Creating...' : 'Create RFQ'}
                    </button>
                </div>
        </ModalShell>
    );
}
