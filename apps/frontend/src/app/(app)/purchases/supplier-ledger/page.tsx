'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useI18n } from '@/lib/i18n';
import PartySearchSelect from '@/components/document-entry/PartySearchSelect';

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

function defaultFrom() {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
}

function defaultTo() {
    return new Date().toISOString().slice(0, 10);
}

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

function directionLabel(type: string | undefined, copy: { directionReceive: string; directionPay: string; directionPurchase: string }) {
    if (type === 'PAYMENT') return copy.directionPay;
    if (type === 'PAYOUT') return copy.directionReceive;
    if (type === 'PURCHASE' || type === 'CREDIT_PURCHASE') return copy.directionPurchase;
    return type?.replace(/_/g, ' ') ?? '—';
}

function transactionRowsFromTable(table: { getFilteredRowModel: () => { rows: { original: LedgerRow }[] } }): LedgerRow[] {
    return table.getFilteredRowModel().rows.map((row) => row.original).filter((row) => row.rowType === 'transaction');
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

function balanceClass(value: number): string | undefined {
    if (value > 0) return 'text-danger';
    if (value < 0) return 'text-emerald-600';
    return undefined;
}

function SupplierLedgerContent() {
    const { t, locale } = useI18n();
    const copy = t.supplierLedger;
    const searchParams = useSearchParams();
    const preselectedId = searchParams.get('supplierId');

    const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
    const [loadingSuppliers, setLoadingSuppliers] = useState(true);
    const [supplierId, setSupplierId] = useState(preselectedId ?? '');
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(defaultTo());
    const [ledgerLoading, setLedgerLoading] = useState(false);
    const [dueBalance, setDueBalance] = useState(0);
    const [openingBalance, setOpeningBalance] = useState(0);
    const [closingBalance, setClosingBalance] = useState(0);
    const [transactions, setTransactions] = useState<LedgerRow[]>([]);
    const [ledgerSupplier, setLedgerSupplier] = useState<SupplierOption | null>(null);

    const loadSuppliers = useCallback(async () => {
        setLoadingSuppliers(true);
        try {
            const items = await api.getSuppliers();
            const list: SupplierOption[] = Array.isArray(items) ? items : [];
            setSuppliers(list);
            if (!preselectedId && list.length > 0) {
                setSupplierId((prev) => prev || list[0].id);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoadingSuppliers(false);
        }
    }, [preselectedId]);

    useEffect(() => {
        void loadSuppliers();
    }, [loadSuppliers]);

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

    const tableData = useMemo<LedgerRow[]>(() => {
        if (!supplierId) return [];
        const openingRow: LedgerRow = {
            id: '__opening__',
            rowType: 'opening',
            created_at: fromDate,
            balance_after: openingBalance,
        };
        return [openingRow, ...transactions];
    }, [supplierId, fromDate, openingBalance, transactions]);

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
                const row = info.row.original;
                if (row.rowType === 'opening') {
                    return (
                        <span className="text-[10px] font-semibold text-orange-700">
                            {copy.openingBalance}
                        </span>
                    );
                }
                const isPayment = info.getValue() === 'PAYMENT';
                const isPayout = info.getValue() === 'PAYOUT';
                return (
                    <span className={`text-[10px] font-semibold ${
                        isPayment ? 'text-danger' : isPayout ? 'text-emerald-700' : 'text-gray-600'
                    }`}>
                        {directionLabel(info.getValue(), copy)}
                    </span>
                );
            },
            size: 140,
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
            footer: ({ table }) => moneyCell(sumField(transactionRowsFromTable(table), 'purchase_total'), locale),
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

    const selectedSupplier = suppliers.find((s) => s.id === supplierId)
        ?? (ledgerSupplier?.id === supplierId ? ledgerSupplier : null);

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
                    actions={supplierId ? (
                        <Link
                            href={`/purchases/supplier-payments?supplierId=${supplierId}&new=1`}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-hover"
                        >
                            {copy.recordPayment}
                        </Link>
                    ) : undefined}
                />

                <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1">
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
                        <label className="space-y-1">
                            <span className="text-xs font-medium text-gray-500">{copy.dateFrom}</span>
                            <input
                                type="date"
                                value={fromDate}
                                onChange={(e) => setFromDate(e.target.value)}
                                className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm"
                            />
                        </label>
                        <label className="space-y-1">
                            <span className="text-xs font-medium text-gray-500">{copy.dateTo}</span>
                            <input
                                type="date"
                                value={toDate}
                                onChange={(e) => setToDate(e.target.value)}
                                className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm"
                            />
                        </label>
                    </div>
                </div>

                {supplierId ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                            <p className="text-xs font-medium text-gray-500">{copy.openingBalance}</p>
                            <p className={`text-2xl font-bold mt-1 ${openingBalance > 0 ? 'text-danger' : openingBalance < 0 ? 'text-emerald-600' : 'text-gray-700'}`}>
                                {formatBDT(openingBalance)}
                            </p>
                        </div>
                        <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                            <p className="text-xs font-medium text-gray-500">{copy.closingBalance}</p>
                            <p className={`text-2xl font-bold mt-1 ${closingBalance > 0 ? 'text-danger' : closingBalance < 0 ? 'text-emerald-600' : 'text-gray-700'}`}>
                                {formatBDT(closingBalance)}
                            </p>
                        </div>
                        <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                            <p className="text-xs font-medium text-gray-500">{copy.currentDue}</p>
                            <p className={`text-2xl font-bold mt-1 ${dueBalance > 0 ? 'text-danger' : dueBalance < 0 ? 'text-emerald-600' : 'text-gray-700'}`}>
                                {formatBDT(dueBalance)}
                            </p>
                            {selectedSupplier ? (
                                <p className="text-xs text-gray-400 mt-1">{selectedSupplier.name}</p>
                            ) : null}
                        </div>
                    </div>
                ) : null}

                {!supplierId ? (
                    <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
                        {copy.selectSupplier}
                    </div>
                ) : ledgerLoading ? (
                    <div className="flex items-center justify-center py-20 text-gray-400">
                        <Loader2 className="w-6 h-6 animate-spin me-2" />
                        {copy.loading}
                    </div>
                ) : (
                    <DataTable
                        tableId="supplier-ledger-entries"
                        title={copy.ledgerTitle}
                        data={tableData}
                        columns={columns}
                        emptyMessage={copy.noTransactions}
                    />
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