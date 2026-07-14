'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Eye, FileText, Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { AccountingPageShell } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { compactDensity } from '@/lib/ui/compact-density';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { VoucherType } from '@erp71/shared-types';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { useBranding } from '@/lib/branding';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { printVoucher } from '@/lib/voucher-printer';
import { toast } from '@/lib/toast';

type VoucherRow = {
    id: string;
    voucher_number: string;
    voucher_type: VoucherType;
    reference_number?: string | null;
    date: string;
    total_amount: number;
    source?: { module: string | null; type: string | null; id: string | null };
};

type VoucherListResponse = {
    data: VoucherRow[];
    meta: { page: number; limit: number; total: number; totalPages: number };
};

const columnHelper = createColumnHelper<VoucherRow>();

const voucherTypeOptions = [
    { value: '', label: 'All voucher types' },
    { value: VoucherType.CASH_PAYMENT, label: 'Cash Payment' },
    { value: VoucherType.CASH_RECEIVE, label: 'Cash Receive' },
    { value: VoucherType.BANK_PAYMENT, label: 'Bank Payment' },
    { value: VoucherType.BANK_RECEIVE, label: 'Bank Receive' },
    { value: VoucherType.FUND_TRANSFER, label: 'Fund Transfer' },
    { value: VoucherType.JOURNAL, label: 'Journal Voucher' },
];

function VouchersListLoading() {
    const { t } = useI18n();
    return <div className="p-4 text-sm text-gray-500">{t.vouchers.loading}</div>;
}

export default function AccountingVouchersListPage() {
    return (
        <Suspense fallback={<VouchersListLoading />}>
            <AccountingVouchersListPageContent />
        </Suspense>
    );
}

