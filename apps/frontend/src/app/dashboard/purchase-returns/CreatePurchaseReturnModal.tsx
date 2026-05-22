'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Receipt, Search, Undo2, X } from 'lucide-react';
import { api } from '../../../lib/api';
import { formatBDT, formatDate } from '../../../lib/format';

interface PurchaseReturnItem {
    id: string;
    quantity: number;
}

interface PurchaseLine {
    id: string;
    quantity: number;
    unit_cost: string | number;
    product_id: string;
    product?: {
        name: string;
        sku?: string | null;
    };
    returnItems?: PurchaseReturnItem[];
}

interface PurchaseRecord {
    id: string;
    purchase_number: string;
    created_at: string;
    total_amount: string | number;
    store_id: string;
    supplier?: {
        name: string;
    } | null;
    items: PurchaseLine[];
}

interface CreatePurchaseReturnModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    initialPurchaseId?: string | null;
}

export default function CreatePurchaseReturnModal({
    isOpen,
    onClose,
    onSuccess,
    initialPurchaseId,
}: CreatePurchaseReturnModalProps) {
    const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
    const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(initialPurchaseId || null);
    const [searchTerm, setSearchTerm] = useState('');
    const [referenceNumber, setReferenceNumber] = useState('');
    const [notes, setNotes] = useState('');
    const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        setLoading(true);
        setError('');
        api.getPurchases()
            .then((data) => setPurchases(data))
            .catch(() => setPurchases([]))
            .finally(() => setLoading(false));
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        setSelectedPurchaseId(initialPurchaseId || null);
        setSearchTerm('');
        setReferenceNumber('');
        setNotes('');
        setReturnQuantities({});
        setSubmitting(false);
        setError('');
    }, [initialPurchaseId, isOpen]);

    const filteredPurchases = useMemo(() => {
        const query = searchTerm.trim().toLowerCase();

        return purchases
            .filter((purchase) => {
                if (!query) {
                    return true;
                }

                const productNames = purchase.items
                    .map((item) => item.product?.name || '')
                    .join(' ')
                    .toLowerCase();

                return (
                    purchase.purchase_number.toLowerCase().includes(query) ||
                    (purchase.supplier?.name || '').toLowerCase().includes(query) ||
                    productNames.includes(query)
                );
            })
            .sort((left, right) => Number(new Date(right.created_at)) - Number(new Date(left.created_at)));
    }, [purchases, searchTerm]);

    const selectedPurchase = useMemo(
        () => purchases.find((purchase) => purchase.id === selectedPurchaseId) || null,
        [purchases, selectedPurchaseId],
    );

    useEffect(() => {
        if (!selectedPurchase) {
            setReturnQuantities({});
            return;
        }

        setReturnQuantities((current) => {
            const next: Record<string, number> = {};

            selectedPurchase.items.forEach((item) => {
                next[item.id] = current[item.id] || 0;
            });

            return next;
        });
    }, [selectedPurchase]);

    const remainingQuantity = (item: PurchaseLine) => {
        const returned = (item.returnItems || []).reduce((sum, returnItem) => sum + returnItem.quantity, 0);
        return Math.max(0, item.quantity - returned);
    };

    const selectedItems = selectedPurchase?.items || [];

    const totalAmount = selectedItems.reduce((sum, item) => {
        const quantity = returnQuantities[item.id] || 0;
        return sum + quantity * Number(item.unit_cost || 0);
    }, 0);

    const handleQuantityChange = (itemId: string, maxQuantity: number, value: string) => {
        const parsed = Number(value);
        const safeQuantity = Number.isFinite(parsed) ? Math.max(0, Math.min(maxQuantity, parsed)) : 0;

        setReturnQuantities((current) => ({
            ...current,
            [itemId]: safeQuantity,
        }));
    };

    const handleSubmit = async () => {
        if (!selectedPurchase) {
            setError('Select a purchase before creating a return.');
            return;
        }

        const items = selectedItems
            .map((item) => ({ purchaseItemId: item.id, quantity: returnQuantities[item.id] || 0 }))
            .filter((item) => item.quantity > 0);

        if (items.length === 0) {
            setError('Choose at least one purchase line to return.');
            return;
        }

        setSubmitting(true);
        setError('');

        try {
            await api.createPurchaseReturn({
                storeId: selectedPurchase.store_id,
                purchaseId: selectedPurchase.id,
                referenceNumber: referenceNumber || undefined,
                notes: notes || undefined,
                items,
            });

            onSuccess();
            onClose();
        } catch (submitError: any) {
            setError(submitError.message || 'Failed to create purchase return.');
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white w-full max-w-5xl rounded-3xl shadow-2xl flex flex-col max-h-[90vh]">
                <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-black tracking-tight">New Purchase Return</h2>
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                            Search an original purchase and return eligible supplier lines
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-50 rounded-xl text-gray-400">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto space-y-6">
                    {error && (
                        <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold flex items-center">
                            <AlertCircle className="w-4 h-4 mr-2" />
                            {error}
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-6">
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-2">
                                    Search Purchases
                                </label>
                                <div className="flex items-center space-x-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
                                    <Search className="w-4 h-4 text-gray-400" />
                                    <input
                                        type="text"
                                        value={searchTerm}
                                        onChange={(event) => setSearchTerm(event.target.value)}
                                        placeholder="Purchase #, supplier, or product"
                                        className="flex-1 bg-transparent text-sm font-medium outline-none"
                                    />
                                </div>
                            </div>

                            <div className="border border-gray-100 rounded-2xl overflow-hidden bg-gray-50/60 min-h-[300px]">
                                {loading ? (
                                    <div className="p-6 text-center text-xs font-bold uppercase tracking-widest text-gray-400">
                                        Loading purchases...
                                    </div>
                                ) : filteredPurchases.length === 0 ? (
                                    <div className="p-6 text-center text-xs font-bold uppercase tracking-widest text-gray-400">
                                        No purchases matched this search
                                    </div>
                                ) : (
                                    <div className="max-h-[420px] overflow-y-auto divide-y divide-gray-100">
                                        {filteredPurchases.map((purchase) => {
                                            const active = purchase.id === selectedPurchaseId;
                                            return (
                                                <button
                                                    key={purchase.id}
                                                    onClick={() => setSelectedPurchaseId(purchase.id)}
                                                    className={`w-full text-left p-4 transition-colors ${
                                                        active ? 'bg-emerald-50' : 'hover:bg-white'
                                                    }`}
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div>
                                                            <p className="text-sm font-black text-gray-900">{purchase.purchase_number}</p>
                                                            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mt-1">
                                                                {purchase.supplier?.name || 'Unlinked supplier'}
                                                            </p>
                                                        </div>
                                                        <span className="text-sm font-black text-emerald-600">
                                                            {formatBDT(Number(purchase.total_amount || 0))}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-gray-500 mt-2">
                                                        {formatDate(purchase.created_at)} · {purchase.items.length} items
                                                    </p>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="space-y-5">
                            {!selectedPurchase ? (
                                <div className="h-full min-h-[420px] rounded-3xl border border-dashed border-gray-200 bg-gray-50 flex flex-col items-center justify-center text-center px-8">
                                    <Receipt className="w-10 h-10 text-gray-300 mb-4" />
                                    <h3 className="text-lg font-black tracking-tight text-gray-700">Choose a purchase</h3>
                                    <p className="text-sm text-gray-400 mt-1 max-w-md">
                                        Select an original purchase to review supplier context, remaining returnable quantities, and create a purchase return.
                                    </p>
                                </div>
                            ) : (
                                <>
                                    <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4 grid grid-cols-2 gap-4">
                                        <div>
                                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Purchase #</span>
                                            <span className="text-sm font-black text-gray-900">{selectedPurchase.purchase_number}</span>
                                        </div>
                                        <div>
                                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Supplier</span>
                                            <span className="text-sm font-bold text-gray-700">{selectedPurchase.supplier?.name || 'Unlinked supplier'}</span>
                                        </div>
                                        <div>
                                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Purchase Date</span>
                                            <span className="text-sm font-bold text-gray-700">
                                                {formatDate(selectedPurchase.created_at)}
                                            </span>
                                        </div>
                                        <div>
                                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Original Total</span>
                                            <span className="text-sm font-black text-emerald-600">
                                                {formatBDT(Number(selectedPurchase.total_amount || 0))}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-2">Reference Number</label>
                                            <input
                                                type="text"
                                                value={referenceNumber}
                                                onChange={(event) => setReferenceNumber(event.target.value)}
                                                placeholder="Optional supplier reference"
                                                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-2">Notes</label>
                                            <input
                                                type="text"
                                                value={notes}
                                                onChange={(event) => setNotes(event.target.value)}
                                                placeholder="Optional notes"
                                                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20"
                                            />
                                        </div>
                                    </div>

                                    <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                                        <div className="p-4 border-b border-gray-100 flex items-center space-x-2">
                                            <Undo2 className="w-4 h-4 text-emerald-600" />
                                            <h3 className="text-sm font-black tracking-tight">Returnable Purchase Lines</h3>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full">
                                                <thead>
                                                    <tr className="border-b border-gray-100 bg-gray-50/80">
                                                        <th className="text-left p-3 text-[10px] font-black uppercase tracking-widest text-gray-400">Product</th>
                                                        <th className="text-center p-3 text-[10px] font-black uppercase tracking-widest text-gray-400 w-24">Purchased</th>
                                                        <th className="text-center p-3 text-[10px] font-black uppercase tracking-widest text-gray-400 w-24">Remaining</th>
                                                        <th className="text-right p-3 text-[10px] font-black uppercase tracking-widest text-gray-400 w-32">Unit Cost</th>
                                                        <th className="text-center p-3 text-[10px] font-black uppercase tracking-widest text-gray-400 w-28">Return Qty</th>
                                                        <th className="text-right p-3 text-[10px] font-black uppercase tracking-widest text-gray-400 w-28">Line Total</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-50">
                                                    {selectedItems.map((item) => {
                                                        const remaining = remainingQuantity(item);
                                                        const quantity = Math.min(returnQuantities[item.id] || 0, remaining);

                                                        return (
                                                            <tr key={item.id}>
                                                                <td className="p-3">
                                                                    <span className="text-sm font-bold text-gray-900">{item.product?.name || 'Unknown item'}</span>
                                                                    <span className="text-xs text-gray-400 ml-2">{item.product?.sku || ''}</span>
                                                                </td>
                                                                <td className="p-3 text-center text-sm font-bold text-gray-700">{item.quantity}</td>
                                                                <td className="p-3 text-center">
                                                                    <span className={`text-sm font-black ${remaining > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>
                                                                        {remaining}
                                                                    </span>
                                                                </td>
                                                                <td className="p-3 text-right text-sm font-bold text-gray-700">
                                                                    {formatBDT(Number(item.unit_cost || 0))}
                                                                </td>
                                                                <td className="p-3">
                                                                    <input
                                                                        type="number"
                                                                        min={0}
                                                                        max={remaining}
                                                                        value={quantity}
                                                                        disabled={remaining === 0}
                                                                        onChange={(event) => handleQuantityChange(item.id, remaining, event.target.value)}
                                                                        className="w-full text-center bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-40"
                                                                    />
                                                                </td>
                                                                <td className="p-3 text-right text-sm font-black text-emerald-600">
                                                                    {formatBDT(quantity * Number(item.unit_cost || 0))}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>

                                    <div className="rounded-2xl bg-emerald-950 text-white p-5 flex items-center justify-between">
                                        <div>
                                            <p className="text-xs font-black uppercase tracking-widest text-emerald-200">Return Total</p>
                                            <p className="text-sm text-emerald-100 mt-1">Calculated from client-side quantity caps and purchase unit costs</p>
                                        </div>
                                        <span className="text-2xl font-black">{formatBDT(totalAmount)}</span>
                                    </div>
                                </>
                            )}
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
                        disabled={submitting || !selectedPurchase}
                        className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-md transition-all hover:-translate-y-0.5 disabled:opacity-50"
                    >
                        {submitting ? 'Creating...' : 'Create Purchase Return'}
                    </button>
                </div>
            </div>
        </div>
    );
}