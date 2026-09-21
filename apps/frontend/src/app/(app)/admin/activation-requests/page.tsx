'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell, Button, Field, Input, Textarea, Alert } from '@/components/ui';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { api } from '@/lib/api';
import { formatBDT, formatDateTime } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';

type RequestStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

type AdminActivationRequest = {
    id: string;
    method: string;
    transaction_id: string;
    sender_number: string | null;
    amount: number;
    note: string | null;
    status: RequestStatus;
    plan_code: string;
    billing_cycle: string;
    review_note: string | null;
    reviewed_at: string | null;
    created_at: string;
    tenant: { id: string; name: string };
    tenant_plan: string | null;
    tenant_subscription_status: string | null;
    submitted_by: { name: string | null; email: string; mobile: string | null } | null;
};

const TABS: RequestStatus[] = ['PENDING', 'VERIFIED', 'REJECTED'];

/**
 * The platform team's queue of payments to verify.
 *
 * Approving here is the step that posts money to the tenant ledger and switches
 * the workspace on, so the card leads with what an admin needs in the merchant
 * app — the transaction ID, the sending wallet and the amount — rather than with
 * the workspace's name.
 */
export default function AdminActivationRequestsPage() {
    const { t, locale } = useI18n();
    const copy = t.activation.admin;
    const [status, setStatus] = useState<RequestStatus>('PENDING');
    const [rows, setRows] = useState<AdminActivationRequest[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [reviewing, setReviewing] = useState<{ row: AdminActivationRequest; mode: 'approve' | 'reject' } | null>(null);

    const load = useCallback(async (nextStatus: RequestStatus) => {
        setIsLoading(true);
        try {
            setRows(await api.getAdminActivationRequests({ status: nextStatus }));
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : copy.loadFailed);
        } finally {
            setIsLoading(false);
        }
    }, [copy.loadFailed]);

    useEffect(() => {
        void load(status);
    }, [load, status]);

    const tabLabels: Record<RequestStatus, string> = useMemo(
        () => ({ PENDING: copy.tabPending, VERIFIED: copy.tabVerified, REJECTED: copy.tabRejected }),
        [copy.tabPending, copy.tabRejected, copy.tabVerified],
    );

    return (
        <PageShell>
            <div className="max-w-5xl mx-auto space-y-4">
                <PageHeader
                    title={copy.title}
                    subtitle={copy.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        copy.title,
                        'admin',
                    )}
                />

                <div className="flex flex-wrap items-center gap-2">
                    {TABS.map((tab) => (
                        <button
                            key={tab}
                            type="button"
                            onClick={() => setStatus(tab)}
                            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors max-md:min-h-touch ${
                                status === tab
                                    ? 'bg-blue-600 text-white'
                                    : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                            }`}
                        >
                            {tabLabels[tab]}
                        </button>
                    ))}
                </div>

                {isLoading ? (
                    <div className="rounded-lg border border-gray-100 bg-white p-8 flex items-center justify-center text-gray-500">
                        <Loader2 className="w-5 h-5 animate-spin me-2" /> {copy.loading}
                    </div>
                ) : rows.length === 0 ? (
                    <div className="rounded-lg border border-gray-100 bg-white p-8 text-center text-sm text-gray-500">
                        {copy.empty}
                    </div>
                ) : (
                    <div className="space-y-3">
                        {rows.map((row) => (
                            <RequestCard
                                key={row.id}
                                row={row}
                                copy={copy}
                                locale={locale}
                                onApprove={() => setReviewing({ row, mode: 'approve' })}
                                onReject={() => setReviewing({ row, mode: 'reject' })}
                            />
                        ))}
                    </div>
                )}
            </div>

            {reviewing && (
                <ReviewModal
                    row={reviewing.row}
                    mode={reviewing.mode}
                    copy={copy}
                    locale={locale}
                    onClose={() => setReviewing(null)}
                    onDone={async () => {
                        setReviewing(null);
                        await load(status);
                    }}
                />
            )}
        </PageShell>
    );
}

function RequestCard({
    row,
    copy,
    locale,
    onApprove,
    onReject,
}: {
    row: AdminActivationRequest;
    copy: Record<string, string>;
    locale: string;
    onApprove: () => void;
    onReject: () => void;
}) {
    const statusIcon =
        row.status === 'VERIFIED' ? <CheckCircle2 className="w-4 h-4" />
        : row.status === 'REJECTED' ? <XCircle className="w-4 h-4" />
        : <Clock className="w-4 h-4" />;

    return (
        <div className="rounded-lg border border-gray-100 bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-950 truncate">{row.tenant.name}</p>
                    <p className="text-xs text-gray-500">
                        {row.tenant_plan ?? row.plan_code} · {row.billing_cycle} · {formatDateTime(row.created_at, locale)}
                    </p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600">
                    {statusIcon}
                    {row.status}
                </span>
            </div>

            <dl className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
                <DetailCell label={copy.amount} value={formatBDT(row.amount, { locale })} emphasis />
                <DetailCell label={copy.method} value={row.method} />
                <DetailCell label={copy.transactionId} value={row.transaction_id} mono />
                <DetailCell label={copy.senderNumber} value={row.sender_number ?? '—'} mono />
            </dl>

            {(row.submitted_by || row.note) && (
                <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 space-y-1">
                    {row.submitted_by && (
                        <p>
                            {copy.submittedBy}: {row.submitted_by.name || row.submitted_by.email}
                            {row.submitted_by.mobile ? ` · ${row.submitted_by.mobile}` : ''}
                        </p>
                    )}
                    {row.note && <p>{copy.note}: {row.note}</p>}
                </div>
            )}

            {row.status === 'PENDING' ? (
                <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
                    <Button size="md" icon={<ShieldCheck className="w-4 h-4" />} onClick={onApprove}>
                        {copy.approve}
                    </Button>
                    <Button size="md" variant="secondary" onClick={onReject}>
                        {copy.reject}
                    </Button>
                </div>
            ) : row.review_note ? (
                <p className="border-t border-gray-100 pt-3 text-xs text-gray-500">
                    {copy.reviewNote}: {row.review_note}
                </p>
            ) : null}
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
            <dd className={`mt-0.5 break-words ${mono ? 'font-mono text-xs' : 'text-sm'} ${emphasis ? 'font-bold text-gray-900' : 'text-gray-700'}`}>
                {value}
            </dd>
        </div>
    );
}

function ReviewModal({
    row,
    mode,
    copy,
    locale,
    onClose,
    onDone,
}: {
    row: AdminActivationRequest;
    mode: 'approve' | 'reject';
    copy: Record<string, string>;
    locale: string;
    onClose: () => void;
    onDone: () => void | Promise<void>;
}) {
    const [amount, setAmount] = useState(String(row.amount));
    const [note, setNote] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const submit = async () => {
        if (mode === 'reject' && note.trim().length < 3) {
            setError(copy.reasonRequired);
            return;
        }
        const parsedAmount = Number(amount);
        if (mode === 'approve' && (!Number.isFinite(parsedAmount) || parsedAmount <= 0)) {
            setError(copy.amountRequired);
            return;
        }

        setIsSubmitting(true);
        setError('');
        try {
            if (mode === 'approve') {
                await api.approveActivationRequest(row.id, { amount: parsedAmount, note: note.trim() || undefined });
                toast.success(copy.approved);
            } else {
                await api.rejectActivationRequest(row.id, { reason: note.trim() });
                toast.success(copy.rejected);
            }
            await onDone();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : copy.reviewFailed);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <ModalShell size="sm" onBackdropClick={isSubmitting ? undefined : onClose} dismissOnBackdrop={false}>
            <ModalHeader
                title={mode === 'approve' ? copy.approveTitle : copy.rejectTitle}
                subtitle={row.tenant.name}
                onClose={isSubmitting ? undefined : onClose}
                closeLabel={copy.close}
            />

            <div className="space-y-4 overflow-y-auto p-4">
                <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600 space-y-1">
                    <p className="font-semibold text-gray-900">{row.tenant.name}</p>
                    <p className="font-mono text-xs">{row.method} · {row.transaction_id}</p>
                    <p>{copy.claimed}: {formatBDT(row.amount, { locale })}</p>
                </div>

                {mode === 'approve' ? (
                    <>
                        <Alert tone="warning">{copy.approveWarning}</Alert>
                        <Field label={copy.amountReceived} htmlFor="review-amount" required error={error || undefined}>
                            <Input
                                id="review-amount"
                                className="w-full"
                                inputMode="decimal"
                                value={amount}
                                error={Boolean(error)}
                                onChange={(event) => setAmount(event.target.value)}
                            />
                        </Field>
                        <Field label={copy.internalNote} htmlFor="review-note">
                            <Textarea
                                id="review-note"
                                className="w-full"
                                rows={2}
                                value={note}
                                onChange={(event) => setNote(event.target.value)}
                            />
                        </Field>
                    </>
                ) : (
                    <Field
                        label={copy.rejectReason}
                        htmlFor="review-reason"
                        required
                        error={error || undefined}
                        hint={copy.rejectReasonHint}
                    >
                        <Textarea
                            id="review-reason"
                            className="w-full"
                            rows={3}
                            value={note}
                            error={Boolean(error)}
                            onChange={(event) => setNote(event.target.value)}
                        />
                    </Field>
                )}
            </div>

            <ModalFooter>
                <Button variant="secondary" size="md" onClick={onClose} disabled={isSubmitting}>
                    {copy.cancel}
                </Button>
                <Button
                    size="md"
                    variant={mode === 'approve' ? 'primary' : 'danger'}
                    loading={isSubmitting}
                    disabled={isSubmitting}
                    onClick={submit}
                >
                    {mode === 'approve' ? copy.approve : copy.reject}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
