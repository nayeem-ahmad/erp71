'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Landmark } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';

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

export default function BankbookPage() {
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
            const result = await api.getBankbook({
                from: fromDate || undefined,
                to: toDate || undefined,
                accountId: accountId || undefined,
            });
            setData(result);
        } catch (err: any) {
            setError(err?.message ?? 'Failed to load bankbook');
        } finally {
            setLoading(false);
        }
    };

    const columns: ColumnDef<BookRow, any>[] = useMemo(() => [
        columnHelper.accessor((row) => String(row.date).slice(0, 10), {
            id: 'date', header: 'Date', size: 110,
        }),
        columnHelper.accessor('voucher_number', { header: 'Voucher #', size: 120 }),
        columnHelper.accessor((row) => row.description ?? row.reference_number ?? '-', {
            id: 'description', header: 'Description', size: 240,
        }),
        columnHelper.accessor('account_name', { header: 'Bank Account', size: 180 }),
        columnHelper.accessor('receipts', {
            header: 'Deposits',
            cell: (info) => info.getValue() > 0 ? <span className="text-emerald-700 font-bold">{formatBDT(Number(info.getValue()))}</span> : <span className="text-gray-300">—</span>,
            size: 130,
        }),
        columnHelper.accessor('payments', {
            header: 'Withdrawals',
            cell: (info) => info.getValue() > 0 ? <span className="text-rose-600 font-bold">{formatBDT(Number(info.getValue()))}</span> : <span className="text-gray-300">—</span>,
            size: 130,
        }),
        columnHelper.accessor('running_balance', {
            header: 'Balance',
            cell: (info) => (
                <span className="font-black text-blue-700">
                    {formatBDT(Number(info.getValue()))}
                    <span className="ml-1 text-xs font-normal text-gray-400">{info.row.original.running_balance_side}</span>
                </span>
            ),
            size: 150,
        }),
    ], []);

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1400px] mx-auto space-y-6">
                <div>
                    <h1 className="text-2xl font-black tracking-tight">Bankbook</h1>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                        Bank deposits and withdrawals ledger with running balance
                    </p>
                </div>

                {data && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-white border border-gray-100 rounded-2xl p-5">
                            <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Opening Balance</div>
                            <div className="text-xl font-black text-gray-900 mt-2">{formatBDT(data.opening_balance)}</div>
                            <div className="text-xs text-gray-400 mt-0.5">{data.opening_balance_side}</div>
                        </div>
                        <div className="bg-white border border-gray-100 rounded-2xl p-5">
                            <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Total Deposits</div>
                            <div className="text-xl font-black text-emerald-700 mt-2">{formatBDT(data.totals.receipts)}</div>
                        </div>
                        <div className="bg-white border border-gray-100 rounded-2xl p-5">
                            <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Total Withdrawals</div>
                            <div className="text-xl font-black text-rose-600 mt-2">{formatBDT(data.totals.payments)}</div>
                        </div>
                        <div className="bg-white border border-gray-100 rounded-2xl p-5">
                            <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Closing Balance</div>
                            <div className="text-xl font-black text-blue-700 mt-2">{formatBDT(data.closing_balance)}</div>
                            <div className="text-xs text-gray-400 mt-0.5">{data.closing_balance_side}</div>
                        </div>
                    </div>
                )}

                <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-wrap gap-3 items-end">
                    {data && data.accounts.length > 0 && (
                        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-w-[220px]">
                            <option value="">All Bank Accounts</option>
                            {data.accounts.map((a) => (
                                <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                        </select>
                    )}
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">From</span>
                        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">To</span>
                        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                            className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                    </div>
                </div>

                {error && <div className="rounded-2xl bg-red-50 border border-red-100 p-4 text-sm text-red-700">{error}</div>}

                <DataTable<BookRow>
                    tableId="bankbook"
                    columns={columns}
                    data={data?.rows ?? []}
                    title="Bank Transactions"
                    isLoading={loading}
                    emptyMessage="No bank transactions in this period"
                    emptyIcon={<Landmark className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder="Search transactions..."
                />
            </div>
        </div>
    );
}
