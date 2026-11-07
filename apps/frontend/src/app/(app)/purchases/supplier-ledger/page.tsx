'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowDownLeft, ArrowUpRight, BookOpen, Flag, FlagTriangleRight, ShoppingBag, Wallet } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { BranchFilter, PageShell, StatusBadge, buttonClassName, type StatusBadgeTone } from '@/components/ui';
import PartySearchSelect from '@/components/document-entry/PartySearchSelect';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import { createdRangeFromPreset, type CreatedRange } from '@/lib/created-range';
import { matchesAnyOf, matchesSearch } from '@/lib/list-filter';

type SupplierOption = {
    id: string;
    name: string;
    phone?: string | null;
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
    purchase_total?: number | string | null;
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

/** The Direction chip's values: a purchase (on credit or paid), money in, money out. */
type Direction = 'purchase' | 'receive' | 'pay';
const DIRECTIONS: Direction[] = ['purchase', 'receive', 'pay'];

function directionOf(type: string | undefined): Direction | null {
    if (type === 'PURCHASE' || type === 'CREDIT_PURCHASE') return 'purchase';
    if (type === 'PAYOUT') return 'receive';
    if (type === 'PAYMENT') return 'pay';
    return null;
}

function directionLabel(type: string | undefined, copy: { directionReceive: string; directionPay: string; directionPurchase: string }) {
    if (type === 'PAYMENT') return copy.directionPay;
    if (type === 'PAYOUT') return copy.directionReceive;
    if (type === 'PURCHASE' || type === 'CREDIT_PURCHASE') return copy.directionPurchase;
    return type?.replace(/_/g, ' ') ?? '—';
}

function sumField(rows: LedgerRow[], key: 'purchase_total' | 'amount_paid' | 'debit' | 'credit'): number {
    return rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
}

const dash = <span className="text-gray-400">—</span>;

function moneyCell(value: number | string | null | undefined, locale: string, className?: string) {
    const amount = Number(value ?? 0);
    if (!amount) return dash;
    return <span className={className}>{formatBDT(amount, { locale })}</span>;
}

/** Paying the supplier is the line to watch; money back from them is good news. */
function directionTone(type: string | undefined): StatusBadgeTone {
    if (type === 'PAYOUT') return 'success';
    if (type === 'PAYMENT') return 'danger';
    return 'neutral';
}

/** Red while the shop owes the supplier, green when they owe the shop. */
function balanceClass(value: number): string | undefined {
    if (value > 0) return 'text-danger';
    if (value < 0) return 'text-emerald-600';
    return undefined;
}

/** The strip's tone for a balance: amber while the shop owes. */
function balanceTone(value: number): ListStat['tone'] {
    return value > 0 ? 'warning' : 'default';
}

function SupplierLedgerContent() {
    const { t, locale } = useI18n();
    const copy = t.supplierLedger;
    const searchParams = useSearchParams();
    const preselectedId = searchParams.get('supplierId');

    const branch = useBranchScope();
    const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
    const [loadingSuppliers, setLoadingSuppliers] = useState(true);
    const [supplierId, setSupplierId] = useState(preselectedId ?? '');
    // This month by default, on the workspace's own calendar. Cleared, the
    // ledger runs from the supplier's first entry.
    const [dateRange, setDateRange] = useState<CreatedRange | null>(() => createdRangeFromPreset('thisMonth'));
    const fromDate = dateRange?.from ?? '';
    const toDate = dateRange?.to ?? '';
    const [ledgerLoading, setLedgerLoading] = useState(false);
    const [dueBalance, setDueBalance] = useState(0);
    const [openingBalance, setOpeningBalance] = useState(0);
    const [closingBalance, setClosingBalance] = useState(0);
    const [transactions, setTransactions] = useState<LedgerRow[]>([]);
    const [directions, setDirections] = useState<string[]>([]);
    const [directionsExclude, setDirectionsExclude] = useState(false);
    const [search, setSearch] = useState('');
    // The ledger names its supplier, so a linked supplier of another branch
    // still reads in the picker though the branch's list does not hold them.
    const [ledgerSupplier, setLedgerSupplier] = useState<SupplierOption | null>(null);
    // A `?supplierId=` link holds on the branch the page opened on only: once
    // the user moves the branch, a supplier outside it gives way to its first.
    const linkBranch = useRef<string | null>(null);

    useEffect(() => {
        if (!branch.ready) return;
        let cancelled = false;
        linkBranch.current ??= branch.value;
        const keepLinked = linkBranch.current === branch.value ? preselectedId : null;
        setLoadingSuppliers(true);
        api.getSuppliers({ storeId: branch.apiStoreId })
            .then((items: SupplierOption[]) => {
                if (cancelled) return;
                setSuppliers(items);
                setSupplierId((prev) =>
                    prev && (prev === keepLinked || items.some((s) => s.id === prev)) ? prev : items[0]?.id ?? '',
                );
            })
            .catch((err) => {
                if (cancelled) return;
                setSuppliers([]);
                if (handleBranchForbidden(err, branch, t.dashboardLayout.branchFilterForbidden)) return;
                console.error(err);
            })
            .finally(() => {
                if (!cancelled) setLoadingSuppliers(false);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branch.ready, branch.apiStoreId]);

    useEffect(() => {
        if (preselectedId) setSupplierId(preselectedId);
    }, [preselectedId]);

    useEffect(() => {
        if (!supplierId) {
            setTransactions([]);
            setDueBalance(0);
            setOpeningBalance(0);
            setClosingBalance(0);
            setLedgerSupplier(null);
            return;
        }
        const loadLedger = async () => {
            setLedgerLoading(true);
            try {
                // GL-derived ledger: the Purchase Payable voucher lines tagged to
                // this supplier, so the ledger reflects what was actually posted.
                const data = await api.getSupplierGlLedger(supplierId, {
                    from: fromDate || undefined,
                    to: toDate || undefined,
                });
                setLedgerSupplier('supplier' in data ? data.supplier ?? null : null);
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
                setLedgerSupplier(null);
                setOpeningBalance(0);
                setClosingBalance(0);
            } finally {
                setLedgerLoading(false);
            }
        };
        void loadLedger();
    }, [supplierId, fromDate, toDate]);

    // The direction and search chips narrow the entries here; the opening
    // balance row stays, since every running balance below starts from it.
    const visible = useMemo(
        () => transactions.filter((tx) => (
            matchesAnyOf(directions, directionOf(tx.type), directionsExclude)
            && matchesSearch(search, tx.payment_number, tx.notes, tx.creator?.name, directionLabel(tx.type, copy))
        )),
        [transactions, directions, directionsExclude, search, copy],
    );

    const totals = useMemo(() => ({
        purchases: sumField(visible, 'purchase_total'),
        paid: sumField(visible, 'amount_paid'),
        due: sumField(visible, 'debit'),
        payment: sumField(visible, 'credit'),
    }), [visible]);

    const tableData = useMemo<LedgerRow[]>(() => {
        if (!supplierId) return [];
        const openingRow: LedgerRow = {
            id: '__opening__',
            rowType: 'opening',
            created_at: fromDate,
            balance_after: openingBalance,
        };
        return [openingRow, ...visible];
    }, [supplierId, fromDate, openingBalance, visible]);

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
                if (row.source_type === 'purchase' && row.source_id) {
                    return (
                        <Link href={`/purchases/${row.source_id}`} className="text-blue-600 hover:underline">
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
        columnHelper.accessor('purchase_total', {
            header: copy.columns.purchaseTotal,
            cell: (info) => (info.row.original.rowType === 'opening' ? dash : moneyCell(info.getValue(), locale)),
            footer: () => moneyCell(totals.purchases, locale),
            size: 120,
            meta: { align: 'end', hideOnMobile: true },
        }),
        columnHelper.accessor('amount_paid', {
            header: copy.columns.paid,
            cell: (info) => (info.row.original.rowType === 'opening' ? dash : moneyCell(info.getValue(), locale)),
            footer: () => moneyCell(totals.paid, locale),
            size: 110,
            meta: { align: 'end', hideOnMobile: true },
        }),
        columnHelper.accessor('debit', {
            id: 'due',
            header: copy.columns.due,
            cell: (info) => (info.row.original.rowType === 'opening' ? dash : moneyCell(info.getValue(), locale, 'text-danger')),
            footer: () => moneyCell(totals.due, locale, 'text-danger'),
            size: 110,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('credit', {
            id: 'payment',
            header: copy.columns.payment,
            cell: (info) => (info.row.original.rowType === 'opening' ? dash : moneyCell(info.getValue(), locale, 'text-emerald-600')),
            footer: () => moneyCell(totals.payment, locale, 'text-emerald-600'),
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
    ], [copy, locale, closingBalance, totals]);

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
                operators: true,
            },
            {
                id: 'direction',
                type: 'multi-select',
                label: copy.columns.direction,
                value: directions,
                onChange: setDirections,
                exclude: { value: directionsExclude, onChange: setDirectionsExclude },
                options: DIRECTIONS.map((value) => ({
                    value,
                    label: { purchase: copy.directionPurchase, receive: copy.directionReceive, pay: copy.directionPay }[value],
                })),
            },
        ],
        [t, copy, dateRange, directions, directionsExclude],
    );

    const selectedSupplier = suppliers.find((s) => s.id === supplierId)
        ?? (ledgerSupplier?.id === supplierId ? ledgerSupplier : null);

    // Opening and closing are the ledger's over the date range; the purchases,
    // due and payment figures follow the direction and search chips, as the
    // total row does.
    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale });
        const items: ListStat[] = [
            {
                id: 'opening',
                icon: <Flag aria-hidden />,
                label: copy.openingBalance,
                value: money(openingBalance),
                tone: balanceTone(openingBalance),
            },
            { id: 'purchases', icon: <ShoppingBag aria-hidden />, label: copy.columns.purchaseTotal, value: money(totals.purchases) },
            { id: 'due', icon: <ArrowUpRight aria-hidden />, label: copy.columns.due, value: money(totals.due) },
            { id: 'payment', icon: <ArrowDownLeft aria-hidden />, label: copy.columns.payment, value: money(totals.payment) },
            {
                id: 'closing',
                icon: <FlagTriangleRight aria-hidden />,
                label: copy.closingBalance,
                value: money(closingBalance),
                tone: balanceTone(closingBalance),
            },
            {
                id: 'current',
                icon: <Wallet aria-hidden />,
                label: copy.currentDue,
                value: money(dueBalance),
                tone: balanceTone(dueBalance),
                hint: selectedSupplier?.name,
            },
        ];
        return { items, loading: ledgerLoading && transactions.length === 0, label: copy.statsLabel };
    }, [copy, locale, openingBalance, closingBalance, dueBalance, totals, selectedSupplier, ledgerLoading, transactions.length]);

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.purchase,
                    copy.title,
                    'purchases',
                )}
                actions={
                    <>
                        <BranchFilter scope={branch} />
                        {supplierId ? (
                            <Link
                                href={`/purchases/supplier-payments?supplierId=${supplierId}&new=1`}
                                className={buttonClassName()}
                            >
                                {copy.recordPayment}
                            </Link>
                        ) : null}
                    </>
                }
            />

            {/* Which ledger to read, rather than a filter on one: the table
                below is always one supplier's. */}
            <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                <div className="max-w-md">
                    <PartySearchSelect
                        parties={suppliers}
                        loading={loadingSuppliers}
                        selected={selectedSupplier}
                        onSelect={(party) => setSupplierId(party?.id ?? '')}
                        label={copy.pickSupplier}
                        placeholder={copy.searchPlaceholder}
                        emptyLabel={copy.noSuppliers}
                        noMatchLabel={copy.noSuppliers}
                        clearLabel={copy.clearSupplier}
                    />
                </div>
            </div>

            {supplierId ? (
                <DataTable
                    tableId="supplier-ledger-entries"
                    title={copy.ledgerTitle}
                    data={tableData}
                    columns={columns}
                    isLoading={ledgerLoading}
                    emptyMessage={copy.noTransactions}
                    emptyIcon={<BookOpen className="w-16 h-16 text-gray-200" />}
                    searchValue={search}
                    onSearchChange={setSearch}
                    filters={filters}
                    filterLayout="row"
                    stats={stats}
                    enableColumnFilters={false}
                    viewOptions
                />
            ) : (
                <div className="rounded-lg border border-gray-100 bg-white py-16 text-center text-sm text-gray-500">
                    {copy.selectSupplier}
                </div>
            )}
        </PageShell>
    );
}

export default function SupplierLedgerPage() {
    const { t } = useI18n();
    return (
        <Suspense fallback={<div className="p-8 text-sm text-gray-500">{t.supplierLedger.loading}</div>}>
            <SupplierLedgerContent />
        </Suspense>
    );
}
