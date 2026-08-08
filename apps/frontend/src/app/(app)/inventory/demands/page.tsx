'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { ClipboardList, Plus, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import PageHeader from '@/components/ui/compact/PageHeader';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import {
    Alert,
    Button,
    Field,
    FormFooter,
    Input,
    PageShell,
    Select,
    StatusBadge,
    Textarea,
    type StatusBadgeTone,
} from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { hasPermission, isOwner } from '@/lib/permissions';
import { useToastStore } from '@/lib/toast';
import { useTenantPlanFeatures } from '@/lib/use-tenant-plan-features';

interface DemandItem {
    id: string;
    product_id: string;
    quantity_requested: number;
    quantity_approved: number | null;
    note: string | null;
    product?: { id: string; name: string; sku: string | null } | null;
}

interface ProductDemand {
    id: string;
    demand_number: string;
    status: string;
    priority: string;
    needed_by: string | null;
    notes: string | null;
    review_note: string | null;
    fulfilment_note: string | null;
    reviewed_at: string | null;
    created_at: string;
    warehouse?: { id: string; name: string } | null;
    items: DemandItem[];
}

type FormLine = { productId: string; quantity: string; note: string };

/** Wire values, in the order they should appear in a filter. */
const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'FULFILLED', 'CANCELLED'] as const;
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

const STATUS_TONE: Record<string, StatusBadgeTone> = {
    DRAFT: 'neutral',
    SUBMITTED: 'info',
    APPROVED: 'success',
    REJECTED: 'danger',
    FULFILLED: 'success',
    CANCELLED: 'neutral',
};

const PRIORITY_TONE: Record<string, StatusBadgeTone> = {
    LOW: 'neutral',
    NORMAL: 'neutral',
    HIGH: 'warning',
    URGENT: 'danger',
};

const blankLine = (): FormLine => ({ productId: '', quantity: '1', note: '' });

const columnHelper = createColumnHelper<ProductDemand>();

/**
 * Inventory > Demands. One page for both sides of the request: the branch that
 * raises it and the approver who decides on it. Which half a user sees is driven
 * by the permission they hold, not by a separate screen — the list is the same
 * list, and hiding the approve action is what differs.
 */
