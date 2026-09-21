'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, Clock, Copy, Phone, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { ActivationPaymentMethod, ActivationStatus } from '@/lib/api';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';

type ActivationPanelProps = {
    status: ActivationStatus;
    /** Re-reads `/activation/status` after a submission, so the panel flips to its waiting state. */
    onSubmitted: () => void | Promise<void>;
};

type FieldErrors = Partial<Record<'transactionId' | 'senderNumber' | 'amount', string>>;

/**
 * The screen a workspace sees between signing up and being switched on.
 *
 * It answers three questions in order, because a customer who cannot answer them
 * phones instead: what do I owe, where do I send it, and what happens after I
 * do. Whichever state the workspace is in, the panel always ends with a way to
 * reach a human — a dead end here is a lost signup.
 */
export default function ActivationPanel({ status, onSubmitted }: ActivationPanelProps) {
    const { t, locale } = useI18n();
    const copy = t.activation;
    const { instructions, latest_request: latestRequest } = status;

    const methodLabels: Record<ActivationPaymentMethod, string> = useMemo(
        () => ({ BKASH: copy.bkash, NAGAD: copy.nagad, BANK_TRANSFER: copy.bankTransfer }),
        [copy.bankTransfer, copy.bkash, copy.nagad],
    );

    const [method, setMethod] = useState<ActivationPaymentMethod>(instructions.methods[0] ?? 'BKASH');
    const [transactionId, setTransactionId] = useState('');
    const [senderNumber, setSenderNumber] = useState('');
    const [amount, setAmount] = useState(status.amount_due != null ? String(status.amount_due) : '');
    const [note, setNote] = useState('');
    const [errors, setErrors] = useState<FieldErrors>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [copiedField, setCopiedField] = useState<string | null>(null);

    const isAwaitingReview = latestRequest?.status === 'PENDING';
    const wasRejected = latestRequest?.status === 'REJECTED';

    const copyToClipboard = async (field: string, value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopiedField(field);
            window.setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 2000);
        } catch {
            // A browser that refuses clipboard access is not an error worth a
            // toast — the number is on screen and can be read off it.
        }
    };

    const validate = (): FieldErrors => {
        const next: FieldErrors = {};
        if (transactionId.trim().length < 4) next.transactionId = copy.transactionIdRequired;
        const parsedAmount = Number(amount);
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) next.amount = copy.amountRequired;
        if (method !== 'BANK_TRANSFER' && senderNumber.trim().length < 4) {
            next.senderNumber = copy.senderNumberRequired;
        }
        return next;
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const nextErrors = validate();
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) return;

        setIsSubmitting(true);
        try {
            await api.submitActivationRequest({
                method,
                transactionId: transactionId.trim(),
                senderNumber: senderNumber.trim() || undefined,
                amount: Number(amount),
                note: note.trim() || undefined,
            });
            toast.success(copy.submitSuccess);
            await onSubmitted();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : copy.submitFailed);
        } finally {
            setIsSubmitting(false);
        }
    };

    const contactBlock = (instructions.support_phone || instructions.support_whatsapp) && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs font-medium text-gray-500">{copy.needHelp}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
                {instructions.support_phone && (
                    <a
                        href={`tel:${instructions.support_phone}`}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700 max-md:min-h-touch"
                    >
                        <Phone className="w-4 h-4" />
                        {instructions.support_phone}
                    </a>
                )}
                {instructions.support_whatsapp && (
                    <a
                        href={`https://wa.me/${instructions.support_whatsapp.replace(/[^\d]/g, '')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700 max-md:min-h-touch"
                    >
                        {copy.whatsApp}
                    </a>
                )}
            </div>
        </div>
    );

    return (
        <section className="rounded-lg border border-blue-200 bg-white p-4 md:p-6 space-y-4">
            <div className="flex items-start gap-3">
                <span className="rounded-lg bg-primary-light p-2 text-blue-600 flex-shrink-0">
                    <ShieldCheck className="w-5 h-5" />
                </span>
                <div className="min-w-0">
                    <h2 className="text-lg font-bold tracking-tight text-gray-950">{copy.title}</h2>
                    <p className="mt-1 text-sm text-gray-500">
                        {formatMessage(copy.subtitle, { hours: instructions.sla_hours })}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <SummaryTile label={copy.plan} value={status.plan?.name ?? '—'} />
                <SummaryTile
                    label={copy.cycle}
                    value={status.billing_cycle === 'YEARLY' ? copy.yearly : copy.monthly}
                />
                <SummaryTile
                    label={copy.amountDue}
                    value={status.amount_due != null ? formatBDT(status.amount_due, { locale }) : '—'}
                    emphasis
                />
            </div>

            {status.setup_fee != null && status.setup_fee > 0 && (
                <p className="text-xs text-gray-500">
                    {formatMessage(copy.includesSetupFee, { amount: formatBDT(status.setup_fee, { locale }) })}
                </p>
            )}

            {isAwaitingReview ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-1">
                    <p className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                        <Clock className="w-4 h-4 flex-shrink-0" />
                        {copy.awaitingReviewTitle}
                    </p>
                    <p className="text-sm text-amber-800">
                        {formatMessage(copy.awaitingReviewBody, {
                            transactionId: latestRequest.transaction_id,
                            hours: instructions.sla_hours,
                        })}
                    </p>
                </div>
            ) : (
                <>
                    {wasRejected && (
                        <div className="rounded-lg border border-red-200 bg-danger-light px-4 py-3 space-y-1">
                            <p className="flex items-center gap-2 text-sm font-semibold text-danger-text">
                                <TriangleAlert className="w-4 h-4 flex-shrink-0" />
                                {copy.rejectedTitle}
                            </p>
                            {latestRequest?.review_note && (
                                <p className="text-sm text-danger-text">{latestRequest.review_note}</p>
                            )}
                            <p className="text-sm text-danger-text">{copy.rejectedBody}</p>
                        </div>
                    )}

                    {instructions.methods.length === 0 ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                            <p className="text-sm font-semibold text-amber-800">{copy.noMethodsTitle}</p>
                            <p className="mt-1 text-sm text-amber-800">{copy.noMethodsBody}</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <h3 className="text-sm font-semibold text-gray-900">{copy.howToPay}</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {instructions.bkash_number && (
                                    <PayToCard
                                        label={copy.bkash}
                                        value={instructions.bkash_number}
                                        copied={copiedField === 'bkash'}
                                        copyLabel={copiedField === 'bkash' ? copy.copied : copy.copy}
                                        onCopy={() => copyToClipboard('bkash', instructions.bkash_number!)}
                                    />
                                )}
                                {instructions.nagad_number && (
                                    <PayToCard
                                        label={copy.nagad}
                                        value={instructions.nagad_number}
                                        copied={copiedField === 'nagad'}
                                        copyLabel={copiedField === 'nagad' ? copy.copied : copy.copy}
                                        onCopy={() => copyToClipboard('nagad', instructions.nagad_number!)}
                                    />
                                )}
                                {instructions.bank_details && (
                                    <PayToCard
                                        label={copy.bankTransfer}
                                        value={instructions.bank_details}
                                        copied={copiedField === 'bank'}
                                        copyLabel={copiedField === 'bank' ? copy.copied : copy.copy}
                                        onCopy={() => copyToClipboard('bank', instructions.bank_details!)}
                                    />
                                )}
                            </div>
                            {instructions.extra_instructions && (
                                <p className="text-xs text-gray-500">{instructions.extra_instructions}</p>
                            )}
                        </div>
                    )}

                    {!status.can_submit ? (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                            {copy.readOnly}
                        </div>
                    ) : instructions.methods.length > 0 && (
                        <form onSubmit={submit} className="space-y-4 border-t border-gray-100 pt-4">
                            <h3 className="text-sm font-semibold text-gray-900">{copy.afterYouPay}</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <Field label={copy.method} htmlFor="activation-method">
                                    <Select
                                        id="activation-method"
                                        className="w-full"
                                        value={method}
                                        onChange={(event) => setMethod(event.target.value as ActivationPaymentMethod)}
                                    >
                                        {instructions.methods.map((option) => (
                                            <option key={option} value={option}>
                                                {methodLabels[option]}
                                            </option>
                                        ))}
                                    </Select>
                                </Field>
                                <Field
                                    label={copy.transactionId}
                                    htmlFor="activation-trx"
                                    required
                                    error={errors.transactionId}
                                    hint={copy.transactionIdHint}
                                >
                                    <Input
                                        id="activation-trx"
                                        className="w-full"
                                        value={transactionId}
                                        error={Boolean(errors.transactionId)}
                                        onChange={(event) => setTransactionId(event.target.value)}
                                        autoComplete="off"
                                    />
                                </Field>
                                <Field
                                    label={copy.senderNumber}
                                    htmlFor="activation-sender"
                                    required={method !== 'BANK_TRANSFER'}
                                    error={errors.senderNumber}
                                    hint={copy.senderNumberHint}
                                >
                                    <Input
                                        id="activation-sender"
                                        className="w-full"
                                        inputMode="tel"
                                        value={senderNumber}
                                        error={Boolean(errors.senderNumber)}
                                        onChange={(event) => setSenderNumber(event.target.value)}
                                        autoComplete="off"
                                    />
                                </Field>
                                <Field
                                    label={copy.amountSent}
                                    htmlFor="activation-amount"
                                    required
                                    error={errors.amount}
                                >
                                    <Input
                                        id="activation-amount"
                                        className="w-full"
                                        inputMode="decimal"
                                        value={amount}
                                        error={Boolean(errors.amount)}
                                        onChange={(event) => setAmount(event.target.value)}
                                    />
                                </Field>
                            </div>
                            <Field label={copy.note} htmlFor="activation-note">
                                <Textarea
                                    id="activation-note"
                                    className="w-full"
                                    rows={2}
                                    value={note}
                                    onChange={(event) => setNote(event.target.value)}
                                />
                            </Field>
                            <Button type="submit" size="md" loading={isSubmitting} disabled={isSubmitting}>
                                {isSubmitting ? copy.submitting : copy.submit}
                            </Button>
                        </form>
                    )}
                </>
            )}

            {contactBlock}
        </section>
    );
}

function SummaryTile({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
    return (
        <div className={`rounded-lg px-4 py-3 ${emphasis ? 'bg-primary-light' : 'bg-gray-50'}`}>
            <p className="text-xs font-medium text-gray-500">{label}</p>
            <p className={`mt-1 text-sm font-bold ${emphasis ? 'text-blue-700' : 'text-gray-900'}`}>{value}</p>
        </div>
    );
}

function PayToCard({
    label,
    value,
    copied,
    copyLabel,
    onCopy,
}: {
    label: string;
    value: string;
    /** Drives the icon. Separate from `copyLabel`, which is translated and so cannot be compared against. */
    copied: boolean;
    copyLabel: string;
    onCopy: () => void;
}) {
    return (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
                <p className="text-xs font-medium text-gray-500">{label}</p>
                <p className="mt-1 text-sm font-bold text-gray-900 break-words">{value}</p>
            </div>
            <button
                type="button"
                onClick={onCopy}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 flex-shrink-0 max-md:min-h-touch"
            >
                {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copyLabel}
            </button>
        </div>
    );
}
