'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { ArrowRightLeft, CheckCircle2, Clock, Eye, Hash, Pencil, Plus, ShieldCheck, Trash2, Truck } from 'lucide-react';
import { DataTable, createdAtColumn, type ListFilter, type ListStat } from '@/components/data-table';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import { matchesAnyOf } from '@/lib/list-filter';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { RowActions, RowActionButton } from '@/components/table';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { BranchFilter, Button, ConfirmDialog, Field, Input, Select, StatusBadge, type StatusBadgeTone } from '@/components/ui';
import { handleBranchForbidden, useBranchBoundState, useBranchScope } from '@/lib/branch-scope';
import { PostingBadge } from '@/components/PostingBadge';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useI18n } from '@/lib/i18n';
import { IdSearchSelect } from '@/components/document-entry/PartySearchSelect';
import { availableQtyOf } from '@/components/document-entry/ProductSearch';

interface WarehouseTransfer {
    id: string;
    transfer_number: string;
    status: string;
    created_at: string;
    sent_at?: string | null;
    received_at?: string | null;
    is_cross_branch?: boolean;
    source_store_id?: string | null;
    destination_store_id?: string | null;
    sourceWarehouse?: { id: string; name: string; store_id?: string } | null;
    destinationWarehouse?: { id: string; name: string; store_id?: string } | null;
    items: Array<{ id: string; product_id: string; quantity_sent: number; quantity_received: number; product?: { name: string } | null }>;
    posting_status?: string | null;
    voucher_number?: string | null;
    notes?: string | null;
}

interface FormLine {
    productId: string;
    quantity: string | number;
}

interface TransferForm {
    sourceWarehouseId: string;
    destinationWarehouseId: string;
    status: 'SENT' | 'DRAFT';
    notes: string;
    items: FormLine[];
}

const EMPTY_FORM: TransferForm = {
    sourceWarehouseId: '',
    destinationWarehouseId: '',
    status: 'SENT',
    notes: '',
    items: [{ productId: '', quantity: 1 }],
};

/** Stock has not left the source — safe to remove from the list. */
const DELETABLE_STATUSES = new Set(['DRAFT', 'PENDING_APPROVAL', 'REJECTED']);

const columnHelper = createColumnHelper<WarehouseTransfer>();

/**
 * Semantic tones per CLAUDE.md: amber warns (waiting on a person, or a receipt
 * still open), emerald is done, red is refused. Info stays the in-flight state
 * because it is the one the module's primary action produces.
 */
const STATUS_TONE: Record<string, StatusBadgeTone> = {
    DRAFT: 'neutral',
    PENDING_APPROVAL: 'warning',
    SENT: 'info',
    PARTIALLY_RECEIVED: 'warning',
    RECEIVED: 'success',
    REJECTED: 'danger',
};

const TRANSFER_STATUSES = [
    'DRAFT',
    'PENDING_APPROVAL',
    'SENT',
    'PARTIALLY_RECEIVED',
    'RECEIVED',
    'REJECTED',
] as const;

