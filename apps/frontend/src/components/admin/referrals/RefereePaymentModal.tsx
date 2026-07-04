'use client';

import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMessage, useI18n } from '@/lib/i18n';

type Props = {
    open: boolean;
    refereeId: string;
    defaultAmount?: number;
    onClose: () => void;
    onSuccess: (message: string) => void;
};

export default function RefereePaymentModal({ open, refereeId, defaultAmount, onClose, onSuccess }: Props) {
    const { t } = useI18n();
    const m = t.admin.referrals.payment;
    const [amount, setAmount] = useState(defaultAmount ? String(defaultAmount) : '');
    const [method, setMethod] = useState('');
    const [reference, setReference] = useState('');
    const [notes, setNotes] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    if (!open) return null;

    const handleSubmit = async () => {
        const parsedAmount = parseFloat(amount);
        if (!parsedAmount || parsedAmount <= 0) {
            setError(m.failed);
            return;
        }

        setSubmitting(true);
        setError('');
        try {
            await api.recordAdminRefereePayment(refereeId, {
                amount: parsedAmount,
                method: method || undefined,
                reference: reference || undefined,
                notes: notes || undefined,
            });
            onSuccess(formatMessage(m.success, { amount: parsedAmount.toFixed(2) }));
            onClose();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.failed);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-lg rounded-3xl border border-gray-100 bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
                    <h2 className="text-lg font-black text-gray-900">{m.title}</h2>
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
                        <label className="text-xs font-medium text-gray-500">{m.amountLabel}</label>
                        <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none" />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500">{m.methodLabel}</label>
                        <input value={method} onChange={(e) => setMethod(e.target.value)} className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none" />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500">{m.referenceLabel}</label>
                        <input value={reference} onChange={(e) => setReference(e.target.value)} className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none" />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500">{m.notesLabel}</label>
                        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none" />
                    </div>
                </div>

                <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
                    <button type="button" onClick={onClose} className="rounded-2xl px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100">
                        {m.cancel}
                    </button>
                    <button type="button" onClick={() => void handleSubmit()} disabled={submitting} className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        {submitting ? m.saving : m.confirm}
                    </button>
                </div>
            </div>
        </div>
    );
}