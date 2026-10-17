'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Loader2, Pencil, Plus, ShieldCheck, XCircle } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { Alert, Button, Field, Input, PageShell, Select, StatusBadge, Switch, Textarea } from '@/components/ui';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api, fetchWithAuth } from '@/lib/api';
import { formatBDT, formatDateTime, formatNumber } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import {
    CHANNEL_LABEL,
    MESSAGING_CHANNELS,
    type AdminCreditTopupRequest,
    type CreditTopupStatus,
    type MessagingChannel,
    type MessagingCreditPackage,
} from '@/lib/messaging-credits';

type Tab = CreditTopupStatus | 'PACKAGES';
const TABS: Array<{ key: Tab; label: string }> = [
    { key: 'PENDING', label: 'Pending' },
    { key: 'APPROVED', label: 'Approved' },
    { key: 'REJECTED', label: 'Rejected' },
    { key: 'PACKAGES', label: 'Packages' },
];

/**
 * The platform team's queue of bKash payments for messaging credits.
 *
 * Approving here is the only way a shop's SMS, WhatsApp or email balance goes
 * up, so each card leads with what has to be matched in the bKash app — the
 * TrxID, the sending number and the amount. Every request also arrived as a
 * support ticket; the decision is posted back to it.
 */
export default function AdminCreditTopupsPage() {
    const { t } = useI18n();
    const [tab, setTab] = useState<Tab>('PENDING');

    return (
        <PageShell>
            <div className="max-w-5xl mx-auto space-y-4">
                <PageHeader
                    title="Credit Top-ups"
                    subtitle="bKash payments for SMS, WhatsApp and email credits. Find each payment in bKash before approving — approving adds the credits."
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        'Credit Top-ups',
                        'admin',
                    )}
                />

                <PaymentNumberCard />

                <div className="flex flex-wrap items-center gap-2" role="tablist">
                    {TABS.map(({ key, label }) => (
                        <button
                            key={key}
                            type="button"
                            role="tab"
                            aria-selected={tab === key}
                            onClick={() => setTab(key)}
                            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors max-md:min-h-touch ${
                                tab === key
                                    ? 'bg-blue-600 text-white'
                                    : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {tab === 'PACKAGES' ? <PackagesPanel /> : <RequestsPanel status={tab} />}
            </div>
        </PageShell>
    );
}

// ── Where shops send the money ──────────────────────────────────────────────────

function PaymentNumberCard() {
    const [bkashNumber, setBkashNumber] = useState('');
    const [instructions, setInstructions] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchWithAuth('/admin/platform-settings/credit_topups')
            .then((group: Record<string, string | null>) => {
                setBkashNumber(group.bkash_number ?? '');
                setInstructions(group.instructions ?? '');
            })
            .catch(() => toast.error('Could not load the payment settings.'))
            .finally(() => setIsLoading(false));
    }, []);

    const save = async () => {
        if (!/^\+?[0-9][0-9\s-]{7,18}$/.test(bkashNumber.trim())) {
            setError('Enter the bKash number shops should send money to.');
            return;
        }
        setError('');
        setIsSaving(true);
        try {
            await fetchWithAuth('/admin/platform-settings/credit_topups', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: { bkash_number: bkashNumber.trim(), instructions: instructions.trim() } }),
            });
            toast.success('Payment settings saved.');
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Could not save the payment settings.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
            <div>
                <h2 className="text-sm font-semibold text-gray-900">Where shops pay</h2>
                <p className="text-xs text-gray-500">
                    Shown on every shop&apos;s Messaging Credits screen. Shops use bKash Send Money to this personal number.
                </p>
            </div>
            {isLoading ? (
                <p className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading...
                </p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-3 items-end">
                    <Field label="bKash number" htmlFor="topup-bkash-number" required error={error || undefined}>
                        <Input
                            id="topup-bkash-number"
                            className="w-full font-mono"
                            inputMode="tel"
                            value={bkashNumber}
                            error={Boolean(error)}
                            onChange={(event) => setBkashNumber(event.target.value)}
                        />
                    </Field>
                    <Field label="Extra instructions (optional)" htmlFor="topup-instructions">
                        <Input
                            id="topup-instructions"
                            className="w-full"
                            placeholder="e.g. Put your shop name in the bKash reference"
                            value={instructions}
                            onChange={(event) => setInstructions(event.target.value)}
                        />
                    </Field>
                    <Button size="md" loading={isSaving} disabled={isSaving} onClick={() => void save()}>
                        Save
                    </Button>
                </div>
            )}
        </section>
    );
}

