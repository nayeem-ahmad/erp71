'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

type SupplierRow = {
    id: string;
    name: string;
    phone?: string | null;
    due_balance?: number | string;
};

type CreditTx = {
    id: string;
    type: string;
    amount: number | string;
    balance_after: number | string;
    notes?: string | null;
    created_at: string;
};

const supplierHelper = createColumnHelper<SupplierRow>();
const txHelper = createColumnHelper<CreditTx>();

function SupplierLedgerContent() {
    const { t, locale } = useI18n();
    const copy = t.supplierLedger;
    const searchParams = useSearchParams();
    const preselectedId = searchParams.get('supplierId');

    const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(preselectedId);
    const [ledgerLoading, setLedgerLoading] = useState(false);
    const [dueBalance, setDueBalance] = useState(0);
    const [transactions, setTransactions] = useState<CreditTx[]>([]);

    const loadSuppliers = useCallback(async () => {
        setLoading(true);
        try {
            const items = await api.getSuppliers();
            setSuppliers(Array.isArray(items) ? items : []);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadSuppliers();
    }, [loadSuppliers]);

    useEffect(() => {
        if (preselectedId) setSelectedId(preselectedId);
    }, [preselectedId]);

    useEffect(() => {
        if (!selectedId) {
            setTransactions([]);
            setDueBalance(0);
            return;
        }
        const loadLedger = async () => {
            setLedgerLoading(true);
            try {
                const data = await api.getSupplierCreditLedger(selectedId, { limit: 50 });
                setDueBalance(Number(data.due_balance ?? 0));
                setTransactions(Array.isArray(data.items) ? data.items : []);
            } catch (err) {
                console.error(err);
                setTransactions([]);
            } finally {
                setLedgerLoading(false);
            }
        };
        void loadLedger();
    }, [selectedId]);

    const supplierColumns = useMemo<ColumnDef<SupplierRow, unknown>[]>(() => [
        supplierHelper.accessor('name', {
            header: copy.columns.supplier,
            cell: (info) => <span className="font-bold text-gray-900">{info.getValue()}</span>,
        }),
        supplierHelper.accessor('phone', {
            header: copy.columns.phone,
            cell: (info) => info.getValue() || '—',
        }),
        supplierHelper.accessor('due_balance', {
            header: copy.columns.due,
            cell: (info) => {
                const v = Number(info.getValue() ?? 0);
                return <span className={`font-black ${v > 0 ? 'text-rose-600' : 'text-gray-400'}`}>{formatBDT(v)}</span>;
            },
        }),
        supplierHelper.display({
            id: 'actions',
            header: '',
            cell: (info) => (
                <button
                    type="button"
                    onClick={() => setSelectedId(info.row.original.id)}
                    className={`text-xs font-bold uppercase tracking-tight ${
                        info.row.original.id === selectedId ? 'text-orange-700' : 'text-blue-600 hover:underline'
                    }`}
                >
                    {copy.viewLedger}
                </button>
            ),
        }),
    ], [copy.columns, copy.viewLedger, selectedId]);

    const txColumns = useMemo<ColumnDef<CreditTx, unknown>[]>(() => [
        txHelper.accessor('created_at', {
            header: copy.txColumns.date,
            cell: (info) => formatDate(info.getValue(), locale),
        }),
        txHelper.accessor('type', {
            header: copy.txColumns.type,
            cell: (info) => <span className="text-xs font-bold uppercase">{info.getValue()}</span>,
        }),
        txHelper.accessor('amount', {
            header: copy.txColumns.amount,
            cell: (info) => formatBDT(Number(info.getValue())),
        }),
        txHelper.accessor('balance_after', {
            header: copy.txColumns.balanceAfter,
            cell: (info) => formatBDT(Number(info.getValue())),
        }),
        txHelper.accessor('notes', {
            header: copy.txColumns.notes,
            cell: (info) => info.getValue() || '—',
        }),
    ], [copy.txColumns, locale]);

    const selected = suppliers.find((s) => s.id === selectedId);

    return (
        <div className="overflow-y-auto h-full bg-[#F0F2F5] p-4 md:p-8">
            <Link href="/dashboard/purchases" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-gray-500 hover:text-gray-900">
                <ArrowLeft className="h-4 w-4" />
                {copy.backToPurchases}
            </Link>

            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black tracking-tight text-gray-900">{copy.title}</h1>
                    <p className="mt-1 text-sm text-gray-500">{copy.subtitle}</p>
                </div>
                {selectedId ? (
                    <Link
                        href={`/dashboard/purchases/supplier-payments?supplierId=${selectedId}`}
                        className="rounded-xl bg-[#293F75] px-4 py-2 text-sm font-bold text-white hover:bg-[#1f3058]"
                    >
                        {copy.recordPayment}
                    </Link>
                ) : null}
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                    <h2 className="mb-3 text-sm font-black uppercase tracking-widest text-gray-400">{copy.suppliersWithBalance}</h2>
                    <DataTable
                        tableId="supplier-ledger-suppliers"
                        title={copy.title}
                        data={suppliers}
                        columns={supplierColumns}
                        isLoading={loading}
                    />
                </section>

                <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                    {selected ? (
                        <>
                            <div className="mb-4 flex items-center gap-3 rounded-xl bg-[#FBE4D9] px-4 py-3">
                                <BookOpen className="h-5 w-5 text-[#9a4a2e]" />
                                <div>
                                    <p className="text-sm font-bold">{selected.name}</p>
                                    <p className="text-xs text-gray-600">{copy.currentDue}: <span className="font-black text-rose-600">{formatBDT(dueBalance)}</span></p>
                                </div>
                            </div>
                            <DataTable
                                tableId="supplier-ledger-transactions"
                                title={copy.ledgerTitle}
                                data={transactions}
                                columns={txColumns}
                                isLoading={ledgerLoading}
                                emptyMessage={copy.noTransactions}
                            />
                        </>
                    ) : (
                        <p className="py-16 text-center text-sm text-gray-400">{copy.selectSupplier}</p>
                    )}
                </section>
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