'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Calculator, Filter, ReceiptText, Wallet } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '../../../../components/data-table';
import { api } from '../../../../lib/api';
import { formatBDT } from '../../../../lib/format';

type LedgerAccount = {
    id: string;
    name: string;
    code?: string | null;
    type: string;
    category: string;
    group?: { name: string };
    subgroup?: { name: string } | null;
};

type LedgerRow = {
    id: string;
    voucher_id: string;
    voucher_number: string;
    voucher_type: string;
    date: string;
    description?: string | null;
    reference_number?: string | null;
    narration?: string | null;
    debit_amount: number;
    credit_amount: number;
    running_balance: number;
    running_balance_side: 'debit' | 'credit' | 'neutral';
};

type LedgerResponse = {
    account: LedgerAccount;
    filters: {
        from?: string | null;
        to?: string | null;
    };
    normal_balance_side: 'debit' | 'credit';
    opening_balance: number;
    opening_balance_side: 'debit' | 'credit' | 'neutral';
    closing_balance: number;
    closing_balance_side: 'debit' | 'credit' | 'neutral';
    totals: {
        debit: number;
        credit: number;
    };
    data: LedgerRow[];
};

const columnHelper = createColumnHelper<LedgerRow>();

export default function AccountingLedgerPage() {
    return (
        <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading ledger...</div>}>
            <AccountingLedgerPageContent />
        </Suspense>
    );
}

