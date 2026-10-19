'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BookOpen, Loader2 } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { BranchFilter, PageShell } from '@/components/ui';
import PartySearchSelect from '@/components/document-entry/PartySearchSelect';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';

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

function directionLabel(type: string | undefined, copy: { directionReceive: string; directionPay: string }) {
    if (type === 'PAYOUT') return copy.directionPay;
    if (type === 'PAYMENT') return copy.directionReceive;
    return type?.replace(/_/g, ' ') ?? '—';
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
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(defaultTo());
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
            cell: (info) => {
                const row = info.row.original;
                if (row.rowType === 'opening') {
                    return (
                        <span className="text-sm font-bold text-gray-800">
                            {formatOpeningDate(info.getValue(), locale)}
                        </span>
                    );
                }
                return <span className="text-sm text-gray-700">{formatDateTime(info.getValue(), locale)}</span>;
            },
            sortingFn: 'datetime',
            size: 150,
        }),
        columnHelper.accessor('payment_number', {
            header: copy.columns.serial,
            cell: (info) => {
                if (info.row.original.rowType === 'opening') return <span className="text-gray-300">—</span>;
                return (
                    <span className="text-xs font-mono font-bold text-gray-700">{info.getValue() || '—'}</span>
                );
            },
            size: 110,
        }),
        columnHelper.accessor('type', {
            header: copy.columns.direction,
            cell: (info) => {
                const row = info.row.original;
                if (row.rowType === 'opening') {
                    return (
                        <span className="text-[10px] font-semibold text-primary">
                            {copy.openingBalance}
                        </span>
                    );
                }
                const isPayout = info.getValue() === 'PAYOUT';
                const isPayment = info.getValue() === 'PAYMENT';
                return (
                    <span className={`text-[10px] font-semibold ${
                        isPayout ? 'text-danger' : isPayment ? 'text-emerald-700' : 'text-gray-600'
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
            cell: (info) => {
                if (info.row.original.rowType === 'opening') return <span className="text-gray-300">—</span>;
                return <span className="text-sm text-gray-600">{info.getValue()}</span>;
            },
            size: 140,
        }),
        columnHelper.accessor('amount', {
            header: copy.columns.amount,
            cell: (info) => {
                const row = info.row.original;
                if (row.rowType === 'opening') return <span className="text-gray-300">—</span>;
                const isPayout = row.type === 'PAYOUT';
                const isPayment = row.type === 'PAYMENT';
                const amt = Number(info.getValue() ?? 0);
                const signed = isPayout || row.type === 'CREDIT_SALE';
                return (
                    <span className={`text-sm font-bold ${
                        isPayout || row.type === 'CREDIT_SALE'
                            ? 'text-danger'
                            : isPayment
                              ? 'text-emerald-600'
                              : 'text-gray-700'
                    }`}>
                        {signed && amt > 0 ? '+' : isPayment ? '−' : ''}{formatBDT(amt)}
                    </span>
                );
            },
            size: 120,
        }),
        columnHelper.accessor('notes', {
            header: copy.columns.notes,
            cell: (info) => {
                if (info.row.original.rowType === 'opening') return <span className="text-gray-300">—</span>;
                return <span className="text-sm text-gray-500 line-clamp-2">{info.getValue() || '—'}</span>;
            },
            size: 180,
        }),
        columnHelper.accessor('balance_after', {
            header: copy.columns.balance,
            cell: (info) => {
                const v = Number(info.getValue());
                return (
                    <span className={`text-sm font-bold ${v > 0 ? 'text-danger' : v < 0 ? 'text-emerald-600' : 'text-gray-700'}`}>
                        {formatBDT(v)}
                    </span>
                );
            },
            size: 120,
        }),
    ], [copy, locale]);

    const selectedCustomer = customers.find((c) => c.id === customerId)
        ?? (ledgerCustomer?.id === customerId ? ledgerCustomer : null);

    return (
        <PageShell>
                <PageHeader
                    title={
                        <span className="inline-flex items-center gap-2">
                            <BookOpen className="w-7 h-7 text-primary" />
                            {copy.title}
                        </span>
                    }
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
                                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-hover"
                                >
                                    {copy.recordPayment}
                                </Link>
                            ) : null}
                        </>
                    }
                />

                <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1">
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

                {customerId ? (
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
                            {selectedCustomer ? (
                                <p className="text-xs text-gray-400 mt-1">{selectedCustomer.name}</p>
                            ) : null}
                        </div>
                    </div>
                ) : null}

                {!customerId ? (
                    <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
                        {copy.selectCustomer}
                    </div>
                ) : ledgerLoading ? (
                    <div className="flex items-center justify-center py-20 text-gray-400">
                        <Loader2 className="w-6 h-6 animate-spin me-2" />
                        {copy.loading}
                    </div>
                ) : (
                    <DataTable
                        tableId="customer-ledger-entries"
                        title={copy.ledgerTitle}
                        data={tableData}
                        columns={columns}
                        emptyMessage={copy.noTransactions}
                    />
                )}
            
        </PageShell>
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