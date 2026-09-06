'use client';

import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Receipt } from 'lucide-react';
import type { LedgerEvent, TenantRecord } from './types';
import { api } from '@/lib/api';
import { formatMessage, useI18n } from '@/lib/i18n';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';

export type LedgerEntryKind = 'payment' | 'refund' | 'fee';

const KIND_BY_EVENT_TYPE: Record<string, LedgerEntryKind> = {
    manual_payment: 'payment',
    manual_refund: 'refund',
    manual_fee: 'fee',
};

type Props = {
    open: boolean;
    tenants: TenantRecord[];
    defaultTenantId?: string;
    /** Which tab the modal opens on when adding. Ignored when editing. */
    defaultKind?: LedgerEntryKind;
    /** Set to edit an existing entry instead of adding one. */
    entry?: LedgerEvent | null;
    onClose: () => void;
    onSuccess: (message: string) => void;
};

/**
 * `datetime-local` wants wall-clock `YYYY-MM-DDTHH:mm`; handing it a UTC ISO
 * string puts the box an offset out — six hours early, in Dhaka.
 */
function toLocalInputValue(value: string | Date): string {
    const at = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(at.getTime())) return '';
    return new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function payloadString(entry: LedgerEvent | null | undefined, key: string): string {
    const value = (entry?.payload as Record<string, unknown> | null | undefined)?.[key];
    return typeof value === 'string' ? value : '';
}

/**
 * Add or edit one row of the tenant ledger — a payment in, a refund out, or an
 * ad-hoc fee. One modal for all three because they differ only in which of the
 * optional fields apply, and an admin correcting the ledger thinks in rows
 * rather than in endpoints.
 */