export default function InventoryTransfersPage() {
    const { t, locale } = useI18n();
    const listUi = t.inventoryTransfers.listUi;
    const branch = useBranchScope();
    const [transfers, setTransfers] = useState<WarehouseTransfer[]>([]);
    const [warehouses, setWarehouses] = useState<any[]>([]);
    const [stores, setStores] = useState<any[]>([]);
    const [products, setProducts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    // A transfer belongs to both its branches, so either end may sit in a branch
    // other than the filter's: the pickers keep every warehouse, but a choice is
    // cleared when the branch filter changes, like the reports' warehouse.
    const [sourceWarehouseId, setSourceWarehouseId] = useBranchBoundState(branch.apiStoreId);
    const [destinationWarehouseId, setDestinationWarehouseId] = useBranchBoundState(branch.apiStoreId);
    const [productId, setProductId] = useState('');
    const [scopeFilter, setScopeFilter] = useState('');
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<WarehouseTransfer | null>(null);
    const [form, setForm] = useState<TransferForm>(EMPTY_FORM);
    const [formError, setFormError] = useState('');
    const [pendingDelete, setPendingDelete] = useState<WarehouseTransfer | null>(null);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        void loadOptions();
    }, []);

    useEffect(() => {
        if (!branch.ready) return;
        void loadTransfers();
    }, [statusFilter, sourceWarehouseId, destinationWarehouseId, productId, scopeFilter, createdRange, branch.ready, branch.apiStoreId]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        const product = params.get('productId');
        if (product) {
            setProductId(product);
        }
    }, []);

    const loadTransfers = async () => {
        setLoading(true);
        try {
            const data = await api.getWarehouseTransfers({
                status: statusFilter.length === 1 ? statusFilter[0] : undefined,
                sourceWarehouseId: sourceWarehouseId || undefined,
                destinationWarehouseId: destinationWarehouseId || undefined,
                productId: productId || undefined,
                isCrossBranch: scopeFilter === '' ? undefined : scopeFilter === 'cross',
                from: applyCreatedRangeQuery(createdRange).createdFrom,
                to: applyCreatedRangeQuery(createdRange).createdTo,
                storeId: branch.apiStoreId,
            });
            setTransfers(data);
        } catch (error) {
            if (handleBranchForbidden(error, branch, t.dashboardLayout.branchFilterForbidden)) return;
            console.error('Failed to load warehouse transfers', error);
        } finally {
            setLoading(false);
        }
    };

    const loadOptions = async () => {
        try {
            const [warehouseData, productData, storeData] = await Promise.all([
                api.getInventoryWarehouses(),
                api.getProducts(),
                api.getStores(),
            ]);
            setWarehouses(warehouseData.filter((warehouse: any) => warehouse.is_active));
            setProducts(productData);
            setStores(Array.isArray(storeData) ? storeData : []);
        } catch (error) {
            console.error('Failed to load transfer options', error);
        }
    };

    const blankForm = (): TransferForm => ({
        ...EMPTY_FORM,
        items: [{ productId: '', quantity: 1 }],
    });

    const openCreate = () => {
        setEditing(null);
        setForm(blankForm());
        setFormError('');
        setFormOpen(true);
    };

    const openEdit = (transfer: WarehouseTransfer) => {
        setEditing(transfer);
        setForm({
            sourceWarehouseId: transfer.sourceWarehouse?.id ?? '',
            destinationWarehouseId: transfer.destinationWarehouse?.id ?? '',
            // A draft reopen defaults to draft so Save does not accidentally send.
            status: 'DRAFT',
            notes: transfer.notes ?? '',
            items: transfer.items.length
                ? transfer.items.map((item) => ({
                    productId: item.product_id,
                    quantity: item.quantity_sent,
                }))
                : [{ productId: '', quantity: 1 }],
        });
        setFormError('');
        setFormOpen(true);
    };

    const closeForm = () => {
        setFormOpen(false);
        setEditing(null);
        setFormError('');
    };

    const handleSave = async (event: React.FormEvent) => {
        event.preventDefault();
        setFormError('');
        setSaving(true);
        try {
            const payload = {
                sourceWarehouseId: form.sourceWarehouseId,
                destinationWarehouseId: form.destinationWarehouseId,
                status: form.status,
                notes: form.notes || undefined,
                items: form.items.map((item) => ({
                    productId: item.productId,
                    quantity: Number(item.quantity),
                })),
            };
            if (editing) {
                await api.updateWarehouseTransfer(editing.id, payload);
                toast.success(t.inventoryTransfers.transferUpdated);
            } else {
                await api.createWarehouseTransfer(payload);
                toast.success(t.inventoryTransfers.transferCreated);
            }
            // A sent transfer has moved stock out of the source, so the on-hand
            // figures shown against each line are stale until reloaded.
            void loadOptions();
            closeForm();
            await loadTransfers();
        } catch (error: any) {
            setFormError(error.message || (editing ? t.inventoryTransfers.updateFailed : t.inventoryTransfers.createFailed));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!pendingDelete) return;
        setDeleting(true);
        try {
            await api.deleteWarehouseTransfer(pendingDelete.id);
            toast.success(t.inventoryTransfers.transferDeleted);
            setPendingDelete(null);
            await loadTransfers();
        } catch (error: any) {
            toast.error(error.message || t.inventoryTransfers.deleteFailed);
        } finally {
            setDeleting(false);
        }
    };

    const storeNames = useMemo(
        () => new Map<string, string>(stores.map((store: any) => [store.id, store.name])),
        [stores],
    );

    /**
     * Warehouses grouped under the branch that owns them — the picker is where a
     * cross-branch transfer is chosen, so the branch has to be visible at the
     * moment of choosing rather than discovered afterwards.
     *
     * A single-branch shop is deliberately left ungrouped: an `<optgroup>` around
     * every warehouse in the only branch there is adds a label and no
     * information.
     *
     * This is why these pickers do NOT use `warehouseLabel()`, which every other
     * warehouse `<select>` in the app does use. That helper appends "(Branch)" to
     * a name another warehouse in the list shares — the same ambiguity grouping
     * solves here, and solving it twice reads as noise: "Godown (Dhaka)" sitting
     * inside an `<optgroup>` already labelled Dhaka. In the ungrouped case the
     * helper is a no-op anyway, because names are unique per branch
     * (`@@unique([tenant_id, store_id, name])`), so one branch cannot hold two
     * warehouses that read alike.
     */
    const warehouseGroups = useMemo(() => {
        const groups = new Map<string, { label: string; warehouses: any[] }>();
        for (const warehouse of warehouses) {
            const storeId = warehouse.store_id ?? '';
            if (!groups.has(storeId)) {
                groups.set(storeId, {
                    label: storeNames.get(storeId) ?? t.inventoryTransfers.unknownBranch,
                    warehouses: [],
                });
            }
            groups.get(storeId)!.warehouses.push(warehouse);
        }
        return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label));
    }, [warehouses, storeNames, t]);

    const warehouseOptions = useMemo(() => (
        warehouseGroups.length > 1
            ? warehouseGroups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                    {group.warehouses.map((warehouse: any) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                </optgroup>
            ))
            : warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)
    ), [warehouseGroups, warehouses]);

    /**
     * Whether the pair currently chosen in the form crosses branches. Computed
     * from the same two `store_id`s the backend compares, so the warning the user
     * sees and the rule the server applies cannot disagree.
     */
    const formCrossesBranches = useMemo(() => {
        const source = warehouses.find((warehouse) => warehouse.id === form.sourceWarehouseId);
        const destination = warehouses.find((warehouse) => warehouse.id === form.destinationWarehouseId);
        return Boolean(source && destination && source.store_id !== destination.store_id);
    }, [warehouses, form.sourceWarehouseId, form.destinationWarehouseId]);

    const productsById = useMemo(
        () => new Map<string, any>(products.map((product: any) => [product.id, product])),
        [products],
    );

    /**
     * What a line's product has on hand where the transfer draws from — the
     * source warehouse once one is chosen, every warehouse until then.
     */
    const stockHint = (product: any): string => {
        const quantity = availableQtyOf(product, form.sourceWarehouseId || undefined);
        return (form.sourceWarehouseId
            ? t.inventoryTransfers.availableAtSource
            : t.inventoryTransfers.inStockTotal).replace('{qty}', String(quantity));
    };

    const statusLabels: Record<string, string> = useMemo(() => ({
        DRAFT: t.inventoryTransfers.statuses.draft,
        PENDING_APPROVAL: t.inventoryTransfers.statuses.pendingApproval,
        SENT: t.inventoryTransfers.statuses.sent,
        PARTIALLY_RECEIVED: t.inventoryTransfers.statuses.partiallyReceived,
        RECEIVED: t.inventoryTransfers.statuses.received,
        REJECTED: t.inventoryTransfers.statuses.rejected,
    }), [t]);

    const columns: ColumnDef<WarehouseTransfer, any>[] = useMemo(
        () => [
            columnHelper.accessor('transfer_number', {
                header: t.inventoryTransfers.columns.transferNumber,
                cell: (info) => <span className="text-sm font-bold text-gray-900">{info.getValue()}</span>,
                size: 150,
            }),
            columnHelper.accessor((row) => row.sourceWarehouse?.name || '-', {
                id: 'sourceWarehouse',
                header: t.inventoryTransfers.columns.source,
                size: 170,
            }),
            columnHelper.accessor((row) => row.destinationWarehouse?.name || '-', {
                id: 'destinationWarehouse',
                header: t.inventoryTransfers.columns.destination,
                size: 170,
            }),
            columnHelper.accessor('status', {
                header: t.common.status,
                cell: (info) => (
                    <StatusBadge tone={STATUS_TONE[info.getValue()] ?? 'neutral'}>
                        {statusLabels[info.getValue()] ?? info.getValue()}
                    </StatusBadge>
                ),
                size: 150,
            }),
            columnHelper.display({
                id: 'scope',
                header: t.inventoryTransfers.columns.branch,
                cell: ({ row }) => {
                    const source = storeNames.get(row.original.source_store_id ?? row.original.sourceWarehouse?.store_id ?? '');
                    const destination = storeNames.get(row.original.destination_store_id ?? row.original.destinationWarehouse?.store_id ?? '');
                    if (!row.original.is_cross_branch) {
                        return <span className="text-sm text-gray-600">{source ?? t.inventoryTransfers.withinBranch}</span>;
                    }
                    return (
                        <span className="inline-flex items-center text-xs font-semibold text-amber-700">
                            {/* Arrow flipped for RTL the way the DataTable scroll hint does
                                it — see docs/rtl-guidelines.md. */}
                            {source ?? '?'}
                            <span className="mx-1 rtl:hidden">→</span>
                            <span className="mx-1 hidden rtl:inline">←</span>
                            {destination ?? '?'}
                        </span>
                    );
                },
                meta: { hideOnMobile: true },
                size: 180,
            }),
            columnHelper.accessor((row) => row.items.map((item) => item.product?.name).filter(Boolean).join(', '), {
                id: 'products',
                header: t.nav.products,
                cell: (info) => <span className="truncate text-sm text-gray-600">{info.getValue() || '-'}</span>,
                size: 260,
            }),
            columnHelper.accessor((row) => row.items.reduce((sum, item) => sum + (item.quantity_sent - item.quantity_received), 0), {
                id: 'outstanding',
                header: t.inventoryTransfers.columns.outstanding,
                cell: (info) => <span className="tabular-nums">{info.getValue()}</span>,
                size: 110,
                meta: { align: 'end' },
            }),
            createdAtColumn(columnHelper, { header: t.common.createdAt }),
            columnHelper.display({
                id: 'posting',
                header: t.inventoryTransfers.columns.voucher,
                cell: ({ row }) => (
                    <PostingBadge
                        status={row.original.posting_status}
                        voucherNumber={row.original.voucher_number}
                    />
                ),
                size: 120,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: ({ row }) => {
                    const transfer = row.original;
                    const canEdit = transfer.status === 'DRAFT';
                    const canDelete = DELETABLE_STATUSES.has(transfer.status);
                    return (
                        <RowActions>
                            <RowActionButton
                                icon={<Eye />}
                                label={t.common.view}
                                href={`/inventory/transfers/${transfer.id}`}
                            />
                            {canEdit ? (
                                <RowActionButton
                                    icon={<Pencil />}
                                    label={t.common.edit}
                                    onClick={() => openEdit(transfer)}
                                />
                            ) : null}
                            {canDelete ? (
                                <RowActionButton
                                    icon={<Trash2 />}
                                    label={t.common.delete}
                                    intent="danger"
                                    onClick={() => setPendingDelete(transfer)}
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
        ],
        [t, statusLabels, storeNames],
    );

    const warehouseFilterOptions = useMemo(
        () => warehouses.map((warehouse) => {
            const branchName = storeNames.get(warehouse.store_id ?? '');
            const label = warehouseGroups.length > 1 && branchName
                ? `${warehouse.name} · ${branchName}`
                : String(warehouse.name);
            return { value: warehouse.id as string, label };
        }),
        [warehouses, storeNames, warehouseGroups.length],
    );

    const productFilterOptions = useMemo(
        () => products.map((product) => ({
            value: product.id as string,
            label: product.sku ? `${product.name} (${product.sku})` : String(product.name),
        })),
        [products],
    );

    const filteredTransfers = useMemo(
        () => transfers.filter((transfer) => matchesAnyOf(statusFilter, transfer.status)),
        [transfers, statusFilter],
    );

    const filters = useMemo<ListFilter[]>(() => {
        const chips: ListFilter[] = [
            {
                id: 'status',
                type: 'multi-select',
                label: t.common.status,
                value: statusFilter,
                onChange: setStatusFilter,
                options: TRANSFER_STATUSES.map((status) => ({
                    value: status,
                    label: statusLabels[status] ?? status,
                })),
            },
            {
                id: 'source',
                type: 'select',
                label: t.inventoryTransfers.columns.source,
                value: sourceWarehouseId || null,
                onChange: (next) => setSourceWarehouseId(next ?? ''),
                options: warehouseFilterOptions,
                searchable: true,
            },
            {
                id: 'destination',
                type: 'select',
                label: t.inventoryTransfers.columns.destination,
                value: destinationWarehouseId || null,
                onChange: (next) => setDestinationWarehouseId(next ?? ''),
                options: warehouseFilterOptions,
                searchable: true,
            },
            {
                id: 'product',
                type: 'select',
                label: t.nav.products,
                value: productId || null,
                onChange: (next) => setProductId(next ?? ''),
                options: productFilterOptions,
                searchable: true,
            },
        ];
        // Only a multi-branch tenant has a scope to filter by.
        if (warehouseGroups.length > 1) {
            chips.push({
                id: 'scope',
                type: 'select',
                label: t.inventoryTransfers.columns.branch,
                value: scopeFilter || null,
                onChange: (next) => setScopeFilter(next ?? ''),
                options: [
                    { value: 'cross', label: t.inventoryTransfers.crossBranchOnly },
                    { value: 'within', label: t.inventoryTransfers.withinBranchOnly },
                ],
            });
        }
        chips.push({ id: 'created', type: 'date-range', value: createdRange, onChange: setCreatedRange, operators: true });
        return chips;
    }, [
        t,
        statusFilter,
        statusLabels,
        sourceWarehouseId,
        destinationWarehouseId,
        productId,
        scopeFilter,
        createdRange,
        warehouseFilterOptions,
        productFilterOptions,
        warehouseGroups.length,
    ]);

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const pending = filteredTransfers.filter((row) => row.status === 'PENDING_APPROVAL').length;
        const inTransit = filteredTransfers.filter((row) => row.status === 'SENT' || row.status === 'PARTIALLY_RECEIVED').length;
        const received = filteredTransfers.filter((row) => row.status === 'RECEIVED').length;
        const items: ListStat[] = [
            { id: 'total', icon: <Hash aria-hidden />, label: listUi.total, value: n(filteredTransfers.length) },
            {
                id: 'pending',
                icon: <Clock aria-hidden />,
                label: listUi.pendingApproval,
                value: n(pending),
                tone: pending > 0 ? 'warning' : 'default',
            },
            { id: 'inTransit', icon: <Truck aria-hidden />, label: listUi.inTransit, value: n(inTransit) },
            { id: 'received', icon: <CheckCircle2 aria-hidden />, label: listUi.received, value: n(received) },
        ];
        return { items, loading, label: listUi.statsLabel };
    }, [filteredTransfers, loading, locale, listUi]);

    const deletePrompt = pendingDelete
        ? t.inventoryTransfers.deleteDescription.replace('{number}', pendingDelete.transfer_number)
        : '';

    return (
        <PageShell>
            <PageHeader
                title={t.inventoryTransfers.title}
                subtitle={t.inventoryTransfers.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.inventory,
                    t.inventoryTransfers.title,
                    'inventory',
                )}
                actions={(
                    <>
                        <BranchFilter scope={branch} />
                        <Button onClick={openCreate} icon={<Plus className="h-4 w-4" />}>
                            {t.inventoryTransfers.newTransfer}
                        </Button>
                    </>
                )}
            />

            <DataTable<WarehouseTransfer>
                tableId="inventory-transfers"
                columns={columns}
                data={filteredTransfers}
                title={t.inventoryTransfers.title}
                isLoading={loading}
                emptyMessage={t.inventoryTransfers.emptyMessage}
                emptyIcon={<Truck className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={t.inventoryTransfers.searchPlaceholder}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
            />

            {formOpen ? (
                <ModalShell size="lg" onBackdropClick={closeForm}>
                    <form onSubmit={handleSave} className="flex min-h-0 flex-1 flex-col">
                        <ModalHeader
                            title={(
                                <span className="inline-flex items-center gap-2">
                                    <Truck className="h-5 w-5 text-blue-600" />
                                    {editing ? t.inventoryTransfers.editTransfer : t.inventoryTransfers.newTransfer}
                                </span>
                            )}
                            onClose={closeForm}
                            closeLabel={t.common.close}
                        />

                        <div className="flex-1 space-y-4 overflow-y-auto p-4">
                            {formError ? (
                                <div className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                                    {formError}
                                </div>
                            ) : null}

                            <div className="grid gap-3 md:grid-cols-2">
                                <Field label={t.inventoryTransfers.sourceWarehouse} required htmlFor="transfer-source">
                                    <Select
                                        id="transfer-source"
                                        required
                                        value={form.sourceWarehouseId}
                                        onChange={(e) => setForm((current) => ({ ...current, sourceWarehouseId: e.target.value }))}
                                    >
                                        <option value="">{t.inventoryTransfers.selectSource}</option>
                                        {warehouseOptions}
                                    </Select>
                                </Field>
                                <Field label={t.inventoryTransfers.destinationWarehouse} required htmlFor="transfer-destination">
                                    <Select
                                        id="transfer-destination"
                                        required
                                        value={form.destinationWarehouseId}
                                        onChange={(e) => setForm((current) => ({ ...current, destinationWarehouseId: e.target.value }))}
                                    >
                                        <option value="">{t.inventoryTransfers.selectDestination}</option>
                                        {warehouseOptions}
                                    </Select>
                                </Field>
                                <Field label={t.inventoryTransfers.initialStatus} htmlFor="transfer-status">
                                    <Select
                                        id="transfer-status"
                                        value={form.status}
                                        onChange={(e) => setForm((current) => ({
                                            ...current,
                                            status: e.target.value as 'SENT' | 'DRAFT',
                                        }))}
                                    >
                                        <option value="SENT">{t.inventoryTransfers.sendNow}</option>
                                        <option value="DRAFT">{t.inventoryTransfers.saveAsDraft}</option>
                                    </Select>
                                </Field>
                                <Field label={t.common.notes} htmlFor="transfer-notes">
                                    <Input
                                        id="transfer-notes"
                                        value={form.notes}
                                        onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))}
                                        placeholder={t.common.optional}
                                    />
                                </Field>
                            </div>

                            {formCrossesBranches ? (
                                <div className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span>{t.inventoryTransfers.crossBranchNotice}</span>
                                </div>
                            ) : null}

                            <div className="space-y-3">
                                {form.items.map((item, index) => {
                                    const product = productsById.get(item.productId);
                                    const sourceQty = product && form.sourceWarehouseId
                                        ? availableQtyOf(product, form.sourceWarehouseId)
                                        : null;
                                    const overStock = sourceQty !== null && Number(item.quantity) > sourceQty;
                                    return (
                                        <div key={index} className="space-y-1">
                                            <div className="grid items-end gap-3 md:grid-cols-[1fr_160px_120px]">
                                                <div>
                                                    <IdSearchSelect
                                                        items={products}
                                                        value={item.productId}
                                                        onChange={(id) => setForm((current) => ({
                                                            ...current,
                                                            items: current.items.map((line, lineIndex) => (
                                                                lineIndex === index ? { ...line, productId: id } : line
                                                            )),
                                                        }))}
                                                        label={t.common.product}
                                                        placeholder={t.inventoryTransfers.selectProduct}
                                                        emptyLabel={t.pos.searchPlaceholder}
                                                        noMatchLabel={t.common.noData}
                                                        subtitle={(option) => [option.sku, stockHint(option)].filter(Boolean).join(' · ')}
                                                    />
                                                </div>
                                                <Field label={t.common.quantity} htmlFor={`transfer-qty-${index}`}>
                                                    <Input
                                                        id={`transfer-qty-${index}`}
                                                        type="number"
                                                        min="1"
                                                        value={item.quantity}
                                                        onChange={(e) => setForm((current) => ({
                                                            ...current,
                                                            items: current.items.map((line, lineIndex) => (
                                                                lineIndex === index ? { ...line, quantity: e.target.value } : line
                                                            )),
                                                        }))}
                                                    />
                                                </Field>
                                                <Button
                                                    type="button"
                                                    variant="secondary"
                                                    onClick={() => setForm((current) => ({
                                                        ...current,
                                                        items: current.items.length === 1
                                                            ? current.items
                                                            : current.items.filter((_, lineIndex) => lineIndex !== index),
                                                    }))}
                                                >
                                                    {t.inventoryShrinkage.remove}
                                                </Button>
                                            </div>
                                            {product ? (
                                                <p className="ms-1 text-xs text-gray-500" data-testid={`transfer-line-stock-${index}`}>
                                                    {stockHint(product)}
                                                    {form.destinationWarehouseId ? (
                                                        <> · {t.inventoryTransfers.atDestination.replace('{qty}', String(availableQtyOf(product, form.destinationWarehouseId)))}</>
                                                    ) : null}
                                                    {overStock ? (
                                                        <span className="text-amber-700"> · {t.inventoryTransfers.exceedsSourceStock}</span>
                                                    ) : null}
                                                </p>
                                            ) : null}
                                        </div>
                                    );
                                })}
                            </div>

                            <Button
                                type="button"
                                variant="secondary"
                                icon={<Plus className="h-4 w-4" />}
                                onClick={() => setForm((current) => ({
                                    ...current,
                                    items: [...current.items, { productId: '', quantity: 1 }],
                                }))}
                            >
                                {t.inventoryTransfers.addLine}
                            </Button>
                        </div>

                        <ModalFooter>
                            <Button type="button" variant="secondary" onClick={closeForm} disabled={saving}>
                                {t.common.cancel}
                            </Button>
                            <Button type="submit" loading={saving} icon={<ArrowRightLeft className="h-4 w-4" />}>
                                {editing ? t.inventoryTransfers.saveTransfer : t.inventoryTransfers.createTransfer}
                            </Button>
                        </ModalFooter>
                    </form>
                </ModalShell>
            ) : null}

            <ConfirmDialog
                open={Boolean(pendingDelete)}
                title={t.inventoryTransfers.deleteTitle}
                prompt={deletePrompt}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                danger
                loading={deleting}
                onConfirm={() => void handleDelete()}
                onCancel={() => setPendingDelete(null)}
            />
        </PageShell>
    );
}
