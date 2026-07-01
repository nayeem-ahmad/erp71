'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ShoppingCart } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

interface PurchaseQuotation {
    id: string;
    rfq_number: string;
    status: string;
    valid_until: string | null;
    created_at: string;
    notes: string | null;
    total_amount: string;
    supplier?: { id: string; name: string; phone: string | null; email: string | null } | null;
    store?: { name: string } | null;
    items: {
        id: string;
        quantity: number;
        unit_cost: string;
        line_total: string;
        product?: { id: string; name: string; sku: string | null } | null;
    }[];
}

const statusStyles: Record<string, string> = {
    DRAFT:     'bg-gray-100 text-gray-700',
    SENT:      'bg-blue-100 text-blue-700',
    RECEIVED:  'bg-amber-100 text-amber-700',
    ACCEPTED:  'bg-emerald-100 text-emerald-700',
    REJECTED:  'bg-red-100 text-red-600',
    CONVERTED: 'bg-violet-100 text-violet-700',
    CANCELLED: 'bg-gray-100 text-gray-500',
};

const nextActions: Record<string, { label: string; next: string; color: string }[]> = {
    DRAFT:    [
        { label: 'Mark as Sent', next: 'SENT', color: 'bg-blue-600 hover:bg-blue-700' },
        { label: 'Cancel RFQ', next: 'CANCELLED', color: 'bg-red-500 hover:bg-red-600' },
    ],
    SENT:     [
        { label: 'Mark Quote Received', next: 'RECEIVED', color: 'bg-amber-600 hover:bg-amber-700' },
        { label: 'Cancel RFQ', next: 'CANCELLED', color: 'bg-red-500 hover:bg-red-600' },
    ],
    RECEIVED: [
        { label: 'Accept Quote', next: 'ACCEPTED', color: 'bg-emerald-600 hover:bg-emerald-700' },
        { label: 'Reject Quote', next: 'REJECTED', color: 'bg-red-500 hover:bg-red-600' },
    ],
    ACCEPTED:  [],
    REJECTED:  [],
    CONVERTED: [],
    CANCELLED: [],
};