// ── Requests ───────────────────────────────────────────────────────────────────

function RequestsPanel({ status }: { status: CreditTopupStatus }) {
    const [rows, setRows] = useState<AdminCreditTopupRequest[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [reviewing, setReviewing] = useState<{ row: AdminCreditTopupRequest; mode: 'approve' | 'reject' } | null>(null);

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            setRows(await api.getAdminCreditTopups({ status }));
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Could not load top-up requests.');
        } finally {
            setIsLoading(false);
        }
    }, [status]);

    useEffect(() => {
        void load();
    }, [load]);

    if (isLoading) {
        return (
            <div className="rounded-lg border border-gray-200 bg-white p-8 flex items-center justify-center text-sm text-gray-500">
                <Loader2 className="w-5 h-5 animate-spin me-2" /> Loading top-up requests...
            </div>
        );
    }

    if (rows.length === 0) {
        return (
            <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
                {status === 'PENDING' ? 'No payments are waiting to be verified.' : 'Nothing here yet.'}
            </div>
        );
    }

    return (
        <>
            <div className="space-y-3">
                {rows.map((row) => (
                    <RequestCard
                        key={row.id}
                        row={row}
                        onApprove={() => setReviewing({ row, mode: 'approve' })}
                        onReject={() => setReviewing({ row, mode: 'reject' })}
                    />
                ))}
            </div>
            {reviewing && (
                <ReviewModal
                    row={reviewing.row}
                    mode={reviewing.mode}
                    onClose={() => setReviewing(null)}
                    onDone={async () => {
                        setReviewing(null);
                        await load();
                    }}
                />
            )}
        </>
    );
}

function RequestCard({
    row,
    onApprove,
    onReject,
}: {
    row: AdminCreditTopupRequest;
    onApprove: () => void;
    onReject: () => void;
}) {
    const statusIcon =
        row.status === 'APPROVED' ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
        : row.status === 'REJECTED' ? <XCircle className="w-4 h-4 text-red-600" />
        : <Clock className="w-4 h-4 text-amber-600" />;

    return (
        <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{row.tenant.name}</p>
                    <p className="text-xs text-gray-500">
                        {row.package_name} · {formatNumber(row.credits)} {CHANNEL_LABEL[row.channel]} credits ·{' '}
                        {formatDateTime(row.created_at)}
                        {row.ticket_number ? ` · Ticket #${row.ticket_number}` : ''}
                    </p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600">
                    {statusIcon}
                    {row.status}
                </span>
            </div>

            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <DetailCell label="Amount to find" value={formatBDT(row.amount)} emphasis />
                <DetailCell label="Method" value="bKash Send Money" />
                <DetailCell label="TrxID" value={row.transaction_id} mono />
                <DetailCell label="Sent from" value={row.sender_number ?? '—'} mono />
            </dl>

            {(row.submitted_by || row.note) && (
                <div className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600 space-y-1">
                    {row.submitted_by && (
                        <p>
                            Submitted by {row.submitted_by.name || row.submitted_by.email}
                            {row.submitted_by.mobile ? ` · ${row.submitted_by.mobile}` : ''}
                        </p>
                    )}
                    {row.note && <p>Note: {row.note}</p>}
                </div>
            )}

            {row.status === 'PENDING' ? (
                <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
                    <Button size="md" icon={<ShieldCheck className="w-4 h-4" />} onClick={onApprove}>
                        Approve and add credits
                    </Button>
                    <Button size="md" variant="secondary" onClick={onReject}>
                        Reject
                    </Button>
                </div>
            ) : (
                <div className="border-t border-gray-100 pt-3 text-xs text-gray-500 space-y-1">
                    {row.status === 'APPROVED' && (
                        <p>
                            Granted {formatNumber(row.credits_granted ?? row.credits)} credits for{' '}
                            {formatBDT(row.amount_received ?? row.amount)} received
                        </p>
                    )}
                    {row.reviewed_by && row.reviewed_at && (
                        <p>
                            Reviewed by {row.reviewed_by.name || row.reviewed_by.email} · {formatDateTime(row.reviewed_at)}
                        </p>
                    )}
                    {row.review_note && <p>{row.status === 'REJECTED' ? 'Reason' : 'Note'}: {row.review_note}</p>}
                </div>
            )}
        </div>
    );
}

