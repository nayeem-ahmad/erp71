'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { AlarmClock, Ban, CheckCircle2, Clock, Pencil, Plus, Truck, XCircle } from 'lucide-react';
import { DataTable, createdAtColumn, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import {
    Button,
    ConfirmDialog,
    Field,
    Input,
    PageShell,
    Select,
    StatusBadge,
    Textarea,
    buttonClassName,
    type StatusBadgeTone,
} from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { api, type DeliveryListFilterParams, type DeliveryListSummary } from '@/lib/api';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import { formatDateTime } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import { useServerList } from '@/hooks/useServerList';
import { useListSummary } from '@/hooks/useListSummary';

interface DeliveryOrder {
    id: string;
    saleId: string | null;
    customerName: string;
    customerPhone: string | null;
    deliveryAddress: string;
    driverName: string | null;
    driverPhone: string | null;
    status: string;
    notes?: string | null;
    scheduledAt: string | null;
    deliveredAt: string | null;
    created_at: string;
    sale?: { id: string; serial_number: string } | null;
}

const STATUSES = ['PENDING', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'CANCELLED'] as const;
type DeliveryStatus = (typeof STATUSES)[number];

/** Still on its way: can be marked delivered or called off. */
const OPEN_STATUSES = new Set<string>(['PENDING', 'IN_TRANSIT']);

const STATUS_TONE: Record<DeliveryStatus, StatusBadgeTone> = {
    PENDING: 'warning',
    IN_TRANSIT: 'info',
    DELIVERED: 'success',
    FAILED: 'danger',
    CANCELLED: 'neutral',
};

/** The Driver chip's value for a delivery with nobody on it, as the server reads it. */
const NO_DRIVER = 'none';

const EMPTY_FORM = {
    saleId: '',
    customerName: '',
    customerPhone: '',
    deliveryAddress: '',
    driverName: '',
    driverPhone: '',
    notes: '',
    scheduledAt: '',
    status: 'PENDING',
};

const columnHelper = createColumnHelper<DeliveryOrder>();

function isOverdue(order: DeliveryOrder, now: number): boolean {
    return OPEN_STATUSES.has(order.status) && !!order.scheduledAt && new Date(order.scheduledAt).getTime() < now;
}

export default function DeliveryPage() {
    const { t, locale } = useI18n();
    const copy = t.delivery;
    const ui = copy.listUi;

    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [statuses, setStatuses] = useState<string[]>([]);
    const [statusExclude, setStatusExclude] = useState(false);
    const [drivers, setDrivers] = useState<string[]>([]);
    const [scheduledRange, setScheduledRange] = useState<CreatedRange | null>(null);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [driverNames, setDriverNames] = useState<string[]>([]);

    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');
    const [pendingCancel, setPendingCancel] = useState<DeliveryOrder | null>(null);
    const [cancelling, setCancelling] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        api.getDeliveryDrivers()
            .then((names) => setDriverNames(Array.isArray(names) ? names : []))
            .catch(() => setDriverNames([]));
    }, []);

    const filterParams = useMemo<DeliveryListFilterParams>(() => {
        const scheduled = applyCreatedRangeQuery(scheduledRange);
        return {
            search: debouncedSearch || undefined,
            status: statuses.length ? statuses.join(',') : undefined,
            statusExclude,
            drivers,
            dateFrom: scheduled.createdFrom,
            dateTo: scheduled.createdTo,
            ...applyCreatedRangeQuery(createdRange),
        };
    }, [debouncedSearch, statuses, statusExclude, drivers, scheduledRange, createdRange]);

    const { items: orders, loading, error: listError, serverPagination, reload } = useServerList<DeliveryOrder>({
        tableId: 'delivery-orders',
        initialSort: { id: 'created_at', desc: true },
        deps: [filterParams],
        fetch: (params) => api.getDeliveriesList({ ...params, ...filterParams }),
    });

    useEffect(() => {
        if (listError) toast.error(copy.loadFailed);
    }, [listError, copy.loadFailed]);

    const { summary, loading: summaryLoading, reload: reloadSummary } = useListSummary<
        DeliveryListFilterParams,
        DeliveryListSummary
    >({ fetch: api.getDeliveriesListSummary, params: filterParams });

    const refresh = () => {
        void reload();
        reloadSummary();
    };

    const statusLabel = (status: string) => {
        const key = ({
            PENDING: 'pending',
            IN_TRANSIT: 'inTransit',
            DELIVERED: 'delivered',
            FAILED: 'failed',
            CANCELLED: 'cancelled',
        } as const)[status as DeliveryStatus];
        return key ? copy.statuses[key] : status;
    };

    function openCreate() {
        setEditingId(null);
        setForm(EMPTY_FORM);
        setFormError('');
        setShowModal(true);
    }

    function openEdit(order: DeliveryOrder) {
        setEditingId(order.id);
        setForm({
            saleId: order.saleId ?? '',
            customerName: order.customerName,
            customerPhone: order.customerPhone ?? '',
            deliveryAddress: order.deliveryAddress,
            driverName: order.driverName ?? '',
            driverPhone: order.driverPhone ?? '',
            notes: order.notes ?? '',
            scheduledAt: order.scheduledAt ? order.scheduledAt.slice(0, 16) : '',
            status: order.status,
        });
        setFormError('');
        setShowModal(true);
    }

    async function handleSave() {
        if (!form.customerName.trim() || !form.deliveryAddress.trim()) {
            setFormError(ui.form.required);
            return;
        }
        setSaving(true);
        setFormError('');
        try {
            const body = {
                customerName: form.customerName,
                customerPhone: form.customerPhone || undefined,
                deliveryAddress: form.deliveryAddress,
                driverName: form.driverName || undefined,
                driverPhone: form.driverPhone || undefined,
                notes: form.notes || undefined,
                scheduledAt: form.scheduledAt || undefined,
                ...(!editingId && form.saleId ? { saleId: form.saleId } : {}),
                ...(editingId ? { status: form.status } : {}),
            };
            if (editingId) await api.updateDelivery(editingId, body);
            else await api.createDelivery(body);
            setShowModal(false);
            toast.success(ui.saved);
            refresh();
        } catch (e: any) {
            setFormError(e?.message || ui.saveFailed);
        } finally {
            setSaving(false);
        }
    }

    async function markDelivered(order: DeliveryOrder) {
        try {
            await api.updateDelivery(order.id, { status: 'DELIVERED' });
            toast.success(formatMessage(ui.markedDelivered, { customer: order.customerName }));
            refresh();
        } catch (e: any) {
            toast.error(e?.message || ui.saveFailed);
        }
    }

    async function confirmCancel() {
        if (!pendingCancel) return;
        setCancelling(true);
        try {
            await api.cancelDelivery(pendingCancel.id);
            setPendingCancel(null);
            toast.success(ui.cancelled);
            refresh();
        } catch (e: any) {
            toast.error(e?.message || copy.cancelFailed);
        } finally {
            setCancelling(false);
        }
    }

    const columns: ColumnDef<DeliveryOrder, any>[] = useMemo(() => {
        const now = Date.now();
        return [
            columnHelper.accessor('customerName', {
                header: copy.columns.customer,
                cell: (info) => {
                    const order = info.row.original;
                    return (
                        <div className="min-w-0">
                            <span className="block truncate font-medium text-gray-900">{order.customerName}</span>
                            {order.customerPhone ? <span className="block text-xs text-gray-500">{order.customerPhone}</span> : null}
                        </div>
                    );
                },
                size: 180,
            }),
            columnHelper.accessor('deliveryAddress', {
                header: copy.columns.address,
                enableSorting: false,
                cell: (info) => (
                    <span className="block truncate" title={info.getValue()}>
                        {info.getValue()}
                    </span>
                ),
                size: 220,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => row.driverName ?? '', {
                id: 'driver',
                header: copy.columns.driver,
                cell: (info) => {
                    const order = info.row.original;
                    if (!order.driverName) return <span className="text-gray-400">{ui.unassigned}</span>;
                    return (
                        <div className="min-w-0">
                            <span className="block truncate">{order.driverName}</span>
                            {order.driverPhone ? <span className="block text-xs text-gray-500">{order.driverPhone}</span> : null}
                        </div>
                    );
                },
                size: 150,
            }),
            columnHelper.accessor('status', {
                header: t.common.status,
                cell: (info) => (
                    <StatusBadge tone={STATUS_TONE[info.getValue() as DeliveryStatus] ?? 'neutral'}>
                        {statusLabel(info.getValue())}
                    </StatusBadge>
                ),
                size: 120,
            }),
            columnHelper.accessor('scheduledAt', {
                header: copy.columns.scheduled,
                cell: (info) => {
                    const order = info.row.original;
                    if (!order.scheduledAt) return <span className="text-gray-400">—</span>;
                    return isOverdue(order, now) ? (
                        <span className="text-amber-700" title={ui.overdueHint}>{formatDateTime(order.scheduledAt, locale)}</span>
                    ) : (
                        formatDateTime(order.scheduledAt, locale)
                    );
                },
                size: 160,
            }),
            columnHelper.accessor((row) => row.sale?.serial_number ?? '', {
                id: 'sale',
                header: ui.sale,
                enableSorting: false,
                cell: (info) => {
                    const sale = info.row.original.sale;
                    return sale ? (
                        <Link href={routes.sales.detail(sale.id)} className="text-blue-600 hover:underline">
                            {sale.serial_number}
                        </Link>
                    ) : (
                        <span className="text-gray-400">—</span>
                    );
                },
                size: 140,
                meta: { hideOnMobile: true },
            }),
            createdAtColumn(columnHelper, { header: t.common.createdAt, locale, enableColumnFilter: false }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: ({ row }) => {
                    const order = row.original;
                    const open = OPEN_STATUSES.has(order.status);
                    return (
                        <RowActions>
                            <RowActionButton icon={<Pencil />} label={t.common.edit} onClick={() => openEdit(order)} />
                            {open ? (
                                <RowActionButton
                                    icon={<CheckCircle2 />}
                                    label={ui.markDelivered}
                                    intent="success"
                                    onClick={() => void markDelivered(order)}
                                />
                            ) : null}
                            {open ? (
                                <RowActionButton
                                    icon={<Ban />}
                                    label={ui.cancelDelivery}
                                    intent="danger"
                                    onClick={() => setPendingCancel(order)}
                                />
                            ) : null}
                        </RowActions>
                    );
                },
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 120,
            }),
        ];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [t, locale]);

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'scheduled',
            type: 'date-range',
            label: copy.columns.scheduled,
            value: scheduledRange,
            onChange: setScheduledRange,
            operators: true,
        },
        {
            id: 'status',
            type: 'multi-select',
            label: t.common.status,
            value: statuses,
            onChange: setStatuses,
            options: STATUSES.map((status) => ({ value: status, label: statusLabel(status) })),
            exclude: { value: statusExclude, onChange: setStatusExclude },
        },
        {
            id: 'driver',
            type: 'multi-select',
            label: copy.columns.driver,
            value: drivers,
            onChange: setDrivers,
            options: [
                { value: NO_DRIVER, label: ui.unassigned },
                ...driverNames.map((name) => ({ value: name, label: name })),
            ],
        },
        {
            id: 'created',
            type: 'date-range',
            label: t.common.createdAt,
            value: createdRange,
            onChange: setCreatedRange,
            operators: true,
            more: true,
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [t, scheduledRange, statuses, statusExclude, drivers, driverNames, createdRange]);

    const stats = useMemo(() => {
        const s = ui.stats;
        const dash = '—';
        const count = (value: number | undefined) => (summary && value !== undefined ? value.toLocaleString(locale) : dash);
        const closedBadly = summary ? summary.failed + summary.cancelled : 0;
        const items: ListStat[] = [
            { id: 'count', icon: <Truck aria-hidden />, label: s.deliveries, value: count(summary?.count) },
            {
                id: 'pending',
                icon: <Clock aria-hidden />,
                label: s.pending,
                value: count(summary?.pending),
                hint: summary && summary.unassigned > 0 ? formatMessage(s.unassigned, { count: summary.unassigned }) : undefined,
            },
            { id: 'inTransit', icon: <Truck aria-hidden />, label: s.inTransit, value: count(summary?.inTransit) },
            {
                id: 'delivered',
                icon: <CheckCircle2 aria-hidden />,
                label: s.delivered,
                value: count(summary?.delivered),
                hint: summary && summary.count > 0
                    ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(summary.delivered / summary.count)
                    : undefined,
            },
            {
                id: 'overdue',
                icon: <AlarmClock aria-hidden />,
                label: s.overdue,
                value: count(summary?.overdue),
                tone: summary && summary.overdue > 0 ? 'warning' : 'default',
            },
            {
                id: 'failed',
                icon: <XCircle aria-hidden />,
                label: s.failed,
                value: summary ? closedBadly.toLocaleString(locale) : dash,
                hint: summary && summary.cancelled > 0 ? formatMessage(s.cancelledHint, { count: summary.cancelled }) : undefined,
                tone: summary && summary.failed > 0 ? 'danger' : 'default',
            },
        ];
        return { items, loading: summaryLoading && !summary, label: ui.statsLabel };
    }, [summary, summaryLoading, locale, ui]);

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    copy.title,
                    'sales',
                )}
                actions={(
                    <button type="button" onClick={openCreate} className={buttonClassName()}>
                        <Plus className="h-4 w-4" />
                        {copy.newDelivery}
                    </button>
                )}
            />

            <DataTable<DeliveryOrder>
                tableId="delivery-orders"
                columns={columns}
                data={orders}
                title={copy.title}
                isLoading={loading}
                emptyMessage={copy.emptyMessage}
                emptyIcon={<Truck className="h-16 w-16 text-gray-200" />}
                searchPlaceholder={ui.searchPlaceholder}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                serverPagination={serverPagination}
            />

            <ConfirmDialog
                open={pendingCancel !== null}
                title={ui.cancelDelivery}
                prompt={copy.cancelConfirm}
                confirmLabel={ui.cancelDelivery}
                cancelLabel={t.common.close}
                loading={cancelling}
                danger
                onConfirm={() => void confirmCancel()}
                onCancel={() => { if (!cancelling) setPendingCancel(null); }}
            />

            {showModal && (
                <ModalShell size="md" onBackdropClick={() => setShowModal(false)}>
                    <ModalHeader
                        title={editingId ? copy.editDelivery : copy.newDelivery}
                        onClose={() => setShowModal(false)}
                    />
                    <div className="space-y-4 overflow-y-auto p-4">
                        {formError ? <p role="alert" className="text-sm text-red-600">{formError}</p> : null}

                        {!editingId && (
                            <Field label={ui.form.saleId} htmlFor="delivery-sale">
                                <Input
                                    id="delivery-sale"
                                    value={form.saleId}
                                    onChange={(e) => setForm((f) => ({ ...f, saleId: e.target.value }))}
                                    placeholder={copy.placeholders.saleId}
                                />
                            </Field>
                        )}

                        <Field label={ui.form.customerName} required htmlFor="delivery-customer">
                            <Input
                                id="delivery-customer"
                                value={form.customerName}
                                onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
                            />
                        </Field>

                        <Field label={ui.form.customerPhone} htmlFor="delivery-phone">
                            <Input
                                id="delivery-phone"
                                value={form.customerPhone}
                                onChange={(e) => setForm((f) => ({ ...f, customerPhone: e.target.value }))}
                            />
                        </Field>

                        <Field label={ui.form.deliveryAddress} required htmlFor="delivery-address">
                            <Textarea
                                id="delivery-address"
                                rows={2}
                                value={form.deliveryAddress}
                                onChange={(e) => setForm((f) => ({ ...f, deliveryAddress: e.target.value }))}
                            />
                        </Field>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Field label={ui.form.driverName} htmlFor="delivery-driver">
                                <Input
                                    id="delivery-driver"
                                    value={form.driverName}
                                    onChange={(e) => setForm((f) => ({ ...f, driverName: e.target.value }))}
                                />
                            </Field>
                            <Field label={ui.form.driverPhone} htmlFor="delivery-driver-phone">
                                <Input
                                    id="delivery-driver-phone"
                                    value={form.driverPhone}
                                    onChange={(e) => setForm((f) => ({ ...f, driverPhone: e.target.value }))}
                                />
                            </Field>
                        </div>

                        <Field label={ui.form.scheduledAt} htmlFor="delivery-scheduled">
                            <Input
                                id="delivery-scheduled"
                                type="datetime-local"
                                value={form.scheduledAt}
                                onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
                            />
                        </Field>

                        {editingId && (
                            <Field label={t.common.status} htmlFor="delivery-status">
                                <Select
                                    id="delivery-status"
                                    value={form.status}
                                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                                >
                                    {STATUSES.map((status) => (
                                        <option key={status} value={status}>{statusLabel(status)}</option>
                                    ))}
                                </Select>
                            </Field>
                        )}

                        <Field label={t.common.notes} htmlFor="delivery-notes">
                            <Textarea
                                id="delivery-notes"
                                rows={2}
                                value={form.notes}
                                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                            />
                        </Field>
                    </div>

                    <ModalFooter className="justify-between">
                        {editingId && OPEN_STATUSES.has(form.status) ? (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-danger hover:bg-red-50"
                                onClick={() => {
                                    const order = orders.find((o) => o.id === editingId);
                                    setShowModal(false);
                                    if (order) setPendingCancel(order);
                                }}
                            >
                                {ui.cancelDelivery}
                            </Button>
                        ) : <span />}
                        <div className="flex gap-3">
                            <Button type="button" variant="secondary" size="md" onClick={() => setShowModal(false)}>
                                {t.common.close}
                            </Button>
                            <Button type="button" variant="primary" size="md" onClick={() => void handleSave()} loading={saving}>
                                {editingId ? t.common.update : t.common.create}
                            </Button>
                        </div>
                    </ModalFooter>
                </ModalShell>
            )}
        </PageShell>
    );
}
