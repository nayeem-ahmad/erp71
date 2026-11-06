'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowDownLeft, ArrowUpRight, Hash, ReceiptText, Scale, Wallet, Waypoints } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { AccountingPageShell } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { BranchFilter, buttonClassName } from '@/components/ui';
import { useBranchScope } from '@/lib/branch-scope';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useApprovedOnly } from '@/lib/accounting-report-scope';
import { accountLabel, sortAccountsByCode } from '@/components/accounting/AccountSelect';
import { createdRangeFromPreset, type CreatedRange } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import { MONTH_RANGE_PRESETS } from '@/components/hr/month-range';

type LedgerAccount = {
    id: string;
    name: string;
    code?: string | null;
    type: string;
    category: string;
    group?: { name: string };
    subgroup?: { name: string } | null;
};

type BalanceSide = 'debit' | 'credit' | 'neutral';

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
    running_balance_side: BalanceSide;
};

type LedgerResponse = {
    account: LedgerAccount;
    filters: {
        from?: string | null;
        to?: string | null;
    };
    normal_balance_side: 'debit' | 'credit';
    opening_balance: number;
    opening_balance_side: BalanceSide;
    closing_balance: number;
    closing_balance_side: BalanceSide;
    totals: {
        debit: number;
        credit: number;
    };
    data: LedgerRow[];
};

/** The voucher types a ledger line can come from, as the server spells them. */
const VOUCHER_TYPES = ['cash_payment', 'cash_receive', 'bank_payment', 'bank_receive', 'fund_transfer', 'journal'] as const;
const SIDES = ['debit', 'credit'] as const;

const columnHelper = createColumnHelper<LedgerRow>();

/** A ledger always covers some period: cleared, it goes back to this month. */
const defaultPeriod = (): CreatedRange => createdRangeFromPreset('thisMonth');

function rowSide(row: LedgerRow): 'debit' | 'credit' {
    return Number(row.debit_amount) > 0 ? 'debit' : 'credit';
}