function AccountingLedgerPageContent() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState(searchParams.get('accountId') || '');
    const [from, setFrom] = useState(searchParams.get('from') || '');
    const [to, setTo] = useState(searchParams.get('to') || '');
    const [ledger, setLedger] = useState<LedgerResponse | null>(null);
    const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
    const [isLoadingLedger, setIsLoadingLedger] = useState(false);
    const [accountError, setAccountError] = useState('');
    const [ledgerError, setLedgerError] = useState('');

    useEffect(() => {
        let active = true;

        const loadAccounts = async () => {
            setIsLoadingAccounts(true);
            setAccountError('');

            try {
                const data = await api.getAccounts();
                if (!active) {
                    return;
                }

                setAccounts(data);
            } catch (error) {
                if (!active) {
                    return;
                }

                setAccountError(error instanceof Error ? error.message : 'Failed to load ledger account options.');
            } finally {
                if (active) {
                    setIsLoadingAccounts(false);
                }
            }
        };

        void loadAccounts();

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        const query = new URLSearchParams();
        if (selectedAccountId) {
            query.set('accountId', selectedAccountId);
        }
        if (from) {
            query.set('from', from);
        }
        if (to) {
            query.set('to', to);
        }

        const nextPath = `${pathname}${query.toString() ? `?${query.toString()}` : ''}`;
        router.replace(nextPath);
    }, [selectedAccountId, from, to, pathname, router]);

    useEffect(() => {
        let active = true;

        if (!selectedAccountId) {
            setLedger(null);
            setLedgerError('');
            setIsLoadingLedger(false);
            return;
        }

        const loadLedger = async () => {
            setIsLoadingLedger(true);
            setLedgerError('');

            try {
                const data = await api.getLedger(selectedAccountId, {
                    from: from || undefined,
                    to: to || undefined,
                });

                if (!active) {
                    return;
                }

                setLedger(data);
            } catch (error) {
                if (!active) {
                    return;
                }

                setLedger(null);
                setLedgerError(error instanceof Error ? error.message : 'Failed to load ledger report.');
            } finally {
                if (active) {
                    setIsLoadingLedger(false);
                }
            }
        };

        void loadLedger();

        return () => {
            active = false;
        };
    }, [selectedAccountId, from, to]);

    const selectedAccount = accounts.find((account) => account.id === selectedAccountId) || ledger?.account || null;
    const periodMovement = ledger
        ? getPeriodMovement(
            ledger.opening_balance,
            ledger.opening_balance_side,
            ledger.closing_balance,
            ledger.closing_balance_side,
            ledger.normal_balance_side,
        )
        : { amount: 0, side: 'neutral' as const };

    const columns: ColumnDef<LedgerRow, any>[] = useMemo(
        () => [
            columnHelper.accessor('date', {
                header: 'Date',
                cell: (info) => <span className="text-sm font-bold text-gray-700">{new Date(info.getValue()).toLocaleDateString()}</span>,
                size: 120,
            }),
            columnHelper.accessor('voucher_number', {
                header: 'Voucher #',
                cell: (info) => (
                    <Link href={`/dashboard/accounting/journal/${info.row.original.voucher_id}`} className="text-sm font-black text-blue-600 hover:text-blue-800">
                        {info.getValue()}
                    </Link>
                ),
                size: 140,
            }),
            columnHelper.accessor('voucher_type', {
                header: 'Type',
                cell: (info) => <span className="text-xs font-black uppercase tracking-widest text-violet-700">{info.getValue().replaceAll('_', ' ')}</span>,
                size: 150,
            }),
            columnHelper.accessor((row) => row.narration || row.description || 'No narration', {
                id: 'narration',
                header: 'Narration',
                cell: (info) => <span className="text-sm text-gray-600">{info.getValue()}</span>,
                size: 320,
            }),
            columnHelper.accessor('debit_amount', {
                header: 'Debit',
                cell: (info) => <span className="text-sm font-black text-amber-700">{formatBDT(info.getValue())}</span>,
                size: 120,
            }),
            columnHelper.accessor('credit_amount', {
                header: 'Credit',
                cell: (info) => <span className="text-sm font-black text-sky-700">{formatBDT(info.getValue())}</span>,
                size: 120,
            }),
            columnHelper.accessor('running_balance', {
                header: 'Running balance',
                cell: (info) => (
                    <div className="flex flex-col">
                        <span className="text-sm font-black text-gray-900">{formatBDT(info.getValue())}</span>
                        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-400">{info.row.original.running_balance_side}</span>
                    </div>
                ),
                size: 150,
            }),
        ],
        [],
    );

    const handleResetFilters = () => {
        setSelectedAccountId('');
        setFrom('');
        setTo('');
        setLedger(null);
        setLedgerError('');
    };

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1400px] mx-auto space-y-6">
                <Link href="/dashboard/accounting" className="inline-flex items-center text-sm font-bold text-gray-500 hover:text-gray-900 transition-colors">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Accounting
                </Link>

                <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex items-start gap-4">
                        <div className="rounded-2xl border border-violet-100 bg-violet-50 p-3 text-violet-700">
                            <Calculator className="h-6 w-6" />
                        </div>
                        <div className="space-y-2">
                            <p className="text-xs font-black uppercase tracking-[0.24em] text-gray-400">Story 30.8</p>
                            <h1 className="text-2xl font-black tracking-tight">General Ledger</h1>
                            <p className="text-sm text-gray-500 max-w-3xl">
                                Review one account at a time with opening balance, period movement, closing position, and voucher drill-down linked directly into journal detail.
                            </p>
                        </div>
                    </div>
                </section>

                <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm space-y-5">
                    <div className="flex items-center gap-3">
                        <Filter className="h-5 w-5 text-gray-900" />
                        <h2 className="text-lg font-black tracking-tight">Ledger filters</h2>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[1.6fr,1fr,1fr,auto]">
                        <label className="block text-xs font-black uppercase tracking-[0.24em] text-gray-400">
                            <span>Account</span>
                            <select
                                aria-label="Ledger account"
                                value={selectedAccountId}
                                onChange={(event) => setSelectedAccountId(event.target.value)}
                                className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900"
                            >
                                <option value="">Select an account</option>
                                {accounts.map((account) => (
                                    <option key={account.id} value={account.id}>
                                        {account.code ? `${account.code} - ` : ''}{account.name}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="block text-xs font-black uppercase tracking-[0.24em] text-gray-400">
                            <span>From</span>
                            <input
                                aria-label="Ledger from date"
                                type="date"
                                value={from}
                                onChange={(event) => setFrom(event.target.value)}
                                className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900"
                            />
                        </label>

                        <label className="block text-xs font-black uppercase tracking-[0.24em] text-gray-400">
                            <span>To</span>
                            <input
                                aria-label="Ledger to date"
                                type="date"
                                value={to}
                                onChange={(event) => setTo(event.target.value)}
                                className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900"
                            />
                        </label>

                        <div className="flex items-end">
                            <button
                                type="button"
                                onClick={handleResetFilters}
                                className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-black text-gray-700 hover:bg-gray-100"
                            >
                                Reset filters
                            </button>
                        </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                            <p className="text-xs font-black uppercase tracking-[0.24em] text-gray-400">Selected account</p>
                            <p className="mt-2 text-lg font-black tracking-tight text-gray-900">
                                {selectedAccount ? selectedAccount.name : 'None selected'}
                            </p>
                            <p className="mt-1 text-sm text-gray-500">
                                {selectedAccount ? `${selectedAccount.code || 'No code'} • ${selectedAccount.type}` : 'Choose an account to load the ledger.'}
                            </p>
                        </div>
                        <LedgerStatCard label="Opening balance" value={ledger ? formatBalance(ledger.opening_balance, ledger.opening_balance_side) : 'Awaiting selection'} accent="text-amber-700" />
                        <LedgerStatCard label="Period movement" value={ledger ? formatBalance(periodMovement.amount, periodMovement.side) : 'Awaiting selection'} accent="text-violet-700" />
                        <LedgerStatCard label="Closing balance" value={ledger ? formatBalance(ledger.closing_balance, ledger.closing_balance_side) : 'Awaiting selection'} accent="text-emerald-700" />
                    </div>
                </section>

                {isLoadingAccounts ? <InfoPanel tone="neutral" message="Loading account options..." /> : null}
                {accountError ? <InfoPanel tone="error" message={accountError} /> : null}
                {isLoadingLedger ? <InfoPanel tone="neutral" message="Loading ledger report..." /> : null}
                {ledgerError ? <InfoPanel tone="error" message={ledgerError} /> : null}

                {!selectedAccountId && !isLoadingAccounts ? (
                    <section className="rounded-3xl border border-dashed border-gray-300 bg-white p-10 text-center shadow-sm">
                        <Wallet className="mx-auto h-8 w-8 text-gray-300" />
                        <h2 className="mt-4 text-lg font-black tracking-tight text-gray-900">Select an account to review the ledger</h2>
                        <p className="mt-2 text-sm text-gray-500">
                            The screen keeps one account in focus so running balance math stays readable during audit work.
                        </p>
                    </section>
                ) : null}

                {selectedAccountId && !ledgerError ? (
                    <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm space-y-5">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <p className="text-xs font-black uppercase tracking-[0.24em] text-gray-400">Ledger activity</p>
                                <h2 className="mt-1 text-lg font-black tracking-tight text-gray-900">
                                    {selectedAccount ? selectedAccount.name : 'Account ledger'}
                                </h2>
                                <p className="mt-1 text-sm text-gray-500">
                                    {ledger
                                        ? `Debit movement ${formatBDT(ledger.totals.debit)} • Credit movement ${formatBDT(ledger.totals.credit)}`
                                        : 'Waiting for report data.'}
                                </p>
                            </div>
                            {ledger ? (
                                <Link href={ledger.data[0] ? `/dashboard/accounting/journal/${ledger.data[0].voucher_id}` : '/dashboard/accounting/journal'} className="inline-flex items-center rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-black text-gray-700 hover:bg-gray-100">
                                    <ReceiptText className="mr-2 h-4 w-4" />
                                    {ledger.data[0] ? 'Open latest voucher detail' : 'Open journal'}
                                </Link>
                            ) : null}
                        </div>

                        <DataTable<LedgerRow>
                            tableId="accounting-ledger"
                            columns={columns}
                            data={ledger?.data || []}
                            title="General Ledger"
                            isLoading={isLoadingLedger}
                            emptyMessage="No ledger movements were found for the selected account and date range"
                            emptyIcon={<Wallet className="w-16 h-16 text-gray-200" />}
                            searchPlaceholder="Search ledger rows by voucher number, narration, or voucher type..."
                        />
                    </section>
                ) : null}
            </div>
        </div>
    );
}

function LedgerStatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
    return (
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-gray-400">{label}</p>
            <p className={`mt-2 text-xl font-black tracking-tight ${accent}`}>{value}</p>
        </section>
    );
}

