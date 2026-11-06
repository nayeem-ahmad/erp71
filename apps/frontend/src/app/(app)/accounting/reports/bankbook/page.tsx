'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { ArrowDownLeft, ArrowUpRight, Hash, Landmark, Scale, Wallet } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { AccountingPageShell } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { BranchFilter } from '@/components/ui';
import { useBranchScope } from '@/lib/branch-scope';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { accountLabel } from '@/components/accounting/AccountSelect';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useApprovedOnly } from '@/lib/accounting-report-scope';
import { createdRangeFromPreset, type CreatedRange, type CreatedRangePreset } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';

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

const VOUCHER_TYPES = ['cash_payment', 'cash_receive', 'bank_payment', 'bank_receive', 'fund_transfer', 'journal'] as const;
const FLOWS = ['in', 'out'] as const;
const PERIOD_PRESETS: readonly CreatedRangePreset[] = ['today', 'yesterday', 'last7', 'thisMonth', 'last3Months', 'thisYear'];

/** A bankbook always covers some period: cleared, it goes back to this month. */
const defaultPeriod = (): CreatedRange => createdRangeFromPreset('thisMonth');

const flowOf = (row: BookRow): 'in' | 'out' => (Number(row.receipts) > 0 ? 'in' : 'out');
const amountOf = (row: BookRow) => (Number(row.receipts) > 0 ? Number(row.receipts) : Number(row.payments));

