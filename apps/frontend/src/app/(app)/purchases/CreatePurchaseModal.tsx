'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { isCompoundUnit, CompoundUnitType, formatCompoundQty } from '@/lib/compound-units';
import CompoundUnitInput from '@/components/CompoundUnitInput';
import VoiceEntryInput from '@/components/VoiceEntryInput';
import { useI18n, formatMessage } from '@/lib/i18n';
import ModalShell from '@/components/ModalShell';
import { buildVoiceEntryMessages, type VoiceEntryResult } from '@/lib/voice-entry';

interface PurchaseProductOption {
    id: string;
    name: string;
    sku?: string | null;
    price: string | number;
    unit_type?: string;
}

interface SupplierOption {
    id: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
}

interface PurchaseItemDraft {
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    unitCost: number;
    unitType: string;
}

interface CreatePurchaseModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    initialProduct?: PurchaseProductOption;
}

const emptySupplierForm = {
    name: '',
    phone: '',
    email: '',
    address: '',
};

export default function CreatePurchaseModal({
    isOpen,
    onClose,
    onSuccess,
    initialProduct,
}: CreatePurchaseModalProps) {
    const { t, locale } = useI18n();
    const [products, setProducts] = useState<PurchaseProductOption[]>([]);
    const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
    const [items, setItems] = useState<PurchaseItemDraft[]>([]);
    const [productSearch, setProductSearch] = useState('');
    const [showProductDropdown, setShowProductDropdown] = useState(false);
    const [supplierId, setSupplierId] = useState('');
    const [createInlineSupplier, setCreateInlineSupplier] = useState(false);
    const [supplierForm, setSupplierForm] = useState(emptySupplierForm);
    const [taxAmount, setTaxAmount] = useState('0');
    const [discountAmount, setDiscountAmount] = useState('0');
    const [freightAmount, setFreightAmount] = useState('0');
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        api.getProducts().then(setProducts).catch(() => setProducts([]));
        api.getSuppliers().then(setSuppliers).catch(() => setSuppliers([]));
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        if (initialProduct) {
            setItems([
                {
                    productId: initialProduct.id,
                    productName: initialProduct.name,
                    sku: initialProduct.sku || '',
                    quantity: 1,
                    unitCost: Number(initialProduct.price || 0),
                    unitType: initialProduct.unit_type || 'none',
                },
            ]);
        } else {
            setItems([]);
        }

        setProductSearch('');
        setSupplierId('');
        setCreateInlineSupplier(false);
        setSupplierForm(emptySupplierForm);
        setTaxAmount('0');
        setDiscountAmount('0');
        setFreightAmount('0');
        setNotes('');
        setLoading(false);
        setError('');
    }, [initialProduct, isOpen]);

    const filteredProducts = useMemo(
        () =>
            products
                .filter((product) => {
                    const query = productSearch.toLowerCase();
                    return (
                        product.name.toLowerCase().includes(query) ||
                        product.sku?.toLowerCase().includes(query)
                    );
                })
                .slice(0, 8),
        [productSearch, products],
    );

    const subtotal = useMemo(
        () => items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0),
        [items],
    );
    const tax = Number(taxAmount || 0);
    const discount = Number(discountAmount || 0);
    const freight = Number(freightAmount || 0);
    const total = subtotal + tax + freight - discount;

    if (!isOpen) {
        return null;
    }

    const addItem = (product: PurchaseProductOption, quantity = 1) => {
        const existing = items.find((item) => item.productId === product.id);
        if (existing) {
            setItems(
                items.map((item) =>
                    item.productId === product.id
                        ? { ...item, quantity: item.quantity + quantity }
                        : item,
                ),
            );
        } else {
            setItems([
                ...items,
                {
                    productId: product.id,
                    productName: product.name,
                    sku: product.sku || '',
                    quantity,
                    unitCost: Number(product.price || 0),
                    unitType: product.unit_type || 'none',
                },
            ]);
        }
        setProductSearch('');
        setShowProductDropdown(false);
    };

    const handleVoicePurchase = (result: VoiceEntryResult) => {
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
        if (result.note && !notes) {
            setNotes(result.note);
        }
        const messages = buildVoiceEntryMessages(result, added);
        if (messages.length > 0) {
            alert(messages.join('\n'));
        }
    };

    const updateItem = (
        index: number,
        field: 'quantity' | 'unitCost',
        value: number,
    ) => {
        setItems(
            items.map((item, itemIndex) =>
                itemIndex === index ? { ...item, [field]: value } : item,
            ),
        );
    };

    const removeItem = (index: number) => {
        setItems(items.filter((_, itemIndex) => itemIndex !== index));
    };

    const handleSubmit = async () => {
        if (items.length === 0) {
            setError(t.purchaseShared.addOnePurchasedProduct);
            return;
        }

        if (createInlineSupplier && !supplierForm.name.trim()) {
            setError(t.purchaseShared.supplierNameRequiredInline);
            return;
        }

        setLoading(true);
        setError('');

        try {
            const storeId = typeof window !== 'undefined' ? localStorage.getItem('store_id') : null;
            await api.createPurchase({
                storeId: storeId || '',
                supplierId: createInlineSupplier ? undefined : supplierId || undefined,
                newSupplier: createInlineSupplier
                    ? {
                          name: supplierForm.name,
                          phone: supplierForm.phone || undefined,
                          email: supplierForm.email || undefined,
                          address: supplierForm.address || undefined,
                      }
                    : undefined,
                items: items.map((item) => ({
                    productId: item.productId,
                    quantity: item.quantity,
                    unitCost: item.unitCost,
                })),
                taxAmount: tax,
                discountAmount: discount,
                freightAmount: freight,
                notes: notes || undefined,
            });
            onSuccess();
            onClose();
        } catch (submitError: any) {
            setError(submitError.message || t.purchaseShared.failedRecordPurchase);
        } finally {
            setLoading(false);
        }
    };

    return (
        <ModalShell size="xl" onBackdropClick={onClose}>
                <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-black tracking-tight">{t.purchases.modal.title}</h2>
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                            {t.purchases.modal.subtitle}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-50 rounded-xl text-gray-400">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto space-y-6">
                    {error && (
                        <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold">
                            {error}
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6">
                        <div className="space-y-6">
                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-2">
                                    Add Products
                                </label>
                                <VoiceEntryInput entryType="purchase" onResult={handleVoicePurchase} inline>
                                    <div className="relative">
                                        <div className="flex items-center space-x-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
                                            <Search className="w-4 h-4 text-gray-400" />
                                            <input
                                                type="text"
                                                placeholder={t.purchaseShared.searchProducts}
                                                value={productSearch}
                                                onChange={(event) => {
                                                    setProductSearch(event.target.value);
                                                    setShowProductDropdown(true);
                                                }}
                                                onFocus={() => setShowProductDropdown(true)}
                                                className="flex-1 bg-transparent text-sm font-medium outline-none"
                                            />
                                        </div>
                                        {showProductDropdown &&
                                            productSearch.length > 0 &&
                                            filteredProducts.length > 0 && (
                                                <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                                                    {filteredProducts.map((product) => (
                                                        <button
                                                            key={product.id}
                                                            onClick={() => addItem(product)}
                                                            className="w-full text-left px-4 py-3 hover:bg-emerald-50 flex items-center justify-between transition-colors"
                                                        >
                                                            <div>
                                                                <span className="text-sm font-bold">{product.name}</span>
                                                                <span className="text-xs text-gray-400 ml-2">{product.sku}</span>
                                                            </div>
                                                            <span className="text-sm font-bold text-emerald-600">
                                                                {formatBDT(Number(product.price || 0), { locale })}
                                                            </span>
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
                                            <th className="text-left pb-2 text-[10px] font-black uppercase tracking-widest text-gray-400">
                                                Product
                                            </th>
                                            <th className="text-center pb-2 text-[10px] font-black uppercase tracking-widest text-gray-400 w-24">
                                                Qty
                                            </th>
                                            <th className="text-right pb-2 text-[10px] font-black uppercase tracking-widest text-gray-400 w-32">
                                                Unit Cost
                                            </th>
                                            <th className="text-right pb-2 text-[10px] font-black uppercase tracking-widest text-gray-400 w-28">
                                                Line Total
                                            </th>
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
                                                        />
                                                    ) : (
                                                        <input
                                                            type="number"
                                                            min={1}
                                                            value={item.quantity}
                                                            onChange={(event) =>
                                                                updateItem(
                                                                    index,
                                                                    'quantity',
                                                                    Math.max(1, Number(event.target.value) || 1),
                                                                )
                                                            }
                                                            className="w-full text-center bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20"
                                                        />
                                                    )}
                                                </td>
                                                <td className="py-3">
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step={0.01}
                                                        value={item.unitCost}
                                                        onChange={(event) =>
                                                            updateItem(index, 'unitCost', Number(event.target.value) || 0)
                                                        }
                                                        className="w-full text-right bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20"
                                                    />
                                                </td>
                                                <td className="py-3 text-right text-sm font-black text-emerald-600">
                                                    {formatBDT(item.quantity * item.unitCost, { locale })}
                                                </td>
                                                <td className="py-3 text-center">
                                                    <button
                                                        onClick={() => removeItem(index)}
                                                        className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                </div>
                            )}
                        </div>

                        <div className="space-y-5">
                            <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4 space-y-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="text-sm font-black tracking-tight">{t.common.supplier}</h3>
                                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                                            {t.purchaseShared.linkOrCreateSupplier}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setCreateInlineSupplier((value) => !value)}
                                        className="text-xs font-black uppercase tracking-widest text-emerald-600 hover:text-emerald-700"
                                    >
                                        {createInlineSupplier ? t.purchaseShared.useExisting : t.purchaseShared.newSupplier}
                                    </button>
                                </div>

                                {!createInlineSupplier ? (
                                    <select
                                        value={supplierId}
                                        onChange={(event) => setSupplierId(event.target.value)}
                                        className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300"
                                    >
                                        <option value="">{t.purchaseShared.noSupplier}</option>
                                        {suppliers.map((supplier) => (
                                            <option key={supplier.id} value={supplier.id}>
                                                {supplier.name}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <div className="space-y-3">
                                        <input
                                            type="text"
                                            placeholder={t.purchaseShared.supplierNamePlaceholder}
                                            value={supplierForm.name}
                                            onChange={(event) =>
                                                setSupplierForm({ ...supplierForm, name: event.target.value })
                                            }
                                            className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20"
                                        />
                                        <input
                                            type="text"
                                            placeholder={t.common.phone}
                                            value={supplierForm.phone}
                                            onChange={(event) =>
                                                setSupplierForm({ ...supplierForm, phone: event.target.value })
                                            }
                                            className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20"
                                        />
                                        <input
                                            type="email"
                                            placeholder={t.common.email}
                                            value={supplierForm.email}
                                            onChange={(event) =>
                                                setSupplierForm({ ...supplierForm, email: event.target.value })
                                            }
                                            className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20"
                                        />
                                        <textarea
                                            placeholder={t.common.address}
                                            value={supplierForm.address}
                                            onChange={(event) =>
                                                setSupplierForm({ ...supplierForm, address: event.target.value })
                                            }
                                            rows={3}
                                            className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-emerald-500/20"
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4 space-y-3">
                                <h3 className="text-sm font-black tracking-tight">{t.purchaseShared.costAdjustments}</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <div>
                                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">
                                            Tax
                                        </label>
                                        <input
                                            type="number"
                                            min={0}
                                            step={0.01}
                                            value={taxAmount}
                                            onChange={(event) => setTaxAmount(event.target.value)}
                                            className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">
                                            Discount
                                        </label>
                                        <input
                                            type="number"
                                            min={0}
                                            step={0.01}
                                            value={discountAmount}
                                            onChange={(event) => setDiscountAmount(event.target.value)}
                                            className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">
                                            Freight
                                        </label>
                                        <input
                                            type="number"
                                            min={0}
                                            step={0.01}
                                            value={freightAmount}
                                            onChange={(event) => setFreightAmount(event.target.value)}
                                            className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20"
                                        />
                                    </div>
                                </div>
                                <textarea
                                    placeholder={t.purchaseShared.purchaseNotes}
                                    value={notes}
                                    onChange={(event) => setNotes(event.target.value)}
                                    rows={3}
                                    className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-emerald-500/20"
                                />
                            </div>

                            <div className="rounded-2xl bg-emerald-950 text-white p-5 space-y-3">
                                <div className="flex items-center justify-between text-sm font-bold text-emerald-100">
                                    <span>{t.common.subtotal}</span>
                                    <span>{formatBDT(subtotal, { locale })}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm font-bold text-emerald-100">
                                    <span>{t.common.tax}</span>
                                    <span>{formatBDT(tax, { locale })}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm font-bold text-emerald-100">
                                    <span>{t.purchaseShared.freight}</span>
                                    <span>{formatBDT(freight, { locale })}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm font-bold text-emerald-100">
                                    <span>{t.common.discount}</span>
                                    <span>-{formatBDT(discount, { locale })}</span>
                                </div>
                                <div className="border-t border-emerald-800 pt-3 flex items-center justify-between">
                                    <span className="text-xs font-black uppercase tracking-widest text-emerald-200">
                                        Purchase Total
                                    </span>
                                    <span className="text-2xl font-black">{formatBDT(total, { locale })}</span>
                                </div>
                            </div>
                        </div>
                    </div>
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
                        disabled={loading || items.length === 0 || total < 0}
                        className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-md transition-all hover:-translate-y-0.5 disabled:opacity-50"
                    >
                        {loading ? t.purchases.modal.saving : t.purchases.modal.postPurchase}
                    </button>
                </div>
        </ModalShell>
    );
}