'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Plus, Printer } from 'lucide-react';
import { DataTable, createdAtColumn } from '@/components/data-table';
import { applyCreatedRangeQuery } from '@/lib/created-range';
import { useBranding } from '@/lib/branding';
import { usePrintHeader } from '@/lib/print/use-print-header';
import { useI18n, formatMessage } from '@/lib/i18n';
import { formatBDT } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import PageHeader from '@/components/ui/compact/PageHeader';
import { Button, ConfirmDialog, PageShell, StatusBadge } from '@/components/ui';
import { AllocateAdvance } from './AllocateAdvance';
import { PaymentDetails } from './PaymentDetails';
import { PaymentEntryForm, type PartiesStatus } from './PaymentEntryForm';
import { NO_METHOD_FILTER, PaymentFilters, type PaymentFilterState } from './PaymentFilters';
import { PaymentKpiStrip } from './PaymentKpiStrip';
import { PaymentPanel } from './PaymentPanel';
import { computePaymentKpis } from './payment-kpis';
import { usePaymentMethods } from './usePaymentMethods';
import type { PartyOption, PartyPayment, PartyPaymentsAdapter } from './types';

/** What the side panel is doing. Payments are held whole so a row filtered out of view can still be shown. */
type PanelState =
    | { kind: 'closed' }
    | { kind: 'create'; from?: PartyPayment }
    | { kind: 'view'; payment: PartyPayment }
    | { kind: 'edit'; payment: PartyPayment }
    | { kind: 'allocate'; payment: PartyPayment };

const columnHelper = createColumnHelper<PartyPayment>();

/** How long a just-saved row stays tinted in the list. */
const FRESH_ROW_MS = 4000;

/**
 * The customer payments and supplier payments page: totals for the period, the
 * list, and a panel for entering, reading and editing payments. Everything
 * party-specific comes from the adapter.
 */
