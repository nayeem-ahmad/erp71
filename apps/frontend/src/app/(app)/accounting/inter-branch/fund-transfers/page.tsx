'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Ban, Banknote, CircleCheck, GitMerge, Plus, Truck } from 'lucide-react';
import { DataTable, createdAtColumn, type ListFilter, type ListStat } from '@/components/data-table';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import { AccountingPageShell } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { formatBDT } from '@/lib/format';
import { compactDensity } from '@/lib/ui/compact-density';
import { useReportStores } from '@/lib/accounting-report-scope';
import { Alert, BranchFilter, Button, StatusBadge, type StatusBadgeTone } from '@/components/ui';
import { RowActions, RowActionButton } from '@/components/table';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';

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
const STATUSES = ['INITIATED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED'] as const;

const STATUS_TONE: Record<FundTransfer['status'], StatusBadgeTone> = {
    INITIATED: 'info',
    IN_TRANSIT: 'warning',
    RECEIVED: 'success',
    CANCELLED: 'neutral',
};

export default function FundTransfersPage() {
    const { t, locale } = useI18n();
    const m = t.accounting.reports.fundTransfers;
    const ui = t.accountingFinanceUi.fundTransfers;
    const { stores } = useReportStores();
    // Lists the transfers the branch sent or received ("All branches": every one).
    const branch = useBranchScope();
    const storeId = branch.apiStoreId;
    const [transfers, setTransfers] = useState<FundTransfer[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statuses, setStatuses] = useState<string[]>([]);
    const [statusExclude, setStatusExclude] = useState(false);
    const [fromBranches, setFromBranches] = useState<string[]>([]);
    const [toBranches, setToBranches] = useState<string[]>([]);
    const [methods, setMethods] = useState<string[]>([]);
    const [amountFilter, setAmountFilter] = useState<NumberCondition | null>(null);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [error, setError] = useState<string | null>(null);

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

    // Branch and date narrow what the server sends; the other chips and the
    // strip narrow the same rows here.
    const loadTransfers = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.listFundTransfers({
                storeId,
                from: applyCreatedRangeQuery(createdRange).createdFrom,
                to: applyCreatedRangeQuery(createdRange).createdTo,
            });
            setTransfers(Array.isArray(data) ? data : []);
        } catch (err: any) {
            if (handleBranchForbidden(err, branch, t.dashboardLayout.branchFilterForbidden)) return;
            setError(err?.message ?? m.loadFailed);
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storeId, createdRange, m.loadFailed]);

    useEffect(() => {
        if (!branch.ready) return;
        void loadTransfers();
    }, [branch.ready, loadTransfers]);

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
        try {
            await api.initiateFundTransfer({
                sourceStoreId: form.sourceStoreId,
                destinationStoreId: form.destinationStoreId,
                amount: Number(form.amount),
                method: form.method,
                description: form.description || undefined,
            });
            setShowModal(false);
            toast.success(ui.initiated);
            await loadTransfers();
        } catch (err: any) {
            toast.error(err?.message ?? m.createFailed);
        } finally {
            setSaving(false);
        }
    };

    const handleReceive = async (id: string) => {
        setReceivingId(id);
        try {
            await api.receiveFundTransfer(id);
            toast.success(ui.received);
            await loadTransfers();
        } catch (err: any) {
            toast.error(err?.message ?? m.receiveFailed);
        } finally {
            setReceivingId(null);
        }
    };

    const statusLabel = (status: string) => m.statuses[status as keyof typeof m.statuses] ?? status;
    const methodLabel = (method: string) => m.methods[method as keyof typeof m.methods] ?? method;

    const filtered = useMemo(
        () => transfers.filter((transfer) => {
            if (!matchesAnyOf(statuses, transfer.status, statusExclude)) return false;
            if (!matchesAnyOf(fromBranches, transfer.sourceStore?.id)) return false;
            if (!matchesAnyOf(toBranches, transfer.destinationStore?.id)) return false;
            if (!matchesAnyOf(methods, transfer.method)) return false;
            if (!matchesNumberCondition(Number(transfer.amount || 0), amountFilter)) return false;
            return matchesSearch(
                search,
                transfer.sourceStore?.name,
                transfer.destinationStore?.name,
                transfer.description,
                transfer.sourceVoucher?.voucher_number,
                transfer.destinationVoucher?.voucher_number,
                statusLabel(transfer.status),
                methodLabel(transfer.method),
                String(transfer.amount ?? ''),
            );
        }),
        [transfers, statuses, statusExclude, fromBranches, toBranches, methods, amountFilter, search, m],
    );

    // Branches the transfers name, with any the workspace has besides.
    const branchOptions = useMemo(() => {
        const named = new Map<string, string>();
        for (const store of stores) named.set(store.id, store.name);
        for (const transfer of transfers) {
            if (transfer.sourceStore) named.set(transfer.sourceStore.id, transfer.sourceStore.name);
            if (transfer.destinationStore) named.set(transfer.destinationStore.id, transfer.destinationStore.name);
        }
        return [...named.entries()]
            .map(([value, label]) => ({ value, label }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [stores, transfers]);

    const filters = useMemo<ListFilter[]>(
        () => [
            { id: 'created', type: 'date-range', label: t.common.date, value: createdRange, onChange: setCreatedRange, operators: true },
            {
                id: 'status',
                type: 'multi-select',
                label: m.status,
                value: statuses,
                onChange: setStatuses,
                exclude: { value: statusExclude, onChange: setStatusExclude },
                options: STATUSES.map((value) => ({ value, label: statusLabel(value) })),
            },
            {
                id: 'from',
                type: 'multi-select',
                label: m.fromBranch,
                value: fromBranches,
                onChange: setFromBranches,
                options: branchOptions,
            },
            {
                id: 'to',
                type: 'multi-select',
                label: m.toBranch,
                value: toBranches,
                onChange: setToBranches,
                options: branchOptions,
            },
            {
                id: 'amount',
                type: 'number',
                label: m.amount,
                value: amountFilter,
                onChange: setAmountFilter,
                money: true,
            },
            {
                id: 'method',
                type: 'multi-select',
                label: m.method,
                value: methods,
                onChange: setMethods,
                options: METHODS.map((value) => ({ value, label: methodLabel(value) })),
                more: true,
            },
        ],
        [t, m, createdRange, statuses, statusExclude, fromBranches, toBranches, branchOptions, amountFilter, methods],
    );

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const n = (value: number) => value.toLocaleString(locale);
        const sumOf = (status?: FundTransfer['status']) => {
            const rows = status ? filtered.filter((row) => row.status === status) : filtered;
            return { count: rows.length, amount: rows.reduce((sum, row) => sum + Number(row.amount || 0), 0) };
        };
        const all = sumOf();
        const open = filtered.filter((row) => row.status === 'INITIATED' || row.status === 'IN_TRANSIT');
        const openAmount = open.reduce((sum, row) => sum + Number(row.amount || 0), 0);
        const received = sumOf('RECEIVED');
        const cancelled = sumOf('CANCELLED');
        const items: ListStat[] = [
            { id: 'count', icon: <GitMerge aria-hidden />, label: ui.transfers, value: n(all.count) },
            { id: 'amount', icon: <Banknote aria-hidden />, label: ui.totalAmount, value: money(all.amount) },
            {
                id: 'inTransit',
                icon: <Truck aria-hidden />,
                label: ui.notReceived,
                value: money(openAmount),
                hint: n(open.length),
                tone: openAmount > 0 ? 'warning' : 'default',
            },
            {
                id: 'received',
                icon: <CircleCheck aria-hidden />,
                label: m.statuses.RECEIVED,
                value: money(received.amount),
                hint: n(received.count),
            },
            {
                id: 'cancelled',
                icon: <Ban aria-hidden />,
                label: m.statuses.CANCELLED,
                value: money(cancelled.amount),
                hint: n(cancelled.count),
            },
        ];
        return { items, loading, label: ui.statsLabel };
    }, [filtered, loading, locale, m, ui]);

    const columns = useMemo<ColumnDef<FundTransfer, any>[]>(() => [
        createdAtColumn(columnHelper, { header: t.common.createdAt, locale }),
        columnHelper.accessor((row) => `${row.sourceStore?.name ?? '—'} → ${row.destinationStore?.name ?? '—'}`, {
            id: 'route',
            header: `${m.fromBranch} → ${m.toBranch}`,
            cell: (info) => info.getValue(),
            size: 220,
        }),
        columnHelper.accessor((row) => Number(row.amount || 0), {
            id: 'amount',
            header: m.amount,
            cell: (info) => formatBDT(info.getValue(), { locale }),
            meta: { align: 'end' },
            size: 120,
        }),
        columnHelper.accessor('method', {
            header: m.method,
            cell: (info) => methodLabel(info.getValue()),
            meta: { hideOnMobile: true },
            size: 120,
        }),
        columnHelper.accessor('status', {
            header: m.status,
            cell: (info) => (
                <StatusBadge tone={STATUS_TONE[info.getValue() as FundTransfer['status']] ?? 'neutral'}>
                    {statusLabel(info.getValue())}
                </StatusBadge>
            ),
            size: 110,
        }),
        columnHelper.display({
            id: 'vouchers',
            header: ui.vouchers,
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
            meta: { hideOnMobile: true },
            size: 200,
        }),
        columnHelper.display({
            id: 'actions',
            header: t.common.actions,
            cell: ({ row }) => (
                row.original.status === 'IN_TRANSIT' ? (
                    <RowActions>
                        <RowActionButton
                            icon={<CircleCheck />}
                            label={receivingId === row.original.id ? m.receiving : m.receive}
                            intent="success"
                            disabled={receivingId === row.original.id}
                            onClick={() => void handleReceive(row.original.id)}
                        />
                    </RowActions>
                ) : null
            ),
            enableSorting: false,
            enableColumnFilter: false,
            enableResizing: false,
            size: 80,
        }),
    ], [t, locale, m, ui, receivingId]);

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
                    <>
                        <BranchFilter scope={branch} />
                        <Button variant="primary" icon={<Plus className="w-3.5 h-3.5" />} onClick={openCreate}>
                            {m.create}
                        </Button>
                    </>
                )}
            />

            {error ? <Alert tone="danger">{error}</Alert> : null}

            <DataTable
                tableId="fund-transfers"
                title={m.title}
                columns={columns}
                data={filtered}
                isLoading={loading}
                emptyMessage={m.empty}
                emptyIcon={<GitMerge className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={ui.search}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
            />

            {showModal ? (
                <ModalShell size="sm" onBackdropClick={() => setShowModal(false)}>
                    <div className="flex max-h-[90vh] flex-col overflow-hidden">
                        <ModalHeader
                            title={(
                                <span className="inline-flex items-center gap-2">
                                    <GitMerge className="w-4 h-4 text-primary" />
                                    {m.create}
                                </span>
                            )}
                            onClose={() => setShowModal(false)}
                        />
                        <div className={`${compactDensity.modalPadding} ${compactDensity.formStack} overflow-y-auto`}>
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
                        <ModalFooter>
                            <Button variant="secondary" type="button" onClick={() => setShowModal(false)}>
                                {t.common.cancel}
                            </Button>
                            <Button
                                variant="primary"
                                type="button"
                                onClick={() => void handleCreate()}
                                loading={saving}
                                disabled={!form.sourceStoreId || !form.destinationStoreId || Number(form.amount) <= 0}
                            >
                                {m.create}
                            </Button>
                        </ModalFooter>
                    </div>
                </ModalShell>
            ) : null}
        </AccountingPageShell>
    );
}
