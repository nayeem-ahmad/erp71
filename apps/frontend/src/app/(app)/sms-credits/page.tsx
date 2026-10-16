'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Check, Copy, Loader2, Mail, MessageCircle, MessageSquare, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import PageHeader from '@/components/ui/compact/PageHeader';
import { Alert, Button, Field, Input, PageShell, StatusBadge, Textarea } from '@/components/ui';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { formatBDT, formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { toast } from '@/lib/toast';
import {
    CHANNEL_LABEL,
    CHANNEL_UNIT_HINT,
    MESSAGING_CHANNELS,
    isPlausibleTrxId,
    isPlausibleWalletNumber,
    type CreditTopupRequestRecord,
    type MessagingChannel,
    type MessagingCreditPackage,
    type MessagingCreditSummary,
} from '@/lib/messaging-credits';

const CHANNEL_ICON: Record<MessagingChannel, typeof MessageSquare> = {
    SMS: MessageSquare,
    WHATSAPP: MessageCircle,
    EMAIL: Mail,
};

const STATUS_TONE = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger' } as const;
const STATUS_LABEL = { PENDING: 'Awaiting verification', APPROVED: 'Credits added', REJECTED: 'Rejected' } as const;

/**
 * The shop's prepaid SMS, WhatsApp and email balances, and how to top them up.
 *
 * Topping up is a bKash payment the platform team verifies by hand: the shop
 * sends the package price to the team's number, submits the TrxID here, and a
 * support ticket opens for the team. Nothing on this page adds a credit — the
 * balance moves only when an admin approves the payment.
 */
export default function MessagingCreditsPage() {
    const { t } = useI18n();
    const [summary, setSummary] = useState<MessagingCreditSummary | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [channel, setChannel] = useState<MessagingChannel>('SMS');
    const [buying, setBuying] = useState<MessagingCreditPackage | null>(null);

    const loadSummary = useCallback(async () => {
        try {
            setSummary(await api.getSmsCreditSummary());
            setLoadError('');
        } catch (err: unknown) {
            setLoadError(err instanceof Error ? err.message : 'Failed to load messaging credits.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadSummary();
    }, [loadSummary]);

    const packages = summary?.packages.filter((pkg) => pkg.channel === channel) ?? [];
    const pendingCount = summary?.requests.filter((request) => request.status === 'PENDING').length ?? 0;

    return (
        <PageShell>
            <div className="max-w-6xl mx-auto space-y-4">
                <PageHeader
                    title="Messaging Credits"
                    subtitle={`Prepaid SMS, WhatsApp and email for ${summary?.tenant.name || 'your shop'} — every message to a customer spends one`}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        'Messaging Credits',
                        'Messaging Credits',
                        'smsCredits',
                    )}
                />

                {loadError && <Alert tone="danger">{loadError}</Alert>}

                {isLoading ? (
                    <div className="rounded-lg border border-gray-200 bg-white p-8 flex items-center justify-center text-sm text-gray-500">
                        <Loader2 className="w-5 h-5 animate-spin me-2" /> Loading messaging credits...
                    </div>
                ) : summary && (
                    <>
                        <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            {MESSAGING_CHANNELS.map((key) => (
                                <BalanceCard
                                    key={key}
                                    channel={key}
                                    balance={summary.balances[key]}
                                    low={summary.low_balance[key]}
                                    smsDisabled={key === 'SMS' && !summary.sms_enabled}
                                />
                            ))}
                        </section>

                        <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-4">
                            <div className="space-y-4">
                                <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                                            <Plus className="w-4 h-4 text-blue-600" /> Buy credits
                                        </h2>
                                        <div className="flex gap-1" role="tablist" aria-label="Channel">
                                            {MESSAGING_CHANNELS.map((key) => (
                                                <button
                                                    key={key}
                                                    type="button"
                                                    role="tab"
                                                    aria-selected={channel === key}
                                                    onClick={() => setChannel(key)}
                                                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors max-md:min-h-touch ${
                                                        channel === key
                                                            ? 'bg-blue-600 text-white'
                                                            : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                                                    }`}
                                                >
                                                    {CHANNEL_LABEL[key]}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <p className="text-xs text-gray-500">
                                        Pay by bKash, then send us the transaction ID. Credits are added once our team has
                                        confirmed the payment.
                                    </p>

                                    {!summary.can_manage_billing ? (
                                        <Alert tone="info">
                                            Your role is {summary.role}. Only owners and managers can buy messaging credits.
                                        </Alert>
                                    ) : packages.length === 0 ? (
                                        <Alert tone="info">No {CHANNEL_LABEL[channel]} packages are available right now.</Alert>
                                    ) : (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {packages.map((pkg) => (
                                                <div key={pkg.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3 flex flex-col gap-3">
                                                    <div>
                                                        <p className="text-sm font-semibold text-gray-900">{pkg.name}</p>
                                                        <p className="mt-1 text-xl font-bold text-blue-600">
                                                            {formatNumber(pkg.credits)}{' '}
                                                            <span className="text-xs font-medium text-gray-500">{CHANNEL_LABEL[pkg.channel]} credits</span>
                                                        </p>
                                                    </div>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="text-base font-semibold text-gray-900">{formatBDT(pkg.price)}</span>
                                                        <Button size="md" onClick={() => setBuying(pkg)}>
                                                            Buy with bKash
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </section>

                                <RequestsSection requests={summary.requests} pendingCount={pendingCount} />
                            </div>

                            <ActivitySection transactions={summary.transactions} />
                        </div>
                    </>
                )}
            </div>

            {buying && summary && (
                <PayWithBkashModal
                    pkg={buying}
                    payment={summary.payment}
                    onClose={() => setBuying(null)}
                    onSubmitted={async (request) => {
                        setBuying(null);
                        toast.success(
                            request.ticket_number
                                ? `Payment submitted — support ticket #${request.ticket_number}. We'll add the credits once it's verified.`
                                : "Payment submitted. We'll add the credits once it's verified.",
                        );
                        await loadSummary();
                    }}
                />
            )}
        </PageShell>
    );
}

function BalanceCard({
    channel,
    balance,
    low,
    smsDisabled,
}: {
    channel: MessagingChannel;
    balance: number;
    low: boolean;
    smsDisabled: boolean;
}) {
    const Icon = CHANNEL_ICON[channel];
    const tone = balance <= 0 ? 'text-red-600' : low ? 'text-amber-600' : 'text-gray-900';

    return (
        <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-gray-500">{CHANNEL_LABEL[channel]} balance</p>
                <Icon className="w-4 h-4 text-blue-600" />
            </div>
            <p className={`text-2xl font-bold ${tone}`}>{formatNumber(balance)}</p>
            <p className="text-xs text-gray-500">{CHANNEL_UNIT_HINT[channel]}</p>
            {balance <= 0 ? (
                <p className="text-xs font-medium text-red-600">Out of credits — {CHANNEL_LABEL[channel]} messages are not being sent.</p>
            ) : low ? (
                <p className="text-xs font-medium text-amber-600">Running low. Top up to avoid interruptions.</p>
            ) : null}
            {smsDisabled && (
                <p className="text-xs text-gray-500">SMS sending is turned off for this shop. Enable it in settings to use these credits.</p>
            )}
        </div>
    );
}

function RequestsSection({ requests, pendingCount }: { requests: CreditTopupRequestRecord[]; pendingCount: number }) {
    if (requests.length === 0) return null;

    return (
        <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-gray-900">Your top-ups</h2>
                {pendingCount > 0 && <StatusBadge tone="warning">{pendingCount} awaiting verification</StatusBadge>}
            </div>
            <ul className="divide-y divide-gray-100">
                {requests.map((request) => (
                    <li key={request.id} className="py-2 space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-gray-900">{request.package_name}</p>
                            <StatusBadge tone={STATUS_TONE[request.status]}>{STATUS_LABEL[request.status]}</StatusBadge>
                        </div>
                        <p className="text-xs text-gray-500">
                            {formatBDT(request.amount)} · bKash TrxID <span className="font-mono">{request.transaction_id}</span>
                            {request.ticket_number ? ` · Ticket #${request.ticket_number}` : ''}
                            {` · ${formatDateTime(request.created_at)}`}
                        </p>
                        {request.status === 'APPROVED' && request.credits_granted !== null && (
                            <p className="text-xs text-emerald-700">
                                {formatNumber(request.credits_granted)} {CHANNEL_LABEL[request.channel]} credits added.
                            </p>
                        )}
                        {request.status === 'REJECTED' && request.review_note && (
                            <p className="text-xs text-red-600">Reason: {request.review_note}</p>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}

function ActivitySection({ transactions }: { transactions: MessagingCreditSummary['transactions'] }) {
    return (
        <aside className="rounded-lg border border-gray-200 bg-white p-4 space-y-3 h-fit">
            <h2 className="text-sm font-semibold text-gray-900">Recent activity</h2>
            {transactions.length === 0 ? (
                <p className="text-sm text-gray-500">No credit activity yet.</p>
            ) : (
                <ul className="space-y-2">
                    {transactions.map((tx) => {
                        const isCredit = tx.credits >= 0;
                        return (
                            <li key={tx.id} className="rounded-md bg-gray-50 px-3 py-2">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2 min-w-0">
                                        {isCredit ? (
                                            <ArrowUpCircle className="w-4 h-4 shrink-0 text-emerald-600" />
                                        ) : (
                                            <ArrowDownCircle className="w-4 h-4 shrink-0 text-red-600" />
                                        )}
                                        <span className="truncate text-sm font-medium text-gray-900">{tx.description || tx.type}</span>
                                    </div>
                                    <span className={`text-sm font-semibold shrink-0 ${isCredit ? 'text-emerald-600' : 'text-red-600'}`}>
                                        {isCredit ? '+' : ''}
                                        {formatNumber(tx.credits)}
                                    </span>
                                </div>
                                <p className="mt-1 text-xs text-gray-500">
                                    {CHANNEL_LABEL[tx.channel] ?? tx.channel} · {formatDate(tx.created_at)}
                                    {tx.recipient ? ` · ${tx.recipient}` : ''}
                                    {` · Balance ${formatNumber(tx.balance_after)}`}
                                </p>
                            </li>
                        );
                    })}
                </ul>
            )}
        </aside>
    );
}

function PayWithBkashModal({
    pkg,
    payment,
    onClose,
    onSubmitted,
}: {
    pkg: MessagingCreditPackage;
    payment: MessagingCreditSummary['payment'];
    onClose: () => void;
    onSubmitted: (request: CreditTopupRequestRecord) => void | Promise<void>;
}) {
    const [transactionId, setTransactionId] = useState('');
    const [senderNumber, setSenderNumber] = useState('');
    const [note, setNote] = useState('');
    const [errors, setErrors] = useState<{ transactionId?: string; senderNumber?: string; form?: string }>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [copied, setCopied] = useState(false);

    const copyNumber = async () => {
        if (!payment.bkash_number) return;
        try {
            await navigator.clipboard.writeText(payment.bkash_number);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard can be blocked; the number is on screen to type instead.
        }
    };

    const submit = async () => {
        const nextErrors: typeof errors = {};
        if (!isPlausibleTrxId(transactionId)) {
            nextErrors.transactionId = 'Enter the TrxID exactly as it appears in your bKash SMS.';
        }
        if (!isPlausibleWalletNumber(senderNumber)) {
            nextErrors.senderNumber = 'Enter the bKash number you paid from.';
        }
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) return;

        setIsSubmitting(true);
        try {
            const request = await api.submitCreditTopupRequest({
                packageId: pkg.id,
                transactionId: transactionId.trim(),
                senderNumber: senderNumber.trim(),
                note: note.trim() || undefined,
            });
            await onSubmitted(request);
        } catch (err: unknown) {
            setErrors({ form: err instanceof Error ? err.message : 'Could not submit the payment. Please try again.' });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <ModalShell size="sm" onBackdropClick={isSubmitting ? undefined : onClose} dismissOnBackdrop={false}>
            <ModalHeader
                title="Pay with bKash"
                subtitle={`${pkg.name} · ${formatBDT(pkg.price)}`}
                onClose={isSubmitting ? undefined : onClose}
                closeLabel="Close"
            />

            <div className="space-y-4 overflow-y-auto p-4">
                {payment.bkash_number ? (
                    <ol className="space-y-3 text-sm text-gray-700">
                        <li className="flex gap-2">
                            <StepNumber n={1} />
                            <div className="space-y-1">
                                <p>
                                    Open bKash and choose <strong>Send Money</strong> (this is a personal number, not a merchant).
                                </p>
                                <div className="flex items-center gap-2">
                                    <span className="font-mono text-base font-semibold text-gray-900">{payment.bkash_number}</span>
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        icon={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                        onClick={() => void copyNumber()}
                                    >
                                        {copied ? 'Copied' : 'Copy'}
                                    </Button>
                                </div>
                            </div>
                        </li>
                        <li className="flex gap-2">
                            <StepNumber n={2} />
                            <p>
                                Send exactly <strong>{formatBDT(pkg.price)}</strong>.
                            </p>
                        </li>
                        <li className="flex gap-2">
                            <StepNumber n={3} />
                            <p>Enter the transaction ID (TrxID) from the bKash confirmation SMS below.</p>
                        </li>
                    </ol>
                ) : (
                    <Alert tone="warning">
                        The bKash payment number has not been set up yet. Please contact support to buy credits.
                    </Alert>
                )}

                {payment.instructions && <p className="text-xs text-gray-500">{payment.instructions}</p>}

                {errors.form && <Alert tone="danger">{errors.form}</Alert>}

                <Field label="bKash TrxID" htmlFor="topup-trx" required error={errors.transactionId}>
                    <Input
                        id="topup-trx"
                        className="w-full font-mono uppercase"
                        autoComplete="off"
                        placeholder="e.g. 9A7B3C2D1E"
                        value={transactionId}
                        error={Boolean(errors.transactionId)}
                        onChange={(event) => setTransactionId(event.target.value)}
                    />
                </Field>
                <Field label="Paid from (your bKash number)" htmlFor="topup-sender" required error={errors.senderNumber}>
                    <Input
                        id="topup-sender"
                        className="w-full"
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="01XXXXXXXXX"
                        value={senderNumber}
                        error={Boolean(errors.senderNumber)}
                        onChange={(event) => setSenderNumber(event.target.value)}
                    />
                </Field>
                <Field label="Note (optional)" htmlFor="topup-note">
                    <Textarea
                        id="topup-note"
                        className="w-full"
                        rows={2}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                    />
                </Field>

                <Alert tone="info">
                    Submitting opens a support ticket for our team. Your {CHANNEL_LABEL[pkg.channel]} credits are added
                    once they find the payment in bKash.
                </Alert>
            </div>

            <ModalFooter>
                <Button variant="secondary" size="md" onClick={onClose} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button
                    size="md"
                    loading={isSubmitting}
                    disabled={isSubmitting || !payment.bkash_number}
                    onClick={() => void submit()}
                >
                    Submit payment
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}

function StepNumber({ n }: { n: number }) {
    return (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
            {n}
        </span>
    );
}
