'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';

interface PurchaseOrder {
    id: string;
    po_number: string;
    status: string;
    expected_date: string | null;
    received_at: string | null;
    created_at: string;
    notes: string | null;
    subtotal_amount: string;
    tax_amount: string;
    discount_amount: string;
    freight_amount: string;
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
    RECEIVED:  'bg-emerald-100 text-emerald-700',
    CANCELLED: 'bg-red-100 text-red-600',
};

const nextActions: Record<string, { label: string; next: string; color: string }[]> = {
    DRAFT:    [{ label: 'Mark as Sent', next: 'SENT', color: 'bg-blue-600 hover:bg-blue-700' }, { label: 'Cancel PO', next: 'CANCELLED', color: 'bg-red-500 hover:bg-red-600' }],
    SENT:     [{ label: 'Mark as Received', next: 'RECEIVED', color: 'bg-emerald-600 hover:bg-emerald-700' }, { label: 'Cancel PO', next: 'CANCELLED', color: 'bg-red-500 hover:bg-red-600' }],
    RECEIVED: [],
    CANCELLED:[],
};

export default function PurchaseOrderDetailPage() {
    const params = useParams();
    const router = useRouter();
    const [po, setPo] = useState<PurchaseOrder | null>(null);
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
            const data = await api.getPurchaseOrder(params.id as string);
            setPo(data);
        } catch {
            setError('Failed to load purchase order');
        } finally {
            setLoading(false);
        }
    };

    const handleStatusUpdate = async (status: string) => {
        if (!po) return;
        setUpdating(true);
        setError('');
        try {
            const updated = await api.updatePurchaseOrderStatus(po.id, status);
            setPo(updated);
        } catch (err: any) {
            setError(err.message || 'Failed to update status');
        } finally {
            setUpdating(false);
        }
    };

    if (loading) return <div className="flex items-center justify-center h-full"><p className="text-gray-400 text-sm">Loading…</p></div>;
    if (error && !po) return <div className="flex items-center justify-center h-full"><p className="text-red-500 text-sm">{error}</p></div>;
    if (!po) return null;

    const subtotal = parseFloat(po.subtotal_amount);
    const tax = parseFloat(po.tax_amount);
    const discount = parseFloat(po.discount_amount);
    const freight = parseFloat(po.freight_amount);
    const total = parseFloat(po.total_amount);
    const actions = nextActions[po.status] ?? [];

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1000px] mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <button onClick={() => router.push('/dashboard/purchase-orders')}
                        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900">
                        <ArrowLeft className="w-4 h-4" /> Back to Purchase Orders
                    </button>
                    <Link href={`/dashboard/purchase-orders/${po.id}/invoice`}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 shadow-sm">
                        <Printer className="w-4 h-4" /> Print PO
                    </Link>
                </div>

                {error && <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold">{error}</div>}

                {/* PO summary card */}
                <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
                    <div className="flex items-start justify-between">
                        <div>
                            <h1 className="text-2xl font-black tracking-tight">{po.po_number}</h1>
                            <p className="text-gray-400 text-xs font-bold uppercase tracking-widest mt-0.5">
                                Created {formatDate(po.created_at)}
                                {po.expected_date ? ` · Expected ${formatDate(po.expected_date)}` : ''}
                                {po.received_at ? ` · Received ${formatDate(po.received_at)}` : ''}
                            </p>
                        </div>
                        <span className={`px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-widest ${statusStyles[po.status]}`}>
                            {po.status}
                        </span>
                    </div>

                    <div className="grid grid-cols-2 gap-6 pt-2 border-t border-gray-100">
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Supplier</p>
                            {po.supplier ? (
                                <div>
                                    <p className="text-sm font-bold text-gray-900">{po.supplier.name}</p>
                                    {po.supplier.phone && <p className="text-sm text-gray-500">{po.supplier.phone}</p>}
                                    {po.supplier.email && <p className="text-sm text-gray-500">{po.supplier.email}</p>}
                                </div>
                            ) : <p className="text-sm text-gray-400 italic">No supplier linked</p>}
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Branch</p>
                            <p className="text-sm font-bold text-gray-900">{po.store?.name ?? '—'}</p>
                        </div>
                    </div>
                </div>

                {/* Line items */}
                <div className="bg-white rounded-2xl border border-gray-100 p-6">
                    <h2 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-4">Items</h2>
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-100">
                                <th className="text-left pb-3 text-[10px] font-black uppercase tracking-widest text-gray-400">Product</th>
                                <th className="text-left pb-3 text-[10px] font-black uppercase tracking-widest text-gray-400">SKU</th>
                                <th className="text-center pb-3 text-[10px] font-black uppercase tracking-widest text-gray-400">Qty</th>
                                <th className="text-right pb-3 text-[10px] font-black uppercase tracking-widest text-gray-400">Unit Cost</th>
                                <th className="text-right pb-3 text-[10px] font-black uppercase tracking-widest text-gray-400">Line Total</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {po.items.map((item) => (
                                <tr key={item.id}>
                                    <td className="py-3 font-medium">{item.product?.name ?? 'Unknown'}</td>
                                    <td className="py-3 text-gray-400 font-mono text-xs">{item.product?.sku ?? '—'}</td>
                                    <td className="py-3 text-center">{item.quantity}</td>
                                    <td className="py-3 text-right">{formatBDT(parseFloat(item.unit_cost))}</td>
                                    <td className="py-3 text-right font-bold">{formatBDT(parseFloat(item.line_total))}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {/* Totals */}
                    <div className="flex justify-end mt-4 pt-4 border-t border-gray-100">
                        <div className="w-64 space-y-1.5 text-sm">
                            <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{formatBDT(subtotal)}</span></div>
                            {tax > 0 && <div className="flex justify-between text-gray-600"><span>Tax</span><span>{formatBDT(tax)}</span></div>}
                            {freight > 0 && <div className="flex justify-between text-gray-600"><span>Freight</span><span>{formatBDT(freight)}</span></div>}
                            {discount > 0 && <div className="flex justify-between text-gray-600"><span>Discount</span><span className="text-red-500">−{formatBDT(discount)}</span></div>}
                            <div className="flex justify-between font-black text-base pt-2 border-t border-gray-200">
                                <span>Total</span><span className="text-blue-700">{formatBDT(total)}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {po.notes && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
                        <span className="font-bold">Note: </span>{po.notes}
                    </div>
                )}

                {/* Status actions */}
                {actions.length > 0 && (
                    <div className="bg-white rounded-2xl border border-gray-100 p-6">
                        <h2 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-4">Actions</h2>
                        <div className="flex gap-3">
                            {actions.map((action) => (
                                <button key={action.next} onClick={() => handleStatusUpdate(action.next)} disabled={updating}
                                    className={`px-5 py-2.5 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-md disabled:opacity-50 transition-all hover:-translate-y-0.5 ${action.color}`}>
                                    {updating ? 'Updating…' : action.label}
                                </button>
                            ))}
                        </div>
                        {po.status === 'SENT' && (
                            <p className="text-xs text-gray-400 mt-3">Marking as Received will apply inventory movements automatically.</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