function InfoPanel({ tone, message }: { tone: 'neutral' | 'error'; message: string }) {
    const classes = tone === 'error'
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-gray-200 bg-white text-gray-500';

    return <div className={`rounded-3xl border p-6 shadow-sm text-sm font-bold ${classes}`}>{message}</div>;
}

function formatBalance(amount: number, side: 'debit' | 'credit' | 'neutral') {
    if (side === 'neutral') {
        return `${formatBDT(0)} neutral`;
    }

    return `${formatBDT(amount)} ${side}`;
}

function getPeriodMovement(
    openingAmount: number,
    openingSide: 'debit' | 'credit' | 'neutral',
    closingAmount: number,
    closingSide: 'debit' | 'credit' | 'neutral',
    normalSide: 'debit' | 'credit',
) {
    const openingSigned = toSignedBalance(openingAmount, openingSide, normalSide);
    const closingSigned = toSignedBalance(closingAmount, closingSide, normalSide);
    const delta = Math.round((closingSigned - openingSigned) * 100) / 100;

    if (Math.abs(delta) < 0.0001) {
        return { amount: 0, side: 'neutral' as const };
    }

    if (delta > 0) {
        return { amount: delta, side: normalSide };
    }

    return { amount: Math.abs(delta), side: normalSide === 'debit' ? 'credit' as const : 'debit' as const };
}

function toSignedBalance(
    amount: number,
    side: 'debit' | 'credit' | 'neutral',
    normalSide: 'debit' | 'credit',
) {
    if (side === 'neutral') {
        return 0;
    }

    return side === normalSide ? amount : -amount;
}