'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { GitMerge, Loader2, Plus } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import {
    AccountingPageShell,
    AccountingToolbar,
    CompactSection,
} from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatBDT, formatDate } from '@/lib/format';
import { compactDensity } from '@/lib/ui/compact-density';
import { useReportStores } from '@/lib/accounting-report-scope';

interface FundTransfer {
    id: string;
    amount: string | number;
    method: string;
    status: 'INITIATED' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
    description?: string | null;
    created_at: string;
    sourceStore?: { id: string; name: string };
    destinationStore?: { id: string; name: string };
    sourceVoucher?: { id: string; voucher_number: string } | null;
    destinationVoucher?: { id: string; voucher_number: string } | null;
}

const columnHelper = createColumnHelper<FundTransfer>();

const METHODS = ['CASH', 'CHECK', 'BANK_TRANSFER'] as const;

export default function FundTransfersPage() {
    const { t } = useI18n();
    const m = t.accounting.reports.fundTransfers;
    const { stores } = useReportStores();
    const [transfers, setTransfers] = useState<FundTransfer[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    const [showModal, setShowModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [receivingId, setReceivingId] = useState<string | null>(null);
    const [form, setForm] = useState({
        sourceStoreId: '',
        destinationStoreId: '',
        amount: '',
        method: 'CASH',
        description: '',
    });

    const loadTransfers = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.listFundTransfers({
                status: statusFilter || undefined,
            });
            setTransfers(Array.isArray(data) ? data : []);
        } catch (err: any) {
            setError(err?.message ?? m.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [statusFilter, m.loadFailed]);

    useEffect(() => {
        void loadTransfers();
    }, [loadTransfers]);

    useEffect(() => {
        if (stores.length === 0) {
            return;
        }
        setForm((current) => ({
            ...current,
            sourceStoreId: current.sourceStoreId || stores[0].id,
            destinationStoreId: current.destinationStoreId || stores[1]?.id || stores[0].id,
        }));
    }, [stores]);

    const openCreate = () => {
        setForm({
            sourceStoreId: stores[0]?.id ?? '',
            destinationStoreId: stores[1]?.id ?? stores[0]?.id ?? '',
            amount: '',
            method: 'CASH',
            description: '',
        });
        setShowModal(true);
    };

    const handleCreate = async () => {
        setSaving(true);
        setToast(null);
        try {
            await api.initiateFundTransfer({
                sourceStoreId: form.sourceStoreId,
                destinationStoreId: form.destinationStoreId,
                amount: Number(form.amount),
                method: form.method,
                description: form.description || undefined,
            });
            setShowModal(false);
            setToast({ type: 'success', message: 'Transfer initiated.' });
            await loadTransfers();
        } catch (err: any) {
            setToast({ type: 'error', message: err?.message ?? m.createFailed });
        } finally {
            setSaving(false);
        }
    };

    const handleReceive = async (id: string) => {
        setReceivingId(id);
        setToast(null);
        try {
            await api.receiveFundTransfer(id);
            setToast({ type: 'success', message: 'Transfer received.' });
            await loadTransfers();
        } catch (err: any) {
            setToast({ type: 'error', message: err?.message ?? m.receiveFailed });
        } finally {
            setReceivingId(null);
        }
    };

    const columns = useMemo<ColumnDef<FundTransfer, any>[]>(() => [
        columnHelper.accessor((row) => row.created_at, {
            id: 'created_at',
            header: t.accountingShared.date,
            cell: (info) => formatDate(info.getValue()),
        }),
        columnHelper.display({
            id: 'route',
            header: `${m.fromBranch} → ${m.toBranch}`,
            cell: ({ row }) => (
                <span className="text-sm font-medium text-gray-800">
                    {row.original.sourceStore?.name ?? '—'} → {row.original.destinationStore?.name ?? '—'}
                </span>
            ),
        }),
        columnHelper.accessor('amount', {
            header: m.amount,
            cell: (info) => <span className="font-semibold text-gray-900">{formatBDT(Number(info.getValue()))}</span>,
        }),
        columnHelper.accessor('method', {
            header: m.method,
            cell: (info) => m.methods[info.getValue() as keyof typeof m.methods] ?? info.getValue(),
        }),
        columnHelper.accessor('status', {
            header: m.status,
            cell: (info) => {
                const status = info.getValue();
                const tone = status === 'RECEIVED'
                    ? 'bg-emerald-50 text-emerald-700'
                    : status === 'IN_TRANSIT'
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-gray-100 text-gray-600';
                return (
                    <span className={`px-2 py-0.5 rounded-lg text-xs font-semibold ${tone}`}>
                        {m.statuses[status as keyof typeof m.statuses] ?? status}
                    </span>
                );
            },
        }),
        columnHelper.display({
            id: 'vouchers',
            header: 'Vouchers',
            cell: ({ row }) => (
                <div className="text-xs text-gray-500 space-y-0.5">
                    {row.original.sourceVoucher?.voucher_number ? (
                        <div>{m.sourceVoucher}: {row.original.sourceVoucher.voucher_number}</div>
                    ) : null}
                    {row.original.destinationVoucher?.voucher_number ? (
                        <div>{m.destinationVoucher}: {row.original.destinationVoucher.voucher_number}</div>
                    ) : null}
                </div>
            ),
        }),
        columnHelper.display({
            id: 'actions',
            header: '',
            cell: ({ row }) => (
                row.original.status === 'IN_TRANSIT' ? (
                    <button
                        type="button"
                        onClick={() => void handleReceive(row.original.id)}
                        disabled={receivingId === row.original.id}
                        className={`${compactDensity.btnSecondary} whitespace-nowrap`}
                    >
                        {receivingId === row.original.id ? m.receiving : m.receive}
                    </button>
                ) : null
            ),
        }),
    ], [t.accountingShared.date, m, receivingId]);

    return (
        <AccountingPageShell maxWidth="full">
            <PageHeader
                title={m.title}
                subtitle={m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    m.title,
                    'accounting',
                )}
                actions={(
                    <button
                        type="button"
                        onClick={openCreate}
                        className={`${compactDensity.btnPrimary} bg-gray-900 text-white hover:bg-gray-700`}
                    >
                        <Plus className="w-3.5 h-3.5" />
                        {m.create}
                    </button>
                )}
            />

            <AccountingToolbar>
                <div className={compactDensity.filterBar}>
                    <div className="flex flex-col gap-1">
                        <span className={compactDensity.formLabel}>{m.status}</span>
                        <select
                            value={statusFilter}
                            onChange={(event) => setStatusFilter(event.target.value)}
                            className={compactDensity.formField}
                        >
                            <option value="">{t.accountingShared.allTypes}</option>
                            {Object.entries(m.statuses).map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </AccountingToolbar>

            {error ? <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div> : null}
            {toast ? (
                <div className={`rounded-lg border p-3 text-sm ${toast.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-red-50 border-red-100 text-red-700'}`}>
                    {toast.message}
                </div>
            ) : null}

            {loading ? (
                <CompactSection className="py-8 text-center text-gray-400 text-sm font-medium flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t.accountingShared.loading}
                </CompactSection>
            ) : (
                <DataTable
                    tableId="fund-transfers"
                    title={m.title}
                    columns={columns}
                    data={transfers}
                    emptyMessage={m.empty}
                    searchPlaceholder="Search transfers..."
                />
            )}

            {showModal ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className={`${compactDensity.modal} max-w-md w-full`}>
                        <div className={`${compactDensity.modalPadding} border-b border-gray-100 flex items-center gap-2`}>
                            <GitMerge className="w-4 h-4 text-teal-700" />
                            <h2 className={compactDensity.modalTitle}>{m.create}</h2>
                        </div>
                        <div className={`${compactDensity.modalPadding} ${compactDensity.formStack}`}>
                            <label className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{m.fromBranch}</span>
                                <select
                                    value={form.sourceStoreId}
                                    onChange={(event) => setForm((current) => ({ ...current, sourceStoreId: event.target.value }))}
                                    className={compactDensity.formField}
                                >
                                    {stores.map((store) => (
                                        <option key={store.id} value={store.id}>{store.name}</option>
                                    ))}
                                </select>
                            </label>
                            <label className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{m.toBranch}</span>
                                <select
                                    value={form.destinationStoreId}
                                    onChange={(event) => setForm((current) => ({ ...current, destinationStoreId: event.target.value }))}
                                    className={compactDensity.formField}
                                >
                                    {stores.map((store) => (
                                        <option key={store.id} value={store.id}>{store.name}</option>
                                    ))}
                                </select>
                            </label>
                            <label className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{m.amount}</span>
                                <input
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    value={form.amount}
                                    onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
                                    className={compactDensity.formField}
                                />
                            </label>
                            <label className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{m.method}</span>
                                <select
                                    value={form.method}
                                    onChange={(event) => setForm((current) => ({ ...current, method: event.target.value }))}
                                    className={compactDensity.formField}
                                >
                                    {METHODS.map((method) => (
                                        <option key={method} value={method}>
                                            {m.methods[method]}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{m.description}</span>
                                <input
                                    value={form.description}
                                    onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                                    className={compactDensity.formField}
                                />
                            </label>
                        </div>
                        <div className={`${compactDensity.modalPadding} flex gap-2 justify-end border-t border-gray-100`}>
                            <button type="button" onClick={() => setShowModal(false)} className={compactDensity.btnSecondary}>
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleCreate()}
                                disabled={saving || !form.sourceStoreId || !form.destinationStoreId || Number(form.amount) <= 0}
                                className={`${compactDensity.btnPrimary} bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-60`}
                            >
                                {saving ? t.accountingShared.loading : m.create}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </AccountingPageShell>
    );
}