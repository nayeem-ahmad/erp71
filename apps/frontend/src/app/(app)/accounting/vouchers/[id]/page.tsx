'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Copy } from 'lucide-react';
import {
    AccountingPageShell,
    CompactSection,
    CompactStat,
} from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { compactDensity } from '@/lib/ui/compact-density';
import { mapApiAttachments, VoucherAttachments } from '@/components/accounting/VoucherAttachments';
import { VoucherApprovalBadge } from '@/components/accounting/VoucherApprovalBadge';
import { hasPermission, isOwner } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { notifyVoucherApprovalChanged } from '@/hooks/usePendingVoucherCount';
import type { VoucherAttachmentItem } from '@/lib/file-preview';
import { getWorkspaceItem } from '@/lib/session-store';

type VoucherDetail = {
    id: string;
    voucher_number: string;
    voucher_type: string;
    description?: string | null;
    reference_number?: string | null;
    date: string;
    total_amount: number;
    approval_status?: string | null;
    rejection_reason?: string | null;
    details: Array<{
        id: string;
        debit_amount: number;
        credit_amount: number;
        comment?: string | null;
        account: {
            name: string;
            code?: string | null;
            group?: { name: string };
            subgroup?: { name: string } | null;
        };
    }>;
    attachments?: Array<{
        id: string;
        file_url: string;
        file_name: string;
        mime_type?: string | null;
        file_size?: number | null;
    }>;
};

