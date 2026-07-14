'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { TenantRecord } from './types';
import { api } from '@/lib/api';
import { formatMessage, useI18n } from '@/lib/i18n';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';

type CreditKind = 'sms' | 'ai';

type Props = {
    open: boolean;
    kind: CreditKind;
    tenant: TenantRecord | null;
    onClose: () => void;
    onSuccess: (message: string) => void;
};

export default function TenantSellCreditsModal({ open, kind, tenant, onClose, onSuccess }: Props) {
    const { t } = useI18n();
    const sc = t.admin.tenants.sellCredits;

    const [credits, setCredits] = useState('');
    const [amount, setAmount] = useState('');
    const [notes, setNotes] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    if (!open || !tenant) return null;

    const title = kind === 'sms' ? sc.smsTitle : sc.aiTitle;

    const handleSubmit = async () => {
        const parsedCredits = parseInt(credits, 10);
        if (!parsedCredits || parsedCredits <= 0) {
            setError(sc.creditsRequired);
            return;
        }

        setSubmitting(true);
        setError('');
        try {
            const parsedAmount = amount.trim() ? parseFloat(amount) : undefined;
            if (kind === 'sms') {
                await api.sellTenantSmsCredits(tenant.id, {
                    credits: parsedCredits,
                    amount: parsedAmount,
                    notes: notes || undefined,
                });
            } else {
                await api.sellTenantAiCredits(tenant.id, {
                    credits: parsedCredits,
                    amount: parsedAmount,
                    notes: notes || undefined,
                });
            }
            onSuccess(formatMessage(kind === 'sms' ? sc.smsSuccess : sc.aiSuccess, {
                credits: String(parsedCredits),
                name: tenant.name,
            }));
            setCredits('');
            setAmount('');
            setNotes('');
            onClose();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : sc.failed);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
            <ModalHeader title={title} subtitle={tenant.name} onClose={onClose} />

            <div className="space-y-4 p-6 overflow-y-auto">
                {error && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                        {error}
                    </div>
                )}

                <div className="space-y-2">
                    <label className="text-xs font-medium text-gray-500">{sc.creditsLabel}</label>
                    <input
                        type="number"
                        min="1"
                        step="1"
                        value={credits}
                        onChange={(e) => setCredits(e.target.value)}
                        placeholder={sc.creditsPlaceholder}
                        className="w-full rounded-md border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                    />
                </div>

                <div className="space-y-2">
                    <label className="text-xs font-medium text-gray-500">{sc.amountLabel}</label>
                    <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder={sc.amountPlaceholder}
                        className="w-full rounded-md border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                    />
                    <p className="text-xs text-gray-400">{sc.amountHint}</p>
                </div>

                <div className="space-y-2">
                    <label className="text-xs font-medium text-gray-500">{sc.notesLabel}</label>
                    <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder={sc.notesPlaceholder}
                        rows={3}
                        className="w-full rounded-md border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none resize-none"
                    />
                </div>
            </div>

            <ModalFooter>
                <button type="button" onClick={onClose} className="rounded-md border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600">
                    {sc.cancel}
                </button>
                <button
                    type="button"
                    onClick={() => void handleSubmit()}
                    disabled={submitting}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
                >
                    {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> {sc.saving}</> : sc.confirm}
                </button>
            </ModalFooter>
        </ModalShell>
    );
}