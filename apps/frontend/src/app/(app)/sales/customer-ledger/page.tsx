'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BookOpen } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, type ListFilter } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { BranchFilter, PageShell, StatusBadge, buttonClassName, type StatusBadgeTone } from '@/components/ui';
import PartySearchSelect from '@/components/document-entry/PartySearchSelect';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import { createdRangeFromPreset, type CreatedRange } from '@/lib/created-range';

type CustomerOption = {
    id: string;
    name: string;
    phone: string;
    due_balance?: number | string;
};

type LedgerRow = {
    id: string;
    rowType: 'opening' | 'transaction';
    type?: string;
    payment_number?: string | null;
    amount?: number | string;
    debit?: number | string;
    credit?: number | string;
    sale_total?: number | string | null;
    amount_paid?: number | string | null;
    source_type?: string | null;
    source_id?: string | null;
    balance_before?: number | string;
    balance_after: number | string;
    notes?: string | null;
    created_at: string;
    creator?: { name: string } | null;
};

const columnHelper = createColumnHelper<LedgerRow>();

function formatDateTime(value: string, locale: string) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    const dateLocale = locale === 'bn' ? 'bn-BD' : locale === 'ms' ? 'ms-MY' : 'en-GB';
    return d.toLocaleString(dateLocale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatOpeningDate(value: string, locale: string) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    const dateLocale = locale === 'bn' ? 'bn-BD' : locale === 'ms' ? 'ms-MY' : 'en-GB';
    return d.toLocaleDateString(dateLocale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    });
}

function directionLabel(type: string | undefined, copy: { directionReceive: string; directionPay: string; directionSale: string }) {
    if (type === 'PAYOUT') return copy.directionPay;
    if (type === 'PAYMENT') return copy.directionReceive;
    if (type === 'SALE' || type === 'CREDIT_SALE') return copy.directionSale;
    return type?.replace(/_/g, ' ') ?? '—';
}

function transactionRowsFromTable(table: { getFilteredRowModel: () => { rows: { original: LedgerRow }[] } }): LedgerRow[] {
    return table.getFilteredRowModel().rows.map((row) => row.original).filter((row) => row.rowType === 'transaction');
}

function sumField(rows: LedgerRow[], key: 'sale_total' | 'amount_paid' | 'debit' | 'credit'): number {
    return rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
}

const dash = <span className="text-gray-400">—</span>;

function moneyCell(value: number | string | null | undefined, locale: string, className?: string) {
    const amount = Number(value ?? 0);
    if (!amount) return dash;
    return <span className={className}>{formatBDT(amount, { locale })}</span>;
}

/** Money in is good news on a due ledger; money paid out to the customer is the one to look at. */
function directionTone(type: string | undefined): StatusBadgeTone {
    if (type === 'PAYMENT') return 'success';
    if (type === 'PAYOUT') return 'danger';
    return 'neutral';
}

/** Red while the customer owes, green when the shop owes them. */
function balanceClass(value: number): string | undefined {
    if (value > 0) return 'text-danger';
    if (value < 0) return 'text-emerald-600';
    return undefined;
}