export function PartyPaymentsWorkspace({ adapter }: { adapter: PartyPaymentsAdapter }) {
    const { t, locale } = useI18n();
    const labels = useMemo(() => adapter.labels(t), [adapter, t]);
    const ui = t.partyPayments;
    const { businessName } = useBranding();
    const printHeader = usePrintHeader('MONEY_RECEIPT');
    const searchParams = useSearchParams();
    const presetPartyId = searchParams.get(adapter.partyParam) ?? '';
    const docked = useMediaQuery('(min-width: 1280px)');
    const { methods } = usePaymentMethods();

    const [payments, setPayments] = useState<PartyPayment[]>([]);
    const [loading, setLoading] = useState(true);
    // Tracked apart from the payments: the full party list takes several
    // requests on a large shop, and the form must not read "still loading" or
    // "failed" as "this shop has no customers".
    const [parties, setParties] = useState<PartyOption[]>([]);
    const [partiesStatus, setPartiesStatus] = useState<PartiesStatus>('loading');
    const [filters, setFilters] = useState<PaymentFilterState>({ range: null, partyId: presetPartyId, flow: 'all', method: '' });
    const [panel, setPanel] = useState<PanelState>({ kind: 'closed' });
    // Bumped to give the entry form a fresh mount: a new payment after a save,
    // or a different duplicate.
    const [formKey, setFormKey] = useState(0);
    const [freshId, setFreshId] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<PartyPayment | null>(null);
    const [deleting, setDeleting] = useState(false);

    const loadPayments = useCallback(async () => {
        setLoading(true);
        try {
            const range = applyCreatedRangeQuery(filters.range);
            setPayments(await adapter.listPayments({
                from: range.createdFrom,
                to: range.createdTo,
                partyId: filters.partyId || undefined,
            }));
        } catch (error) {
            console.error('Failed to load payments', error);
            toast.error(labels.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [adapter, filters.range, filters.partyId, labels.loadFailed]);

    // The party list does not depend on the filters, so it loads on its own —
    // a failed payments fetch can never empty the picker.
    const loadParties = useCallback(async (quiet = false) => {
        if (!quiet) setPartiesStatus('loading');
        try {
            setParties(await adapter.listParties());
            setPartiesStatus('ready');
        } catch (error) {
            console.error('Failed to load parties', error);
            if (!quiet) setPartiesStatus('error');
        }
    }, [adapter]);

    useEffect(() => { void loadPayments(); }, [loadPayments]);
    useEffect(() => { void loadParties(); }, [loadParties]);

    useEffect(() => {
        if (presetPartyId) setFilters((prev) => ({ ...prev, partyId: presetPartyId }));
    }, [presetPartyId]);

    useEffect(() => {
        if (searchParams.get('new') === '1') setPanel({ kind: 'create' });
    }, [searchParams]);

    useEffect(() => {
        if (!freshId) return;
        const timer = setTimeout(() => setFreshId(null), FRESH_ROW_MS);
        return () => clearTimeout(timer);
    }, [freshId]);

    // Saving moves a party's due; the next payment's due card has to see it.
    const refreshAfterWrite = useCallback(() => {
        void loadPayments();
        void loadParties(true);
    }, [loadPayments, loadParties]);

    const print = useCallback((payment: PartyPayment) => {
        adapter.print(payment, { businessName: businessName ?? undefined, headerConfig: printHeader.headerConfig, locale, t });
    }, [adapter, businessName, printHeader.headerConfig, locale, t]);

    const printLabel = useCallback(
        (payment: PartyPayment) => (adapter.directionOf(payment) === 'pay' ? labels.printVoucher : labels.printReceipt),
        [adapter, labels],
    );

    const openCreate = useCallback((from?: PartyPayment) => {
        setPanel({ kind: 'create', from });
        setFormKey((k) => k + 1);
    }, []);

    const closePanel = useCallback(() => setPanel({ kind: 'closed' }), []);

    const handleCreated = (saved: PartyPayment, { print: andPrint }: { print: boolean }) => {
        toast.success(formatMessage(ui.saved, { serial: saved.payment_number ?? '' }), {
            action: { label: printLabel(saved), onClick: () => print(saved) },
        });
        if (andPrint) print(saved);
        setFreshId(saved.id);
        // Stay open for the next one, cleared.
        openCreate();
        refreshAfterWrite();
    };

    const handleUpdated = (previous: PartyPayment, saved: PartyPayment) => {
        toast.success(labels.paymentUpdated);
        setPanel({ kind: 'view', payment: { ...previous, ...saved } });
        refreshAfterWrite();
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await adapter.remove(deleteTarget.id);
            toast.success(labels.paymentDeleted);
            setPanel((current) => ('payment' in current && current.payment.id === deleteTarget.id ? { kind: 'closed' } : current));
            setDeleteTarget(null);
            refreshAfterWrite();
        } catch (error: unknown) {
            toast.error(error instanceof Error && error.message ? error.message : labels.deleteFailed);
        } finally {
            setDeleting(false);
        }
    };

    const visible = useMemo(() => payments.filter((payment) => {
        if (filters.flow !== 'all' && adapter.directionOf(payment) !== filters.flow) return false;
        if (!filters.method) return true;
        if (filters.method === NO_METHOD_FILTER) return !payment.payment_method_name;
        return payment.payment_method_name === filters.method;
    }), [payments, filters.flow, filters.method, adapter]);

    const kpis = useMemo(
        () => computePaymentKpis(payments, adapter.directionOf, adapter.primary),
        [payments, adapter],
    );

    const panelPayment = 'payment' in panel ? panel.payment : null;
    // The list is refetched after every write; show the panel the fresh copy.
    const current = panelPayment ? payments.find((p) => p.id === panelPayment.id) ?? panelPayment : null;
    const panelOpen = panel.kind !== 'closed';
    const narrowTable = docked && panelOpen;

    const columns: ColumnDef<PartyPayment, unknown>[] = useMemo(() => {
        const list: ColumnDef<PartyPayment, unknown>[] = [
            columnHelper.accessor('payment_number', {
                header: labels.columns.serial,
                cell: (info) => <span className="font-mono text-xs font-semibold text-gray-700">{info.getValue() || '—'}</span>,
                size: 110,
            }),
            // A payment can be backdated, so this is when the money changed
            // hands rather than when the row was keyed in.
            createdAtColumn(columnHelper, { header: labels.columns.dateTime, locale }) as ColumnDef<PartyPayment, unknown>,
            columnHelper.accessor((row) => adapter.partyOf(row)?.name ?? '—', {
                id: 'party',
                header: labels.party,
                cell: (info) => {
                    const party = adapter.partyOf(info.row.original);
                    return (
                        <div className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-gray-900">{party?.name ?? '—'}</span>
                            {party?.phone ? <span className="block text-xs text-gray-400">{party.phone}</span> : null}
                        </div>
                    );
                },
                size: 190,
            }),
            columnHelper.accessor((row) => row.payment_method_name ?? '', {
                id: 'method',
                header: ui.method,
                cell: (info) => (info.getValue()
                    ? <StatusBadge tone="neutral">{String(info.getValue())}</StatusBadge>
                    : <span className="text-xs text-gray-300">—</span>),
                size: 110,
            }),
            columnHelper.accessor((row) => Number(row.amount), {
                id: 'amount',
                header: labels.columns.amount,
                cell: (info) => {
                    const payment = info.row.original;
                    const isIn = adapter.directionOf(payment) === 'receive';
                    const discount = Number(payment.discount_amount ?? 0);
                    return (
                        <div>
                            <span className={`text-sm font-bold tabular-nums ${isIn ? 'text-emerald-600' : 'text-danger'}`}>
                                {isIn ? '+' : '−'}{formatBDT(Number(payment.amount))}
                            </span>
                            {discount > 0 ? (
                                <span className="block text-xs text-gray-500">{labels.discount.label}: {formatBDT(discount)}</span>
                            ) : null}
                        </div>
                    );
                },
                size: 130,
            }),
        ];
        if (!narrowTable) {
            list.push(
                columnHelper.accessor((row) => Number(row.balance_after ?? 0), {
                    id: 'balance_after',
                    header: ui.dueAfter,
                    cell: (info) => {
                        const value = Number(info.row.original.balance_after ?? 0);
                        return value < -0.005
                            ? <span className="text-sm tabular-nums text-emerald-700">{ui.advance} {formatBDT(-value)}</span>
                            : <span className="text-sm tabular-nums text-gray-700">{formatBDT(value)}</span>;
                    },
                    meta: { hideOnMobile: true },
                    size: 120,
                }),
                columnHelper.accessor((row) => row.creator?.name ?? '—', {
                    id: 'recordedBy',
                    header: labels.columns.recordedBy,
                    cell: (info) => <span className="text-sm text-gray-600">{info.getValue()}</span>,
                    meta: { hideOnMobile: true },
                    size: 130,
                }),
            );
        }
        list.push(columnHelper.display({
            id: 'actions',
            header: '',
            cell: ({ row }) => (
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => print(row.original)}
                    aria-label={printLabel(row.original)}
                    title={printLabel(row.original)}
                >
                    <Printer className="h-4 w-4" />
                </Button>
            ),
            enableSorting: false,
            size: 48,
        }));
        return list;
    }, [adapter, labels, ui, locale, narrowTable, print, printLabel]);

    const panelTitle = (() => {
        switch (panel.kind) {
            case 'create': return panel.from ? labels.duplicatePayment : labels.newPayment;
            case 'view': return labels.viewPayment;
            case 'edit': return labels.editPayment;
            case 'allocate': return labels.allocation?.allocateModalTitle ?? labels.viewPayment;
            default: return '';
        }
    })();
    const panelSubtitle = panel.kind === 'create'
        ? panel.from?.payment_number ?? undefined
        : panel.kind === 'allocate'
            ? adapter.partyOf(panel.payment)?.name
            : current?.payment_number ?? undefined;

    return (
        <PageShell>
            <PageHeader
                title={labels.title}
                subtitle={labels.subtitle}
                breadcrumbs={adapter.breadcrumbs(t, labels.title)}
                actions={(
                    <Button variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => openCreate()}>
                        {labels.newPayment}
                    </Button>
                )}
            />

            <PaymentKpiStrip kpis={kpis} primary={adapter.primary} labels={labels} ui={ui} />

            <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1 space-y-3">
                    <PaymentFilters
                        value={filters}
                        onChange={setFilters}
                        parties={parties}
                        partiesLoading={partiesStatus === 'loading'}
                        methods={methods}
                        labels={labels}
                        ui={ui}
                    />
                    <DataTable
                        tableId={adapter.tableId}
                        title={labels.listTitle}
                        data={visible}
                        columns={columns}
                        isLoading={loading}
                        getRowId={(row) => row.id}
                        searchPlaceholder={labels.searchPayments}
                        emptyMessage={labels.noPayments}
                        onRowClick={(row) => setPanel({ kind: 'view', payment: row })}
                        rowClassName={(row) => (row.id === current?.id
                            ? 'bg-blue-50/70'
                            : row.id === freshId ? 'bg-emerald-50' : undefined)}
                    />
                </div>

                {panelOpen ? (
                    <PaymentPanel
                        docked={docked}
                        title={panelTitle}
                        subtitle={panelSubtitle}
                        onClose={closePanel}
                        closeLabel={ui.closePanel}
                    >
                        {panel.kind === 'create' ? (
                            <PaymentEntryForm
                                key={`create-${formKey}`}
                                adapter={adapter}
                                labels={labels}
                                ui={ui}
                                common={t.common}
                                mode="create"
                                payment={panel.from}
                                presetPartyId={presetPartyId}
                                parties={parties}
                                partiesStatus={partiesStatus}
                                onRetryParties={() => void loadParties()}
                                methods={methods}
                                onSaved={handleCreated}
                                onCancel={closePanel}
                            />
                        ) : panel.kind === 'edit' && current ? (
                            <PaymentEntryForm
                                key={`edit-${current.id}`}
                                adapter={adapter}
                                labels={labels}
                                ui={ui}
                                common={t.common}
                                mode="edit"
                                payment={current}
                                parties={parties}
                                partiesStatus={partiesStatus}
                                onRetryParties={() => void loadParties()}
                                methods={methods}
                                onSaved={(saved) => handleUpdated(current, saved)}
                                onCancel={() => setPanel({ kind: 'view', payment: current })}
                                onDuplicate={(payment) => openCreate(payment)}
                            />
                        ) : panel.kind === 'allocate' && current ? (
                            <AllocateAdvance
                                adapter={adapter}
                                payment={current}
                                labels={labels}
                                ui={ui}
                                common={t.common}
                                onDone={() => {
                                    toast.success(labels.allocation?.allocateSuccess ?? labels.paymentUpdated);
                                    setPanel({ kind: 'view', payment: current });
                                    refreshAfterWrite();
                                }}
                                onCancel={() => setPanel({ kind: 'view', payment: current })}
                            />
                        ) : panel.kind === 'view' && current ? (
                            <PaymentDetails
                                adapter={adapter}
                                payment={current}
                                labels={labels}
                                ui={ui}
                                common={t.common}
                                locale={locale}
                                onPrint={() => print(current)}
                                onEdit={() => setPanel({ kind: 'edit', payment: current })}
                                onDuplicate={() => openCreate(current)}
                                onDelete={() => setDeleteTarget(current)}
                                onAllocate={adapter.allocate ? () => setPanel({ kind: 'allocate', payment: current }) : undefined}
                            />
                        ) : null}
                    </PaymentPanel>
                ) : null}
            </div>

            <ConfirmDialog
                open={!!deleteTarget}
                title={deleteTarget?.payment_number ? `${t.common.delete} ${deleteTarget.payment_number}` : t.common.delete}
                prompt={labels.deleteConfirm}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                loading={deleting}
                danger
                onConfirm={() => void confirmDelete()}
                onCancel={() => setDeleteTarget(null)}
            />
        </PageShell>
    );
}
