'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { ArrowDownLeft, ArrowUpRight, BadgePercent, Hash, Plus, Printer, Scale, Wallet } from 'lucide-react';
import { DataTable, createdAtColumn, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import type { NumberCondition } from '@/lib/number-condition';
import { useBranding } from '@/lib/branding';
import { usePrintHeader } from '@/lib/print/use-print-header';
import { useSalePrintPrefs } from '@/lib/hooks/useSalePrintPrefs';
import { useI18n, formatMessage } from '@/lib/i18n';
import { formatBDT } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import PageHeader from '@/components/ui/compact/PageHeader';
import { BranchFilter, Button, ConfirmDialog, PageShell, StatusBadge } from '@/components/ui';
import { AllocateAdvance } from './AllocateAdvance';
import { PaymentDetails } from './PaymentDetails';
import { PaymentEntryForm, type PartiesStatus } from './PaymentEntryForm';
import { PaymentPanel } from './PaymentPanel';
import { computePaymentKpis } from './payment-kpis';
import { usePaymentMethods } from './usePaymentMethods';
import type { MoneyFlow, PartyOption, PartyPayment, PartyPaymentsAdapter } from './types';

/** The Method chip's value for a payment saved without a method. */
export const NO_METHOD_FILTER = '__none__';

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
    const { paperSize } = useSalePrintPrefs();
    const searchParams = useSearchParams();
    const presetPartyId = searchParams.get(adapter.partyParam) ?? '';
    const docked = useMediaQuery('(min-width: 1280px)');
    // Payments belong to their party's branch; the page follows the header
    // branch, or the one picked here.
    const branch = useBranchScope();
    // The method filter lists what the page's branch offers; the entry form
    // fetches its own only when its party sits at another branch.
    const { methods } = usePaymentMethods(branch.apiStoreId);

    const [payments, setPayments] = useState<PartyPayment[]>([]);
    const [loading, setLoading] = useState(true);
    // Tracked apart from the payments: the full party list takes several
    // requests on a large shop, and the form must not read "still loading" or
    // "failed" as "this shop has no customers".
    const [parties, setParties] = useState<PartyOption[]>([]);
    const [partiesStatus, setPartiesStatus] = useState<PartiesStatus>('loading');
    // The date and a single party go to the server; the rest narrow the
    // loaded period here, so rows and strip always describe the same payments.
    const [range, setRange] = useState<CreatedRange | null>(null);
    const [partyIds, setPartyIds] = useState<string[]>(presetPartyId ? [presetPartyId] : []);
    const [flows, setFlows] = useState<string[]>([]);
    const [methodNames, setMethodNames] = useState<string[]>([]);
    const [amountFilter, setAmountFilter] = useState<NumberCondition | null>(null);
    const [recorders, setRecorders] = useState<string[]>([]);
    const [search, setSearch] = useState('');
    const [panel, setPanel] = useState<PanelState>({ kind: 'closed' });
    // Bumped to give the entry form a fresh mount: a new payment after a save,
    // or a different duplicate.
    const [formKey, setFormKey] = useState(0);
    const [freshId, setFreshId] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<PartyPayment | null>(null);
    const [deleting, setDeleting] = useState(false);

    const branchReady = branch.ready;
    const branchStoreId = branch.apiStoreId;
    // One party is narrowed by the server; several are narrowed here.
    const serverPartyId = partyIds.length === 1 && partyIds[0] ? partyIds[0] : undefined;
    const loadPayments = useCallback(async () => {
        if (!branchReady) return;
        setLoading(true);
        try {
            const period = applyCreatedRangeQuery(range);
            setPayments(await adapter.listPayments({
                from: period.createdFrom,
                to: period.createdTo,
                partyId: serverPartyId,
                storeId: branchStoreId,
            }));
        } catch (error) {
            // The server refused the picked branch: say so and go back to the header's.
            if (handleBranchForbidden(error, branch, t.dashboardLayout.branchFilterForbidden)) return;
            console.error('Failed to load payments', error);
            toast.error(labels.loadFailed);
        } finally {
            setLoading(false);
        }
        // `branch` is read for its reset only; its fields that matter are deps.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [adapter, range, serverPartyId, labels.loadFailed, branchReady, branchStoreId, t]);

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
        if (presetPartyId) setPartyIds([presetPartyId]);
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

    const print = useCallback(async (payment: PartyPayment) => {
        // The payment's branch picks the letterhead, as a sale's does on its invoice.
        const header = await printHeader.resolve(payment.store_id ?? undefined);
        adapter.print(payment, { businessName: businessName ?? undefined, headerConfig: header.headerConfig, paperSize, locale, t });
    }, [adapter, businessName, printHeader, paperSize, locale, t]);

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
            action: { label: printLabel(saved), onClick: () => void print(saved) },
        });
        if (andPrint) void print(saved);
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
        const party = adapter.partyOf(payment);
        if (!matchesAnyOf(partyIds, party?.id)) return false;
        if (!matchesAnyOf(flows, adapter.directionOf(payment))) return false;
        if (!matchesAnyOf(methodNames, payment.payment_method_name || NO_METHOD_FILTER)) return false;
        if (!matchesAnyOf(recorders, payment.creator?.id)) return false;
        if (!matchesNumberCondition(Number(payment.amount || 0), amountFilter)) return false;
        return matchesSearch(
            search,
            payment.payment_number,
            party?.name,
            party?.phone,
            party?.customer_code,
            payment.payment_method_name,
            payment.notes,
            payment.creator?.name,
        );
    }), [payments, partyIds, flows, methodNames, recorders, amountFilter, search, adapter]);

    // The strip follows the chips and the search box, as the rows do.
    const kpis = useMemo(
        () => computePaymentKpis(visible, adapter.directionOf, adapter.primary),
        [visible, adapter],
    );

    const listUi = ui.listUi;

    // Everyone who recorded a payment in the loaded period.
    const recorderOptions = useMemo(() => {
        const seen = new Map<string, string>();
        for (const payment of payments) {
            if (payment.creator && !seen.has(payment.creator.id)) seen.set(payment.creator.id, payment.creator.name);
        }
        return [...seen].map(([value, label]) => ({ value, label }));
    }, [payments]);

    // The branch's methods, plus any an older payment carries that the branch no longer offers.
    const methodOptions = useMemo(() => {
        const names = new Set(methods.map((method) => method.name));
        for (const payment of payments) if (payment.payment_method_name) names.add(payment.payment_method_name);
        return [
            ...[...names].map((name) => ({ value: name, label: name })),
            { value: NO_METHOD_FILTER, label: ui.methodNotRecorded },
        ];
    }, [methods, payments, ui.methodNotRecorded]);

    const listFilters = useMemo<ListFilter[]>(() => {
        const flowOptions: { value: MoneyFlow; label: string }[] = [
            { value: 'receive', label: labels.receive },
            { value: 'pay', label: labels.pay },
        ];
        return [
            {
                id: 'date',
                type: 'date-range',
                label: labels.columns.dateTime,
                value: range,
                onChange: setRange,
                operators: true,
            },
            {
                id: 'party',
                type: 'multi-select',
                label: labels.party,
                value: partyIds,
                onChange: setPartyIds,
                options: parties.map((party) => ({ value: party.id, label: party.name })),
                searchable: true,
            },
            {
                id: 'direction',
                type: 'multi-select',
                label: labels.direction,
                value: flows,
                onChange: setFlows,
                options: adapter.primary === 'receive' ? flowOptions : [...flowOptions].reverse(),
            },
            {
                id: 'method',
                type: 'multi-select',
                label: ui.method,
                value: methodNames,
                onChange: setMethodNames,
                options: methodOptions,
            },
            {
                id: 'amount',
                type: 'number',
                label: labels.columns.amount,
                value: amountFilter,
                onChange: setAmountFilter,
                money: true,
            },
            {
                id: 'recordedBy',
                type: 'multi-select',
                label: labels.columns.recordedBy,
                value: recorders,
                onChange: setRecorders,
                options: recorderOptions,
                more: true,
            },
        ];
    }, [adapter.primary, labels, ui, range, partyIds, parties, flows, methodNames, methodOptions, amountFilter, recorders, recorderOptions]);

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const entries = (count: number) => formatMessage(ui.entries, { count });
        const percent = (part: number, whole: number) => (whole > 0
            ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(part / whole)
            : undefined);
        const receivePrimary = adapter.primary === 'receive';
        const primaryTotal = receivePrimary ? kpis.inTotal : kpis.outTotal;
        const top = kpis.byMethod[0];
        const inTile: ListStat = {
            id: 'in',
            icon: <ArrowDownLeft aria-hidden />,
            label: labels.kpiIn,
            value: money(kpis.inTotal),
            hint: entries(kpis.inCount),
        };
        // Money given back to a customer is the one figure here to watch;
        // paying a supplier is that page's ordinary business.
        const outTile: ListStat = {
            id: 'out',
            icon: <ArrowUpRight aria-hidden />,
            label: labels.kpiOut,
            value: money(kpis.outTotal),
            hint: entries(kpis.outCount),
            tone: receivePrimary && kpis.outTotal > 0 ? 'danger' : 'default',
        };
        const items: ListStat[] = [
            { id: 'count', icon: <Hash aria-hidden />, label: listUi.payments, value: visible.length.toLocaleString(locale) },
            ...(receivePrimary ? [inTile, outTile] : [outTile, inTile]),
            {
                id: 'discount',
                icon: <BadgePercent aria-hidden />,
                label: labels.discount.label,
                value: money(kpis.discountTotal),
                hint: kpis.discountCount ? entries(kpis.discountCount) : undefined,
            },
            { id: 'net', icon: <Scale aria-hidden />, label: labels.kpiNet, value: money(kpis.net) },
            {
                id: 'topMethod',
                icon: <Wallet aria-hidden />,
                label: listUi.topMethod,
                value: top ? top.name ?? ui.methodNotRecorded : '—',
                hint: top ? percent(top.amount, primaryTotal) : undefined,
            },
        ];
        return { items, loading: loading && payments.length === 0, label: listUi.statsLabel };
    }, [kpis, visible.length, loading, payments.length, adapter.primary, labels, ui, listUi, locale]);

    const panelPayment = 'payment' in panel ? panel.payment : null;
    // The list is refetched after every write; show the panel the fresh copy.
    const current = panelPayment ? payments.find((p) => p.id === panelPayment.id) ?? panelPayment : null;
    const panelOpen = panel.kind !== 'closed';
    const narrowTable = docked && panelOpen;

    const columns: ColumnDef<PartyPayment, unknown>[] = useMemo(() => {
        const list: ColumnDef<PartyPayment, unknown>[] = [
            columnHelper.accessor('payment_number', {
                header: labels.columns.serial,
                cell: (info) => <span className="font-mono text-xs">{info.getValue() || '—'}</span>,
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
                            <span className="block truncate font-medium text-gray-900">{party?.name ?? '—'}</span>
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
                            <span className={isIn ? 'text-emerald-700' : 'text-red-600'}>
                                {isIn ? '+' : '−'}{formatBDT(Number(payment.amount), { locale })}
                            </span>
                            {discount > 0 ? (
                                <span className="block text-xs text-gray-500">{labels.discount.label}: {formatBDT(discount, { locale })}</span>
                            ) : null}
                        </div>
                    );
                },
                meta: { align: 'end' },
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
                            ? <span className="text-emerald-700">{ui.advance} {formatBDT(-value, { locale })}</span>
                            : formatBDT(value, { locale });
                    },
                    meta: { align: 'end', hideOnMobile: true },
                    size: 120,
                }),
                columnHelper.accessor((row) => row.creator?.name ?? '—', {
                    id: 'recordedBy',
                    header: labels.columns.recordedBy,
                    cell: (info) => info.getValue(),
                    meta: { hideOnMobile: true },
                    size: 130,
                }),
            );
        }
        list.push(columnHelper.display({
            id: 'actions',
            header: '',
            cell: ({ row }) => (
                <RowActions>
                    <RowActionButton
                        icon={<Printer />}
                        label={printLabel(row.original)}
                        onClick={(event) => {
                            // The row opens the payment; the button only prints it.
                            event.stopPropagation();
                            void print(row.original);
                        }}
                    />
                </RowActions>
            ),
            enableSorting: false,
            enableColumnFilter: false,
            enableResizing: false,
            size: 56,
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
                    <>
                        <BranchFilter scope={branch} />
                        <Button variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => openCreate()}>
                            {labels.newPayment}
                        </Button>
                    </>
                )}
            />

            <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                    <DataTable
                        tableId={adapter.tableId}
                        title={labels.listTitle}
                        data={visible}
                        columns={columns}
                        isLoading={loading}
                        getRowId={(row) => row.id}
                        searchPlaceholder={labels.searchPayments}
                        searchValue={search}
                        onSearchChange={setSearch}
                        filters={listFilters}
                        filterLayout="row"
                        stats={stats}
                        enableColumnFilters={false}
                        viewOptions
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
                                methodsStoreId={branch.apiStoreId}
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
                                methodsStoreId={branch.apiStoreId}
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
                                onPrint={() => void print(current)}
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
