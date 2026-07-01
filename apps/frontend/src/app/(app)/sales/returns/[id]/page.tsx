'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Printer, Save, Package, FileText, Pencil, X, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

interface EditItem {
    saleItemId: string;
    productId: string;
    productName: string;
    quantity: number;
    priceAtSale: number;
    maxQuantity: number;
}

function ReturnDetailPageContent() {
    const { t, locale } = useI18n();
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const printRef = useRef<HTMLDivElement>(null);
    const [ret, setRet] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const isEditMode = searchParams.get('edit') === 'true';

    // Edit state
    const [editReason, setEditReason] = useState('');
    const [editItems, setEditItems] = useState<EditItem[]>([]);

    useEffect(() => {
        if (params.id) {
            loadReturn(params.id as string);
        }
    }, [params.id]);

    useEffect(() => {
        if (isEditMode && ret) {
            setEditReason(ret.reason || '');
            // Build editable items from the return items, enriched with original sale info
            const items: EditItem[] = (ret.items || []).map((item: any) => {
                // Find the matching sale item to get max returnable qty
                const saleItem = ret.sale?.items?.find((si: any) => si.id === item.sale_item_id);
                // Other returns for this sale item (excluding items from THIS return)
                const otherReturned = saleItem
                    ? saleItem.returns
                          .filter((r: any) => r.return_id !== ret.id)
                          .reduce((sum: number, r: any) => sum + r.quantity, 0)
                    : 0;
                const maxQty = saleItem ? saleItem.quantity - otherReturned : item.quantity;

                return {
                    saleItemId: item.sale_item_id,
                    productId: item.product_id,
                    productName: item.product?.name || t.shared.unknown,
                    quantity: item.quantity,
                    priceAtSale: saleItem ? parseFloat(saleItem.price_at_sale) : parseFloat(item.refund_amount) / item.quantity,
                    maxQuantity: maxQty,
                };
            });
            setEditItems(items);
        }
    }, [isEditMode, ret]);

    const loadReturn = async (id: string) => {
        try {
            const data = await api.getReturn(id);
            setRet(data);
        } catch (error) {
            console.error('Failed to load return', error);
        } finally {
            setLoading(false);
        }
    };

    const editTotal = editItems.reduce((sum, i) => sum + i.quantity * i.priceAtSale, 0);

    const updateItemQuantity = (index: number, val: string) => {
        const num = parseInt(val) || 0;
        if (num < 0) return;
        const item = editItems[index];
        if (num > item.maxQuantity) return;
        setEditItems(editItems.map((it, i) => (i === index ? { ...it, quantity: num } : it)));
    };

    const removeItem = (index: number) => {
        setEditItems(editItems.filter((_, i) => i !== index));
    };

    const handleSave = async () => {
        if (!ret) return;
        const itemsToSave = editItems.filter((i) => i.quantity > 0);
        if (itemsToSave.length === 0) {
            alert(t.shared.form.atLeastOneReturnItem);
            return;
        }
        setSaving(true);
        try {
            await api.updateReturn(ret.id, {
                reason: editReason,
                items: itemsToSave.map((i) => ({
                    saleItemId: i.saleItemId,
                    productId: i.productId,
                    quantity: i.quantity,
                })),
            });
            await loadReturn(ret.id);
            router.push(`/sales/returns/${ret.id}`);
        } catch (error) {
            console.error('Failed to save return', error);
            alert(t.shared.errors.saveReturn);
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
                <title>Return ${ret?.return_number}</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; color: #111; }
                    h1 { font-size: 24px; margin-bottom: 4px; }
                    .subtitle { color: #666; font-size: 12px; margin-bottom: 20px; }
                    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
                    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #eee; }
                    th { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #999; }
                    .total-row { font-weight: bold; border-top: 2px solid #333; }
                    .note-section { margin-top: 20px; padding: 12px; background: #f9f9f9; border-radius: 8px; }
                    .footer { margin-top: 40px; text-align: center; color: #999; font-size: 11px; }
                </style>
            </head>
            <body>
                ${printContent.innerHTML}
                <div class="footer">{t.shared.print.returnProcessed}</div>
            </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.print();
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full bg-[#f3f4f6]">
                <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">{t.shared.loading.return}</p>
            </div>
        );
    }

    if (!ret) {
        return (
            <div className="flex items-center justify-center h-full bg-[#f3f4f6]">
                <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">{t.shared.notFound.return}</p>
            </div>
        );
    }

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="max-w-4xl mx-auto space-y-6">
                {/* Edit Mode Banner */}
                {isEditMode && (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3 flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <Pencil className="w-4 h-4 text-amber-600" />
                            <span className="text-sm font-bold text-amber-800">
                                Edit Mode — Modify item quantities and reason
                            </span>
                        </div>
                        <div className="flex items-center space-x-3">
                            <button
                                onClick={handleSave}
                                disabled={saving || editItems.filter((i) => i.quantity > 0).length === 0}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg font-bold text-xs uppercase tracking-widest shadow-sm flex items-center space-x-1.5 transition-all disabled:opacity-50"
                            >
                                <Save className="w-3.5 h-3.5" />
                                <span>{saving ? t.returns.detail.saving : t.returns.detail.saveChanges}</span>
                            </button>
                            <button
                                onClick={() => router.push(`/sales/returns/${ret.id}`)}
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
                        <button
                            onClick={() => router.push('/sales/returns')}
                            className="p-2 bg-white rounded-xl shadow-sm hover:shadow-md transition-all text-gray-400 hover:text-gray-900"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <div>
                            <h1 className="text-lg font-bold tracking-tight text-gray-950">{ret.return_number}</h1>
                            <p className="text-xs text-gray-500 mt-0.5">
                                {new Date(ret.created_at).toLocaleString()}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center space-x-3">
                        {!isEditMode && (
                            <>
                                <button
                                    onClick={() => router.push(`/sales/returns/${ret.id}?edit=true`)}
                                    className="bg-white hover:bg-amber-50 text-gray-700 hover:text-amber-700 border border-gray-200 hover:border-amber-300 px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-sm flex items-center space-x-2 transition-all hover:-translate-y-0.5"
                                >
                                    <Pencil className="w-4 h-4" />
                                    <span>{t.returns.detail.edit}</span>
                                </button>
                                <button
                                    onClick={handlePrint}
                                    className="bg-gray-900 hover:bg-blue-600 text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-md flex items-center space-x-2 transition-all hover:-translate-y-0.5"
                                >
                                    <Printer className="w-4 h-4" />
                                    <span>{t.returns.detail.printPreview}</span>
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Summary cards */}
                {isEditMode ? (
                    <div className="grid grid-cols-3 gap-4">
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <span className="text-xs font-medium text-gray-500 block mb-1">{t.returns.columns.originalReceipt}</span>
                            <span className="text-sm font-black text-gray-900">{ret.sale?.serial_number || '-'}</span>
                        </div>
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <span className="text-xs font-medium text-gray-500 block mb-1">{t.returns.detail.newTotalRefund}</span>
                            <span className="text-xl font-black text-rose-600">{formatBDT(editTotal, { locale })}</span>
                            {editTotal !== parseFloat(ret.total_refund) && (
                                <span className="block text-xs font-bold mt-1 text-gray-400">
                                    {formatMessage(t.returns.detail.was, { amount: formatBDT(parseFloat(ret.total_refund), { locale }) })}
                                </span>
                            )}
                        </div>
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <span className="text-xs font-medium text-gray-500 block mb-1">{t.returns.columns.items}</span>
                            <span className="text-xl font-black text-gray-900">{editItems.filter((i) => i.quantity > 0).length}</span>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-4 gap-4">
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <span className="text-xs font-medium text-gray-500 block mb-1">{t.returns.columns.originalReceipt}</span>
                            <span className="text-sm font-black text-gray-900">{ret.sale?.serial_number || '-'}</span>
                        </div>
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <span className="text-xs font-medium text-gray-500 block mb-1">{t.returns.detail.totalRefund}</span>
                            <span className="text-xl font-black text-rose-600">{formatBDT(parseFloat(ret.total_refund), { locale })}</span>
                        </div>
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <span className="text-xs font-medium text-gray-500 block mb-1">{t.returns.detail.itemsReturned}</span>
                            <span className="text-xl font-black text-gray-900">{ret.items?.length || 0}</span>
                        </div>
                        <div className="bg-white p-4 rounded-2xl shadow-sm">
                            <span className="text-xs font-medium text-gray-500 block mb-1">{t.common.status}</span>
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border bg-emerald-50 text-emerald-700 border-emerald-200">
                                {t.shared.statuses.return[(ret.status || 'COMPLETED') as keyof typeof t.shared.statuses.return] ?? ret.status}
                            </span>
                        </div>
                    </div>
                )}

                {/* Print-ready content (hidden on screen) */}
                <div ref={printRef} className="hidden">
                    <h1>{ret.return_number}</h1>
                    <div className="subtitle">Date: {new Date(ret.created_at).toLocaleString()} | {t.returns.columns.originalReceipt}: {ret.sale?.serial_number || '-'}</div>
                    <table>
                        <thead>
                            <tr>
                                <th>{t.shared.columns.product}</th>
                                <th>{t.shared.columns.qty}</th>
                                <th>{t.shared.refund}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {ret.items?.map((item: any) => (
                                <tr key={item.id}>
                                    <td>{item.product?.name || t.shared.unknown}</td>
                                    <td>{item.quantity}</td>
                                    <td>{formatBDT(parseFloat(item.refund_amount), { locale })}</td>
                                </tr>
                            ))}
                            <tr className="total-row">
                                <td colSpan={2}>{t.returns.detail.totalRefund}</td>
                                <td>{formatBDT(parseFloat(ret.total_refund), { locale })}</td>
                            </tr>
                        </tbody>
                    </table>
                    {ret.reason && (
                        <div className="note-section">
                            <strong>{t.returns.detail.reason}:</strong> {ret.reason}
                        </div>
                    )}
                </div>

                {/* {t.returns.detail.returnedItems} Section */}
                <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-gray-100 flex items-center space-x-3">
                        <div className="p-2 bg-rose-50 rounded-xl text-rose-600">
                            <Package className="w-5 h-5" />
                        </div>
                        <h2 className="text-lg font-black tracking-tight">{t.returns.detail.returnedItems}</h2>
                    </div>

                    {isEditMode ? (
                        <div className="p-6">
                            {editItems.length === 0 ? (
                                <div className="text-center py-8 text-gray-300">
                                    <Package className="w-8 h-8 mx-auto mb-2" />
                                    <p className="text-xs font-bold uppercase tracking-widest">{t.shared.empty.noItemsRemoved}</p>
                                </div>
                            ) : (
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-gray-100">
                                            <th className="text-left pb-2 text-xs font-medium text-gray-500">{t.shared.columns.product}</th>
                                            <th className="text-center pb-2 text-xs font-medium text-gray-500 w-24">{t.shared.columns.qty}</th>
                                            <th className="text-center pb-2 text-xs font-medium text-gray-500 w-20">{t.shared.max}</th>
                                            <th className="text-right pb-2 text-xs font-medium text-gray-500 w-28">{t.shared.columns.unitPrice}</th>
                                            <th className="text-right pb-2 text-xs font-medium text-gray-500 w-28">{t.shared.refund}</th>
                                            <th className="w-10"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {editItems.map((item, idx) => (
                                            <tr key={idx}>
                                                <td className="py-3">
                                                    <span className="text-sm font-bold">{item.productName}</span>
                                                </td>
                                                <td className="py-3">
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        max={item.maxQuantity}
                                                        value={item.quantity}
                                                        onChange={(e) => updateItemQuantity(idx, e.target.value)}
                                                        className="w-full text-center bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                                                    />
                                                </td>
                                                <td className="py-3 text-center text-xs font-bold text-gray-400 uppercase tracking-widest">
                                                    {item.maxQuantity}
                                                </td>
                                                <td className="py-3 text-right text-sm font-bold text-gray-500">
                                                    {formatBDT(item.priceAtSale, { locale })}
                                                </td>
                                                <td className="py-3 text-right text-sm font-black text-rose-600">
                                                    {formatBDT(item.quantity * item.priceAtSale, { locale })}
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
                                            <td colSpan={4} className="pt-3 text-right text-sm font-black uppercase tracking-widest">{t.returns.detail.totalRefund}</td>
                                            <td className="pt-3 text-right text-xl font-black text-rose-600">{formatBDT(editTotal, { locale })}</td>
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
                                    <th className="text-center p-4 text-xs font-medium text-gray-500">{t.returns.detail.qtyReturned}</th>
                                    <th className="text-right p-4 text-xs font-medium text-gray-500">{t.shared.columns.refundAmount}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {ret.items?.map((item: any) => (
                                    <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                                        <td className="p-4">
                                            <div className="flex items-center space-x-3">
                                                <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center">
                                                    <Package className="w-4 h-4 text-gray-200" />
                                                </div>
                                                <span className="text-sm font-black text-gray-900">{item.product?.name || t.shared.unknown}</span>
                                            </div>
                                        </td>
                                        <td className="p-4 text-center text-sm font-black">{item.quantity}</td>
                                        <td className="p-4 text-right text-sm font-black text-rose-600">{formatBDT(parseFloat(item.refund_amount), { locale })}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="border-t-2 border-gray-200">
                                    <td colSpan={2} className="p-4 text-right text-sm font-black uppercase tracking-widest">{t.returns.detail.totalRefund}</td>
                                    <td className="p-4 text-right text-xl font-black text-rose-600">{formatBDT(parseFloat(ret.total_refund), { locale })}</td>
                                </tr>
                            </tfoot>
                        </table>
                    )}
                </div>

                {/* Reason Section */}
                <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-gray-100 flex items-center space-x-3">
                        <div className="p-2 bg-amber-50 rounded-xl text-amber-600">
                            <FileText className="w-5 h-5" />
                        </div>
                        <h2 className="text-lg font-black tracking-tight">{t.returns.detail.reason}</h2>
                    </div>
                    <div className="p-6">
                        {isEditMode ? (
                            <textarea
                                value={editReason}
                                onChange={(e) => setEditReason(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all shadow-sm resize-none"
                                rows={4}
                                placeholder={t.returns.detail.reasonPlaceholder}
                            />
                        ) : (
                            <p className="text-sm text-gray-600">
                                {ret.reason || <span className="text-gray-300 italic">{t.shared.empty.noReason}</span>}
                            </p>
                        )}
                    </div>
                </div>

                {/* Bottom Save Bar in edit mode */}
                {isEditMode && (
                    <div className="flex justify-end space-x-3 pb-6">
                        <button
                            onClick={() => router.push(`/sales/returns/${ret.id}`)}
                            className="px-6 py-3 bg-white border border-gray-200 text-gray-700 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-gray-50 transition-all"
                        >
                            {t.common.cancel}
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving || editItems.filter((i) => i.quantity > 0).length === 0}
                            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-md flex items-center space-x-2 transition-all hover:-translate-y-0.5 disabled:opacity-50"
                        >
                            <Save className="w-4 h-4" />
                            <span>{saving ? t.returns.detail.saving : t.returns.detail.saveChanges}</span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function ReturnDetailPage() {
    return (
        <Suspense>
            <ReturnDetailPageContent />
        </Suspense>
    );
}
