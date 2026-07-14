'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
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
import type { VoucherAttachmentItem } from '@/lib/file-preview';

type VoucherDetail = {
    id: string;
    voucher_number: string;
    voucher_type: string;
    description?: string | null;
    reference_number?: string | null;
    date: string;
    total_amount: number;
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

                    <CompactSection title={t.accountingShared.narration}>
                        <p className="text-sm text-gray-700">{voucher.description || t.journal.detail.noNarrationCaptured}</p>

                        <div className="overflow-hidden rounded-lg border border-gray-200 mt-3">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.24em] text-gray-400">{t.accountingShared.account}</th>
                                            <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.24em] text-gray-400">{t.accountingShared.group}</th>
                                            <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.24em] text-gray-400">{t.accountingShared.debit}</th>
                                            <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.24em] text-gray-400">{t.accountingShared.credit}</th>
                                            <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.24em] text-gray-400">{t.accountingShared.comment}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 bg-white">
                                        {voucher.details.map((row) => (
                                            <tr key={row.id}>
                                                <td className="px-4 py-3 text-sm font-bold text-gray-900">{row.account.name}</td>
                                                <td className="px-4 py-3 text-sm text-gray-500">{row.account.group?.name || 'Ungrouped'}</td>
                                                <td className="px-4 py-3 text-right text-sm font-bold text-amber-700">{formatBDT(Number(row.debit_amount || 0), { locale })}</td>
                                                <td className="px-4 py-3 text-right text-sm font-bold text-sky-700">{formatBDT(Number(row.credit_amount || 0), { locale })}</td>
                                                <td className="px-4 py-3 text-sm text-gray-500">{row.comment || '-'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="bg-gray-50">
                                        <tr>
                                            <td colSpan={2} className="px-4 py-3 text-sm font-bold uppercase tracking-[0.24em] text-gray-500">{t.accountingShared.totals}</td>
                                            <td className="px-4 py-3 text-right text-sm font-bold text-amber-700">{formatBDT(debitTotal, { locale })}</td>
                                            <td className="px-4 py-3 text-right text-sm font-bold text-sky-700">{formatBDT(creditTotal, { locale })}</td>
                                            <td className="px-4 py-3 text-right text-sm font-bold text-gray-700">{t.accountingShared.balanced}</td>
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