function CustomerLedgerContent() {
    const { t, locale } = useI18n();
    const copy = t.customerLedger;
    const searchParams = useSearchParams();
    const preselectedId = searchParams.get('customerId');

    const branch = useBranchScope();
    const [customers, setCustomers] = useState<CustomerOption[]>([]);
    const [loadingCustomers, setLoadingCustomers] = useState(true);
    const [customerId, setCustomerId] = useState(preselectedId ?? '');
    // This month by default, on the workspace's own calendar. Cleared, the
    // ledger runs from the customer's first entry.
    const [dateRange, setDateRange] = useState<CreatedRange | null>(() => createdRangeFromPreset('thisMonth'));
    const fromDate = dateRange?.from ?? '';
    const toDate = dateRange?.to ?? '';
    const [ledgerLoading, setLedgerLoading] = useState(false);
    const [dueBalance, setDueBalance] = useState(0);
    const [openingBalance, setOpeningBalance] = useState(0);
    const [closingBalance, setClosingBalance] = useState(0);
    const [transactions, setTransactions] = useState<LedgerRow[]>([]);
    // The ledger names its customer, so a linked customer of another branch
    // still reads in the picker though the branch's list does not hold them.
    const [ledgerCustomer, setLedgerCustomer] = useState<CustomerOption | null>(null);
    // A `?customerId=` link holds on the branch the page opened on only: once
    // the user moves the branch, a customer outside it gives way to its first.
    const linkBranch = useRef<string | null>(null);

    useEffect(() => {
        if (!branch.ready) return;
        let cancelled = false;
        linkBranch.current ??= branch.value;
        const keepLinked = linkBranch.current === branch.value ? preselectedId : null;
        setLoadingCustomers(true);
        api.getCustomers({ storeId: branch.apiStoreId })
            .then((items: CustomerOption[]) => {
                if (cancelled) return;
                setCustomers(items);
                setCustomerId((prev) =>
                    prev && (prev === keepLinked || items.some((c) => c.id === prev)) ? prev : items[0]?.id ?? '',
                );
            })
            .catch((err) => {
                if (cancelled) return;
                setCustomers([]);
                if (handleBranchForbidden(err, branch, t.dashboardLayout.branchFilterForbidden)) return;
                console.error(err);
            })
            .finally(() => {
                if (!cancelled) setLoadingCustomers(false);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branch.ready, branch.apiStoreId]);

    useEffect(() => {
        if (preselectedId) setCustomerId(preselectedId);
    }, [preselectedId]);

    useEffect(() => {
        if (!customerId) {
            setTransactions([]);
            setDueBalance(0);
            setOpeningBalance(0);
            setClosingBalance(0);
            return;
        }
        const loadLedger = async () => {
            setLedgerLoading(true);
            try {
                // GL-derived ledger: the AR voucher lines tagged to this customer,
                // so the ledger reflects what was actually posted to the accounts.
                const data = await api.getCustomerGlLedger(customerId, {
                    from: fromDate || undefined,
                    to: toDate || undefined,
                });
                setLedgerCustomer('customer' in data ? data.customer ?? null : null);
                setDueBalance(Number(data.due_balance ?? 0));
                setOpeningBalance(Number(data.opening_balance ?? 0));
                setClosingBalance(Number(data.closing_balance ?? data.opening_balance ?? 0));
                const items = Array.isArray(data.transactions) ? data.transactions : [];
                setTransactions(
                    items.map((tx: LedgerRow) => ({
                        ...tx,
                        rowType: 'transaction' as const,
                    })),
                );
            } catch (err) {
                console.error(err);
                setTransactions([]);
                setOpeningBalance(0);
                setClosingBalance(0);
            } finally {
                setLedgerLoading(false);
            }
        };
        void loadLedger();
    }, [customerId, fromDate, toDate]);

    const tableData = useMemo<LedgerRow[]>(() => {
        if (!customerId) return [];
        const openingRow: LedgerRow = {
            id: '__opening__',
            rowType: 'opening',
            created_at: fromDate,
            balance_after: openingBalance,
        };
        return [openingRow, ...transactions];
    }, [customerId, fromDate, openingBalance, transactions]);

    const columns = useMemo<ColumnDef<LedgerRow, unknown>[]>(() => [
        columnHelper.accessor('created_at', {
            header: copy.columns.dateTime,
            cell: (info) =>
                info.row.original.rowType === 'opening'
                    ? formatOpeningDate(info.getValue(), locale)
                    : formatDateTime(info.getValue(), locale),
            footer: () => copy.columnTotal,
            sortingFn: 'datetime',
            size: 150,
        }),
        columnHelper.accessor('payment_number', {
            header: copy.columns.serial,
            cell: (info) => {
                const row = info.row.original;
                if (row.rowType === 'opening') return dash;
                const serial = info.getValue();
                if (!serial) return dash;
                if (row.source_type === 'sale' && row.source_id) {
                    return (
                        <Link href={`/sales/${row.source_id}`} className="text-blue-600 hover:underline">
                            {serial}
                        </Link>
                    );
                }
                return serial;
            },
            size: 110,
        }),
        columnHelper.accessor('type', {
            header: copy.columns.direction,
            cell: (info) => {
                if (info.row.original.rowType === 'opening') {
                    return <StatusBadge tone="info">{copy.openingBalance}</StatusBadge>;
                }
                return (
                    <StatusBadge tone={directionTone(info.getValue())}>
                        {directionLabel(info.getValue(), copy)}
                    </StatusBadge>
                );
            },
            size: 150,
        }),
        columnHelper.accessor((row) => row.creator?.name ?? '—', {
            id: 'recordedBy',
            header: copy.columns.recordedBy,
            cell: (info) => (info.row.original.rowType === 'opening' ? dash : info.getValue()),
            size: 140,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor('sale_total', {
            header: copy.columns.saleTotal,
            cell: (info) => (info.row.original.rowType === 'opening' ? dash : moneyCell(info.getValue(), locale)),
            footer: ({ table }) => moneyCell(sumField(transactionRowsFromTable(table), 'sale_total'), locale),
            size: 120,
            meta: { align: 'end', hideOnMobile: true },
        }),
        columnHelper.accessor('amount_paid', {
            header: copy.columns.paid,
            cell: (info) => (info.row.original.rowType === 'opening' ? dash : moneyCell(info.getValue(), locale)),
            footer: ({ table }) => moneyCell(sumField(transactionRowsFromTable(table), 'amount_paid'), locale),
            size: 110,
            meta: { align: 'end', hideOnMobile: true },
        }),
        columnHelper.accessor('debit', {
            id: 'due',
            header: copy.columns.due,
            cell: (info) => (info.row.original.rowType === 'opening' ? dash : moneyCell(info.getValue(), locale, 'text-danger')),
            footer: ({ table }) => moneyCell(sumField(transactionRowsFromTable(table), 'debit'), locale, 'text-danger'),
            size: 110,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('credit', {
            id: 'payment',
            header: copy.columns.payment,
            cell: (info) => (info.row.original.rowType === 'opening' ? dash : moneyCell(info.getValue(), locale, 'text-emerald-600')),
            footer: ({ table }) => moneyCell(sumField(transactionRowsFromTable(table), 'credit'), locale, 'text-emerald-600'),
            size: 110,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('notes', {
            header: copy.columns.notes,
            cell: (info) => (info.row.original.rowType === 'opening' ? dash : info.getValue() || dash),
            size: 180,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor('balance_after', {
            header: copy.columns.balance,
            cell: (info) => {
                const v = Number(info.getValue());
                return <span className={balanceClass(v)}>{formatBDT(v, { locale })}</span>;
            },
            footer: () => <span className={balanceClass(closingBalance)}>{formatBDT(closingBalance, { locale })}</span>,
            size: 120,
            meta: { align: 'end' },
        }),
    ], [copy, locale, closingBalance]);

    // Page-owned: the range goes to the ledger query, and the opening balance
    // is read at its start.
    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'date',
                type: 'date-range',
                label: t.common.date,
                value: dateRange,
                onChange: setDateRange,
            },
        ],
        [t, dateRange],
    );

    const selectedCustomer = customers.find((c) => c.id === customerId)
        ?? (ledgerCustomer?.id === customerId ? ledgerCustomer : null);

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    copy.title,
                    'sales',
                )}
                actions={
                    <>
                        <BranchFilter scope={branch} />
                        {customerId ? (
                            <Link
                                href={`/sales/customer-payments?customerId=${customerId}&new=1`}
                                className={buttonClassName()}
                            >
                                {copy.recordPayment}
                            </Link>
                        ) : null}
                    </>
                }
            />

            {/* Which ledger to read, rather than a filter on one: the table
                below is always one customer's. */}
            <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                <div className="max-w-md">
                    <PartySearchSelect
                        parties={customers}
                        loading={loadingCustomers}
                        selected={selectedCustomer}
                        onSelect={(party) => setCustomerId(party?.id ?? '')}
                        label={copy.pickCustomer}
                        placeholder={copy.searchPlaceholder}
                        emptyLabel={copy.noCustomers}
                        noMatchLabel={copy.noCustomers}
                        clearLabel={copy.clearCustomer}
                    />
                </div>
            </div>

            {customerId ? (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <BalanceTile label={copy.openingBalance} value={openingBalance} locale={locale} />
                        <BalanceTile label={copy.closingBalance} value={closingBalance} locale={locale} />
                        <BalanceTile
                            label={copy.currentDue}
                            value={dueBalance}
                            locale={locale}
                            note={selectedCustomer?.name}
                        />
                    </div>

                    <DataTable
                        tableId="customer-ledger-entries"
                        title={copy.ledgerTitle}
                        data={tableData}
                        columns={columns}
                        isLoading={ledgerLoading}
                        emptyMessage={copy.noTransactions}
                        emptyIcon={<BookOpen className="w-16 h-16 text-gray-200" />}
                        filters={filters}
                        viewOptions
                    />
                </>
            ) : (
                <div className="rounded-lg border border-gray-100 bg-white py-16 text-center text-sm text-gray-500">
                    {copy.selectCustomer}
                </div>
            )}
        </PageShell>
    );
}

function BalanceTile({
    label,
    value,
    locale,
    note,
}: Readonly<{ label: string; value: number; locale: string; note?: string }>) {
    return (
        <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
            <p className="text-xs font-medium text-gray-500">{label}</p>
            <p className={`mt-1 text-xl font-semibold tabular-nums ${balanceClass(value) ?? 'text-gray-900'}`}>
                {formatBDT(value, { locale })}
            </p>
            {note ? <p className="mt-1 text-xs text-gray-400">{note}</p> : null}
        </div>
    );
}

export default function CustomerLedgerPage() {
    const { t } = useI18n();
    return (
        <Suspense fallback={<div className="p-8 text-sm text-gray-500">{t.customerLedger.loading}</div>}>
            <CustomerLedgerContent />
        </Suspense>
    );
}