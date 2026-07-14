'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ReceiptText, Wallet } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import {
    AccountingPageShell,
    CompactSection,
    CompactStat,
} from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { compactDensity } from '@/lib/ui/compact-density';

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

function LedgerLoadingFallback() {
    const { t } = useI18n();
    return <div className="p-4 text-sm text-gray-500">{t.ledger.loading}</div>;
}

export default function AccountingLedgerPage() {
    return (
        <Suspense fallback={<LedgerLoadingFallback />}>
            <AccountingLedgerPageContent />
        </Suspense>
    );
}

function AccountingLedgerPageContent() {
    const { t, locale } = useI18n();
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
                header: t.accountingShared.date,
                cell: (info) => <span className="text-sm font-bold text-gray-700">{formatDate(info.getValue(), locale)}</span>,
                size: 120,
            }),
            columnHelper.accessor('voucher_number', {
                header: t.journal.columns.voucherNumber,
                cell: (info) => (
                    <Link href={`/accounting/vouchers/${info.row.original.voucher_id}`} className="text-sm font-bold text-blue-600 hover:text-blue-800">
                        {info.getValue()}
                    </Link>
                ),
                size: 140,
            }),
            columnHelper.accessor('voucher_type', {
                header: t.accountingShared.type,
                cell: (info) => <span className="text-xs font-semibold text-primary">{info.getValue().replaceAll('_', ' ')}</span>,
                size: 150,
            }),
            columnHelper.accessor((row) => row.narration || row.description, {
                id: 'narration',
                header: t.accountingShared.narration,
                cell: (info) => <span className="text-sm text-gray-600">{info.getValue() || t.accountingShared.noNarration}</span>,
                size: 320,
            }),
            columnHelper.accessor('debit_amount', {
                header: t.accountingShared.debit,
                cell: (info) => <span className="text-sm font-bold text-amber-700">{formatBDT(info.getValue(), { locale })}</span>,
                size: 120,
            }),
            columnHelper.accessor('credit_amount', {
                header: t.accountingShared.credit,
                cell: (info) => <span className="text-sm font-bold text-sky-700">{formatBDT(info.getValue(), { locale })}</span>,
                size: 120,
            }),
            columnHelper.accessor('running_balance', {
                header: t.ledger.columns.runningBalance,
                cell: (info) => (
                    <div className="flex flex-col">
                        <span className="text-sm font-bold text-gray-900">{formatBDT(info.getValue(), { locale })}</span>
                        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400">{info.row.original.running_balance_side}</span>
                    </div>
                ),
                size: 150,
            }),
        ],
        [t, locale],
    );

    const handleResetFilters = () => {
        setSelectedAccountId('');
        setFrom('');
        setTo('');
        setLedger(null);
        setLedgerError('');
    };

    return (
        <AccountingPageShell>
            <PageHeader
                title={t.ledger.title}
                subtitle="Review one account at a time with opening balance, period movement, closing position, and voucher drill-down."
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.ledger.title,
                    'accounting',
                )}
            />

            <CompactSection title={t.ledger.title}>
                <div className={`${compactDensity.filterBar} mb-3`}>
                    <label className="block flex-1 min-w-[200px]">
                        <span className={`${compactDensity.formLabel} block mb-1`}>{t.accountingShared.account}</span>
                        <select
                            aria-label={t.ledger.accountAria}
                            value={selectedAccountId}
                            onChange={(event) => setSelectedAccountId(event.target.value)}
                            className={compactDensity.formField}
                        >
                            <option value="">{t.accountingShared.selectAccount}</option>
                            {accounts.map((account) => (
                                <option key={account.id} value={account.id}>
                                    {account.code ? `${account.code} - ` : ''}{account.name}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="block">
                        <span className={`${compactDensity.formLabel} block mb-1`}>{t.accountingShared.from}</span>
                        <input
                            aria-label={t.ledger.fromDateAria}
                            type="date"
                            value={from}
                            onChange={(event) => setFrom(event.target.value)}
                            className={compactDensity.formField}
                        />
                    </label>

                    <label className="block">
                        <span className={`${compactDensity.formLabel} block mb-1`}>{t.accountingShared.to}</span>
                        <input
                            aria-label={t.ledger.toDateAria}
                            type="date"
                            value={to}
                            onChange={(event) => setTo(event.target.value)}
                            className={compactDensity.formField}
                        />
                    </label>

                    <div className="flex items-end">
                        <button type="button" onClick={handleResetFilters} className={compactDensity.btnSecondary}>
                            Reset filters
                        </button>
                    </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <CompactStat
                        label="Selected account"
                        value={(
                            <>
                                <span className="block text-base">{selectedAccount ? selectedAccount.name : 'None selected'}</span>
                                {selectedAccount ? (
                                    <span className="block text-xs font-normal text-gray-500 mt-0.5">
                                        {selectedAccount.code || t.accountingShared.noCode} • {selectedAccount.type}
                                    </span>
                                ) : null}
                            </>
                        )}
                    />
                    <CompactStat label={t.ledger.openingBalance} value={ledger ? formatBalance(ledger.opening_balance, ledger.opening_balance_side, locale) : t.accountingShared.awaitingSelection} tone="warning" />
                    <CompactStat label={t.ledger.periodMovement} value={ledger ? formatBalance(periodMovement.amount, periodMovement.side, locale) : t.accountingShared.awaitingSelection} tone="info" />
                    <CompactStat label={t.accountingShared.closingBalance} value={ledger ? formatBalance(ledger.closing_balance, ledger.closing_balance_side, locale) : t.accountingShared.awaitingSelection} tone="positive" />
                </div>
            </CompactSection>

                {isLoadingAccounts ? <InfoPanel tone="neutral" message={t.accountingShared.loadingAccountOptions} /> : null}
                {accountError ? <InfoPanel tone="error" message={accountError} /> : null}
                {isLoadingLedger ? <InfoPanel tone="neutral" message={t.accountingShared.loadingLedgerReport} /> : null}
                {ledgerError ? <InfoPanel tone="error" message={ledgerError} /> : null}

                {!selectedAccountId && !isLoadingAccounts ? (
                    <CompactSection className="border-dashed text-center py-8">
                        <Wallet className="mx-auto h-8 w-8 text-gray-300" />
                        <p className="mt-3 text-sm font-semibold text-gray-900">{t.ledger.selectAccountHint}</p>
                        <p className="mt-1 text-xs text-gray-500">
                            The screen keeps one account in focus so running balance math stays readable during audit work.
                        </p>
                    </CompactSection>
                ) : null}

                {selectedAccountId && !ledgerError ? (
                    <CompactSection title="Ledger activity">
                        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                            <p className="text-xs text-gray-500">
                                {ledger
                                    ? `Debit movement ${formatBDT(ledger.totals.debit, { locale })} • Credit movement ${formatBDT(ledger.totals.credit, { locale })}`
                                    : 'Waiting for report data.'}
                            </p>
                            {ledger ? (
                                <Link href={ledger.data[0] ? `/accounting/vouchers/${ledger.data[0].voucher_id}` : '/accounting/vouchers'} className={compactDensity.btnSecondary}>
                                    <ReceiptText className="h-3.5 w-3.5" />
                                    {ledger.data[0] ? 'Open latest voucher detail' : 'Open journal'}
                                </Link>
                            ) : null}
                        </div>

                        <DataTable<LedgerRow>
                            tableId="accounting-ledger"
                            columns={columns}
                            data={ledger?.data || []}
                            title={t.accountingShared.generalLedger}
                            isLoading={isLoadingLedger}
                            emptyMessage={t.ledger.emptyMessage}
                            emptyIcon={<Wallet className="w-10 h-10 text-gray-200" />}
                            searchPlaceholder={t.ledger.searchPlaceholder}
                        />
                    </CompactSection>
                ) : null}
        </AccountingPageShell>
    );
}

function InfoPanel({ tone, message }: { tone: 'neutral' | 'error'; message: string }) {
    const classes = tone === 'error'
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-gray-200 bg-white text-gray-500';

    return <div className={`rounded-lg border p-3 text-sm ${classes}`}>{message}</div>;
}

function formatBalance(amount: number, side: 'debit' | 'credit' | 'neutral', locale: string) {
    if (side === 'neutral') {
        return `${formatBDT(0, { locale })} neutral`;
    }

    return `${formatBDT(amount, { locale })} ${side}`;
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