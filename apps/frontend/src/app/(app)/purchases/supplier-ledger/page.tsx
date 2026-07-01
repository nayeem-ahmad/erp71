'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BookOpen, Loader2 } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

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
    if (type === 'PAYMENT') return copy.directionPay;
    if (type === 'PAYOUT') return copy.directionReceive;
    return type?.replace(/_/g, ' ') ?? '—';
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
            return;
        }
        const loadLedger = async () => {
            setLedgerLoading(true);
            try {
                const data = await api.getSupplierCreditLedger(supplierId, {
                    from: fromDate || undefined,
                    to: toDate || undefined,
                    limit: 500,
                });
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
                        <span className="text-[10px] font-black uppercase tracking-widest text-orange-700">
                            {copy.openingBalance}
                        </span>
                    );
                }
                const isPayment = info.getValue() === 'PAYMENT';
                const isPayout = info.getValue() === 'PAYOUT';
                return (
                    <span className={`text-[10px] font-black uppercase tracking-widest ${
                        isPayment ? 'text-rose-600' : isPayout ? 'text-emerald-700' : 'text-gray-600'
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
                const signed = isPayout || row.type === 'CREDIT_PURCHASE';
                return (
                    <span className={`text-sm font-black ${
                        isPayout || row.type === 'CREDIT_PURCHASE'
                            ? 'text-rose-600'
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
                    <span className={`text-sm font-black ${v > 0 ? 'text-rose-600' : v < 0 ? 'text-emerald-600' : 'text-gray-700'}`}>
                        {formatBDT(v)}
                    </span>
                );
            },
            size: 120,
        }),
    ], [copy, locale]);

    const selectedSupplier = suppliers.find((s) => s.id === supplierId) ?? null;

    return (
        <div className="h-full overflow-y-auto bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="w-full space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-gray-950 inline-flex items-center gap-2">
                            <BookOpen className="w-7 h-7 text-orange-600" />
                            {copy.title}
                        </h1>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {copy.subtitle}
                        </p>
                    </div>
                    {supplierId ? (
                        <Link
                            href={`/purchases/supplier-payments?supplierId=${supplierId}&new=1`}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#293F75] text-white text-sm font-black hover:bg-[#1f3058]"
                        >
                            {copy.recordPayment}
                        </Link>
                    ) : null}
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <label className="space-y-1">
                            <span className="text-xs font-medium text-gray-500">{copy.pickSupplier}</span>
                            <select
                                value={supplierId}
                                onChange={(e) => setSupplierId(e.target.value)}
                                disabled={loadingSuppliers}
                                className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm"
                            >
                                <option value="">{copy.allSuppliers}</option>
                                {suppliers.map((supplier) => (
                                    <option key={supplier.id} value={supplier.id}>
                                        {supplier.name}{supplier.phone ? ` (${supplier.phone})` : ''}
                                    </option>
                                ))}
                            </select>
                        </label>
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
                            <p className={`text-2xl font-black mt-1 ${openingBalance > 0 ? 'text-rose-600' : openingBalance < 0 ? 'text-emerald-600' : 'text-gray-700'}`}>
                                {formatBDT(openingBalance)}
                            </p>
                        </div>
                        <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                            <p className="text-xs font-medium text-gray-500">{copy.closingBalance}</p>
                            <p className={`text-2xl font-black mt-1 ${closingBalance > 0 ? 'text-rose-600' : closingBalance < 0 ? 'text-emerald-600' : 'text-gray-700'}`}>
                                {formatBDT(closingBalance)}
                            </p>
                        </div>
                        <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                            <p className="text-xs font-medium text-gray-500">{copy.currentDue}</p>
                            <p className={`text-2xl font-black mt-1 ${dueBalance > 0 ? 'text-rose-600' : dueBalance < 0 ? 'text-emerald-600' : 'text-gray-700'}`}>
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
                        <Loader2 className="w-6 h-6 animate-spin mr-2" />
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
            </div>
        </div>
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