export default function PurchaseQuotationDetailPage() {
    const { t, locale } = useI18n();
    const params = useParams();
    const router = useRouter();
    const [rfq, setRfq] = useState<PurchaseQuotation | null>(null);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!params.id) return;
        void load();
    }, [params.id]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getPurchaseQuotation(params.id as string);
            setRfq(data);
        } catch {
            setError('Failed to load purchase quotation');
        } finally {
            setLoading(false);
        }
    };

    const handleStatusUpdate = async (status: string) => {
        if (!rfq) return;
        setUpdating(true);
        setError('');
        try {
            const updated = await api.updatePurchaseQuotationStatus(rfq.id, status);
            setRfq(updated);
        } catch (err: any) {
            setError(err.message || 'Failed to update status');
        } finally {
            setUpdating(false);
        }
    };

    const handleConvert = async () => {
        if (!rfq) return;
        if (!window.confirm(formatMessage(t.purchaseQuotations.convertConfirm, { rfqNumber: rfq.rfq_number }))) return;
        setUpdating(true);
        setError('');
        try {
            const po = await api.convertPurchaseQuotation(rfq.id);
            alert(formatMessage(t.purchaseQuotations.convertSuccess, { poNumber: po.po_number }));
            router.push(`/purchases/orders/${po.id}`);
        } catch (err: any) {
            setError(err.message || 'Conversion failed');
            setUpdating(false);
        }
    };

    if (loading) return <div className="flex items-center justify-center h-full"><p className="text-gray-400 text-sm">Loading…</p></div>;
    if (error && !rfq) return <div className="flex items-center justify-center h-full"><p className="text-red-500 text-sm">{error}</p></div>;
    if (!rfq) return null;

    const total = parseFloat(rfq.total_amount);
    const actions = nextActions[rfq.status] ?? [];

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="max-w-[1000px] mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <button onClick={() => router.push('/purchases/quotations')}
                        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900">
                        <ArrowLeft className="w-4 h-4" /> {t.purchaseQuotations.detail.back}
                    </button>
                    {rfq.status === 'ACCEPTED' && (
                        <button onClick={handleConvert} disabled={updating}
                            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-black uppercase tracking-widest shadow-md disabled:opacity-50 transition-all hover:-translate-y-0.5">
                            <ShoppingCart className="w-4 h-4" />
                            {t.purchaseQuotations.detail.convertToPo}
                        </button>
                    )}
                </div>

                {error && <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold">{error}</div>}

                {/* RFQ summary card */}
                <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
                    <div className="flex items-start justify-between">
                        <div>
                            <h1 className="text-lg font-bold tracking-tight text-gray-950">{rfq.rfq_number}</h1>
                            <p className="text-gray-400 text-xs font-bold uppercase tracking-widest mt-0.5">
                                Created {formatDate(rfq.created_at, locale)}
                                {rfq.valid_until ? ` · Valid until ${formatDate(rfq.valid_until, locale)}` : ''}
                            </p>
                        </div>
                        <span className={`px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-widest ${statusStyles[rfq.status]}`}>
                            {rfq.status}
                        </span>
                    </div>

                    <div className="grid grid-cols-2 gap-6 pt-2 border-t border-gray-100">
                        <div>
                            <p className="text-xs font-medium text-gray-500 mb-1">{t.purchaseQuotations.detail.supplier}</p>
                            {rfq.supplier ? (
                                <div>
                                    <p className="text-sm font-bold text-gray-900">{rfq.supplier.name}</p>
                                    {rfq.supplier.phone && <p className="text-sm text-gray-500">{rfq.supplier.phone}</p>}
                                    {rfq.supplier.email && <p className="text-sm text-gray-500">{rfq.supplier.email}</p>}
                                </div>
                            ) : <p className="text-sm text-gray-400 italic">{t.purchaseQuotations.detail.noSupplierLinked}</p>}
                        </div>
                        <div>
                            <p className="text-xs font-medium text-gray-500 mb-1">{t.common.branch}</p>
                            <p className="text-sm font-bold text-gray-900">{rfq.store?.name ?? '—'}</p>
                        </div>
                    </div>
                </div>

                {/* Line items */}
                <div className="bg-white rounded-2xl border border-gray-100 p-6">
                    <h2 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-4">{t.purchaseQuotations.detail.requestedItems}</h2>
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-100">
                                <th className="text-left pb-3 text-xs font-medium text-gray-500">{t.common.product}</th>
                                <th className="text-left pb-3 text-xs font-medium text-gray-500">{t.purchases.invoice.sku}</th>
                                <th className="text-center pb-3 text-xs font-medium text-gray-500">{t.purchaseShared.qty}</th>
                                <th className="text-right pb-3 text-xs font-medium text-gray-500">{t.purchaseShared.unitCost}</th>
                                <th className="text-right pb-3 text-xs font-medium text-gray-500">{t.purchaseShared.lineTotal}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {rfq.items.map((item) => (
                                <tr key={item.id}>
                                    <td className="py-3 font-medium">{item.product?.name ?? t.purchaseShared.unknownProduct}</td>
                                    <td className="py-3 text-gray-400 font-mono text-xs">{item.product?.sku ?? '—'}</td>
                                    <td className="py-3 text-center">{item.quantity}</td>
                                    <td className="py-3 text-right">{formatBDT(parseFloat(item.unit_cost), { locale })}</td>
                                    <td className="py-3 text-right font-bold">{formatBDT(parseFloat(item.line_total), { locale })}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    <div className="flex justify-end mt-4 pt-4 border-t border-gray-100">
                        <div className="w-48 text-sm">
                            <div className="flex justify-between font-black text-base">
                                <span>{t.purchases.invoice.total}</span>
                                <span className="text-blue-700">{formatBDT(total, { locale })}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {rfq.notes && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
                        <span className="font-bold">{t.purchases.invoice.notePrefix} </span>{rfq.notes}
                    </div>
                )}

                {/* Status actions */}
                {actions.length > 0 && (
                    <div className="bg-white rounded-2xl border border-gray-100 p-6">
                        <h2 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-4">{t.purchaseQuotations.detail.actions}</h2>
                        <div className="flex gap-3">
                            {actions.map((action) => (
                                <button key={action.next} onClick={() => handleStatusUpdate(action.next)} disabled={updating}
                                    className={`px-5 py-2.5 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-md disabled:opacity-50 transition-all hover:-translate-y-0.5 ${action.color}`}>
                                    {updating ? t.purchaseQuotations.detail.updating : action.label}
                                </button>
                            ))}
                        </div>
                        {rfq.status === 'RECEIVED' && (
                            <p className="text-xs text-gray-400 mt-3">
                                {t.purchaseQuotations.detail.acceptHint}
                            </p>
                        )}
                    </div>
                )}

                {rfq.status === 'ACCEPTED' && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-800">
                        <span className="font-bold">{t.purchaseQuotations.detail.quoteAccepted}</span> {t.purchaseQuotations.detail.quoteAcceptedHint}
                    </div>
                )}

                {rfq.status === 'CONVERTED' && (
                    <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 text-sm text-violet-800">
                        <span className="font-bold">{t.purchaseQuotations.detail.convertedBanner}</span> {t.purchaseQuotations.detail.convertedMessage}{' '}
                        <button onClick={() => router.push('/purchases/orders')} className="underline font-bold">
                            {t.purchaseQuotations.detail.viewPurchaseOrders}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