function DetailCell({
    label,
    value,
    mono = false,
    emphasis = false,
}: {
    label: string;
    value: string;
    mono?: boolean;
    emphasis?: boolean;
}) {
    return (
        <div>
            <dt className="text-xs font-medium text-gray-500">{label}</dt>
            <dd className={`mt-0.5 break-words ${mono ? 'font-mono text-xs' : 'text-sm'} ${emphasis ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                {value}
            </dd>
        </div>
    );
}

function ReviewModal({
    row,
    mode,
    onClose,
    onDone,
}: {
    row: AdminCreditTopupRequest;
    mode: 'approve' | 'reject';
    onClose: () => void;
    onDone: () => void | Promise<void>;
}) {
    const [amount, setAmount] = useState(String(row.amount));
    const [credits, setCredits] = useState(String(row.credits));
    const [note, setNote] = useState('');
    const [errors, setErrors] = useState<{ amount?: string; credits?: string; note?: string; form?: string }>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    const submit = async () => {
        const nextErrors: typeof errors = {};
        const parsedAmount = Number(amount);
        const parsedCredits = Number(credits);
        if (mode === 'approve') {
            if (!Number.isFinite(parsedAmount) || parsedAmount < 0) nextErrors.amount = 'Enter the amount you found in bKash.';
            if (!Number.isInteger(parsedCredits) || parsedCredits < 1) nextErrors.credits = 'Enter how many credits to add.';
        } else if (note.trim().length < 3) {
            nextErrors.note = 'Tell the shop why — they see this reason.';
        }
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) return;

        setIsSubmitting(true);
        try {
            if (mode === 'approve') {
                await api.approveCreditTopup(row.id, {
                    amount: parsedAmount,
                    credits: parsedCredits,
                    note: note.trim() || undefined,
                });
                toast.success(`${formatNumber(parsedCredits)} ${CHANNEL_LABEL[row.channel]} credits added for ${row.tenant.name}.`);
            } else {
                await api.rejectCreditTopup(row.id, { reason: note.trim() });
                toast.success('Top-up rejected. The shop has been told why.');
            }
            await onDone();
        } catch (err: unknown) {
            setErrors({ form: err instanceof Error ? err.message : 'Could not save the decision.' });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <ModalShell size="sm" onBackdropClick={isSubmitting ? undefined : onClose} dismissOnBackdrop={false}>
            <ModalHeader
                title={mode === 'approve' ? 'Approve top-up' : 'Reject top-up'}
                subtitle={row.tenant.name}
                onClose={isSubmitting ? undefined : onClose}
                closeLabel="Close"
            />

            <div className="space-y-4 overflow-y-auto p-4">
                <div className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600 space-y-1">
                    <p className="font-semibold text-gray-900">{row.package_name}</p>
                    <p className="font-mono text-xs">bKash · {row.transaction_id} · from {row.sender_number ?? '—'}</p>
                    <p>Claimed: {formatBDT(row.amount)}</p>
                </div>

                {errors.form && <Alert tone="danger">{errors.form}</Alert>}

                {mode === 'approve' ? (
                    <>
                        <Alert tone="warning">
                            Only approve after you have found this TrxID in the bKash app for the amount below. Approving adds
                            the credits immediately.
                        </Alert>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Amount received (৳)" htmlFor="review-amount" required error={errors.amount}>
                                <Input
                                    id="review-amount"
                                    className="w-full"
                                    inputMode="decimal"
                                    value={amount}
                                    error={Boolean(errors.amount)}
                                    onChange={(event) => setAmount(event.target.value)}
                                />
                            </Field>
                            <Field label={`${CHANNEL_LABEL[row.channel]} credits to add`} htmlFor="review-credits" required error={errors.credits}>
                                <Input
                                    id="review-credits"
                                    className="w-full"
                                    inputMode="numeric"
                                    value={credits}
                                    error={Boolean(errors.credits)}
                                    onChange={(event) => setCredits(event.target.value)}
                                />
                            </Field>
                        </div>
                        <Field label="Note to the shop (optional)" htmlFor="review-note" hint="Posted on their support ticket.">
                            <Textarea id="review-note" className="w-full" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
                        </Field>
                    </>
                ) : (
                    <Field
                        label="Reason"
                        htmlFor="review-reason"
                        required
                        error={errors.note}
                        hint="Shown to the shop on their credits screen and support ticket."
                    >
                        <Textarea
                            id="review-reason"
                            className="w-full"
                            rows={3}
                            value={note}
                            error={Boolean(errors.note)}
                            onChange={(event) => setNote(event.target.value)}
                        />
                    </Field>
                )}
            </div>

            <ModalFooter>
                <Button variant="secondary" size="md" onClick={onClose} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button
                    size="md"
                    variant={mode === 'approve' ? 'primary' : 'danger'}
                    loading={isSubmitting}
                    disabled={isSubmitting}
                    onClick={() => void submit()}
                >
                    {mode === 'approve' ? 'Approve and add credits' : 'Reject'}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}

// ── Packages ───────────────────────────────────────────────────────────────────

function PackagesPanel() {
    const [packages, setPackages] = useState<MessagingCreditPackage[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [editing, setEditing] = useState<MessagingCreditPackage | 'new' | null>(null);

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            setPackages(await api.getAdminCreditPackages());
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Could not load packages.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    return (
        <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-gray-500">What shops can buy on each channel. Retire a package rather than repurposing it.</p>
                <Button size="md" icon={<Plus className="w-4 h-4" />} onClick={() => setEditing('new')}>
                    New package
                </Button>
            </div>

            {isLoading ? (
                <div className="rounded-lg border border-gray-200 bg-white p-8 flex items-center justify-center text-sm text-gray-500">
                    <Loader2 className="w-5 h-5 animate-spin me-2" /> Loading packages...
                </div>
            ) : (
                MESSAGING_CHANNELS.map((channel) => {
                    const rows = packages.filter((pkg) => pkg.channel === channel);
                    return (
                        <div key={channel} className="rounded-lg border border-gray-200 bg-white">
                            <h3 className="border-b border-gray-100 px-4 py-2 text-sm font-semibold text-gray-900">{CHANNEL_LABEL[channel]}</h3>
                            {rows.length === 0 ? (
                                <p className="px-4 py-3 text-sm text-gray-500">No packages — shops cannot top up {CHANNEL_LABEL[channel]}.</p>
                            ) : (
                                <ul className="divide-y divide-gray-100">
                                    {rows.map((pkg) => (
                                        <li key={pkg.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium text-gray-900">{pkg.name}</p>
                                                <p className="text-xs text-gray-500">
                                                    {formatNumber(pkg.credits)} credits · {formatBDT(pkg.price)}
                                                    {pkg.credits > 0 ? ` · ${formatBDT(pkg.price / pkg.credits)} each` : ''}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <StatusBadge tone={pkg.is_active ? 'success' : 'neutral'}>
                                                    {pkg.is_active ? 'On sale' : 'Retired'}
                                                </StatusBadge>
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    aria-label={`Edit ${pkg.name}`}
                                                    icon={<Pencil className="w-4 h-4" />}
                                                    onClick={() => setEditing(pkg)}
                                                />
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    );
                })
            )}

            {editing && (
                <PackageModal
                    pkg={editing === 'new' ? null : editing}
                    onClose={() => setEditing(null)}
                    onSaved={async () => {
                        setEditing(null);
                        await load();
                    }}
                />
            )}
        </section>
    );
}

function PackageModal({
    pkg,
    onClose,
    onSaved,
}: {
    pkg: MessagingCreditPackage | null;
    onClose: () => void;
    onSaved: () => void | Promise<void>;
}) {
    const [channel, setChannel] = useState<MessagingChannel>(pkg?.channel ?? 'SMS');
    const [name, setName] = useState(pkg?.name ?? '');
    const [credits, setCredits] = useState(pkg ? String(pkg.credits) : '');
    const [price, setPrice] = useState(pkg ? String(pkg.price) : '');
    const [sortOrder, setSortOrder] = useState(pkg ? String(pkg.sort_order) : '0');
    const [isActive, setIsActive] = useState(pkg?.is_active ?? true);
    const [errors, setErrors] = useState<{ name?: string; credits?: string; price?: string; form?: string }>({});
    const [isSaving, setIsSaving] = useState(false);

    const save = async () => {
        const nextErrors: typeof errors = {};
        const parsedCredits = Number(credits);
        const parsedPrice = Number(price);
        if (name.trim().length < 2) nextErrors.name = 'Give the package a name.';
        if (!Number.isInteger(parsedCredits) || parsedCredits < 1) nextErrors.credits = 'Enter a whole number of credits.';
        if (!Number.isFinite(parsedPrice) || parsedPrice < 0) nextErrors.price = 'Enter the price in taka.';
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) return;

        const body = {
            name: name.trim(),
            credits: parsedCredits,
            price: parsedPrice,
            sort_order: Number.parseInt(sortOrder, 10) || 0,
            is_active: isActive,
        };
        setIsSaving(true);
        try {
            if (pkg) {
                await api.updateAdminCreditPackage(pkg.id, body);
            } else {
                await api.createAdminCreditPackage({ ...body, channel });
            }
            toast.success('Package saved.');
            await onSaved();
        } catch (err: unknown) {
            setErrors({ form: err instanceof Error ? err.message : 'Could not save the package.' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <ModalShell size="sm" onBackdropClick={isSaving ? undefined : onClose} dismissOnBackdrop={false}>
            <ModalHeader
                title={pkg ? 'Edit package' : 'New package'}
                subtitle={pkg ? `${CHANNEL_LABEL[pkg.channel]} · ${pkg.name}` : undefined}
                onClose={isSaving ? undefined : onClose}
                closeLabel="Close"
            />
            <div className="space-y-4 overflow-y-auto p-4">
                {errors.form && <Alert tone="danger">{errors.form}</Alert>}
                {!pkg && (
                    <Field label="Channel" htmlFor="package-channel" required>
                        <Select
                            id="package-channel"
                            className="w-full"
                            value={channel}
                            onChange={(event) => setChannel(event.target.value as MessagingChannel)}
                        >
                            {MESSAGING_CHANNELS.map((key) => (
                                <option key={key} value={key}>
                                    {CHANNEL_LABEL[key]}
                                </option>
                            ))}
                        </Select>
                    </Field>
                )}
                <Field label="Name" htmlFor="package-name" required error={errors.name}>
                    <Input id="package-name" className="w-full" value={name} error={Boolean(errors.name)} onChange={(event) => setName(event.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Credits" htmlFor="package-credits" required error={errors.credits}>
                        <Input
                            id="package-credits"
                            className="w-full"
                            inputMode="numeric"
                            value={credits}
                            error={Boolean(errors.credits)}
                            onChange={(event) => setCredits(event.target.value)}
                        />
                    </Field>
                    <Field label="Price (৳)" htmlFor="package-price" required error={errors.price}>
                        <Input
                            id="package-price"
                            className="w-full"
                            inputMode="decimal"
                            value={price}
                            error={Boolean(errors.price)}
                            onChange={(event) => setPrice(event.target.value)}
                        />
                    </Field>
                </div>
                <div className="grid grid-cols-2 gap-3 items-end">
                    <Field label="Sort order" htmlFor="package-sort">
                        <Input id="package-sort" className="w-full" inputMode="numeric" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} />
                    </Field>
                    <label className="flex items-center gap-2 text-sm text-gray-700 min-h-touch">
                        <Switch checked={isActive} onCheckedChange={setIsActive} />
                        On sale
                    </label>
                </div>
            </div>
            <ModalFooter>
                <Button variant="secondary" size="md" onClick={onClose} disabled={isSaving}>
                    Cancel
                </Button>
                <Button size="md" loading={isSaving} disabled={isSaving} onClick={() => void save()}>
                    Save
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
