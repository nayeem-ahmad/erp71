'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Button, Checkbox, Field, Input, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';

/** Mirrors BadDebtReasonDto on the backend; the API rejects anything else. */
const REASONS = [
    'UNTRACEABLE',
    'REFUSED',
    'CLOSED_OR_DECEASED',
    'UNECONOMIC_TO_PURSUE',
    'SETTLED_SHORT',
    'OTHER',
] as const;

type Props = {
    open: boolean;
    customerId: string;
    customerName: string;
    /** What the customer owes right now — the ceiling on what can be forgiven. */
    dueBalance: number;
    onClose: () => void;
    onSuccess: () => void;
};

/** Today in the browser's own timezone, which is the date the shopkeeper means. */
function today(): string {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
}

/**
 * Forgives a customer debt the shop has given up on collecting.
 *
 * Deliberately heavier than the payment form beside it. A write-off destroys
 * money with no counterparty and no document from the other side, so it asks
 * for a reason and a written explanation rather than an optional note, states
 * in the modal what it will and will not do to the books, and defaults to
 * closing the customer's credit — the amount leaving `due_balance` would
 * otherwise hand a defaulter their whole limit back.
 */
export default function WriteOffDebtModal({
    open,
    customerId,
    customerName,
    dueBalance,
    onClose,
    onSuccess,
}: Props) {
    const { t, fmt } = useI18n();
    const m = t.customers.profile.writeOff;

    const [amount, setAmount] = useState(String(dueBalance || ''));
    const [reason, setReason] = useState<(typeof REASONS)[number]>('UNTRACEABLE');
    const [notes, setNotes] = useState('');
    const [date, setDate] = useState(today());
    const [disableCredit, setDisableCredit] = useState(true);
    const [errors, setErrors] = useState<{ amount?: string; notes?: string }>({});
    const [submitting, setSubmitting] = useState(false);

    if (!open) return null;

    const parsedAmount = Number(amount);

    const validate = () => {
        const next: { amount?: string; notes?: string } = {};
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
            next.amount = m.amountRequired;
        } else if (parsedAmount > dueBalance + 0.005) {
            next.amount = fmt(m.amountTooHigh, { due: formatBDT(dueBalance) });
        }
        if (!notes.trim()) next.notes = m.notesRequired;
        setErrors(next);
        return Object.keys(next).length === 0;
    };

    const handleSubmit = async () => {
        if (!validate()) return;
        setSubmitting(true);
        try {
            await api.writeOffCustomerDebt(customerId, {
                amount: parsedAmount,
                reason,
                notes: notes.trim(),
                date,
                disableCredit,
            });
            toast.success(
                fmt(m.written, { amount: formatBDT(parsedAmount), name: customerName }),
            );
            onSuccess();
            onClose();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : m.failed);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <ModalShell size="sm" onBackdropClick={submitting ? undefined : onClose}>
            <ModalHeader
                title={m.title}
                subtitle={customerName}
                onClose={submitting ? undefined : onClose}
                closeLabel={m.cancel}
            />

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Said up front, because the thing people fear here is that a
                    write-off silently cancels the invoice and its VAT. It does not. */}
                <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <p className="text-xs text-amber-900">{m.intro}</p>
                </div>

                <Field
                    label={m.amount}
                    required
                    htmlFor="write-off-amount"
                    error={errors.amount}
                    hint={fmt(m.amountHint, { due: formatBDT(dueBalance) })}
                >
                    <Input
                        id="write-off-amount"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                    />
                </Field>

                <Field label={m.reason} required htmlFor="write-off-reason">
                    <Select
                        id="write-off-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])}
                    >
                        {REASONS.map((value) => (
                            <option key={value} value={value}>
                                {m.reasons[value]}
                            </option>
                        ))}
                    </Select>
                </Field>

                <Field
                    label={m.notes}
                    required
                    htmlFor="write-off-notes"
                    error={errors.notes}
                    hint={m.notesHint}
                >
                    <Textarea
                        id="write-off-notes"
                        rows={3}
                        maxLength={500}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                    />
                </Field>

                <Field label={m.date} htmlFor="write-off-date" hint={m.dateHint}>
                    <Input
                        id="write-off-date"
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                    />
                </Field>

                <div className="flex gap-2">
                    <Checkbox
                        id="write-off-disable-credit"
                        className="mt-0.5 shrink-0"
                        checked={disableCredit}
                        onChange={(e) => setDisableCredit(e.target.checked)}
                    />
                    <label htmlFor="write-off-disable-credit" className="cursor-pointer">
                        <span className="block text-xs font-medium text-gray-700">
                            {m.disableCredit}
                        </span>
                        <span className="mt-0.5 block text-xs text-gray-400">
                            {m.disableCreditHint}
                        </span>
                    </label>
                </div>
            </div>

            <ModalFooter>
                <Button variant="secondary" size="md" onClick={onClose} disabled={submitting}>
                    {m.cancel}
                </Button>
                <Button variant="danger" size="md" onClick={handleSubmit} loading={submitting}>
                    {m.confirm}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