function rowAmount(row: LedgerRow): number {
    return Number(row.debit_amount) > 0 ? Number(row.debit_amount) : Number(row.credit_amount);
}

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
    const ui = t.accountingBooksUi;
    const branch = useBranchScope();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState(searchParams.get('accountId') || '');
    // The period opens on the one in the link, else this month.
    const [period, setPeriod] = useState<CreatedRange>(() => {
        const from = searchParams.get('from');
        const to = searchParams.get('to');
        if (!from && !to) return defaultPeriod();
        return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
    });
    const from = period.from ?? '';
    const to = period.to ?? '';
    const [ledger, setLedger] = useState<LedgerResponse | null>(null);
    const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
    const [isLoadingLedger, setIsLoadingLedger] = useState(false);
    const { approvedOnly, setApprovedOnly, approvalEnabled, ready: approvalReady } = useApprovedOnly();
    const [accountError, setAccountError] = useState('');
    const [ledgerError, setLedgerError] = useState('');
    const [search, setSearch] = useState('');
    const [voucherTypes, setVoucherTypes] = useState<string[]>([]);
    const [excludeVoucherTypes, setExcludeVoucherTypes] = useState(false);
    const [sides, setSides] = useState<string[]>([]);
    const [amountFilter, setAmountFilter] = useState<NumberCondition | null>(null);

    useEffect(() => {
        let active = true;

        if (!branch.ready) return;

        const loadAccounts = async () => {
            setIsLoadingAccounts(true);
            setAccountError('');

            try {
                const data = await api.getAccounts({ storeId: branch.apiStoreId });
                if (!active) {
                    return;
                }

                setAccounts(Array.isArray(data) ? data : []);
            } catch (error) {
                if (!active) {
                    return;
                }

                setAccountError(error instanceof Error ? error.message : t.ledger.loadAccountsFailed);
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branch.ready, branch.apiStoreId]);

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

        // Hold off until the tenant's approved-only setting is known, so the
        // ledger is never drawn against the wrong value and then corrected.
        if (!approvalReady || !branch.ready) {
            return;
        }

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
                    approvedOnly,
                    storeId: branch.apiStoreId,
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
                setLedgerError(error instanceof Error ? error.message : ui.ledger.loadFailed);
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedAccountId, from, to, approvedOnly, approvalReady, branch.ready, branch.apiStoreId]);

    const voucherTypeLabel = (type: string) => {
        const labels = t.accountingShared.voucherTypes as Record<string, string>;
        return labels[type.toUpperCase()] ?? type.replaceAll('_', ' ');
    };
    const sideLabel = (side: BalanceSide) => (
        side === 'debit' ? t.accountingShared.debit : side === 'credit' ? t.accountingShared.credit : ui.common.neutral
    );

    // The account and period are asked of the server; the other chips and the
    // search narrow the lines it sent, and the strip sums the same lines.
    const filteredRows = useMemo(
        () => (ledger?.data ?? []).filter((row) => (
            matchesAnyOf(voucherTypes, row.voucher_type, excludeVoucherTypes)
            && matchesAnyOf(sides, rowSide(row))
            && matchesNumberCondition(rowAmount(row), amountFilter)
            && matchesSearch(
                search,
                row.voucher_number,
                row.narration,
                row.description,
                row.reference_number,
                voucherTypeLabel(row.voucher_type),
            )
        )),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [ledger, voucherTypes, excludeVoucherTypes, sides, amountFilter, search, t],
    );

    const columns: ColumnDef<LedgerRow, any>[] = useMemo(
        () => [
            columnHelper.accessor('date', {
                header: t.accountingShared.date,
                cell: (info) => <span className="text-sm text-gray-700">{formatDate(info.getValue(), locale)}</span>,
                size: 120,
            }),
            columnHelper.accessor('voucher_number', {
                header: t.journal.columns.voucherNumber,
                cell: (info) => (
                    <Link href={`/accounting/vouchers/${info.row.original.voucher_id}`} className="text-sm font-medium text-blue-600 hover:text-blue-800">
                        {info.getValue()}
                    </Link>
                ),
                size: 140,
            }),
            columnHelper.accessor('voucher_type', {
                header: t.accountingShared.type,
                cell: (info) => <span className="text-xs text-gray-600">{voucherTypeLabel(info.getValue())}</span>,
                meta: { hideOnMobile: true },
                size: 150,
            }),
            columnHelper.accessor((row) => row.narration || row.description, {
                id: 'narration',
                header: t.accountingShared.narration,
                cell: (info) => <span className="text-sm text-gray-600">{info.getValue() || t.accountingShared.noNarration}</span>,
                meta: { hideOnMobile: true },
                size: 320,
            }),
            columnHelper.accessor('debit_amount', {
                header: t.accountingShared.debit,
                cell: (info) => <span className="text-sm text-gray-800">{formatBDT(info.getValue(), { locale })}</span>,
                meta: { align: 'end' },
                size: 120,
            }),
            columnHelper.accessor('credit_amount', {
                header: t.accountingShared.credit,
                cell: (info) => <span className="text-sm text-gray-800">{formatBDT(info.getValue(), { locale })}</span>,
                meta: { align: 'end' },
                size: 120,
            }),
            columnHelper.accessor('running_balance', {
                header: t.ledger.columns.runningBalance,
                cell: (info) => (
                    <span className="text-sm font-medium text-gray-900">
                        {formatBDT(info.getValue(), { locale })}
                        <span className="ms-1 text-xs font-normal text-gray-400">{sideLabel(info.row.original.running_balance_side)}</span>
                    </span>
                ),
                meta: { align: 'end' },
                size: 170,
            }),
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [t, locale],
    );

    const accountOptions = useMemo(
        () => sortAccountsByCode(accounts).map((account) => ({ value: account.id, label: accountLabel(account) })),
        [accounts],
    );

    const filters = useMemo<ListFilter[]>(() => {
        const list: ListFilter[] = [
            {
                // The report reads one account; ticking another moves to it.
                id: 'account',
                type: 'multi-select',
                label: t.accountingShared.account,
                value: selectedAccountId ? [selectedAccountId] : [],
                onChange: (next) => {
                    const picked = next.filter((id) => id !== selectedAccountId);
                    // "Select all" names no one account.
                    if (picked.length > 1) return;
                    setSelectedAccountId(picked[0] ?? (next.includes(selectedAccountId) ? selectedAccountId : ''));
                },
                options: accountOptions,
                searchable: true,
            },
            {
                id: 'period',
                type: 'date-range',
                label: t.accountingShared.period,
                value: period,
                onChange: (next) => setPeriod(next ?? defaultPeriod()),
                presets: MONTH_RANGE_PRESETS,
                operators: true,
            },
            {
                id: 'voucherType',
                type: 'multi-select',
                label: ui.common.voucherType,
                value: voucherTypes,
                onChange: setVoucherTypes,
                exclude: { value: excludeVoucherTypes, onChange: setExcludeVoucherTypes },
                options: VOUCHER_TYPES.map((type) => ({ value: type, label: voucherTypeLabel(type) })),
            },
            {
                id: 'side',
                type: 'multi-select',
                label: ui.common.side,
                value: sides,
                onChange: setSides,
                options: SIDES.map((side) => ({ value: side, label: sideLabel(side) })),
            },
            {
                id: 'amount',
                type: 'number',
                label: t.accountingShared.amount,
                value: amountFilter,
                onChange: setAmountFilter,
                money: true,
            },
        ];
        if (approvalEnabled) {
            list.push({
                id: 'approvedOnly',
                type: 'toggle',
                label: t.accountingShared.approvedOnly,
                pressed: approvedOnly,
                onChange: setApprovedOnly,
                control: 'checkbox',
                more: true,
            });
        }
        return list;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [t, ui, selectedAccountId, accountOptions, period, voucherTypes, excludeVoucherTypes, sides, amountFilter, approvalEnabled, approvedOnly]);

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const debit = filteredRows.reduce((sum, row) => sum + Number(row.debit_amount || 0), 0);
        const credit = filteredRows.reduce((sum, row) => sum + Number(row.credit_amount || 0), 0);
        const movement = ledger
            ? getPeriodMovement(
                ledger.opening_balance,
                ledger.opening_balance_side,
                ledger.closing_balance,
                ledger.closing_balance_side,
                ledger.normal_balance_side,
            )
            : null;
        const balance = (amount: number, side: BalanceSide) => ({
            value: money(side === 'neutral' ? 0 : amount),
            hint: sideLabel(side),
        });
        const empty = { value: '—' };
        const items: ListStat[] = [
            {
                id: 'opening',
                icon: <Wallet aria-hidden />,
                label: ui.common.openingBalance,
                ...(ledger ? balance(ledger.opening_balance, ledger.opening_balance_side) : empty),
            },
            { id: 'debit', icon: <ArrowDownLeft aria-hidden />, label: ui.common.totalDebit, value: ledger ? money(debit) : '—' },
            { id: 'credit', icon: <ArrowUpRight aria-hidden />, label: ui.common.totalCredit, value: ledger ? money(credit) : '—' },
            {
                id: 'movement',
                icon: <Waypoints aria-hidden />,
                label: t.ledger.periodMovement,
                ...(movement ? balance(movement.amount, movement.side) : empty),
            },
            {
                id: 'closing',
                icon: <Scale aria-hidden />,
                label: ui.common.closingBalance,
                ...(ledger ? balance(ledger.closing_balance, ledger.closing_balance_side) : empty),
            },
            {
                id: 'entries',
                icon: <Hash aria-hidden />,
                label: ui.common.entries,
                value: ledger ? filteredRows.length.toLocaleString(locale) : '—',
            },
        ];
        return { items, loading: isLoadingLedger, label: ui.ledger.statsLabel };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filteredRows, ledger, isLoadingLedger, locale, t, ui]);

    return (
        <AccountingPageShell>
            <PageHeader
                title={t.ledger.title}
                subtitle={ui.ledger.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.ledger.title,
                    'accounting',
                )}
                actions={<BranchFilter scope={branch} />}
            />

            {accountError ? <ErrorPanel message={accountError} /> : null}
            {ledgerError ? <ErrorPanel message={ledgerError} /> : null}

            <DataTable<LedgerRow>
                tableId="accounting-ledger"
                columns={columns}
                data={filteredRows}
                title={t.accountingShared.generalLedger}
                isLoading={isLoadingLedger || (isLoadingAccounts && Boolean(selectedAccountId) && !ledger)}
                emptyMessage={selectedAccountId ? t.ledger.emptyMessage : t.ledger.selectAccountHint}
                emptyIcon={<Wallet className="w-10 h-10 text-gray-200" />}
                searchPlaceholder={t.ledger.searchPlaceholder}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                toolbarActions={ledger ? (
                    <Link
                        href={ledger.data[0] ? `/accounting/vouchers/${ledger.data[0].voucher_id}` : '/accounting/vouchers'}
                        className={buttonClassName({ variant: 'secondary' })}
                    >
                        <ReceiptText className="h-3.5 w-3.5" aria-hidden />
                        {ledger.data[0] ? t.ledger.openVoucherDetail : t.ledger.openJournal}
                    </Link>
                ) : undefined}
            />
        </AccountingPageShell>
    );
}

function ErrorPanel({ message }: { message: string }) {
    return <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{message}</div>;
}

function getPeriodMovement(
    openingAmount: number,
    openingSide: BalanceSide,
    closingAmount: number,
    closingSide: BalanceSide,
    normalSide: 'debit' | 'credit',
): { amount: number; side: BalanceSide } {
    const openingSigned = toSignedBalance(openingAmount, openingSide, normalSide);
    const closingSigned = toSignedBalance(closingAmount, closingSide, normalSide);
    const delta = Math.round((closingSigned - openingSigned) * 100) / 100;

    if (Math.abs(delta) < 0.0001) {
        return { amount: 0, side: 'neutral' };
    }

    if (delta > 0) {
        return { amount: delta, side: normalSide };
    }

    return { amount: Math.abs(delta), side: normalSide === 'debit' ? 'credit' : 'debit' };
}

function toSignedBalance(
    amount: number,
    side: BalanceSide,
    normalSide: 'debit' | 'credit',
) {
    if (side === 'neutral') {
        return 0;
    }

    return side === normalSide ? amount : -amount;
}
