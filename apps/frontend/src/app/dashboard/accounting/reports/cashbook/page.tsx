'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { BookOpen } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

interface BookRow {
    id: string;
    voucher_number: string;
    voucher_type: string;
    date: string;
    description: string | null;
    reference_number: string | null;
    account_name: string;
    receipts: number;
    payments: number;
    running_balance: number;
    running_balance_side: string;
}

interface BookAccount {
    id: string;
    name: string;
    code?: string | null;
}

interface BookData {
    filters: { from: string; to: string };
    accounts: BookAccount[];
    opening_balance: number;
    opening_balance_side: string;
    closing_balance: number;
    closing_balance_side: string;
    totals: { receipts: number; payments: number };
    rows: BookRow[];
}

const columnHelper = createColumnHelper<BookRow>();

function defaultFrom() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function defaultTo() {
    return new Date().toISOString().slice(0, 10);
}

export default function CashbookPage() {
    const { t, locale } = useI18n();
    const [data, setData] = useState<BookData | null>(null);
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(defaultTo());
    const [accountId, setAccountId] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        void load();
    }, [fromDate, toDate, accountId]);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await api.getCashbook({
                from: fromDate || undefined,
                to: toDate || undefined,
                accountId: accountId || undefined,
            });
            setData(result);
        } catch (err: any) {
            setError(err?.message ?? 'Failed to load cashbook');
        } finally {
            setLoading(false);
        }
    };

    const columns: ColumnDef<BookRow, any>[] = useMemo(() => [
        columnHelper.accessor((row) => String(row.date).slice(0, 10), {
            id: 'date', header: t.accountingShared.date, size: 110,
        }),
        columnHelper.accessor('voucher_number', { header: t.journal.columns.voucherNumber, size: 120 }),
        columnHelper.accessor((row) => row.description ?? row.reference_number ?? '-', {
            id: 'description', header: t.accountingShared.description, size: 240,
        }),
        columnHelper.accessor('account_name', { header: t.accountingShared.account, size: 160 }),
        columnHelper.accessor('receipts', {
            header: t.accounting.reports.cashbook.receipts,
            cell: (info) => info.getValue() > 0 ? <span className="text-emerald-700 font-bold">{formatBDT(Number(info.getValue()), { locale })}</span> : <span className="text-gray-300">—</span>,
            size: 130,
        }),
        columnHelper.accessor('payments', {
            header: t.accounting.reports.cashbook.payments,
            cell: (info) => info.getValue() > 0 ? <span className="text-rose-600 font-bold">{formatBDT(Number(info.getValue()), { locale })}</span> : <span className="text-gray-300">—</span>,
            size: 130,
        }),
        columnHelper.accessor('running_balance', {
            header: t.accounting.reports.cashbook.balance,
            cell: (info) => (
                <span className="font-black text-blue-700">
                    {formatBDT(Number(info.getValue()), { locale })}
                    <span className="ml-1 text-xs font-normal text-gray-400">{info.row.original.running_balance_side}</span>
                </span>
            ),
            size: 150,
        }),
    ], []);

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="w-full space-y-6">
                <div>
                    <h1 className="text-2xl font-black tracking-tight">Cashbook</h1>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                        Cash receipts and payments ledger with running balance
                    </p>
                </div>

                {data && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-white border border-gray-100 rounded-2xl p-5">
                            <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Opening Balance</div>
                            <div className="text-xl font-black text-gray-900 mt-2">{formatBDT(data.opening_balance, { locale })}</div>
                            <div className="text-xs text-gray-400 mt-0.5">{data.opening_balance_side}</div>
                        </div>
                        <div className="bg-white border border-gray-100 rounded-2xl p-5">
                            <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Total Receipts</div>
                            <div className="text-xl font-black text-emerald-700 mt-2">{formatBDT(data.totals.receipts, { locale })}</div>
                        </div>
                        <div className="bg-white border border-gray-100 rounded-2xl p-5">
                            <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Total Payments</div>
                            <div className="text-xl font-black text-rose-600 mt-2">{formatBDT(data.totals.payments, { locale })}</div>
                        </div>
                        <div className="bg-white border border-gray-100 rounded-2xl p-5">
                            <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Closing Balance</div>
                            <div className="text-xl font-black text-blue-700 mt-2">{formatBDT(data.closing_balance, { locale })}</div>
                            <div className="text-xs text-gray-400 mt-0.5">{data.closing_balance_side}</div>
                        </div>
                    </div>
                )}

                <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-wrap gap-3 items-end">
                    {data && data.accounts.length > 1 && (
                        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-w-[200px]">
                            <option value="">All Cash Accounts</option>
                            {data.accounts.map((a) => (
                                <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                        </select>
                    )}
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t.accountingShared.from}</span>
                        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t.accountingShared.to}</span>
                        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                    </div>
                </div>

                {error && <div className="rounded-2xl bg-red-50 border border-red-100 p-4 text-sm text-red-700">{error}</div>}

                <DataTable<BookRow>
                    tableId="cashbook"
                    columns={columns}
                    data={data?.rows ?? []}
                    title={t.accountingShared.cashTransactions}
                    isLoading={loading}
                    emptyMessage={t.accountingShared.noCashTransactions}
                    emptyIcon={<BookOpen className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.accountingShared.searchTransactions}
                />
            </div>
        </div>
    );
}