export default function VoucherDetailPage() {
    const { t, locale } = useI18n();
    const params = useParams<{ id: string }>();
    const [voucher, setVoucher] = useState<VoucherDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [attachments, setAttachments] = useState<VoucherAttachmentItem[]>([]);
    const [canApprove, setCanApprove] = useState(false);
    const [acting, setActing] = useState(false);

    useEffect(() => {
        api.getMe()
            .then((me) => {
                const tenant = me?.tenants?.find((entry: { id: string }) => entry.id === getWorkspaceItem('tenant_id'))
                    ?? me?.tenants?.[0];
                setCanApprove(isOwner(tenant?.role) || hasPermission(tenant?.permissions, 'APPROVE_VOUCHER'));
            })
            .catch(() => setCanApprove(false));
    }, []);

    useEffect(() => {
        let active = true;

        const loadVoucher = async () => {
            setLoading(true);
            setError('');

            try {
                const data = await api.getVoucher(params.id);
                if (!active) {
                    return;
                }

                setVoucher(data);
                setAttachments(mapApiAttachments(data.attachments));
            } catch (loadError) {
                if (!active) {
                    return;
                }

                setError(loadError instanceof Error ? loadError.message : 'Failed to load voucher detail.');
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        };

        void loadVoucher();

        return () => {
            active = false;
        };
    }, [params.id]);

    const debitTotal = voucher?.details.reduce((sum, row) => sum + Number(row.debit_amount || 0), 0) ?? 0;
    const creditTotal = voucher?.details.reduce((sum, row) => sum + Number(row.credit_amount || 0), 0) ?? 0;
    const isPending = voucher?.approval_status === 'PENDING';

    const act = async (action: 'approve' | 'reject') => {
        if (!voucher) return;

        let reason: string | undefined;
        if (action === 'reject') {
            const answer = window.prompt(t.vouchers.approval.rejectPrompt);
            if (answer === null) return;
            reason = answer || undefined;
        }

        setActing(true);
        try {
            const updated = action === 'approve'
                ? await api.approveVoucher(voucher.id)
                : await api.rejectVoucher(voucher.id, reason);
            setVoucher(updated);
            notifyVoucherApprovalChanged();
            toast.success(action === 'approve' ? t.vouchers.approval.approveSuccess : t.vouchers.approval.rejectSuccess);
        } catch (actionError) {
            toast.error(actionError instanceof Error
                ? actionError.message
                : (action === 'approve' ? t.vouchers.approval.approveFailed : t.vouchers.approval.rejectFailed));
        } finally {
            setActing(false);
        }
    };

    return (
        <AccountingPageShell maxWidth="full">
            <PageHeader
                title={voucher?.voucher_number ?? t.journal.detail.voucherDetail}
                subtitle="Inspect the full debit and credit composition of a single posted voucher."
                breadcrumbs={nestedPageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    'accounting',
                    [{ label: t.vouchers.list.title, href: routes.accounting.vouchers }],
                    voucher?.voucher_number ?? t.journal.detail.voucherDetail,
                )}
                actions={voucher ? (
                    <Link
                        href={`/accounting/vouchers/new?duplicate=${voucher.id}`}
                        className="inline-flex items-center gap-1 min-h-touch px-3 py-1.5 rounded border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                        <Copy className="h-3.5 w-3.5" />
                        {t.vouchers.list.duplicate}
                    </Link>
                ) : undefined}
            />

            {loading ? <CompactSection className="text-sm text-gray-500">{t.journal.detail.loading}</CompactSection> : null}
            {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div> : null}

            {voucher ? (
                <>
                    <div className="grid gap-3 md:grid-cols-4">
                        <CompactStat label={t.journal.columns.voucherNumber} value={voucher.voucher_number} />
                        <CompactStat label={t.accountingShared.type} value={voucher.voucher_type.replaceAll('_', ' ')} />
                        <CompactStat label={t.accountingShared.date} value={formatDate(voucher.date, locale)} />
                        <CompactStat label={t.accountingShared.reference} value={voucher.reference_number || t.accountingShared.notProvided} />
                    </div>

                    {voucher.approval_status && voucher.approval_status !== 'APPROVED' ? (
                        <CompactSection className={isPending ? 'border-amber-100 bg-amber-50/50' : 'border-red-100 bg-red-50/50'}>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="space-y-1">
                                    <VoucherApprovalBadge status={voucher.approval_status} />
                                    <p className={`text-xs ${isPending ? 'text-amber-800' : 'text-danger'}`}>
                                        {isPending
                                            ? t.vouchers.approval.pendingNotice
                                            : `${t.vouchers.approval.rejectedReason}: ${voucher.rejection_reason || '—'}`}
                                    </p>
                                </div>
                                {canApprove ? (
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => void act('approve')}
                                            disabled={acting || voucher.approval_status === 'APPROVED'}
                                            className="min-h-touch px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-40"
                                        >
                                            {t.vouchers.approval.approve}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void act('reject')}
                                            disabled={acting || voucher.approval_status === 'REJECTED'}
                                            className="min-h-touch px-3 py-1.5 rounded border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                                        >
                                            {t.vouchers.approval.reject}
                                        </button>
                                    </div>
                                ) : (
                                    <p className="text-xs text-gray-500">{t.vouchers.approval.noPermission}</p>
                                )}
                            </div>
                        </CompactSection>
                    ) : null}

                    <CompactSection title={t.accountingShared.narration}>
                        <p className="text-sm text-gray-700">{voucher.description || t.journal.detail.noNarrationCaptured}</p>

                        <div className="overflow-hidden rounded-lg border border-gray-200 mt-3">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-4 py-3 text-start text-[11px] font-bold uppercase tracking-[0.24em] text-gray-400">{t.accountingShared.account}</th>
                                            <th className="px-4 py-3 text-start text-[11px] font-bold uppercase tracking-[0.24em] text-gray-400">{t.accountingShared.group}</th>
                                            <th className="px-4 py-3 text-end text-[11px] font-bold uppercase tracking-[0.24em] text-gray-400">{t.accountingShared.debit}</th>
                                            <th className="px-4 py-3 text-end text-[11px] font-bold uppercase tracking-[0.24em] text-gray-400">{t.accountingShared.credit}</th>
                                            <th className="px-4 py-3 text-start text-[11px] font-bold uppercase tracking-[0.24em] text-gray-400">{t.accountingShared.comment}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 bg-white">
                                        {voucher.details.map((row) => (
                                            <tr key={row.id}>
                                                <td className="px-4 py-3 text-sm font-bold text-gray-900">{row.account.name}</td>
                                                <td className="px-4 py-3 text-sm text-gray-500">{row.account.group?.name || 'Ungrouped'}</td>
                                                <td className="px-4 py-3 text-end text-sm font-bold text-amber-700">{formatBDT(Number(row.debit_amount || 0), { locale })}</td>
                                                <td className="px-4 py-3 text-end text-sm font-bold text-sky-700">{formatBDT(Number(row.credit_amount || 0), { locale })}</td>
                                                <td className="px-4 py-3 text-sm text-gray-500">{row.comment || '-'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="bg-gray-50">
                                        <tr>
                                            <td colSpan={2} className="px-4 py-3 text-sm font-bold uppercase tracking-[0.24em] text-gray-500">{t.accountingShared.totals}</td>
                                            <td className="px-4 py-3 text-end text-sm font-bold text-amber-700">{formatBDT(debitTotal, { locale })}</td>
                                            <td className="px-4 py-3 text-end text-sm font-bold text-sky-700">{formatBDT(creditTotal, { locale })}</td>
                                            <td className="px-4 py-3 text-end text-sm font-bold text-gray-700">{t.accountingShared.balanced}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                        </div>
                    </CompactSection>

                    {attachments.length > 0 ? (
                        <CompactSection title={t.vouchers.attachments.title}>
                            <VoucherAttachments
                                attachments={attachments}
                                onChange={setAttachments}
                                readOnly
                                labels={t.vouchers.attachments}
                            />
                        </CompactSection>
                    ) : null}
                </>
            ) : null}
        </AccountingPageShell>
    );
}