'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { ArrowLeft, CheckCircle, Loader2, Plus } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { DataTable } from '@/components/data-table';
import RefereePaymentModal from '@/components/admin/referrals/RefereePaymentModal';
import type { RefereeLedger, ReferralCommission, RefereePayment } from '@/components/admin/referrals/types';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';

const commissionHelper = createColumnHelper<ReferralCommission>();
const paymentHelper = createColumnHelper<RefereePayment>();

export default function AdminRefereeDetailPage() {
    const params = useParams<{ id: string }>();
    const refereeId = params.id;
    const { t } = useI18n();
    const m = t.admin.referrals;
    const d = m.detail;
    const [ledger, setLedger] = useState<RefereeLedger | null>(null);
    const [error, setError] = useState('');
    const [toast, setToast] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [paymentOpen, setPaymentOpen] = useState(false);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const data = await api.getAdminRefereeLedger(refereeId);
            setLedger(data);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : d.loadFailed);
        } finally {
            setIsLoading(false);
        }
    }, [d.loadFailed, refereeId]);

    useEffect(() => {
        void load();
    }, [load]);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(''), 3500);
    };

    const commissionColumns: ColumnDef<ReferralCommission, unknown>[] = useMemo(() => [
        commissionHelper.accessor((row) => row.tenant?.name ?? row.tenant_id, {
            id: 'tenant',
            header: d.commissionColumns.tenant,
            cell: (info) => <span className="font-medium text-gray-900">{info.getValue()}</span>,
        }),
        commissionHelper.accessor('status', {
            header: d.commissionColumns.status,
            cell: (info) => {
                const status = info.getValue();
                const color = status === 'PAID' ? 'bg-emerald-100 text-emerald-700' : status === 'EARNED' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600';
                return (
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${color}`}>
                        {d.status[status]}
                    </span>
                );
            },
        }),
        commissionHelper.accessor('discount_pct', {
            header: d.commissionColumns.discount,
            cell: (info) => `${info.getValue()}%`,
        }),
        commissionHelper.accessor('plan_amount', {
            header: d.commissionColumns.planAmount,
            cell: (info) => {
                const value = info.getValue();
                return value !== null ? `৳${Number(value).toFixed(2)}` : '—';
            },
        }),
        commissionHelper.accessor('commission_amount', {
            header: d.commissionColumns.commission,
            cell: (info) => {
                const value = info.getValue();
                return value !== null ? <span className="font-semibold text-emerald-700">৳{Number(value).toFixed(2)}</span> : '—';
            },
        }),
        commissionHelper.accessor('signed_up_at', {
            header: d.commissionColumns.signedUp,
            cell: (info) => formatDate(info.getValue()),
        }),
    ], [d]);

    const paymentColumns: ColumnDef<RefereePayment, unknown>[] = useMemo(() => [
        paymentHelper.accessor('paid_at', {
            header: d.paymentColumns.date,
            cell: (info) => formatDate(info.getValue()),
        }),
        paymentHelper.accessor('amount', {
            header: d.paymentColumns.amount,
            cell: (info) => <span className="font-semibold text-emerald-700">৳{Number(info.getValue()).toFixed(2)}</span>,
        }),
        paymentHelper.accessor('method', {
            header: d.paymentColumns.method,
            cell: (info) => info.getValue() ?? '—',
        }),
        paymentHelper.accessor('reference', {
            header: d.paymentColumns.reference,
            cell: (info) => info.getValue() ?? '—',
        }),
        paymentHelper.accessor('notes', {
            header: d.paymentColumns.notes,
            cell: (info) => info.getValue() ?? '—',
        }),
    ], [d]);

    const summaryCards = ledger ? [
        { label: d.summary.totalReferrals, value: String(ledger.summary.total_referrals) },
        { label: d.summary.pending, value: String(ledger.summary.pending) },
        { label: d.summary.earned, value: String(ledger.summary.earned) },
        { label: d.summary.paid, value: String(ledger.summary.paid) },
        { label: d.summary.totalEarned, value: `৳${ledger.summary.total_earned_amount.toFixed(2)}` },
        { label: d.summary.totalPaid, value: `৳${ledger.summary.total_paid_amount.toFixed(2)}` },
        { label: d.summary.balanceDue, value: `৳${ledger.summary.balance_due.toFixed(2)}`, highlight: true },
    ] : [];

    return (
        <div className="overflow-y-auto h-full bg-canvas p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
            <PageHeader
                title={ledger ? `${d.title}: ${ledger.referee.name}` : d.title}
                subtitle={ledger?.referee.referral_code}
                breadcrumbs={nestedPageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.admin,
                    'admin',
                    [{ label: m.title, href: '/admin/referrals' }],
                    ledger?.referee.name ?? '…',
                )}
                actions={(
                    <div className="flex items-center gap-2">
                        <Link href="/admin/referrals" className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                            <ArrowLeft className="w-4 h-4" />
                            {d.back}
                        </Link>
                        <button
                            type="button"
                            onClick={() => setPaymentOpen(true)}
                            disabled={!ledger || ledger.summary.earned === 0 || Boolean(ledger?.referee.deleted_at)}
                            className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                            <Plus className="w-4 h-4" />
                            {d.recordPayment}
                        </button>
                    </div>
                )}
            />

            {toast && (
                <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                    <CheckCircle className="w-4 h-4" />
                    {toast}
                </div>
            )}

            {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                    {error}
                </div>
            )}

            {ledger?.referee.deleted_at && (
                <div className="rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
                    {d.archivedBanner}
                </div>
            )}

            {isLoading ? (
                <div className="flex items-center justify-center py-16 text-gray-500">
                    <Loader2 className="w-6 h-6 animate-spin" />
                </div>
            ) : ledger ? (
                <>
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
                        {summaryCards.map((card) => (
                            <div
                                key={card.label}
                                className={`rounded-2xl border p-4 ${card.highlight ? 'border-amber-200 bg-amber-50' : 'border-gray-100 bg-white'}`}
                            >
                                <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{card.label}</p>
                                <p className={`mt-2 text-xl font-black ${card.highlight ? 'text-amber-700' : 'text-gray-900'}`}>{card.value}</p>
                            </div>
                        ))}
                    </div>

                    <div className="space-y-3">
                        <h2 className="text-lg font-black text-gray-900">{d.commissionsTitle}</h2>
                        <DataTable
                            tableId="admin-referral-commissions"
                            data={ledger.commissions}
                            columns={commissionColumns}
                            title={d.commissionsTitle}
                            emptyMessage={d.noCommissions}
                        />
                    </div>

                    <div className="space-y-3">
                        <h2 className="text-lg font-black text-gray-900">{d.paymentsTitle}</h2>
                        <DataTable
                            tableId="admin-referral-payments"
                            data={ledger.payments}
                            columns={paymentColumns}
                            title={d.paymentsTitle}
                            emptyMessage={d.noPayments}
                        />
                    </div>
                </>
            ) : null}

            <RefereePaymentModal
                open={paymentOpen}
                refereeId={refereeId}
                defaultAmount={ledger?.summary.balance_due}
                onClose={() => setPaymentOpen(false)}
                onSuccess={(message) => {
                    showToast(message);
                    void load();
                }}
            />
            </div>
        </div>
    );
}