'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Banknote } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Button, StatusBadge, Textarea } from '@/components/ui';
import type { StatusBadgeTone } from '@/components/ui';
import type { RefereePayoutRequest, RefereePayoutRequestStatus } from './types';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';

const helper = createColumnHelper<RefereePayoutRequest>();

const STATUS_TONE: Record<RefereePayoutRequestStatus, StatusBadgeTone> = {
    PENDING: 'warning',
    APPROVED: 'info',
    PAID: 'success',
    REJECTED: 'danger',
    CANCELLED: 'neutral',
};

type Props = {
    /** Omit to review every partner's requests; pass one to scope to their page. */
    refereeId?: string;
    /** Opens the payment modal against the request, which settles it on success. */
    onSettle?: (request: RefereePayoutRequest) => void;
    /** Bumped by the parent after a payment lands, to pull the new statuses. */
    refreshToken?: number;
};

/**
 * The admin half of partner-initiated payouts.
 *
 * Approving deliberately moves no money and settles no commission — it tells the
 * partner their request cleared review. The ledger changes only when a payment is
 * recorded against the request, which is the path payouts have always taken.
 */
export default function PayoutRequestsPanel({ refereeId, onSettle, refreshToken }: Readonly<Props>) {
    const { t } = useI18n();
    const m = t.admin.referrals.payoutRequests;

    const [requests, setRequests] = useState<RefereePayoutRequest[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [rejectTarget, setRejectTarget] = useState<RefereePayoutRequest | null>(null);
    const [reason, setReason] = useState('');

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            setRequests(await api.getAdminPayoutRequests(refereeId ? { referee_id: refereeId } : undefined));
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : m.loadFailed);
        } finally {
            setIsLoading(false);
        }
    }, [refereeId, m.loadFailed]);

    useEffect(() => {
        void load();
    }, [load, refreshToken]);

    const approve = async (request: RefereePayoutRequest) => {
        setBusyId(request.id);
        try {
            await api.approveAdminPayoutRequest(request.id);
            toast.success(m.approved);
            await load();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : m.actionFailed);
        } finally {
            setBusyId(null);
        }
    };

    const reject = async () => {
        if (!rejectTarget || !reason.trim()) return;
        setBusyId(rejectTarget.id);
        try {
            await api.rejectAdminPayoutRequest(rejectTarget.id, reason.trim());
            toast.success(m.rejected);
            setRejectTarget(null);
            setReason('');
            await load();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : m.actionFailed);
        } finally {
            setBusyId(null);
        }
    };

    const columns: ColumnDef<RefereePayoutRequest, unknown>[] = useMemo(() => {
        const base: ColumnDef<RefereePayoutRequest, unknown>[] = [];

        if (!refereeId) {
            base.push(helper.accessor((row) => row.referee?.name ?? row.referee_id, {
                id: 'referee',
                header: m.columns.referee,
                cell: (info) => <span className="font-medium text-gray-900">{info.getValue()}</span>,
            }) as ColumnDef<RefereePayoutRequest, unknown>);
        }

        return [
            ...base,
            helper.accessor('requested_at', {
                header: m.columns.requested,
                cell: (info) => formatDate(info.getValue()),
            }),
            helper.accessor('amount', {
                header: m.columns.amount,
                cell: (info) => (
                    <span className="font-semibold text-gray-900">{formatBDT(Number(info.getValue()))}</span>
                ),
            }),
            helper.accessor('status', {
                header: m.columns.status,
                cell: (info) => {
                    const status = info.getValue();
                    return <StatusBadge tone={STATUS_TONE[status]}>{m.status[status]}</StatusBadge>;
                },
            }),
            // The destination is the thing an admin actually keys into bKash, so it
            // is monospaced and never hidden on mobile.
            helper.display({
                id: 'destination',
                header: m.columns.destination,
                cell: (info) => {
                    const r = info.row.original;
                    return (
                        <div className="text-xs">
                            <span className="font-semibold">{r.method}</span>
                            <br />
                            <span className="font-mono">{r.account_number}</span>
                            {r.account_name && <br />}
                            {r.account_name}
                            {r.bank_name && <span className="block text-gray-500">{r.bank_name}</span>}
                        </div>
                    );
                },
            }),
            helper.accessor('note', {
                header: m.columns.note,
                meta: { hideOnMobile: true },
                cell: (info) => info.getValue() ?? '—',
            }),
            helper.display({
                id: 'actions',
                header: m.columns.actions,
                cell: (info) => {
                    const request = info.row.original;
                    const busy = busyId === request.id;

                    if (request.status === 'PENDING') {
                        return (
                            <div className="flex gap-2">
                                <Button size="sm" disabled={busy} onClick={() => void approve(request)}>
                                    {m.approve}
                                </Button>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    disabled={busy}
                                    onClick={() => setRejectTarget(request)}
                                >
                                    {m.reject}
                                </Button>
                            </div>
                        );
                    }

                    if (request.status === 'APPROVED') {
                        return (
                            <div className="flex gap-2">
                                <Button size="sm" disabled={busy || !onSettle} onClick={() => onSettle?.(request)}>
                                    {m.settle}
                                </Button>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    disabled={busy}
                                    onClick={() => setRejectTarget(request)}
                                >
                                    {m.reject}
                                </Button>
                            </div>
                        );
                    }

                    if (request.status === 'REJECTED' && request.decision_note) {
                        return <span className="text-xs text-red-700">{request.decision_note}</span>;
                    }
                    return <span className="text-gray-400">—</span>;
                },
            }),
        ];
        // `approve` closes over `load`, which is already in this component's identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [m, refereeId, busyId, onSettle]);

    return (
        <>
            <DataTable
                tableId={refereeId ? 'admin-referee-payout-requests' : 'admin-payout-requests'}
                data={requests}
                columns={columns}
                title={m.title}
                isLoading={isLoading}
                emptyMessage={m.empty}
                emptyIcon={<Banknote className="h-16 w-16 text-gray-200" />}
                searchPlaceholder={m.searchPlaceholder}
            />

            {rejectTarget && (
                <ModalShell size="sm" onBackdropClick={() => setRejectTarget(null)}>
                    <ModalHeader
                        title={m.rejectTitle}
                        subtitle={formatBDT(rejectTarget.amount)}
                        onClose={() => setRejectTarget(null)}
                    />
                    <div className="space-y-3 p-6">
                        <p className="text-sm text-gray-600">{m.rejectBody}</p>
                        <Textarea
                            rows={3}
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            placeholder={m.rejectPlaceholder}
                            aria-label={m.rejectReasonLabel}
                        />
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" size="md" onClick={() => setRejectTarget(null)}>
                            {t.common.cancel}
                        </Button>
                        <Button
                            variant="danger"
                            size="md"
                            disabled={!reason.trim()}
                            loading={busyId === rejectTarget.id}
                            onClick={() => void reject()}
                        >
                            {m.reject}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}
        </>
    );
}
