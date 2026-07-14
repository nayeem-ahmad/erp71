'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, ClipboardList } from 'lucide-react';
import { VoucherType } from '@erp71/shared-types';
import { AccountingPageShell } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { compactDensity } from '@/lib/ui/compact-density';

type JournalEntry = {
    id: string;
    voucher_number: string;
    voucher_type: VoucherType;
    description?: string | null;
    date: string;
    total_amount: number;
};

type VoucherListResponse = {
    data: JournalEntry[];
    meta: { page: number; limit: number; total: number; totalPages: number };
};

const voucherTypeOptions = [
    { value: '', label: 'All voucher types' },
    { value: VoucherType.CASH_PAYMENT, label: 'Cash Payment' },
    { value: VoucherType.CASH_RECEIVE, label: 'Cash Receive' },
    { value: VoucherType.BANK_PAYMENT, label: 'Bank Payment' },
    { value: VoucherType.BANK_RECEIVE, label: 'Bank Receive' },
    { value: VoucherType.FUND_TRANSFER, label: 'Fund Transfer' },
    { value: VoucherType.JOURNAL, label: 'Journal Voucher' },
];

export default function AccountingJournalPage() {
    const { t, locale } = useI18n();
    const [response, setResponse] = useState<VoucherListResponse>({
        data: [],
        meta: { page: 1, limit: 30, total: 0, totalPages: 1 },
    });
    const [loading, setLoading] = useState(true);
    const [voucherType, setVoucherType] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [page, setPage] = useState(1);

    useEffect(() => {
        void loadJournal();
    }, [voucherType, from, to, page]);

    const loadJournal = async () => {
        setLoading(true);
        try {
            const data = await api.getVouchers({
                voucherType: voucherType || undefined,
                from: from || undefined,
                to: to || undefined,
                page,
                limit: 30,
            });
            setResponse(data);
        } catch (error) {
            console.error('Failed to load journal', error);
            setResponse({ data: [], meta: { page: 1, limit: 30, total: 0, totalPages: 1 } });
        } finally {
            setLoading(false);
        }
    };

    const filterControls = (
        <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
                aria-label={t.journal.voucherTypeAria}
                value={voucherType}
                onChange={(e) => { setVoucherType(e.target.value); setPage(1); }}
                className="px-1.5 py-0.5 border rounded text-xs"
            >
                {voucherTypeOptions.map((option) => (
                    <option key={option.label} value={option.value}>{option.label}</option>
                ))}
            </select>
            <input
                aria-label={t.journal.fromDateAria}
                type="date"
                value={from}
                onChange={(e) => { setFrom(e.target.value); setPage(1); }}
                className="px-1.5 py-0.5 border rounded text-xs"
            />
            <span className="text-gray-400">–</span>
            <input
                aria-label={t.journal.toDateAria}
                type="date"
                value={to}
                onChange={(e) => { setTo(e.target.value); setPage(1); }}
                className="px-1.5 py-0.5 border rounded text-xs"
            />
        </div>
    );

    return (
        <AccountingPageShell>
            <PageHeader
                title={t.journal.title}
                subtitle={t.journal.compactSubtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.journal.title,
                    'accounting',
                )}
                actions={filterControls}
            />

            <div className="bg-white rounded border overflow-hidden">
                {loading ? (
                    <div className="p-8 text-center text-xs text-gray-400">{t.accountingShared.loading}</div>
                ) : response.data.length === 0 ? (
                    <div className="p-8 text-center">
                        <ClipboardList className="w-12 h-12 text-gray-200 mx-auto mb-2" />
                        <p className="text-xs font-bold uppercase tracking-widest text-gray-400">{t.journal.emptyMessage}</p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-50">
                        {response.data.map((entry) => (
                            <Link
                                key={entry.id}
                                href={`/accounting/vouchers/${entry.id}`}
                                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50/80 transition-colors"
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                        <span className="text-sm font-bold text-gray-900">{entry.voucher_number}</span>
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-sky-700">
                                            {entry.voucher_type.replaceAll('_', ' ')}
                                        </span>
                                        <span className="text-xs text-gray-400">{formatDate(entry.date, locale)}</span>
                                    </div>
                                    <p className="text-xs text-gray-500 truncate mt-0.5">
                                        {entry.description || t.accountingShared.noNarration}
                                    </p>
                                </div>
                                <span className="text-sm font-bold text-emerald-600 whitespace-nowrap">
                                    {formatBDT(Number(entry.total_amount || 0), { locale })}
                                </span>
                            </Link>
                        ))}
                    </div>
                )}
            </div>

            <div className={`flex items-center justify-end gap-2 ${compactDensity.filterBar} !mt-0`}>
                <button
                    type="button"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={response.meta.page <= 1}
                    className="inline-flex items-center px-3 py-1.5 border rounded text-xs font-medium disabled:opacity-40"
                >
                    <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                    {t.common.prevPage}
                </button>
                <span className="text-xs text-gray-500">{response.meta.page} / {response.meta.totalPages}</span>
                <button
                    type="button"
                    onClick={() => setPage((current) => Math.min(response.meta.totalPages, current + 1))}
                    disabled={response.meta.page >= response.meta.totalPages}
                    className="inline-flex items-center px-3 py-1.5 border rounded text-xs font-medium disabled:opacity-40"
                >
                    {t.common.nextPage}
                    <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </button>
            </div>
        </AccountingPageShell>
    );
}