'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Landmark } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import {
    AccountingPageShell,
    AccountingToolbar,
    CompactStat,
} from '@/components/accounting/compact';
import { compactDensity } from '@/lib/ui/compact-density';
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

export default function BankbookPage() {
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
            id: 'date', header: t.accountingShared.date, size: 110,
        }),
        columnHelper.accessor('voucher_number', { header: t.journal.columns.voucherNumber, size: 120 }),
        columnHelper.accessor((row) => row.description ?? row.reference_number ?? '-', {
            id: 'description', header: t.accountingShared.description, size: 240,
        }),
        columnHelper.accessor('account_name', { header: 'Bank Account', size: 180 }),
        columnHelper.accessor('receipts', {
            header: t.accounting.reports.bankbook.deposits,
            cell: (info) => info.getValue() > 0 ? <span className="text-emerald-700 font-bold">{formatBDT(Number(info.getValue()), { locale })}</span> : <span className="text-gray-300">—</span>,
            size: 130,
        }),
        columnHelper.accessor('payments', {
            header: t.accounting.reports.bankbook.withdrawals,
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
        <AccountingPageShell maxWidth="full">
            <AccountingToolbar subtitle="Bank deposits and withdrawals ledger with running balance">
                <div className={compactDensity.filterBar}>
                    {data && data.accounts.length > 0 && (
                        <div className="flex flex-col gap-1">
                            <span className={compactDensity.formLabel}>Bank Account</span>
                            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
                                className={`${compactDensity.formField} min-w-[220px]`}>
                                <option value="">All Bank Accounts</option>
                                {data.accounts.map((a) => (
                                    <option key={a.id} value={a.id}>{a.name}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div className="flex flex-col gap-1">
                        <span className={compactDensity.formLabel}>{t.accountingShared.from}</span>
                        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                            className={compactDensity.formField} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className={compactDensity.formLabel}>{t.accountingShared.to}</span>
                        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                            className={compactDensity.formField} />
                    </div>
                </div>
            </AccountingToolbar>

            {data && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <CompactStat
                        label="Opening Balance"
                        value={
                            <>
                                {formatBDT(data.opening_balance, { locale })}
                                <span className="block text-xs font-normal text-gray-400 mt-0.5">{data.opening_balance_side}</span>
                            </>
                        }
                    />
                    <CompactStat label="Total Deposits" value={formatBDT(data.totals.receipts, { locale })} tone="positive" />
                    <CompactStat label="Total Withdrawals" value={formatBDT(data.totals.payments, { locale })} tone="negative" />
                    <CompactStat
                        label="Closing Balance"
                        value={
                            <>
                                {formatBDT(data.closing_balance, { locale })}
                                <span className="block text-xs font-normal text-gray-400 mt-0.5">{data.closing_balance_side}</span>
                            </>
                        }
                        tone="info"
                    />
                </div>
            )}

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            <DataTable<BookRow>
                tableId="bankbook"
                columns={columns}
                data={data?.rows ?? []}
                title={t.accountingShared.bankTransactions}
                isLoading={loading}
                emptyMessage={t.accountingShared.noBankTransactions}
                emptyIcon={<Landmark className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={t.accountingShared.searchTransactions}
            />
        </AccountingPageShell>
    );
}