export default function TenantLedgerEntryModal({
    open,
    tenants,
    defaultTenantId = '',
    defaultKind = 'payment',
    entry = null,
    onClose,
    onSuccess,
}: Props) {
    const { t } = useI18n();
    const m = t.admin.tenants;
    const pm = m.payments;
    const ml = m.ledger;
    const lp = m.ledgerPage;
    const em = ml.entryModal;

    const isEdit = Boolean(entry);

    const [tenantId, setTenantId] = useState(defaultTenantId);
    const [kind, setKind] = useState<LedgerEntryKind>(defaultKind);
    const [occurredAt, setOccurredAt] = useState('');
    const [amount, setAmount] = useState('');
    const [label, setLabel] = useState('');
    const [method, setMethod] = useState('');
    const [notes, setNotes] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Reset on every open: the modal stays mounted between uses, so without this
    // yesterday's amount is still sitting in the box when it reopens — and the
    // edit form would show the previously edited row.
    useEffect(() => {
        if (!open) return;
        setError('');
        setSubmitting(false);
        setTenantId(entry?.tenant_id ?? defaultTenantId);
        setKind(entry ? (KIND_BY_EVENT_TYPE[entry.event_type] ?? 'fee') : defaultKind);
        setOccurredAt(toLocalInputValue(entry?.created_at ?? new Date()));
        setAmount(entry?.amount != null ? String(entry.amount) : '');
        setLabel(entry ? (payloadString(entry, 'label') || entry.reference_id || '') : '');
        setMethod(payloadString(entry, 'method'));
        setNotes(payloadString(entry, 'notes'));
    }, [open, entry, defaultTenantId, defaultKind]);

    if (!open) return null;

    const kindOptions: Array<{ value: LedgerEntryKind; label: string; icon: typeof ArrowDownLeft }> = [
        { value: 'payment', label: pm.receivePayment, icon: ArrowDownLeft },
        { value: 'refund', label: pm.issueRefund, icon: ArrowUpRight },
        { value: 'fee', label: em.addFee, icon: Receipt },
    ];

    const amountLabel = kind === 'payment'
        ? ml.paymentModal.amountLabel
        : kind === 'refund' ? ml.refundModal.amountLabel : em.feeAmountLabel;

    const submitLabel = isEdit
        ? t.common.saveChanges
        : kind === 'payment' ? pm.submitPayment : kind === 'refund' ? pm.submitRefund : em.submitFee;

    /** Local wall-clock from the picker → the instant the API stores. Blank = now. */
    const parseOccurredAt = (): string | undefined => {
        if (!occurredAt) return undefined;
        const parsed = new Date(occurredAt);
        return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
    };

    const handleSubmit = async () => {
        if (!isEdit && !tenantId) {
            setError(pm.tenantRequired);
            return;
        }

        const parsedAmount = parseFloat(amount);
        if (!parsedAmount || parsedAmount <= 0) {
            setError(em.amountRequired);
            return;
        }

        if (occurredAt && Number.isNaN(new Date(occurredAt).getTime())) {
            setError(em.dateInvalid);
            return;
        }

        setSubmitting(true);
        setError('');
        try {
            const occurredAtIso = parseOccurredAt();

            if (isEdit && entry) {
                await api.updateTenantLedgerEntry(entry.id, {
                    amount: parsedAmount,
                    notes,
                    ...(kind === 'payment' ? { method } : {}),
                    ...(kind === 'fee' ? { label } : {}),
                    ...(occurredAtIso ? { occurredAt: occurredAtIso } : {}),
                });
                onSuccess(em.updateSuccess);
            } else if (kind === 'payment') {
                await api.recordTenantPayment(tenantId, {
                    amount: parsedAmount,
                    method: method || undefined,
                    notes: notes || undefined,
                    occurredAt: occurredAtIso,
                });
                onSuccess(formatMessage(ml.paymentModal.success, { amount: parsedAmount.toFixed(2) }));
            } else if (kind === 'refund') {
                await api.recordTenantRefund(tenantId, {
                    amount: parsedAmount,
                    notes: notes || undefined,
                    occurredAt: occurredAtIso,
                });
                onSuccess(formatMessage(ml.refundModal.success, { amount: parsedAmount.toFixed(2) }));
            } else {
                await api.recordTenantFee(tenantId, {
                    amount: parsedAmount,
                    label: label || undefined,
                    notes: notes || undefined,
                    occurredAt: occurredAtIso,
                });
                onSuccess(formatMessage(em.feeSuccess, { amount: parsedAmount.toFixed(2) }));
            }
            onClose();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : em.saveFailed);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
            <ModalHeader
                title={isEdit ? em.editTitle : lp.recordPaymentTitle}
                onClose={onClose}
                closeLabel={t.common.close}
            />

            <div className="space-y-4 p-4 overflow-y-auto">
                {error && (
                    <div role="alert" className="rounded-md border border-danger bg-danger-light px-3 py-2 text-sm font-semibold text-danger-text">
                        {error}
                    </div>
                )}

                <Field label={pm.tenantLabel} htmlFor="ledger-entry-tenant">
                    <Select
                        id="ledger-entry-tenant"
                        value={tenantId}
                        onChange={(e) => setTenantId(e.target.value)}
                        disabled={isEdit}
                        className="w-full"
                    >
                        <option value="">{pm.tenantPlaceholder}</option>
                        {tenants.map((tenant) => (
                            <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
                        ))}
                    </Select>
                </Field>

                <Field label={pm.typeLabel} hint={isEdit ? em.typeLockedHint : undefined}>
                    <div className="flex rounded-md border border-gray-200 overflow-hidden">
                        {kindOptions.map(({ value, label: optionLabel, icon: Icon }) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setKind(value)}
                                disabled={isEdit}
                                aria-pressed={kind === value}
                                className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-xs font-semibold transition-colors min-h-touch disabled:cursor-not-allowed ${
                                    kind === value
                                        ? 'bg-primary text-white'
                                        : 'bg-gray-50 text-gray-500 hover:bg-gray-100 disabled:hover:bg-gray-50'
                                }`}
                            >
                                <Icon className="w-3.5 h-3.5" />
                                {optionLabel}
                            </button>
                        ))}
                    </div>
                </Field>

                <Field label={em.dateLabel} hint={em.dateHint} htmlFor="ledger-entry-date">
                    <Input
                        id="ledger-entry-date"
                        type="datetime-local"
                        value={occurredAt}
                        onChange={(e) => setOccurredAt(e.target.value)}
                        max={toLocalInputValue(new Date())}
                        className="w-full"
                    />
                </Field>

                <Field label={amountLabel} required htmlFor="ledger-entry-amount">
                    <Input
                        id="ledger-entry-amount"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder={ml.paymentModal.amountPlaceholder}
                        className="w-full"
                    />
                </Field>

                {kind === 'fee' && (
                    <Field label={em.feeLabelLabel} htmlFor="ledger-entry-label">
                        <Input
                            id="ledger-entry-label"
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            placeholder={em.feeLabelPlaceholder}
                            className="w-full"
                        />
                    </Field>
                )}

                {kind === 'payment' && (
                    <Field label={ml.paymentModal.methodLabel} htmlFor="ledger-entry-method">
                        <Input
                            id="ledger-entry-method"
                            value={method}
                            onChange={(e) => setMethod(e.target.value)}
                            placeholder={ml.paymentModal.methodPlaceholder}
                            className="w-full"
                        />
                    </Field>
                )}

                <Field
                    label={kind === 'refund' ? ml.refundModal.notesLabel : ml.paymentModal.notesLabel}
                    htmlFor="ledger-entry-notes"
                >
                    <Textarea
                        id="ledger-entry-notes"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder={kind === 'refund' ? ml.refundModal.notesPlaceholder : ml.paymentModal.notesPlaceholder}
                        rows={3}
                        className="w-full resize-none"
                    />
                </Field>
            </div>

            <ModalFooter>
                <Button variant="secondary" size="md" onClick={onClose} disabled={submitting}>
                    {t.common.cancel}
                </Button>
                <Button size="md" onClick={() => void handleSubmit()} loading={submitting}>
                    {submitting ? pm.submitting : submitLabel}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
