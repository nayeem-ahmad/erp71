'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronLeft, ChevronRight, ClipboardList, Filter } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { VoucherType } from '@retail-saas/shared-types';
import { DataTable } from '../../../../components/data-table';
import { api } from '../../../../lib/api';
import { formatBDT, formatDate } from '../../../../lib/format';

type VoucherRow = {
    id: string;
    voucher_number: string;
    voucher_type: VoucherType;
    description?: string | null;
    reference_number?: string | null;
    date: string;
    total_amount: number;
};

type VoucherListResponse = {
    data: VoucherRow[];
    meta: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
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

export default function AccountingJournalPage() {
    const [response, setResponse] = useState<VoucherListResponse>({
        data: [],
        meta: { page: 1, limit: 20, total: 0, totalPages: 1 },
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
                limit: 20,
            });
            setResponse(data);
        } catch (error) {
            console.error('Failed to load journal vouchers', error);
            setResponse({
                data: [],
                meta: { page: 1, limit: 20, total: 0, totalPages: 1 },
            });
        } finally {
            setLoading(false);
        }
    };

    const columns: ColumnDef<VoucherRow, any>[] = useMemo(
        () => [
            columnHelper.accessor('voucher_number', {
                header: 'Voucher #',
                cell: (info) => <span className="text-sm font-black text-gray-900">{info.getValue()}</span>,
                size: 140,
            }),
            columnHelper.accessor('date', {
                header: 'Date',
                cell: (info) => {
                    return <span className="text-sm font-bold text-gray-700">{formatDate(info.getValue())}</span>;
                },
                size: 120,
            }),
            columnHelper.accessor('voucher_type', {
                header: 'Type',
                cell: (info) => <span className="text-xs font-black uppercase tracking-widest text-sky-700">{info.getValue().replaceAll('_', ' ')}</span>,
                size: 150,
            }),
            columnHelper.accessor('description', {
                header: 'Description',
                cell: (info) => <span className="text-sm text-gray-600">{info.getValue() || 'No narration'}</span>,
                size: 320,
            }),
            columnHelper.accessor('total_amount', {
                header: 'Amount',
                cell: (info) => <span className="text-sm font-black text-emerald-600">{formatBDT(Number(info.getValue() || 0))}</span>,
                size: 120,
            }),
            columnHelper.display({
                id: 'actions',
                header: 'Detail',
                cell: (info) => (
                    <Link href={`/dashboard/accounting/journal/${info.row.original.id}`} className="text-sm font-black text-blue-600 hover:text-blue-800">
                        Open
                    </Link>
                ),
                size: 90,
            }),
        ],
        [],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1400px] mx-auto space-y-6">
                <Link href="/dashboard/accounting" className="inline-flex items-center text-sm font-bold text-gray-500 hover:text-gray-900 transition-colors">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Accounting
                </Link>

                <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex items-start gap-4">
                        <div className="rounded-2xl border border-sky-100 bg-sky-50 p-3 text-sky-700">
                            <ClipboardList className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="text-xs font-black uppercase tracking-[0.24em] text-gray-400">Story 30.6</p>
                            <h1 className="text-2xl font-black tracking-tight">Journal Viewer</h1>
                            <p className="mt-2 max-w-3xl text-sm text-gray-500">
                                Review vouchers in newest-first order, filter by type and date, and drill into a single voucher for full debit and credit detail.
                            </p>
                        </div>
                    </div>
                </section>

                <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm space-y-5">
                    <div className="flex items-center gap-3">
                        <Filter className="h-5 w-5 text-gray-900" />
                        <h2 className="text-lg font-black tracking-tight">Journal filters</h2>
                    </div>

                    <div className="grid gap-4 md:grid-cols-4">
                        <label className="block text-xs font-black uppercase tracking-[0.24em] text-gray-400">
                            <span>Voucher type</span>
                            <select aria-label="Journal voucher type" value={voucherType} onChange={(event) => { setVoucherType(event.target.value); setPage(1); }} className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900">
                                {voucherTypeOptions.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
                            </select>
                        </label>
                        <label className="block text-xs font-black uppercase tracking-[0.24em] text-gray-400">
                            <span>From</span>
                            <input aria-label="Journal from date" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900" />
                        </label>
                        <label className="block text-xs font-black uppercase tracking-[0.24em] text-gray-400">
                            <span>To</span>
                            <input aria-label="Journal to date" type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900" />
                        </label>
                        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                            <p className="text-xs font-black uppercase tracking-[0.24em] text-gray-400">Results</p>
                            <p className="mt-2 text-2xl font-black tracking-tight text-gray-900">{response.meta.total}</p>
                            <p className="mt-1 text-sm text-gray-500">Page {response.meta.page} of {response.meta.totalPages}</p>
                        </div>
                    </div>

                    <DataTable<VoucherRow>
                        tableId="accounting-journal"
                        columns={columns}
                        data={response.data}
                        title="Accounting Journal"
                        isLoading={loading}
                        emptyMessage="No vouchers found for the selected filters"
                        emptyIcon={<ClipboardList className="w-16 h-16 text-gray-200" />}
                        searchPlaceholder="Search journal rows by voucher number, description, or type..."
                    />

                    <div className="flex items-center justify-end gap-3">
                        <button
                            type="button"
                            onClick={() => setPage((current) => Math.max(1, current - 1))}
                            disabled={response.meta.page <= 1}
                            className="inline-flex items-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-black text-gray-700 disabled:opacity-40"
                        >
                            <ChevronLeft className="mr-1 h-4 w-4" />
                            Previous
                        </button>
                        <button
                            type="button"
                            onClick={() => setPage((current) => Math.min(response.meta.totalPages, current + 1))}
                            disabled={response.meta.page >= response.meta.totalPages}
                            className="inline-flex items-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-black text-gray-700 disabled:opacity-40"
                        >
                            Next
                            <ChevronRight className="ml-1 h-4 w-4" />
                        </button>
                    </div>
                </section>
            </div>
        </div>
    );
}