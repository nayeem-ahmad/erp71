'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { CheckCircle, Copy, Gift, Link2, Loader2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { DataTable } from '@/components/data-table';
import type { RefereeLedger, ReferralCommission, RefereePayment } from '@/components/admin/referrals/types';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { buildBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell } from '@/components/ui';

const commissionHelper = createColumnHelper<ReferralCommission>();
const paymentHelper = createColumnHelper<RefereePayment>();

export default function RefereePortalPage() {
    const { t } = useI18n();
    const m = t.referralPortal;
    const [ledger, setLedger] = useState<RefereeLedger | null>(null);
    const [error, setError] = useState('');
    const [toast, setToast] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const data = await api.getRefereePortalLedger();
            setLedger(data);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.loadFailed);
        } finally {
            setIsLoading(false);
        }
    }, [m.loadFailed]);

    useEffect(() => {
        void load();
    }, [load]);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(''), 3500);
    };

    const signupUrl = useMemo(() => {
        if (!ledger?.referee.referral_code || typeof window === 'undefined') return '';
        return `${window.location.origin}/signup?ref=${encodeURIComponent(ledger.referee.referral_code)}`;
    }, [ledger?.referee.referral_code]);

    const copyText = async (value: string, message: string) => {
        try {
            await navigator.clipboard.writeText(value);
            showToast(message);
        } catch {
            setError(m.copyFailed);
        }
    };

    const commissionColumns: ColumnDef<ReferralCommission, unknown>[] = useMemo(() => [
        commissionHelper.accessor((row) => row.tenant?.name ?? row.tenant_id, {
            id: 'tenant',
            header: m.commissions.columns.tenant,
            cell: (info) => <span className="font-medium text-gray-900">{info.getValue()}</span>,
        }),
        commissionHelper.accessor('status', {
            header: m.commissions.columns.status,
            cell: (info) => {
                const status = info.getValue();
                const color = status === 'PAID' ? 'bg-emerald-100 text-emerald-700' : status === 'EARNED' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600';
                return (
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${color}`}>
                        {m.status[status]}
                    </span>
                );
            },
        }),
        commissionHelper.accessor('commission_amount', {
            header: m.commissions.columns.commission,
            cell: (info) => {
                const value = info.getValue();
                return value !== null ? <span className="font-semibold text-emerald-700">৳{Number(value).toFixed(2)}</span> : '—';
            },
        }),
        commissionHelper.accessor('signed_up_at', {
            header: m.commissions.columns.signedUp,
            cell: (info) => formatDate(info.getValue()),
        }),
    ], [m]);

    const paymentColumns: ColumnDef<RefereePayment, unknown>[] = useMemo(() => [
        paymentHelper.accessor('paid_at', {
            header: m.payments.columns.date,
            cell: (info) => formatDate(info.getValue()),
        }),
        paymentHelper.accessor('amount', {
            header: m.payments.columns.amount,
            cell: (info) => <span className="font-semibold text-emerald-700">৳{Number(info.getValue()).toFixed(2)}</span>,
        }),
        paymentHelper.accessor('method', {
            header: m.payments.columns.method,
            cell: (info) => info.getValue() ?? '—',
        }),
        paymentHelper.accessor('reference', {
            header: m.payments.columns.reference,
            cell: (info) => info.getValue() ?? '—',
        }),
    ], [m]);

    const summaryCards = ledger ? [
        { label: m.summary.balanceDue, value: `৳${ledger.summary.balance_due.toFixed(2)}`, highlight: true },
        { label: m.summary.totalReferrals, value: String(ledger.summary.total_referrals) },
        { label: m.summary.pending, value: String(ledger.summary.pending) },
        { label: m.summary.earned, value: String(ledger.summary.earned) },
        { label: m.summary.paid, value: String(ledger.summary.paid) },
        { label: m.summary.totalEarned, value: `৳${ledger.summary.total_earned_amount.toFixed(2)}` },
        { label: m.summary.totalPaid, value: `৳${ledger.summary.total_paid_amount.toFixed(2)}` },
    ] : [];

    return (
        <PageShell>
                <PageHeader
                    title={formatMessage(m.title, { name: ledger?.referee.name ?? '' })}
                    subtitle={m.subtitle}
                    breadcrumbs={buildBreadcrumbs(t.dashboardHome.breadcrumbHome, [{ label: m.dashboard }])}
                />

                {toast && (
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                        <CheckCircle className="w-4 h-4" />
                        {toast}
                    </div>
                )}

                {error && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                        {error}
                    </div>
                )}

                {isLoading ? (
                    <div className="flex items-center justify-center py-16 text-gray-500">
                        <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                ) : ledger ? (
                    <>
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <div className="rounded-lg border border-gray-100 bg-white p-6 shadow-sm">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                                        <Gift className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-gray-900">{m.share.referralCode}</p>
                                        <p className="font-mono text-lg font-bold tracking-wider text-gray-900">{ledger.referee.referral_code}</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void copyText(ledger.referee.referral_code, m.share.codeCopied)}
                                    className="mt-4 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                                >
                                    <Copy className="w-4 h-4" />
                                    {m.share.copyCode}
                                </button>
                            </div>

                            <div className="rounded-lg border border-gray-100 bg-white p-6 shadow-sm">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-light text-primary">
                                        <Link2 className="w-5 h-5" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-gray-900">{m.share.signupLink}</p>
                                        <p className="truncate text-sm text-gray-500">{signupUrl}</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void copyText(signupUrl, m.share.linkCopied)}
                                    className="mt-4 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                                >
                                    <Copy className="w-4 h-4" />
                                    {m.share.copyLink}
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
                            {summaryCards.map((card) => (
                                <div
                                    key={card.label}
                                    className={`rounded-lg border p-4 ${card.highlight ? 'border-amber-200 bg-amber-50' : 'border-gray-100 bg-white'}`}
                                >
                                    <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{card.label}</p>
                                    <p className={`mt-2 text-xl font-bold ${card.highlight ? 'text-amber-700' : 'text-gray-900'}`}>{card.value}</p>
                                </div>
                            ))}
                        </div>

                        <div className="space-y-3">
                            <h2 className="text-lg font-bold text-gray-900">{m.commissions.title}</h2>
                            <DataTable
                                tableId="referee-portal-commissions"
                                data={ledger.commissions}
                                columns={commissionColumns}
                                title={m.commissions.title}
                                emptyMessage={m.commissions.empty}
                            />
                        </div>

                        <div className="space-y-3">
                            <h2 className="text-lg font-bold text-gray-900">{m.payments.title}</h2>
                            <DataTable
                                tableId="referee-portal-payments"
                                data={ledger.payments}
                                columns={paymentColumns}
                                title={m.payments.title}
                                emptyMessage={m.payments.empty}
                            />
                        </div>
                    </>
                ) : null}
        </PageShell>
    );
}