export default function ProductDemandsPage() {
    const { t } = useI18n();
    const copy = t.inventoryDemands;
    const toast = useToastStore((state) => state.show);
    const { permissions, role, ready: permissionsReady } = useTenantPlanFeatures();

    const canCreate = isOwner(role) || hasPermission(permissions, 'CREATE_PRODUCT_DEMAND');
    const canApprove = isOwner(role) || hasPermission(permissions, 'APPROVE_PRODUCT_DEMAND');

    const [demands, setDemands] = useState<ProductDemand[]>([]);
    const [warehouses, setWarehouses] = useState<any[]>([]);
    const [products, setProducts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [statusFilter, setStatusFilter] = useState('');
    const [priorityFilter, setPriorityFilter] = useState('');
    const [warehouseFilter, setWarehouseFilter] = useState('');
    const [mineOnly, setMineOnly] = useState(false);

    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<ProductDemand | null>(null);
    const [form, setForm] = useState<{
        warehouseId: string;
        priority: string;
        neededBy: string;
        notes: string;
        items: FormLine[];
    }>({ warehouseId: '', priority: 'NORMAL', neededBy: '', notes: '', items: [blankLine()] });
    const [formError, setFormError] = useState('');
    const [saving, setSaving] = useState(false);

    const [detail, setDetail] = useState<ProductDemand | null>(null);
    const [reviewQuantities, setReviewQuantities] = useState<Record<string, string>>({});
    const [reviewNote, setReviewNote] = useState('');
    const [fulfilmentNote, setFulfilmentNote] = useState('');
    const [acting, setActing] = useState(false);

    const loadDemands = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const data = await api.getProductDemands({
                status: statusFilter || undefined,
                priority: priorityFilter || undefined,
                warehouseId: warehouseFilter || undefined,
                mine: mineOnly || undefined,
            });
            setDemands(data ?? []);
        } catch (err: any) {
            setError(err?.message || copy.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [statusFilter, priorityFilter, warehouseFilter, mineOnly, copy.loadFailed]);

    useEffect(() => { void loadDemands(); }, [loadDemands]);

    useEffect(() => {
        void (async () => {
            try {
                const [warehouseData, productData] = await Promise.all([
                    api.getInventoryWarehouses(),
                    api.getProducts(),
                ]);
                setWarehouses((warehouseData ?? []).filter((warehouse: any) => warehouse.is_active));
                setProducts(productData ?? []);
            } catch {
                // Options failing is not worth blocking the list over — the form
                // simply opens with empty selects and the user sees that.
            }
        })();
    }, []);

    const productName = useCallback(
        (item: DemandItem) => item.product?.name ?? products.find((p) => p.id === item.product_id)?.name ?? '—',
        [products],
    );

    // The catalog keys are camelCase (`draft`), the wire values SCREAMING_SNAKE
    // (`DRAFT`); these two are the only place that seam is crossed.
    const statusLabel = useCallback(
        (status: string) => copy.statuses[status.toLowerCase() as keyof typeof copy.statuses] ?? status,
        [copy],
    );
    const priorityLabel = useCallback(
        (priority: string) => copy.priorities[priority.toLowerCase() as keyof typeof copy.priorities] ?? priority,
        [copy],
    );

    // ── Create / edit ─────────────────────────────────────────────────────────

    const defaultWarehouseId = useMemo(() => {
        const preferred = warehouses.find((warehouse: any) => warehouse.is_default) ?? warehouses[0];
        return preferred?.id ?? '';
    }, [warehouses]);

    const openForm = (demand: ProductDemand | null) => {
        setFormError('');
        setEditing(demand);
        setForm(demand
            ? {
                warehouseId: demand.warehouse?.id ?? defaultWarehouseId,
                priority: demand.priority,
                neededBy: demand.needed_by ? demand.needed_by.slice(0, 10) : '',
                notes: demand.notes ?? '',
                items: demand.items.length
                    ? demand.items.map((item) => ({
                        productId: item.product_id,
                        quantity: String(item.quantity_requested),
                        note: item.note ?? '',
                    }))
                    : [blankLine()],
            }
            : { warehouseId: defaultWarehouseId, priority: 'NORMAL', neededBy: '', notes: '', items: [blankLine()] });
        setFormOpen(true);
    };

    const setLine = (index: number, patch: Partial<FormLine>) => {
        setForm((prev) => ({
            ...prev,
            items: prev.items.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
        }));
    };

    const buildPayloadItems = () => form.items
        .filter((line) => line.productId)
        .map((line) => ({
            productId: line.productId,
            quantity: Number(line.quantity),
            note: line.note || undefined,
        }));

    /** `submit` decides whether the save also sends it on for approval. */
    const saveDemand = async (submit: boolean) => {
        setFormError('');
        const items = buildPayloadItems();

        if (!form.warehouseId) {
            setFormError(copy.errors.warehouseRequired);
            return;
        }
        if (items.length === 0) {
            setFormError(copy.errors.noLines);
            return;
        }
        if (items.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1)) {
            setFormError(copy.errors.badQuantity);
            return;
        }
        if (new Set(items.map((item) => item.productId)).size !== items.length) {
            setFormError(copy.errors.duplicateProduct);
            return;
        }

        const payload = {
            warehouseId: form.warehouseId,
            priority: form.priority,
            neededBy: form.neededBy || undefined,
            notes: form.notes || undefined,
            items,
        };

        setSaving(true);
        try {
            if (editing) {
                await api.updateProductDemand(editing.id, payload);
                if (submit) await api.submitProductDemand(editing.id);
                toast('success', submit ? copy.toasts.submitted : copy.toasts.saved);
            } else {
                await api.createProductDemand({ ...payload, status: submit ? 'SUBMITTED' : 'DRAFT' });
                toast('success', submit ? copy.toasts.submitted : copy.toasts.saved);
            }
            setFormOpen(false);
            setEditing(null);
            await loadDemands();
        } catch (err: any) {
            setFormError(err?.message || copy.errors.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    // ── Detail actions ────────────────────────────────────────────────────────

    const openDetail = (demand: ProductDemand) => {
        setDetail(demand);
        setReviewNote('');
        setFulfilmentNote('');
        setReviewQuantities(Object.fromEntries(
            demand.items.map((item) => [item.product_id, String(item.quantity_approved ?? item.quantity_requested)]),
        ));
    };

    /** Every detail action reloads the list and closes the panel on success. */
    const runAction = async (action: () => Promise<unknown>, successMessage: string) => {
        setActing(true);
        try {
            await action();
            toast('success', successMessage);
            setDetail(null);
            await loadDemands();
        } catch (err: any) {
            toast('error', err?.message || copy.errors.actionFailed);
        } finally {
            setActing(false);
        }
    };

    const reviewItems = (demand: ProductDemand) => demand.items.map((item) => ({
        productId: item.product_id,
        quantityApproved: Math.max(0, Number(reviewQuantities[item.product_id] ?? item.quantity_requested) || 0),
    }));

    // ── Table ─────────────────────────────────────────────────────────────────

    const columns: ColumnDef<ProductDemand, any>[] = useMemo(() => [
        columnHelper.accessor('demand_number', {
            header: copy.columns.demandNumber,
            cell: (info) => <span className="text-sm font-semibold text-gray-900">{info.getValue()}</span>,
            size: 120,
        }),
        columnHelper.accessor('status', {
            header: t.common.status,
            cell: (info) => (
                <StatusBadge tone={STATUS_TONE[info.getValue()] ?? 'neutral'}>
                    {statusLabel(info.getValue())}
                </StatusBadge>
            ),
            size: 120,
        }),
        columnHelper.accessor('priority', {
            header: copy.columns.priority,
            cell: (info) => (
                <StatusBadge tone={PRIORITY_TONE[info.getValue()] ?? 'neutral'}>
                    {priorityLabel(info.getValue())}
                </StatusBadge>
            ),
            size: 110,
        }),
        columnHelper.accessor((row) => row.warehouse?.name ?? '—', {
            id: 'warehouse',
            header: copy.columns.warehouse,
            size: 160,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor((row) => row.items.map(productName).join(', '), {
            id: 'products',
            header: t.nav.products,
            cell: (info) => <span className="line-clamp-2 text-sm text-gray-600">{info.getValue() || '—'}</span>,
            size: 240,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor((row) => row.items.reduce((sum, item) => sum + item.quantity_requested, 0), {
            id: 'requested',
            header: copy.columns.requested,
            size: 110,
        }),
        columnHelper.accessor(
            (row) => (row.items.some((item) => item.quantity_approved !== null)
                ? row.items.reduce((sum, item) => sum + (item.quantity_approved ?? 0), 0)
                : null),
            {
                id: 'approved',
                header: copy.columns.approved,
                cell: (info) => <span className="text-sm">{info.getValue() ?? '—'}</span>,
                size: 110,
                meta: { hideOnMobile: true },
            },
        ),
        columnHelper.accessor('needed_by', {
            header: copy.columns.neededBy,
            cell: (info) => <span className="text-sm">{info.getValue() ? formatDate(info.getValue()) : '—'}</span>,
            size: 130,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor('created_at', {
            header: copy.columns.created,
            cell: (info) => <span className="text-sm">{formatDate(info.getValue())}</span>,
            size: 130,
            meta: { hideOnMobile: true },
        }),
        columnHelper.display({
            id: 'actions',
            header: t.common.actions,
            cell: ({ row }) => (
                <button
                    type="button"
                    onClick={() => openDetail(row.original)}
                    className="text-sm font-semibold text-blue-600 hover:text-blue-700"
                >
                    {t.common.view}
                </button>
            ),
            size: 90,
        }),
    ], [copy, t, productName, statusLabel, priorityLabel]);

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.inventory,
                    copy.title,
                    'inventory',
                )}
                actions={permissionsReady && canCreate ? (
                    <Button onClick={() => openForm(null)} icon={<Plus className="h-4 w-4" />}>
                        {copy.newDemand}
                    </Button>
                ) : null}
            />

            {error ? <Alert tone="danger">{error}</Alert> : null}

            <div className="grid gap-3 rounded-lg border border-gray-100 bg-white p-3 md:grid-cols-4">
                <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label={t.common.status}>
                    <option value="">{copy.filters.allStatuses}</option>
                    {STATUSES.map((status) => (
                        <option key={status} value={status}>{statusLabel(status)}</option>
                    ))}
                </Select>
                <Select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} aria-label={copy.columns.priority}>
                    <option value="">{copy.filters.allPriorities}</option>
                    {PRIORITIES.map((priority) => (
                        <option key={priority} value={priority}>{priorityLabel(priority)}</option>
                    ))}
                </Select>
                <Select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)} aria-label={copy.columns.warehouse}>
                    <option value="">{copy.filters.allWarehouses}</option>
                    {warehouses.map((warehouse: any) => (
                        <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                    ))}
                </Select>
                <label className="flex min-h-touch items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
                    {copy.filters.mineOnly}
                </label>
            </div>

            <DataTable<ProductDemand>
                tableId="inventory-demands"
                columns={columns}
                data={demands}
                title={copy.title}
                isLoading={loading}
                emptyMessage={copy.empty}
                emptyIcon={<ClipboardList className="h-16 w-16 text-gray-200" />}
                searchPlaceholder={copy.searchPlaceholder}
            />

            {formOpen ? (
                <ModalShell size="lg" onBackdropClick={() => setFormOpen(false)}>
                    <ModalHeader
                        title={editing ? copy.editTitle : copy.newTitle}
                        subtitle={copy.formHint}
                        onClose={() => setFormOpen(false)}
                        closeLabel={t.common.cancel}
                    />
                    <div className="space-y-3 overflow-y-auto p-4">
                        {formError ? <Alert tone="danger">{formError}</Alert> : null}

                        <div className="grid gap-3 md:grid-cols-3">
                            <Field label={copy.form.warehouse} htmlFor="demand-warehouse" required>
                                <Select
                                    id="demand-warehouse"
                                    value={form.warehouseId}
                                    onChange={(e) => setForm((prev) => ({ ...prev, warehouseId: e.target.value }))}
                                >
                                    <option value="">{copy.form.selectWarehouse}</option>
                                    {warehouses.map((warehouse: any) => (
                                        <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                                    ))}
                                </Select>
                            </Field>
                            <Field label={copy.columns.priority} htmlFor="demand-priority">
                                <Select
                                    id="demand-priority"
                                    value={form.priority}
                                    onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))}
                                >
                                    {PRIORITIES.map((priority) => (
                                        <option key={priority} value={priority}>{priorityLabel(priority)}</option>
                                    ))}
                                </Select>
                            </Field>
                            <Field label={copy.columns.neededBy} htmlFor="demand-needed-by">
                                <Input
                                    id="demand-needed-by"
                                    type="date"
                                    value={form.neededBy}
                                    onChange={(e) => setForm((prev) => ({ ...prev, neededBy: e.target.value }))}
                                />
                            </Field>
                        </div>

                        <div className="space-y-2">
                            {form.items.map((line, index) => (
                                <div key={index} className="grid gap-2 md:grid-cols-[1fr_110px_1fr_auto] md:items-end">
                                    <Field label={t.common.product} htmlFor={`demand-product-${index}`} required={index === 0}>
                                        <Select
                                            id={`demand-product-${index}`}
                                            value={line.productId}
                                            onChange={(e) => setLine(index, { productId: e.target.value })}
                                        >
                                            <option value="">{copy.form.selectProduct}</option>
                                            {products.map((product: any) => (
                                                <option key={product.id} value={product.id}>{product.name}</option>
                                            ))}
                                        </Select>
                                    </Field>
                                    <Field label={t.common.quantity} htmlFor={`demand-quantity-${index}`}>
                                        <Input
                                            id={`demand-quantity-${index}`}
                                            type="number"
                                            min="1"
                                            value={line.quantity}
                                            onChange={(e) => setLine(index, { quantity: e.target.value })}
                                        />
                                    </Field>
                                    <Field label={copy.form.lineNote} htmlFor={`demand-note-${index}`}>
                                        <Input
                                            id={`demand-note-${index}`}
                                            value={line.note}
                                            onChange={(e) => setLine(index, { note: e.target.value })}
                                            placeholder={copy.form.lineNotePlaceholder}
                                        />
                                    </Field>
                                    <Button
                                        variant="ghost"
                                        aria-label={copy.form.removeLine}
                                        disabled={form.items.length === 1}
                                        onClick={() => setForm((prev) => ({
                                            ...prev,
                                            items: prev.items.filter((_, lineIndex) => lineIndex !== index),
                                        }))}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                            <Button
                                variant="secondary"
                                icon={<Plus className="h-4 w-4" />}
                                onClick={() => setForm((prev) => ({ ...prev, items: [...prev.items, blankLine()] }))}
                            >
                                {copy.form.addLine}
                            </Button>
                        </div>

                        <Field label={t.common.notes} htmlFor="demand-notes">
                            <Textarea
                                id="demand-notes"
                                rows={2}
                                value={form.notes}
                                onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                                placeholder={copy.form.notesPlaceholder}
                            />
                        </Field>

                        <FormFooter>
                            <Button variant="secondary" disabled={saving} onClick={() => void saveDemand(false)}>
                                {copy.form.saveDraft}
                            </Button>
                            <Button loading={saving} onClick={() => void saveDemand(true)}>
                                {copy.form.submitForApproval}
                            </Button>
                        </FormFooter>
                    </div>
                </ModalShell>
            ) : null}

            {detail ? (
                <ModalShell size="lg" onBackdropClick={() => setDetail(null)}>
                    <ModalHeader
                        title={detail.demand_number}
                        subtitle={detail.warehouse?.name ?? undefined}
                        onClose={() => setDetail(null)}
                        closeLabel={t.common.close}
                    >
                        <StatusBadge tone={STATUS_TONE[detail.status] ?? 'neutral'}>
                            {statusLabel(detail.status)}
                        </StatusBadge>
                    </ModalHeader>

                    <div className="space-y-3 overflow-y-auto p-4">
                        <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                            <div>
                                <dt className="text-xs text-gray-500">{copy.columns.priority}</dt>
                                <dd>{priorityLabel(detail.priority)}</dd>
                            </div>
                            <div>
                                <dt className="text-xs text-gray-500">{copy.columns.neededBy}</dt>
                                <dd>{detail.needed_by ? formatDate(detail.needed_by) : '—'}</dd>
                            </div>
                            <div>
                                <dt className="text-xs text-gray-500">{copy.columns.created}</dt>
                                <dd>{formatDate(detail.created_at)}</dd>
                            </div>
                            <div>
                                <dt className="text-xs text-gray-500">{copy.detail.reviewedOn}</dt>
                                <dd>{detail.reviewed_at ? formatDate(detail.reviewed_at) : '—'}</dd>
                            </div>
                        </dl>

                        {detail.notes ? (
                            <p className="rounded-md bg-gray-50 p-2 text-sm text-gray-700">{detail.notes}</p>
                        ) : null}

                        <div className="overflow-x-auto rounded-lg border border-gray-200">
                            <table className="w-full text-sm">
                                <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
                                    <tr>
                                        <th className="p-2 text-left font-medium">{t.common.product}</th>
                                        <th className="p-2 text-right font-medium">{copy.columns.requested}</th>
                                        <th className="p-2 text-right font-medium">{copy.columns.approved}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {detail.items.map((item) => (
                                        <tr key={item.id} className="border-b border-gray-100 last:border-0">
                                            <td className="p-2">
                                                <span className="font-medium text-gray-900">{productName(item)}</span>
                                                {item.note ? <span className="block text-xs text-gray-500">{item.note}</span> : null}
                                            </td>
                                            <td className="p-2 text-right">{item.quantity_requested}</td>
                                            <td className="p-2 text-right">
                                                {detail.status === 'SUBMITTED' && canApprove ? (
                                                    <Input
                                                        type="number"
                                                        min="0"
                                                        max={item.quantity_requested}
                                                        className="ml-auto w-24 text-right"
                                                        aria-label={`${copy.columns.approved} — ${productName(item)}`}
                                                        value={reviewQuantities[item.product_id] ?? String(item.quantity_requested)}
                                                        onChange={(e) => setReviewQuantities((prev) => ({
                                                            ...prev,
                                                            [item.product_id]: e.target.value,
                                                        }))}
                                                    />
                                                ) : (
                                                    item.quantity_approved ?? '—'
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {detail.review_note ? (
                            <p className="text-sm text-gray-700">
                                <span className="text-xs text-gray-500">{copy.detail.reviewNote}: </span>
                                {detail.review_note}
                            </p>
                        ) : null}
                        {detail.fulfilment_note ? (
                            <p className="text-sm text-gray-700">
                                <span className="text-xs text-gray-500">{copy.detail.fulfilmentNote}: </span>
                                {detail.fulfilment_note}
                            </p>
                        ) : null}

                        {detail.status === 'SUBMITTED' && canApprove ? (
                            <Field label={copy.detail.reviewNote} htmlFor="demand-review-note">
                                <Textarea
                                    id="demand-review-note"
                                    rows={2}
                                    value={reviewNote}
                                    onChange={(e) => setReviewNote(e.target.value)}
                                    placeholder={copy.detail.reviewNotePlaceholder}
                                />
                            </Field>
                        ) : null}

                        {detail.status === 'APPROVED' && canApprove ? (
                            <Field label={copy.detail.fulfilmentNote} htmlFor="demand-fulfilment-note" hint={copy.detail.fulfilmentHint}>
                                <Input
                                    id="demand-fulfilment-note"
                                    value={fulfilmentNote}
                                    onChange={(e) => setFulfilmentNote(e.target.value)}
                                    placeholder={copy.detail.fulfilmentNotePlaceholder}
                                />
                            </Field>
                        ) : null}
                    </div>

                    <ModalFooter className="flex-wrap">
                        {detail.status === 'DRAFT' && canCreate ? (
                            <>
                                <Button variant="secondary" onClick={() => { const target = detail; setDetail(null); openForm(target); }}>
                                    {t.common.edit}
                                </Button>
                                <Button
                                    loading={acting}
                                    onClick={() => void runAction(() => api.submitProductDemand(detail.id), copy.toasts.submitted)}
                                >
                                    {copy.actions.submit}
                                </Button>
                            </>
                        ) : null}

                        {['DRAFT', 'SUBMITTED'].includes(detail.status) && canCreate ? (
                            <Button
                                variant="danger"
                                disabled={acting}
                                onClick={() => void runAction(() => api.cancelProductDemand(detail.id), copy.toasts.cancelled)}
                            >
                                {copy.actions.cancel}
                            </Button>
                        ) : null}

                        {detail.status === 'SUBMITTED' && canApprove ? (
                            <>
                                <Button
                                    variant="danger"
                                    disabled={acting}
                                    onClick={() => void runAction(
                                        () => api.reviewProductDemand(detail.id, {
                                            status: 'REJECTED',
                                            reviewNote: reviewNote || undefined,
                                        }),
                                        copy.toasts.rejected,
                                    )}
                                >
                                    {copy.actions.reject}
                                </Button>
                                <Button
                                    loading={acting}
                                    onClick={() => void runAction(
                                        () => api.reviewProductDemand(detail.id, {
                                            status: 'APPROVED',
                                            reviewNote: reviewNote || undefined,
                                            items: reviewItems(detail),
                                        }),
                                        copy.toasts.approved,
                                    )}
                                >
                                    {copy.actions.approve}
                                </Button>
                            </>
                        ) : null}

                        {detail.status === 'APPROVED' && canApprove ? (
                            <Button
                                loading={acting}
                                onClick={() => void runAction(
                                    () => api.fulfilProductDemand(detail.id, {
                                        fulfilmentNote: fulfilmentNote || undefined,
                                    }),
                                    copy.toasts.fulfilled,
                                )}
                            >
                                {copy.actions.markFulfilled}
                            </Button>
                        ) : null}
                    </ModalFooter>
                </ModalShell>
            ) : null}
        </PageShell>
    );
}
