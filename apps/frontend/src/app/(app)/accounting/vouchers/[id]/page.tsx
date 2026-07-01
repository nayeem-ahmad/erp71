'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
    AccountingPageShell,
    AccountingToolbar,
    CompactSection,
    CompactStat,
} from '@/components/accounting/compact';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { compactDensity } from '@/lib/ui/compact-density';

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
};

export default function VoucherDetailPage() {
    const { t, locale } = useI18n();
    const params = useParams<{ id: string }>();
    const [voucher, setVoucher] = useState<VoucherDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

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
        <AccountingPageShell maxWidth="wide">
            <Link href="/accounting/vouchers" className="inline-flex items-center text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors">
                <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                Back to Vouchers
            </Link>

            <AccountingToolbar subtitle="Inspect the full debit and credit composition of a single posted voucher." />

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
                                            <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.24em] text-gray-400">{t.accountingShared.account}</th>
                                            <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.24em] text-gray-400">{t.accountingShared.group}</th>
                                            <th className="px-4 py-3 text-right text-[11px] font-black uppercase tracking-[0.24em] text-gray-400">{t.accountingShared.debit}</th>
                                            <th className="px-4 py-3 text-right text-[11px] font-black uppercase tracking-[0.24em] text-gray-400">{t.accountingShared.credit}</th>
                                            <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.24em] text-gray-400">{t.accountingShared.comment}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 bg-white">
                                        {voucher.details.map((row) => (
                                            <tr key={row.id}>
                                                <td className="px-4 py-3 text-sm font-black text-gray-900">{row.account.name}</td>
                                                <td className="px-4 py-3 text-sm text-gray-500">{row.account.group?.name || 'Ungrouped'}</td>
                                                <td className="px-4 py-3 text-right text-sm font-black text-amber-700">{formatBDT(Number(row.debit_amount || 0), { locale })}</td>
                                                <td className="px-4 py-3 text-right text-sm font-black text-sky-700">{formatBDT(Number(row.credit_amount || 0), { locale })}</td>
                                                <td className="px-4 py-3 text-sm text-gray-500">{row.comment || '-'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="bg-gray-50">
                                        <tr>
                                            <td colSpan={2} className="px-4 py-3 text-sm font-black uppercase tracking-[0.24em] text-gray-500">{t.accountingShared.totals}</td>
                                            <td className="px-4 py-3 text-right text-sm font-black text-amber-700">{formatBDT(debitTotal, { locale })}</td>
                                            <td className="px-4 py-3 text-right text-sm font-black text-sky-700">{formatBDT(creditTotal, { locale })}</td>
                                            <td className="px-4 py-3 text-right text-sm font-black text-gray-700">{t.accountingShared.balanced}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                        </div>
                    </CompactSection>
                </>
            ) : null}
        </AccountingPageShell>
    );
}