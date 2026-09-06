'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { ArrowDownLeft, ArrowUpRight, Loader2, Pencil, Plus, Receipt, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell, Button, Select, StatusBadge, ConfirmDialog } from '@/components/ui';
import { toast } from '@/lib/toast';
import { DataTable } from '@/components/data-table';
import TenantLedgerEntryModal, { type LedgerEntryKind } from '@/components/admin/tenants/TenantLedgerEntryModal';
import {
    isCreditLedgerEvent,
    isDebitLedgerEvent,
    withRunningBalances,
} from '@/components/admin/tenants/ledger-utils';
import type { LedgerEvent, TenantRecord } from '@/components/admin/tenants/types';
import { api } from '@/lib/api';
import { formatBDT, formatDateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';

const columnHelper = createColumnHelper<LedgerEvent>();

export default function AdminTenantLedgerPage() {
    const { t } = useI18n();
    const m = t.admin.tenants;
    const lp = m.ledgerPage;
    const ml = m.ledger;
    const em = ml.entryModal;

    const [tenants, setTenants] = useState<TenantRecord[]>([]);
    const [tenantFilter, setTenantFilter] = useState('');
    const [events, setEvents] = useState<LedgerEvent[]>([]);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [entryModalOpen, setEntryModalOpen] = useState(false);
    const [entryModalKind, setEntryModalKind] = useState<LedgerEntryKind>('payment');
    const [editingEntry, setEditingEntry] = useState<LedgerEvent | null>(null);
    const [pendingDelete, setPendingDelete] = useState<LedgerEvent | null>(null);
    const [deleting, setDeleting] = useState(false);

    const loadLedger = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const rows = await api.getAdminTenantLedger({
                tenantId: tenantFilter || undefined,
            });
            setEvents(withRunningBalances(rows));
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : ml.loadFailed);
        } finally {
            setIsLoading(false);
        }
    }, [ml.loadFailed, tenantFilter]);

    useEffect(() => {
        api.getAdminTenants({})
            .then((rows) => setTenants(rows))
            .catch(() => null);
    }, []);

    useEffect(() => {
        void loadLedger();
    }, [loadLedger]);

    const openAdd = (kind: LedgerEntryKind) => {
        setEditingEntry(null);
        setEntryModalKind(kind);
        setEntryModalOpen(true);
    };

    // Memoised because the actions column closes over it — a fresh identity every
    // render would rebuild the whole column set on each keystroke elsewhere.
    const openEdit = useCallback((event: LedgerEvent) => {
        setEditingEntry(event);
        setEntryModalOpen(true);
    }, []);

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        setDeleting(true);
        try {
            await api.deleteTenantLedgerEntry(pendingDelete.id);
            toast.success(em.deleteSuccess);
            setPendingDelete(null);
            await loadLedger();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : em.deleteFailed);
        } finally {
            setDeleting(false);
        }
    };

    const columns: ColumnDef<LedgerEvent, unknown>[] = useMemo(() => [
        columnHelper.accessor('created_at', {
            header: ml.columns.date,
            // Date and time: entries are backdated by hand now, and two rows on
            // the same day are otherwise indistinguishable in the running balance.
            cell: (info) => formatDateTime(info.getValue()),
        }),
        columnHelper.accessor('tenant_name', {
            header: lp.columns.tenant,
            cell: (info) => info.getValue() ?? '—',
        }),
        columnHelper.accessor('event_type', {
            header: ml.columns.type,
            cell: (info) => {
                const type = info.getValue();
                const isCredit = isCreditLedgerEvent(type);
                const isDebit = isDebitLedgerEvent(type);
                const tone = isCredit ? 'success' : isDebit ? 'warning' : 'neutral';
                return (
                    <StatusBadge tone={tone} className="gap-1">
                        {isCredit ? <ArrowDownLeft className="w-2.5 h-2.5" /> : isDebit ? <ArrowUpRight className="w-2.5 h-2.5" /> : null}
                        {(ml.eventType as Record<string, string>)[type] ?? type}
                    </StatusBadge>
                );
            },
        }),
        columnHelper.accessor('amount', {
            header: ml.columns.amount,
            cell: (info) => {
                const isCredit = isCreditLedgerEvent(info.row.original.event_type);
                const value = info.getValue();
                return (
                    <span className={`font-bold ${isCredit ? 'text-success-text' : 'text-warning-text'}`}>
                        {value !== null ? formatBDT(Number(value)) : '—'}
                    </span>
                );
            },
        }),
        columnHelper.accessor('running_balance', {
            header: lp.columns.runningBalance,
            cell: (info) => {
                const value = info.getValue();
                return value !== undefined ? formatBDT(Number(value)) : '—';
            },
        }),
        columnHelper.accessor(
            (row) => {
                const payload = row.payload as Record<string, unknown> | null;
                const label = typeof payload?.label === 'string' ? payload.label : null;
                const notes = typeof payload?.notes === 'string' ? payload.notes : null;
                return [label, notes].filter(Boolean).join(' — ');
            },
            {
                id: 'notes',
                header: ml.columns.notes,
                cell: (info) => <span className="text-gray-500">{info.getValue() || '—'}</span>,
            },
        ),
        columnHelper.display({
            id: 'actions',
            header: t.common.actions,
            cell: (info) => {
                const row = info.row.original;
                // Machine-posted rows (subscription fees, credit-sale payments) own
                // state this screen cannot unwind, so the server refuses to edit
                // them — the buttons say so rather than failing on click.
                const locked = row.editable === false;
                return (
                    <div className="flex items-center justify-end gap-1">
                        <button
                            type="button"
                            onClick={() => openEdit(row)}
                            disabled={locked}
                            title={locked ? em.lockedHint : t.common.edit}
                            aria-label={t.common.edit}
                            className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                        >
                            <Pencil className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setPendingDelete(row)}
                            disabled={locked}
                            title={locked ? em.lockedHint : t.common.delete}
                            aria-label={t.common.delete}
                            className="p-1.5 rounded-md text-danger hover:bg-danger-light transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                );
            },
            enableSorting: false,
            enableColumnFilter: false,
            enableResizing: false,
            size: 100,
        }),
    ], [em.lockedHint, lp.columns, ml.columns, ml.eventType, openEdit, t.common]);

    return (
        <PageShell>
                <PageHeader
                    title={lp.title}
                    subtitle={lp.subtitle}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        'admin',
                        [{ label: m.title, href: '/admin/tenants' }],
                        lp.title,
                    )}
                    actions={(
                        <>
                            <Button
                                variant="secondary"
                                onClick={() => openAdd('fee')}
                                icon={<Receipt className="w-4 h-4" />}
                            >
                                {lp.addFee}
                            </Button>
                            <Button onClick={() => openAdd('payment')} icon={<Plus className="w-4 h-4" />}>
                                {lp.recordPayment}
                            </Button>
                        </>
                    )}
                />

                {error && (
                    <div className="rounded-md border border-danger bg-danger-light px-4 py-3 text-sm font-semibold text-danger-text">
                        {error}
                    </div>
                )}

                <div className="max-w-md">
                    <Select
                        value={tenantFilter}
                        onChange={(e) => setTenantFilter(e.target.value)}
                        aria-label={lp.columns.tenant}
                        className="w-full"
                    >
                        <option value="">{lp.allTenants}</option>
                        {tenants.map((tenant) => (
                            <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
                        ))}
                    </Select>
                </div>

                {isLoading ? (
                    <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white p-8 text-sm text-gray-500">
                        <Loader2 className="w-4 h-4 animate-spin" /> {m.loading}
                    </div>
                ) : (
                    <DataTable
                        tableId="admin-tenant-ledger"
                        columns={columns}
                        data={events}
                        title={lp.title}
                        emptyMessage={ml.noEvents}
                    />
                )}

            <TenantLedgerEntryModal
                open={entryModalOpen}
                tenants={tenants}
                defaultTenantId={tenantFilter}
                defaultKind={entryModalKind}
                entry={editingEntry}
                onClose={() => {
                    setEntryModalOpen(false);
                    setEditingEntry(null);
                }}
                onSuccess={(message) => {
                    toast.success(message);
                    void loadLedger();
                }}
            />

            <ConfirmDialog
                open={pendingDelete !== null}
                title={em.deleteTitle}
                prompt={em.deletePrompt}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                workingLabel={em.deleting}
                loading={deleting}
                danger
                onConfirm={() => void confirmDelete()}
                onCancel={() => setPendingDelete(null)}
            />
        </PageShell>
    );
}
