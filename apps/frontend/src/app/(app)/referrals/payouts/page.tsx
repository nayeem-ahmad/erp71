'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Loader2, Wallet } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { DataTable } from '@/components/data-table';
import {
    Alert,
    Button,
    ConfirmDialog,
    Field,
    FormGrid,
    Input,
    PageShell,
    Select,
    StatusBadge,
    Textarea,
} from '@/components/ui';
import type { StatusBadgeTone } from '@/components/ui';
import type {
    RefereePayoutMethod,
    RefereePayoutProfile,
    RefereePayoutRequest,
    RefereePayoutRequestStatus,
} from '@/components/admin/referrals/types';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { buildBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import { useRefereeLedger } from '../use-referee-ledger';

const helper = createColumnHelper<RefereePayoutRequest>();

const METHODS: RefereePayoutMethod[] = ['BKASH', 'NAGAD', 'ROCKET', 'BANK'];

/**
 * Not `statusToneFor`: that maps shared status vocabulary, and PENDING here means
 * "waiting on us" (amber), not the neutral pending it means on a commission.
 */
const STATUS_TONE: Record<RefereePayoutRequestStatus, StatusBadgeTone> = {
    PENDING: 'warning',
    APPROVED: 'info',
    PAID: 'success',
    REJECTED: 'danger',
    CANCELLED: 'neutral',
};

export default function RefereePayoutsPage() {
    const { t } = useI18n();
    const m = t.referralPortal;
    const page = m.payoutsPage;

    const { ledger } = useRefereeLedger();
    const [profile, setProfile] = useState<RefereePayoutProfile | null>(null);
    const [requests, setRequests] = useState<RefereePayoutRequest[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    const [method, setMethod] = useState<RefereePayoutMethod>('BKASH');
    const [accountName, setAccountName] = useState('');
    const [accountNumber, setAccountNumber] = useState('');
    const [bankName, setBankName] = useState('');
    const [branch, setBranch] = useState('');
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [profileError, setProfileError] = useState('');

    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    const [isRequesting, setIsRequesting] = useState(false);
    const [requestError, setRequestError] = useState('');
    const [cancelTarget, setCancelTarget] = useState<RefereePayoutRequest | null>(null);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const [nextProfile, nextRequests] = await Promise.all([
                api.getRefereePayoutProfile(),
                api.getRefereePayoutRequests(),
            ]);
            setProfile(nextProfile);
            setRequests(nextRequests);
            setMethod(nextProfile.payout_method ?? 'BKASH');
            setAccountName(nextProfile.payout_account_name ?? '');
            setAccountNumber(nextProfile.payout_account_number ?? '');
            setBankName(nextProfile.payout_bank_name ?? '');
            setBranch(nextProfile.payout_branch ?? '');
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : page.loadFailed);
        } finally {
            setIsLoading(false);
        }
    }, [page.loadFailed]);

    useEffect(() => {
        void load();
    }, [load]);

    const balanceDue = ledger?.summary.balance_due ?? 0;
    const minimum = profile?.min_payout_amount ?? 0;
    const isBank = method === 'BANK';

    /**
     * The server is the authority on all three of these — it re-checks every one
     * before creating a request. Mirroring them here is only so the partner is told
     * why the button is disabled instead of being handed a 400.
     */
    const blockedReason = useMemo(() => {
        const hasOpenRequest = requests.some((r) => r.status === 'PENDING' || r.status === 'APPROVED');
        if (!profile?.is_complete) return page.profile.incomplete;
        if (hasOpenRequest) return page.request.inFlight;
        if (balanceDue <= 0) return page.request.nothingDue;
        if (balanceDue < minimum) {
            return formatMessage(page.request.belowMinimum, { amount: formatBDT(minimum) });
        }
        return null;
    }, [requests, profile?.is_complete, balanceDue, minimum, page]);

    const saveProfile = async () => {
        setIsSavingProfile(true);
        setProfileError('');
        try {
            const next = await api.updateRefereePayoutProfile({
                payout_method: method,
                payout_account_name: accountName || undefined,
                payout_account_number: accountNumber,
                payout_bank_name: isBank ? bankName : undefined,
                payout_branch: isBank ? branch : undefined,
            });
            setProfile(next);
            toast.success(page.profile.saved);
        } catch (err: unknown) {
            setProfileError(err instanceof Error ? err.message : page.loadFailed);
        } finally {
            setIsSavingProfile(false);
        }
    };

    const submitRequest = async () => {
        setIsRequesting(true);
        setRequestError('');
        try {
            await api.createRefereePayoutRequest({
                amount: amount ? Number(amount) : undefined,
                note: note || undefined,
            });
            setAmount('');
            setNote('');
            toast.success(page.request.submitted);
            await load();
        } catch (err: unknown) {
            setRequestError(err instanceof Error ? err.message : page.request.failed);
        } finally {
            setIsRequesting(false);
        }
    };

    const cancelRequest = async () => {
        if (!cancelTarget) return;
        try {
            await api.cancelRefereePayoutRequest(cancelTarget.id);
            toast.success(page.request.cancelled);
            await load();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : page.request.failed);
        } finally {
            setCancelTarget(null);
        }
    };

    const columns: ColumnDef<RefereePayoutRequest, unknown>[] = useMemo(() => [
        helper.accessor('requested_at', {
            header: page.history.columns.requested,
            cell: (info) => formatDate(info.getValue()),
        }),
        helper.accessor('amount', {
            header: page.history.columns.amount,
            cell: (info) => (
                <span className="font-semibold text-gray-900">{formatBDT(Number(info.getValue()))}</span>
            ),
        }),
        helper.accessor('status', {
            header: page.history.columns.status,
            cell: (info) => {
                const status = info.getValue();
                return <StatusBadge tone={STATUS_TONE[status]}>{page.status[status]}</StatusBadge>;
            },
        }),
        helper.accessor((row) => `${row.method} · ${row.account_number}`, {
            id: 'destination',
            header: page.history.columns.destination,
            meta: { hideOnMobile: true },
            cell: (info) => <span className="font-mono text-xs">{info.getValue()}</span>,
        }),
        helper.accessor('reviewed_at', {
            header: page.history.columns.reviewed,
            meta: { hideOnMobile: true },
            cell: (info) => (info.getValue() ? formatDate(info.getValue() as string) : '—'),
        }),
        helper.display({
            id: 'note',
            header: page.history.columns.note,
            meta: { hideOnMobile: true },
            cell: (info) => {
                const request = info.row.original;
                // The decline reason is the whole point of a declined row.
                if (request.status === 'REJECTED' && request.decision_note) {
                    return <span className="text-red-700">{request.decision_note}</span>;
                }
                if (request.status === 'PENDING') {
                    return (
                        <button
                            type="button"
                            onClick={() => setCancelTarget(request)}
                            className="min-h-touch text-sm font-semibold text-blue-600 hover:underline"
                        >
                            {page.request.cancel}
                        </button>
                    );
                }
                return request.note ?? '—';
            },
        }),
    ], [page]);

    return (
        <PageShell>
            <PageHeader
                title={page.title}
                subtitle={page.subtitle}
                breadcrumbs={buildBreadcrumbs(t.dashboardHome.breadcrumbHome, [
                    { label: m.breadcrumb, href: routes.referralsPortal.root },
                    { label: page.title },
                ])}
            />

            {error && <Alert tone="danger">{error}</Alert>}

            {isLoading ? (
                <div className="flex items-center justify-center py-16 text-gray-500">
                    <Loader2 className="h-6 w-6 animate-spin" />
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <section className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
                            <h2 className="text-sm font-semibold text-gray-900">{page.profile.title}</h2>
                            <p className="mt-1 text-xs text-gray-500">{page.profile.subtitle}</p>

                            {profileError && (
                                <div className="mt-3">
                                    <Alert tone="danger">{profileError}</Alert>
                                </div>
                            )}

                            <FormGrid className="mt-4">
                                <Field label={page.profile.method}>
                                    <Select
                                        value={method}
                                        onChange={(event) =>
                                            setMethod(event.target.value as RefereePayoutMethod)
                                        }
                                    >
                                        {METHODS.map((option) => (
                                            <option key={option} value={option}>
                                                {page.profile.methodOptions[option]}
                                            </option>
                                        ))}
                                    </Select>
                                </Field>

                                <Field
                                    label={isBank ? page.profile.accountNumber : page.profile.walletNumber}
                                    hint={isBank ? undefined : page.profile.walletHint}
                                >
                                    <Input
                                        value={accountNumber}
                                        onChange={(event) => setAccountNumber(event.target.value)}
                                        inputMode={isBank ? 'text' : 'numeric'}
                                    />
                                </Field>

                                <Field label={page.profile.accountName}>
                                    <Input
                                        value={accountName}
                                        onChange={(event) => setAccountName(event.target.value)}
                                    />
                                </Field>

                                {isBank && (
                                    <>
                                        <Field label={page.profile.bankName}>
                                            <Input
                                                value={bankName}
                                                onChange={(event) => setBankName(event.target.value)}
                                            />
                                        </Field>
                                        <Field label={page.profile.branch}>
                                            <Input
                                                value={branch}
                                                onChange={(event) => setBranch(event.target.value)}
                                            />
                                        </Field>
                                    </>
                                )}
                            </FormGrid>

                            <div className="mt-4 flex items-center gap-3">
                                <Button size="md" loading={isSavingProfile} onClick={() => void saveProfile()}>
                                    {page.profile.save}
                                </Button>
                                {profile?.payout_updated_at && (
                                    <span className="text-xs text-gray-500">
                                        {formatMessage(page.profile.lastUpdated, {
                                            date: formatDate(profile.payout_updated_at),
                                        })}
                                    </span>
                                )}
                            </div>
                        </section>

                        <section className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
                            <h2 className="text-sm font-semibold text-gray-900">{page.request.title}</h2>

                            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
                                <p className="text-xs font-medium uppercase tracking-wider text-gray-600">
                                    {page.request.balanceDue}
                                </p>
                                <p className="mt-1 text-2xl font-bold text-amber-700">{formatBDT(balanceDue)}</p>
                                <p className="mt-1 text-xs text-gray-600">
                                    {formatMessage(page.request.minimum, { amount: formatBDT(minimum) })}
                                </p>
                            </div>

                            {blockedReason ? (
                                <div className="mt-3">
                                    <Alert tone="info">{blockedReason}</Alert>
                                </div>
                            ) : (
                                <>
                                    {requestError && (
                                        <div className="mt-3">
                                            <Alert tone="danger">{requestError}</Alert>
                                        </div>
                                    )}
                                    <FormGrid className="mt-4">
                                        <Field label={page.request.amount} hint={page.request.amountHint}>
                                            <Input
                                                type="number"
                                                inputMode="decimal"
                                                min={minimum}
                                                max={balanceDue}
                                                value={amount}
                                                onChange={(event) => setAmount(event.target.value)}
                                                placeholder={String(balanceDue)}
                                            />
                                        </Field>
                                        <Field label={page.request.note}>
                                            <Textarea
                                                rows={2}
                                                value={note}
                                                onChange={(event) => setNote(event.target.value)}
                                                placeholder={page.request.notePlaceholder}
                                            />
                                        </Field>
                                    </FormGrid>
                                    <Button
                                        size="md"
                                        className="mt-4"
                                        loading={isRequesting}
                                        onClick={() => void submitRequest()}
                                    >
                                        {page.request.submit}
                                    </Button>
                                </>
                            )}
                        </section>
                    </div>

                    <DataTable
                        tableId="referee-portal-payout-requests"
                        data={requests}
                        columns={columns}
                        title={page.history.title}
                        emptyMessage={page.history.empty}
                        emptyIcon={<Wallet className="h-16 w-16 text-gray-200" />}
                        searchPlaceholder={page.history.searchPlaceholder}
                    />
                </>
            )}

            <ConfirmDialog
                open={!!cancelTarget}
                title={page.request.cancelConfirmTitle}
                prompt={page.request.cancelConfirmBody}
                confirmLabel={page.request.cancel}
                cancelLabel={t.common.cancel}
                onConfirm={() => void cancelRequest()}
                onCancel={() => setCancelTarget(null)}
            />
        </PageShell>
    );
}
