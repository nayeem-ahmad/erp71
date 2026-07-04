'use client';

import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Loader2, X } from 'lucide-react';
import type { TenantRecord } from './types';
import { api } from '@/lib/api';
import { formatMessage, useI18n } from '@/lib/i18n';

type PaymentDirection = 'payment' | 'refund';

type Props = {
    open: boolean;
    tenants: TenantRecord[];
    defaultTenantId?: string;
    onClose: () => void;
    onSuccess: (message: string) => void;
};

export default function TenantLedgerPaymentModal({ open, tenants, defaultTenantId = '', onClose, onSuccess }: Props) {
    const { t } = useI18n();
    const m = t.admin.tenants;
    const pm = m.payments;
    const ml = m.ledger;
    const lp = m.ledgerPage;

    const [tenantId, setTenantId] = useState(defaultTenantId);
    const [direction, setDirection] = useState<PaymentDirection>('payment');
    const [amount, setAmount] = useState('');
    const [method, setMethod] = useState('');
    const [notes, setNotes] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    if (!open) return null;

    const handleSubmit = async () => {
        if (!tenantId) {
            setError(pm.tenantRequired);
            return;
        }
        const parsedAmount = parseFloat(amount);
        if (!parsedAmount || parsedAmount <= 0) {
            setError(direction === 'payment' ? ml.paymentModal.amountRequired : ml.refundModal.amountRequired);
            return;
        }

        setSubmitting(true);
        setError('');
        try {
            if (direction === 'payment') {
                await api.recordTenantPayment(tenantId, {
                    amount: parsedAmount,
                    method: method || undefined,
                    notes: notes || undefined,
                });
                onSuccess(formatMessage(ml.paymentModal.success, { amount: parsedAmount.toFixed(2) }));
            } else {
                await api.recordTenantRefund(tenantId, {
                    amount: parsedAmount,
                    notes: notes || undefined,
                });
                onSuccess(formatMessage(ml.refundModal.success, { amount: parsedAmount.toFixed(2) }));
            }
            setAmount('');
            setMethod('');
            setNotes('');
            onClose();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : (direction === 'payment' ? ml.paymentModal.failed : ml.refundModal.failed));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-lg rounded-3xl border border-gray-100 bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
                    <h2 className="text-lg font-black text-gray-900">{lp.recordPaymentTitle}</h2>
                    <button type="button" onClick={onClose} className="rounded-xl p-2 text-gray-500 hover:bg-gray-100" aria-label="Close">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="space-y-4 p-6">
                    {error && (
                        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                            {error}
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500">{pm.tenantLabel}</label>
                        <select
                            value={tenantId || defaultTenantId}
                            onChange={(e) => setTenantId(e.target.value)}
                            className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none"
                        >
                            <option value="">{pm.tenantPlaceholder}</option>
                            {tenants.map((tenant) => (
                                <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500">{pm.typeLabel}</label>
                        <div className="flex rounded-2xl border border-gray-100 overflow-hidden">
                            <button
                                type="button"
                                onClick={() => setDirection('payment')}
                                className={`flex-1 inline-flex items-center justify-center gap-2 py-3 text-xs font-black uppercase tracking-widest transition ${direction === 'payment' ? 'bg-emerald-600 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                            >
                                <ArrowDownLeft className="w-3.5 h-3.5" />
                                {pm.receivePayment}
                            </button>
                            <button
                                type="button"
                                onClick={() => setDirection('refund')}
                                className={`flex-1 inline-flex items-center justify-center gap-2 py-3 text-xs font-black uppercase tracking-widest transition ${direction === 'refund' ? 'bg-amber-600 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                            >
                                <ArrowUpRight className="w-3.5 h-3.5" />
                                {pm.issueRefund}
                            </button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500">
                            {direction === 'payment' ? ml.paymentModal.amountLabel : ml.refundModal.amountLabel}
                        </label>
                        <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder={direction === 'payment' ? ml.paymentModal.amountPlaceholder : ml.refundModal.amountPlaceholder}
                            className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                        />
                    </div>

                    {direction === 'payment' && (
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-gray-500">{ml.paymentModal.methodLabel}</label>
                            <input
                                value={method}
                                onChange={(e) => setMethod(e.target.value)}
                                placeholder={ml.paymentModal.methodPlaceholder}
                                className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                            />
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500">
                            {direction === 'payment' ? ml.paymentModal.notesLabel : ml.refundModal.notesLabel}
                        </label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder={direction === 'payment' ? ml.paymentModal.notesPlaceholder : ml.refundModal.notesPlaceholder}
                            rows={3}
                            className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none resize-none"
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
                    <button type="button" onClick={onClose} className="rounded-2xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600">
                        {ml.paymentModal.cancel}
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleSubmit()}
                        disabled={submitting}
                        className={`inline-flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-black text-white disabled:opacity-60 ${direction === 'payment' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'}`}
                    >
                        {submitting
                            ? <><Loader2 className="w-4 h-4 animate-spin" /> {pm.submitting}</>
                            : direction === 'payment' ? pm.submitPayment : pm.submitRefund}
                    </button>
                </div>
            </div>
        </div>
    );
}