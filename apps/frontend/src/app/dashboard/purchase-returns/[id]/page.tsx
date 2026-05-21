'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Pencil, Printer, Receipt, Save, Trash2, Undo2, X } from 'lucide-react';
import { api } from '../../../../lib/api';
import { formatBDT } from '../../../../lib/format';

interface EditItem {
    purchaseItemId: string;
    productId: string;
    productName: string;
    quantity: number;
    unitCost: number;
    maxQuantity: number;
}

export default function PurchaseReturnDetailPage() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [purchaseReturn, setPurchaseReturn] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [editReferenceNumber, setEditReferenceNumber] = useState('');
    const [editNotes, setEditNotes] = useState('');
    const [editItems, setEditItems] = useState<EditItem[]>([]);
    const isEditMode = searchParams.get('edit') === 'true';
    const shouldAutoPrint = searchParams.get('print') === 'true';

    useEffect(() => {
        if (!params.id) {
            return;
        }

        loadPurchaseReturn(params.id as string);
    }, [params.id]);

    useEffect(() => {
        if (!isEditMode || !purchaseReturn) {
            return;
        }

        setEditReferenceNumber(purchaseReturn.reference_number || '');
        setEditNotes(purchaseReturn.notes || '');

        const items: EditItem[] = (purchaseReturn.items || []).map((item: any) => {
            const purchaseItem = purchaseReturn.purchase?.items?.find(
                (candidate: any) => candidate.id === (item.purchase_item_id || item.purchaseItem?.id),
            );
            const otherReturned = (purchaseItem?.returnItems || [])
                .filter((returnItem: any) => returnItem.return_id !== purchaseReturn.id)
                .reduce((sum: number, returnItem: any) => sum + returnItem.quantity, 0);
            const maxQuantity = purchaseItem ? purchaseItem.quantity - otherReturned : item.quantity;

            return {
                purchaseItemId: item.purchase_item_id || item.purchaseItem?.id,
                productId: item.product_id,
                productName: item.product?.name || item.purchaseItem?.product?.name || 'Unknown item',
                quantity: item.quantity,
                unitCost: Number(item.unit_cost || 0),
                maxQuantity,
            };
        });

        setEditItems(items);
    }, [isEditMode, purchaseReturn]);

    useEffect(() => {
        if (shouldAutoPrint && purchaseReturn && !isEditMode) {
            window.setTimeout(() => handlePrint(), 150);
        }
    }, [shouldAutoPrint, purchaseReturn, isEditMode]);

    const loadPurchaseReturn = async (id: string) => {
        try {
            const data = await api.getPurchaseReturn(id);
            setPurchaseReturn(data);
        } catch (error) {
            console.error('Failed to load purchase return', error);
            setPurchaseReturn(null);
        } finally {
            setLoading(false);
        }
    };

    const updateItemQuantity = (index: number, value: string) => {
        const parsed = parseInt(value, 10) || 0;
        const item = editItems[index];
        if (!item) {
            return;
        }

        const safeQuantity = Math.max(0, Math.min(item.maxQuantity, parsed));
        setEditItems((current) => current.map((entry, entryIndex) => (
            entryIndex === index ? { ...entry, quantity: safeQuantity } : entry
        )));
    };

    const removeItem = (index: number) => {
        setEditItems((current) => current.filter((_, entryIndex) => entryIndex !== index));
    };

    const editTotal = editItems.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);

    const handleSave = async () => {
        if (!purchaseReturn) {
            return;
        }

        const itemsToSave = editItems.filter((item) => item.quantity > 0);
        if (itemsToSave.length === 0) {
            window.alert('At least one return line must remain with quantity greater than zero.');
            return;
        }

        setSaving(true);
        try {
            await api.updatePurchaseReturn(purchaseReturn.id, {
                referenceNumber: editReferenceNumber || undefined,
                notes: editNotes || undefined,
                items: itemsToSave.map((item) => ({
                    purchaseItemId: item.purchaseItemId,
                    quantity: item.quantity,
                })),
            });

            await loadPurchaseReturn(purchaseReturn.id);
            router.push(`/dashboard/purchase-returns/${purchaseReturn.id}`);
        } catch (error) {
            console.error('Failed to update purchase return', error);
            window.alert('Failed to save purchase return. Please review the changes and try again.');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!purchaseReturn) {
            return;
        }

        if (!window.confirm('Are you sure you want to delete this purchase return?')) {
            return;
        }

        setDeleting(true);
        try {
            await api.deletePurchaseReturn(purchaseReturn.id);
            router.push('/dashboard/purchase-returns');
        } catch (error) {
            console.error('Failed to delete purchase return', error);
            window.alert('Failed to delete purchase return. Please try again.');
        } finally {
            setDeleting(false);
        }
    };

    const handlePrint = () => {
        if (!purchaseReturn) {
            return;
        }

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            return;
        }

        const itemRows = (purchaseReturn.items || [])
            .map(
                (item: any) => `
                    <tr>
                        <td>${item.product?.name || 'Unknown item'}</td>
                        <td class="text-center">${item.quantity}</td>
                        <td class="text-right">${formatBDT(Number(item.unit_cost || 0))}</td>
                        <td class="text-right">${formatBDT(Number(item.line_total || 0))}</td>
                    </tr>
                `,
            )
            .join('');

        printWindow.document.write(`
            <html>
            <head>
                <title>${purchaseReturn.return_number}</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; color: #111; }
                    h1 { font-size: 24px; margin-bottom: 4px; }
                    .subtitle { color: #666; font-size: 12px; margin-bottom: 20px; }
                    .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 20px; }
                    .meta-box { padding: 12px; background: #f9f9f9; border-radius: 8px; }
                    .meta-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #999; display: block; margin-bottom: 4px; }
                    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
                    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #eee; }
                    th { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #999; }
                    .text-right { text-align: right; }
                    .text-center { text-align: center; }
                    .total-row { font-weight: bold; border-top: 2px solid #333; }
                    .note-section { margin-top: 20px; padding: 12px; background: #f9f9f9; border-radius: 8px; }
                    .footer { margin-top: 40px; text-align: center; color: #999; font-size: 11px; }
                </style>
            </head>
            <body>
                <h1>${purchaseReturn.return_number}</h1>
                <div class="subtitle">
                    Date: ${new Date(purchaseReturn.created_at).toLocaleString()} | Source Purchase: ${purchaseReturn.purchase?.purchase_number || '-'}
                </div>
                <div class="meta-grid">
                    <div class="meta-box">
                        <span class="meta-label">Supplier</span>
                        <span>${purchaseReturn.supplier?.name || 'Unlinked supplier'}</span>
                    </div>
                    <div class="meta-box">
                        <span class="meta-label">Reference</span>
                        <span>${purchaseReturn.reference_number || 'No reference number provided'}</span>
                    </div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Product</th>
                            <th class="text-center">Qty</th>
                            <th class="text-right">Unit Cost</th>
                            <th class="text-right">Line Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemRows}
                        <tr class="total-row">
                            <td colspan="3">Total</td>
                            <td class="text-right">${formatBDT(Number(purchaseReturn.total_amount || 0))}</td>
                        </tr>
                    </tbody>
                </table>
                <div class="note-section">
                    <strong>Notes:</strong> ${purchaseReturn.notes || 'No notes added for this return.'}
                </div>
                <div class="footer">Purchase return documentation</div>
            </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.print();
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full bg-[#f3f4f6]">
                <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">Loading purchase return...</p>
            </div>
        );
    }

    if (!purchaseReturn) {
        return (
            <div className="flex items-center justify-center h-full bg-[#f3f4f6]">
                <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">Purchase return not found</p>
            </div>
        );
    }

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-4xl mx-auto space-y-6">
                {isEditMode && (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3 flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <Pencil className="w-4 h-4 text-amber-600" />
                            <span className="text-sm font-bold text-amber-800">
                                Edit Mode — update quantities, reference, and notes with purchase-level caps applied
                            </span>
                        </div>
                        <div className="flex items-center space-x-3">
                            <button
                                onClick={handleSave}
                                disabled={saving || editItems.filter((item) => item.quantity > 0).length === 0}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg font-bold text-xs uppercase tracking-widest shadow-sm flex items-center space-x-1.5 transition-all disabled:opacity-50"
                            >
                                <Save className="w-3.5 h-3.5" />
                                <span>{saving ? 'Saving...' : 'Save Changes'}</span>
                            </button>
                            <button
                                onClick={() => router.push(`/dashboard/purchase-returns/${purchaseReturn.id}`)}
                                className="text-xs font-bold uppercase tracking-widest text-amber-600 hover:text-amber-800 transition-colors flex items-center space-x-1"
                            >
                                <X className="w-3.5 h-3.5" />
                                <span>Cancel</span>
                            </button>
                        </div>
                    </div>
                )}

                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                        <button
                            onClick={() => router.push('/dashboard/purchase-returns')}
                            className="p-2 bg-white rounded-xl shadow-sm hover:shadow-md transition-all text-gray-400 hover:text-gray-900"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <div>
                            <h1 className="text-2xl font-black tracking-tight">{purchaseReturn.return_number}</h1>
                            <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                                {new Date(purchaseReturn.created_at).toLocaleString()}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center space-x-3">
                        {!isEditMode && (
                            <>
                                <button
                                    onClick={() => router.push(`/dashboard/purchase-returns/${purchaseReturn.id}?edit=true`)}
                                    className="bg-white hover:bg-amber-50 text-gray-700 hover:text-amber-700 border border-gray-200 hover:border-amber-300 px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-sm flex items-center space-x-2 transition-all hover:-translate-y-0.5"
                                >
                                    <Pencil className="w-4 h-4" />
                                    <span>Edit</span>
                                </button>
                                <button
                                    onClick={handlePrint}
                                    className="bg-gray-900 hover:bg-blue-600 text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-md flex items-center space-x-2 transition-all hover:-translate-y-0.5"
                                >
                                    <Printer className="w-4 h-4" />
                                    <span>Print Preview</span>
                                </button>
                                <button
                                    onClick={handleDelete}
                                    disabled={deleting}
                                    className="bg-white hover:bg-red-50 text-red-600 border border-red-200 hover:border-red-300 px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-sm flex items-center space-x-2 transition-all hover:-translate-y-0.5 disabled:opacity-50"
                                >
                                    <Trash2 className="w-4 h-4" />
                                    <span>{deleting ? 'Deleting...' : 'Delete'}</span>
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {isEditMode ? (
                    <div className="grid grid-cols-4 gap-4">
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Source Purchase</span>
                            <span className="text-sm font-black text-gray-900">{purchaseReturn.purchase?.purchase_number || '-'}</span>
                        </div>
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Supplier</span>
                            <span className="text-sm font-bold text-gray-700">{purchaseReturn.supplier?.name || 'Unlinked supplier'}</span>
                        </div>
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Editable Items</span>
                            <span className="text-xl font-black text-gray-900">{editItems.filter((item) => item.quantity > 0).length}</span>
                        </div>
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">New Total</span>
                            <span className="text-xl font-black text-emerald-600">{formatBDT(editTotal)}</span>
                            {editTotal !== Number(purchaseReturn.total_amount || 0) && (
                                <span className="block text-xs font-bold mt-1 text-gray-400">
                                    Was: {formatBDT(Number(purchaseReturn.total_amount || 0))}
                                </span>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-5 gap-4">
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Source Purchase</span>
                            <span className="text-sm font-black text-gray-900">{purchaseReturn.purchase?.purchase_number || '-'}</span>
                        </div>
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Supplier</span>
                            <span className="text-sm font-bold text-gray-700">{purchaseReturn.supplier?.name || 'Unlinked supplier'}</span>
                        </div>
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Status</span>
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border bg-emerald-50 text-emerald-700 border-emerald-200">
                                {purchaseReturn.status || 'RECORDED'}
                            </span>
                        </div>
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Items</span>
                            <span className="text-xl font-black text-gray-900">{purchaseReturn.items?.length || 0}</span>
                        </div>
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Total</span>
                            <span className="text-xl font-black text-emerald-600">{formatBDT(Number(purchaseReturn.total_amount || 0))}</span>
                        </div>
                    </div>
                )}

                <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-gray-100 flex items-center space-x-3">
                        <div className="p-2 bg-emerald-50 rounded-xl text-emerald-600">
                            <Undo2 className="w-5 h-5" />
                        </div>
                        <h2 className="text-lg font-black tracking-tight">Return Lines</h2>
                    </div>
                    {isEditMode ? (
                        <div className="p-6">
                            {editItems.length === 0 ? (
                                <div className="text-center py-8 text-gray-300">
                                    <Undo2 className="w-8 h-8 mx-auto mb-2" />
                                    <p className="text-xs font-bold uppercase tracking-widest">No items remain in this return</p>
                                </div>
                            ) : (
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-gray-100">
                                            <th className="text-left pb-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Product</th>
                                            <th className="text-center pb-2 text-[10px] font-black uppercase tracking-widest text-gray-400 w-24">Qty</th>
                                            <th className="text-center pb-2 text-[10px] font-black uppercase tracking-widest text-gray-400 w-20">Max</th>
                                            <th className="text-right pb-2 text-[10px] font-black uppercase tracking-widest text-gray-400 w-28">Unit Cost</th>
                                            <th className="text-right pb-2 text-[10px] font-black uppercase tracking-widest text-gray-400 w-28">Line Total</th>
                                            <th className="w-10"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {editItems.map((item, index) => (
                                            <tr key={`${item.purchaseItemId}-${index}`}>
                                                <td className="py-3">
                                                    <span className="text-sm font-bold">{item.productName}</span>
                                                </td>
                                                <td className="py-3">
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        max={item.maxQuantity}
                                                        value={item.quantity}
                                                        onChange={(event) => updateItemQuantity(index, event.target.value)}
                                                        className="w-full text-center bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                                                    />
                                                </td>
                                                <td className="py-3 text-center text-xs font-bold text-gray-400 uppercase tracking-widest">{item.maxQuantity}</td>
                                                <td className="py-3 text-right text-sm font-bold text-gray-700">{formatBDT(item.unitCost)}</td>
                                                <td className="py-3 text-right text-sm font-black text-emerald-600">{formatBDT(item.quantity * item.unitCost)}</td>
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
                                    <tfoot>
                                        <tr className="border-t-2 border-gray-200">
                                            <td colSpan={4} className="pt-3 text-right text-sm font-black uppercase tracking-widest">Total</td>
                                            <td className="pt-3 text-right text-xl font-black text-emerald-600">{formatBDT(editTotal)}</td>
                                            <td></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            )}
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-gray-100 bg-gray-50/80">
                                        <th className="text-left p-3 text-[10px] font-black uppercase tracking-widest text-gray-400">Product</th>
                                        <th className="text-center p-3 text-[10px] font-black uppercase tracking-widest text-gray-400 w-28">Qty</th>
                                        <th className="text-right p-3 text-[10px] font-black uppercase tracking-widest text-gray-400 w-32">Unit Cost</th>
                                        <th className="text-right p-3 text-[10px] font-black uppercase tracking-widest text-gray-400 w-32">Line Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {(purchaseReturn.items || []).map((item: any) => (
                                        <tr key={item.id}>
                                            <td className="p-3">
                                                <span className="text-sm font-bold text-gray-900">{item.product?.name || 'Unknown item'}</span>
                                            </td>
                                            <td className="p-3 text-center text-sm font-bold text-gray-700">{item.quantity}</td>
                                            <td className="p-3 text-right text-sm font-bold text-gray-700">{formatBDT(Number(item.unit_cost || 0))}</td>
                                            <td className="p-3 text-right text-sm font-black text-emerald-600">{formatBDT(Number(item.line_total || 0))}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white p-5 rounded-3xl shadow-sm">
                        <div className="flex items-center space-x-2 mb-3">
                            <Receipt className="w-4 h-4 text-gray-400" />
                            <h3 className="text-sm font-black tracking-tight">Reference</h3>
                        </div>
                        {isEditMode ? (
                            <input
                                type="text"
                                value={editReferenceNumber}
                                onChange={(event) => setEditReferenceNumber(event.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                                placeholder="Supplier or credit reference"
                            />
                        ) : (
                            <p className="text-sm font-bold text-gray-700">{purchaseReturn.reference_number || 'No reference number provided'}</p>
                        )}
                    </div>
                    <div className="bg-white p-5 rounded-3xl shadow-sm">
                        <div className="flex items-center space-x-2 mb-3">
                            <Receipt className="w-4 h-4 text-gray-400" />
                            <h3 className="text-sm font-black tracking-tight">Notes</h3>
                        </div>
                        {isEditMode ? (
                            <textarea
                                value={editNotes}
                                onChange={(event) => setEditNotes(event.target.value)}
                                rows={4}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-blue-500/20 resize-none"
                                placeholder="Operational notes or supplier context"
                            />
                        ) : (
                            <p className="text-sm font-medium text-gray-700">{purchaseReturn.notes || 'No notes added for this return.'}</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}