function AccountingVouchersListPageContent() {
    const { t, locale } = useI18n();
    const { businessName } = useBranding();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [response, setResponse] = useState<VoucherListResponse>({
        data: [],
        meta: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
    const [loading, setLoading] = useState(true);
    const [voucherType, setVoucherType] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [page, setPage] = useState(1);

    const createdVoucherNumber = searchParams.get('voucher');

    const loadVouchers = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getVouchers({
                voucherType: voucherType || undefined,
                from: from || undefined,
                to: to || undefined,
                page,
                limit: 20,
            });
            setResponse(data);
        } catch (error) {
            console.error('Failed to load vouchers', error);
            setResponse({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } });
        } finally {
            setLoading(false);
        }
    }, [voucherType, from, to, page]);

    useEffect(() => {
        void loadVouchers();
    }, [loadVouchers]);

    useEffect(() => {
        if (createdVoucherNumber) {
            toast.success(t.vouchers.voucherCreated.replace('{voucherNumber}', createdVoucherNumber));
            router.replace('/accounting/vouchers');
        }
    }, [createdVoucherNumber, router, t.vouchers.voucherCreated]);

    const handlePrint = useCallback(async (voucher: VoucherRow) => {
        try {
            const detail = await api.getVoucher(voucher.id);
            printVoucher({
                businessName,
                voucherNumber: detail.voucher_number,
                voucherType: detail.voucher_type,
                date: formatDate(detail.date, locale),
                referenceNumber: detail.reference_number,
                description: detail.description,
                totalAmount: Number(detail.total_amount || voucher.total_amount || 0),
                lines: (detail.details ?? []).map((line: any) => ({
                    accountName: line.account?.name ?? '—',
                    accountCode: line.account?.code,
                    debit: Number(line.debit_amount || 0),
                    credit: Number(line.credit_amount || 0),
                    comment: line.comment,
                })),
                labels: {
                    title: t.vouchers.list.printTitle,
                    voucherNumber: t.journal.columns.voucherNumber,
                    date: t.accountingShared.date,
                    type: t.accountingShared.type,
                    reference: t.accountingShared.reference,
                    narration: t.accountingShared.narration,
                    account: t.accountingShared.account,
                    debit: t.accountingShared.debit,
                    credit: t.accountingShared.credit,
                    total: t.accountingShared.amount,
                    footer: t.vouchers.list.printFooter,
                },
            });
        } catch {
            toast.error(t.vouchers.list.printFailed);
        }
    }, [businessName, locale, t]);

    const handleDelete = useCallback(async (voucher: VoucherRow) => {
        if (voucher.source?.module) {
            toast.info(t.vouchers.list.systemVoucherLocked);
            return;
        }
        if (!window.confirm(t.vouchers.list.deleteConfirm.replace('{voucherNumber}', voucher.voucher_number))) {
            return;
        }
        try {
            await api.deleteVoucher(voucher.id);
            toast.success(t.vouchers.list.deleteSuccess);
            void loadVouchers();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t.vouchers.list.deleteFailed);
        }
    }, [loadVouchers, t]);

    const columns: ColumnDef<VoucherRow, any>[] = useMemo(
        () => [
            columnHelper.accessor('voucher_number', {
                header: t.journal.columns.voucherNumber,
                cell: (info) => <span className="text-sm font-bold text-gray-900">{info.getValue()}</span>,
                size: 130,
            }),
            columnHelper.accessor('date', {
                header: t.accountingShared.date,
                cell: (info) => <span className="text-sm text-gray-700">{formatDate(info.getValue(), locale)}</span>,
                size: 110,
            }),
            columnHelper.accessor('voucher_type', {
                header: t.accountingShared.type,
                cell: (info) => (
                    <span className="text-xs font-bold uppercase tracking-wide text-sky-700">
                        {info.getValue().replaceAll('_', ' ')}
                    </span>
                ),
                size: 130,
            }),
            columnHelper.accessor('reference_number', {
                header: t.accountingShared.reference,
                cell: (info) => <span className="text-sm text-gray-600">{info.getValue() || '—'}</span>,
                size: 120,
            }),
            columnHelper.accessor('total_amount', {
                header: t.accountingShared.amount,
                cell: (info) => (
                    <span className="text-sm font-bold text-emerald-600">
                        {formatBDT(Number(info.getValue() || 0), { locale })}
                    </span>
                ),
                size: 110,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.vouchers.list.actions,
                cell: ({ row }) => {
                    const voucher = row.original;
                    const isSystem = Boolean(voucher.source?.module);
                    return (
                        <div className="flex items-center gap-0.5">
                            <Link
                                href={`/accounting/vouchers/${voucher.id}`}
                                className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50"
                                title={t.common.view}
                            >
                                <Eye className="w-4 h-4" />
                            </Link>
                            <Link
                                href={isSystem ? '#' : `/accounting/vouchers/new?edit=${voucher.id}`}
                                onClick={isSystem ? (e) => { e.preventDefault(); toast.info(t.vouchers.list.systemVoucherLocked); } : undefined}
                                className={`p-1.5 rounded-lg ${isSystem ? 'text-gray-300 cursor-not-allowed' : 'text-amber-600 hover:bg-amber-50'}`}
                                title={t.common.edit}
                            >
                                <Pencil className="w-4 h-4" />
                            </Link>
                            <button
                                type="button"
                                onClick={() => void handlePrint(voucher)}
                                className="p-1.5 rounded-lg text-purple-600 hover:bg-purple-50"
                                title={t.vouchers.list.print}
                            >
                                <Printer className="w-4 h-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleDelete(voucher)}
                                disabled={isSystem}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                title={t.common.delete}
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    );
                },
                enableSorting: false,
                size: 140,
            }),
        ],
        [handleDelete, handlePrint, locale, t],
    );

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
            <span className="text-gray-500">{response.meta.total} total</span>
        </div>
    );

    return (
        <AccountingPageShell>
            <PageHeader
                title={t.vouchers.list.title}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.vouchers.list.title,
                    'accounting',
                )}
                actions={(
                    <>
                        {filterControls}
                        <Link
                            href="/accounting/vouchers/new"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            {t.vouchers.list.newVoucher}
                        </Link>
                    </>
                )}
            />

            <DataTable<VoucherRow>
                    tableId="accounting-vouchers-list"
                    columns={columns}
                    data={response.data}
                    title={t.vouchers.list.title}
                    isLoading={loading}
                    emptyMessage={t.vouchers.list.emptyMessage}
                    emptyIcon={<FileText className="w-10 h-10 text-gray-200" />}
                    searchPlaceholder={t.vouchers.list.searchPlaceholder}
                />

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
                <span className="text-xs text-gray-500">
                    {response.meta.page} / {response.meta.totalPages}
                </span>
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