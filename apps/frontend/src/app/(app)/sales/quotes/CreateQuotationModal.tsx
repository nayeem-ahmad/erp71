'use client';

import { useEffect, useState } from 'react';
import { X, Search, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { isCompoundUnit, CompoundUnitType } from '@/lib/compound-units';
import CompoundUnitInput from '@/components/CompoundUnitInput';
import ModalShell from '@/components/ModalShell';
import VoiceEntryInput from '@/components/VoiceEntryInput';
import { useI18n } from '@/lib/i18n';
import { buildVoiceEntryMessages, type VoiceEntryResult } from '@/lib/voice-entry';

interface CreateQuotationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

interface QuoteItem {
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    unitType: string;
}

export default function CreateQuotationModal({ isOpen, onClose, onSuccess }: CreateQuotationModalProps) {
    const { t, locale } = useI18n();
    const [customers, setCustomers] = useState<any[]>([]);
    const [products, setProducts] = useState<any[]>([]);
    const [customerId, setCustomerId] = useState('');
    const [items, setItems] = useState<QuoteItem[]>([]);
    const [validUntil, setValidUntil] = useState('');
    const [notes, setNotes] = useState('');
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
            (product) =>
                product.name?.toLowerCase().includes(productSearch.toLowerCase()) ||
                product.sku?.toLowerCase().includes(productSearch.toLowerCase()),
        )
        .slice(0, 8);

    const addItem = (product: any, quantity = 1) => {
        const existing = items.find((item) => item.productId === product.id);
        if (existing) {
            setItems(items.map((item) => (
                item.productId === product.id ? { ...item, quantity: item.quantity + quantity } : item
            )));
        } else {
            setItems([
                ...items,
                {
                    productId: product.id,
                    productName: product.name,
                    sku: product.sku || '',
                    quantity,
                    unitPrice: parseFloat(product.price),
                    unitType: product.unit_type || 'none',
                },
            ]);
        }
        setProductSearch('');
        setShowProductDropdown(false);
    };

    const updateItem = (index: number, field: 'quantity' | 'unitPrice', value: number) => {
        setItems(items.map((item, itemIndex) => (
            itemIndex === index ? { ...item, [field]: value } : item
        )));
    };

    const handleVoiceQuote = (result: VoiceEntryResult) => {
        let added = 0;
        for (const item of result.items) {
            if (item.matched && item.product) {
                addItem({
                    id: item.product.id,
                    name: item.product.name,
                    price: item.product.price,
                    unit_type: 'none',
                }, item.quantity);
                added++;
            }
        }
        if (result.note && !notes) setNotes(result.note);
        const messages = buildVoiceEntryMessages(result, added);
        if (messages.length > 0) alert(messages.join('\n'));
    };

    const removeItem = (index: number) => {
        setItems(items.filter((_, itemIndex) => itemIndex !== index));
    };

    const reset = () => {
        setCustomerId('');
        setItems([]);
        setValidUntil('');
        setNotes('');
        setProductSearch('');
        setShowProductDropdown(false);
        setError('');
    };

    const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

    const handleSubmit = async () => {
        if (items.length === 0) {
            setError(t.shared.form.addAtLeastOneItem);
            return;
        }

        setLoading(true);
        setError('');

        try {
            const storeId = typeof window !== 'undefined' ? localStorage.getItem('store_id') : null;
            await api.createQuotation({
                storeId: storeId || '',
                customerId: customerId || undefined,
                items: items.map((item) => ({
                    productId: item.productId,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                })),
                totalAmount: total,
                validUntil: validUntil || undefined,
                notes: notes || undefined,
            });

            onSuccess();
            onClose();
            reset();
        } catch (err: any) {
            setError(err.message || t.shared.errors.createQuotation);
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        reset();
        onClose();
    };

    return (
        <ModalShell size="lg" onBackdropClick={handleClose}>
                <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-black tracking-tight">{t.quotes.createModal.title}</h2>
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-0.5">{t.quotes.createModal.subtitle}</p>
                    </div>
                    <button onClick={handleClose} className="p-2 hover:bg-gray-50 rounded-xl text-gray-400">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto space-y-6">
                    {error && (
                        <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold">{error}</div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-2">{t.common.customer}</label>
                            <select
                                value={customerId}
                                onChange={(e) => setCustomerId(e.target.value)}
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
                                value={validUntil}
                                onChange={(e) => setValidUntil(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-2">{t.common.notes}</label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={3}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 resize-none"
                            placeholder={t.shared.form.notesPlaceholder}
                        />
                    </div>

                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-2">{t.shared.form.addProducts}</label>
                        <VoiceEntryInput entryType="sales_quote" onResult={handleVoiceQuote} inline>
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
                                                <span className="text-sm font-bold text-blue-600">{formatBDT(parseFloat(product.price))}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </VoiceEntryInput>
                    </div>

                    {items.length > 0 && (
                        <div className="overflow-x-auto -mx-1 px-1">
                        <table className="w-full min-w-[480px]">
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
                                {items.map((item, index) => (
                                    <tr key={`${item.productId}-${index}`}>
                                        <td className="py-3">
                                            <span className="text-sm font-bold">{item.productName}</span>
                                            <span className="text-xs text-gray-400 ml-2">{item.sku}</span>
                                        </td>
                                        <td className="py-3">
                                            {isCompoundUnit(item.unitType) ? (
                                                <CompoundUnitInput
                                                    unitType={item.unitType as CompoundUnitType}
                                                    value={item.quantity}
                                                    onChange={(val) => updateItem(index, 'quantity', Math.max(1, val))}
                                                    inputClassName="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                                                />
                                            ) : (
                                                <input
                                                    type="number"
                                                    min={1}
                                                    value={item.quantity}
                                                    onChange={(e) => updateItem(index, 'quantity', Math.max(1, parseInt(e.target.value, 10) || 1))}
                                                    className="w-full text-center bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                                                />
                                            )}
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
                                            {formatBDT(item.quantity * item.unitPrice)}
                                        </td>
                                        <td className="py-3 text-center">
                                            <button onClick={() => removeItem(index)} className="p-1 text-gray-300 hover:text-red-500 transition-colors">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="border-t-2 border-gray-200">
                                    <td colSpan={3} className="pt-3 text-right text-sm font-black uppercase tracking-widest">{t.common.total}</td>
                                    <td className="pt-3 text-right text-xl font-black text-blue-600">{formatBDT(total)}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                        </div>
                    )}
                </div>

                <div className="p-6 border-t border-gray-100 flex justify-end space-x-3">
                    <button
                        onClick={handleClose}
                        className="px-6 py-3 bg-white border border-gray-200 text-gray-700 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-gray-50 transition-all"
                    >
                        {t.common.cancel}
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={loading || items.length === 0}
                        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-md transition-all hover:-translate-y-0.5 disabled:opacity-50"
                    >
                        {loading ? t.quotes.createModal.creating : t.quotes.createModal.createQuotation}
                    </button>
                </div>
        </ModalShell>
    );
}