export default function BankbookPage() {
    const { t, locale } = useI18n();
    const ui = t.accountingBooksUi;
    const copy = t.accounting.reports.bankbook;
    const branch = useBranchScope();
    const [data, setData] = useState<BookData | null>(null);
    const [period, setPeriod] = useState<CreatedRange>(defaultPeriod);
    const fromDate = period.from ?? '';
    const toDate = period.to ?? '';
    const [accountId, setAccountId] = useState('');
    const [loading, setLoading] = useState(true);
    const { approvedOnly, setApprovedOnly, approvalEnabled, ready: approvalReady } = useApprovedOnly();
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [voucherTypes, setVoucherTypes] = useState<string[]>([]);
    const [flows, setFlows] = useState<string[]>([]);
    const [amountFilter, setAmountFilter] = useState<NumberCondition | null>(null);

    // approvalReady holds the first fetch until the tenant's approved-only
    // setting is known, so the report is never generated against the wrong value.
    useEffect(() => {
        if (approvalReady && branch.ready) void load();
        // load reads the latest filters and branch from this render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fromDate, toDate, accountId, approvalReady, approvedOnly, branch.ready, branch.apiStoreId]);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await api.getBankbook({ approvedOnly,
                from: fromDate || undefined,
                to: toDate || undefined,
                accountId: accountId || undefined,
                storeId: branch.apiStoreId,
            });
            setData(result);
        } catch (err: any) {
            setError(err?.message ?? ui.bankbook.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const voucherTypeLabel = (type: string) => {
        const labels = t.accountingShared.voucherTypes as Record<string, string>;
        return labels[type.toUpperCase()] ?? type.replaceAll('_', ' ');
    };
    const sideLabel = (side: string) => (
        side === 'debit' ? t.accountingShared.debit : side === 'credit' ? t.accountingShared.credit : ui.common.neutral
    );

    // Account and period are asked of the server; the other chips and the
    // search narrow the rows it sent, and the strip sums the same rows.
    const filteredRows = useMemo(
        () => (data?.rows ?? []).filter((row) => (
            matchesAnyOf(voucherTypes, row.voucher_type)
            && matchesAnyOf(flows, flowOf(row))
            && matchesNumberCondition(amountOf(row), amountFilter)
            && matchesSearch(
                search,
                row.voucher_number,
                row.description,
                row.reference_number,
                row.account_name,
                voucherTypeLabel(row.voucher_type),
            )
        )),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [data, voucherTypes, flows, amountFilter, search, t],
    );

    const columns: ColumnDef<BookRow, any>[] = useMemo(() => [
        columnHelper.accessor((row) => String(row.date).slice(0, 10), {
            id: 'date',
            header: t.accountingShared.date,
            cell: (info) => <span className="text-sm text-gray-700">{formatDate(info.row.original.date, locale)}</span>,
            size: 110,
        }),
        columnHelper.accessor('voucher_number', { header: t.journal.columns.voucherNumber, size: 120 }),
        columnHelper.accessor((row) => row.description ?? row.reference_number ?? '-', {
            id: 'description', header: t.accountingShared.description, size: 240,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor('account_name', {
            header: ui.bankbook.bankAccount,
            size: 180,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor('receipts', {
            header: copy.deposits,
            cell: (info) => info.getValue() > 0 ? <span>{formatBDT(Number(info.getValue()), { locale })}</span> : <span className="text-gray-300">—</span>,
            meta: { align: 'end' },
            size: 130,
        }),
        columnHelper.accessor('payments', {
            header: copy.withdrawals,
            cell: (info) => info.getValue() > 0 ? <span>{formatBDT(Number(info.getValue()), { locale })}</span> : <span className="text-gray-300">—</span>,
            meta: { align: 'end' },
            size: 130,
        }),
        columnHelper.accessor('running_balance', {
            header: copy.balance,
            cell: (info) => (
                <span className="font-medium text-gray-900">
                    {formatBDT(Number(info.getValue()), { locale })}
                    <span className="ms-1 text-xs font-normal text-gray-400">{sideLabel(info.row.original.running_balance_side)}</span>
                </span>
            ),
            meta: { align: 'end' },
            size: 160,
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [t, locale]);

    const accounts = data?.accounts ?? [];

    const filters = useMemo<ListFilter[]>(() => {
        const list: ListFilter[] = [
            {
                id: 'period',
                type: 'date-range',
                label: t.accountingShared.period,
                value: period,
                onChange: (next) => setPeriod(next ?? defaultPeriod()),
                presets: PERIOD_PRESETS,
                operators: true,
            },
        ];
        if (accounts.length > 0 || accountId) {
            list.push({
                id: 'account',
                type: 'select',
                label: ui.bankbook.bankAccount,
                value: accountId || null,
                onChange: (next) => setAccountId(next ?? ''),
                options: accounts.map((account) => ({ value: account.id, label: accountLabel(account) })),
                // Past a handful of accounts, a search box finds one faster than scrolling.
                searchable: accounts.length > 8,
            });
        }
        list.push(
            {
                id: 'voucherType',
                type: 'multi-select',
                label: ui.common.voucherType,
                value: voucherTypes,
                onChange: setVoucherTypes,
                options: VOUCHER_TYPES.map((type) => ({ value: type, label: voucherTypeLabel(type) })),
            },
            {
                id: 'flow',
                type: 'multi-select',
                label: ui.bankbook.flow,
                value: flows,
                onChange: setFlows,
                options: FLOWS.map((flow) => ({ value: flow, label: flow === 'in' ? copy.deposits : copy.withdrawals })),
            },
            {
                id: 'amount',
                type: 'number',
                label: t.accountingShared.amount,
                value: amountFilter,
                onChange: setAmountFilter,
                money: true,
            },
        );
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
    }, [t, ui, copy, period, accounts, accountId, voucherTypes, flows, amountFilter, approvalEnabled, approvedOnly]);

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const receipts = filteredRows.reduce((sum, row) => sum + Number(row.receipts || 0), 0);
        const payments = filteredRows.reduce((sum, row) => sum + Number(row.payments || 0), 0);
        const items: ListStat[] = [
            {
                id: 'opening',
                icon: <Wallet aria-hidden />,
                label: ui.common.openingBalance,
                value: data ? money(data.opening_balance) : '—',
                hint: data ? sideLabel(data.opening_balance_side) : undefined,
            },
            { id: 'receipts', icon: <ArrowDownLeft aria-hidden />, label: ui.bankbook.totalDeposits, value: money(receipts) },
            {
                id: 'payments',
                icon: <ArrowUpRight aria-hidden />,
                label: ui.bankbook.totalWithdrawals,
                value: money(payments),
            },
            {
                id: 'closing',
                icon: <Scale aria-hidden />,
                label: ui.common.closingBalance,
                value: data ? money(data.closing_balance) : '—',
                hint: data ? sideLabel(data.closing_balance_side) : undefined,
            },
            { id: 'entries', icon: <Hash aria-hidden />, label: ui.common.entries, value: filteredRows.length.toLocaleString(locale) },
        ];
        return { items, loading: loading && !data, label: ui.bankbook.statsLabel };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filteredRows, data, loading, locale, t, ui]);

    return (
        <AccountingPageShell maxWidth="full">
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    copy.title,
                    'accounting',
                )}
                actions={<BranchFilter scope={branch} />}
            />

            {error && <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}

            <DataTable<BookRow>
                tableId="bankbook"
                columns={columns}
                data={filteredRows}
                title={t.accountingShared.bankTransactions}
                isLoading={loading}
                emptyMessage={t.accountingShared.noBankTransactions}
                emptyIcon={<Landmark className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={t.accountingShared.searchTransactions}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
            />
        </AccountingPageShell>
    );
}
