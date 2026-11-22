'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, Eye, Hash, PackagePlus, Pencil, Plus, Scale, Trash2 } from 'lucide-react';
import { DataTable, createdAtColumn, type ListFilter, type ListStat } from '@/components/data-table';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import { warehouseLabel } from '@/lib/warehouse-label';
import { formatBDT, formatDateTime } from '@/lib/format';
import { api } from '@/lib/api';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import { PostingBadge } from '@/components/PostingBadge';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { BranchFilter, Alert, Button, ConfirmDialog, Field, Input, Select, StatusBadge } from '@/components/ui';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useI18n } from '@/lib/i18n';
import { hasPermission, isOwner } from '@/lib/permissions';
import { useTenantPlanFeatures } from '@/lib/use-tenant-plan-features';
import { useWarehouses } from '@/lib/hooks/useWarehouses';
import { availableQtyOf } from '@/components/document-entry/ProductSearch';
import StockProductPicker from '@/components/document-entry/StockProductPicker';
import { displayInventoryReasonLabel, INVENTORY_REASON_TYPE } from '@/lib/inventory-reason';

/**
 * LOSS writes stock off; FOUND puts a surplus back. They are the same document
 * with the sign flipped, so they share this screen rather than splitting into
 * two that would drift apart — but each has its own reason catalogue, because
 * "Theft" can never explain why a shelf holds more than the book says.
 */
type Direction = 'LOSS' | 'FOUND';

const REASON_TYPE: Record<Direction, string> = {
    LOSS: INVENTORY_REASON_TYPE.PRODUCT_LOST,
    FOUND: INVENTORY_REASON_TYPE.PRODUCT_FOUND,
};

interface ShrinkageRecord {
    id: string;
    reference_number: string;
    created_at: string;
    direction?: Direction | null;
    warehouse?: { name: string } | null;
    reason?: { label: string } | null;
    items: Array<{ id: string; quantity: number }>;
    posting_status?: string | null;
    voucher_number?: string | null;
}

/** The full document behind a list row — what View shows and Edit starts from. */
interface ShrinkageDetail {
    id: string;
    reference_number: string;
    created_at: string;
    direction?: Direction | null;
    notes?: string | null;
    warehouse_id: string;
    reason_id: string;
    warehouse?: { name: string } | null;
    reason?: { label: string } | null;
    items: Array<{
        id: string;
        product_id: string;
        quantity: number;
        unit_cost?: string | number | null;
        note?: string | null;
        product: any;
    }>;
    posting_status?: string | null;
    voucher_number?: string | null;
}

/**
 * A line holds the picked product itself, not just its id: the row has to show
 * what is on the shelf for *that* product, and a write-off must refuse a
 * quantity the warehouse cannot cover before the post is attempted.
 */
interface LineItem {
    productId: string;
    product: any | null;
    quantity: string | number;
}

interface FormErrors {
    warehouseId?: string;
    reasonId?: string;
    notes?: string;
    items: Record<number, { productId?: string; quantity?: string }>;
}

const BLANK_LINE: LineItem = { productId: '', product: null, quantity: 1 };

const EMPTY_FORM = {
    direction: 'LOSS' as Direction,
    warehouseId: '',
    reasonId: '',
    notes: '',
    items: [{ ...BLANK_LINE }],
};

const columnHelper = createColumnHelper<ShrinkageRecord>();

export default function InventoryShrinkagePage() {
    const { t, locale } = useI18n();
    const branch = useBranchScope();
    const listUi = t.inventoryShrinkage.listUi;
    const [records, setRecords] = useState<ShrinkageRecord[]>([]);
    const [reasons, setReasons] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [directionFilter, setDirectionFilter] = useState<'' | Direction>('');
    const [formOpen, setFormOpen] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [errors, setErrors] = useState<FormErrors>({ items: {} });
    /** Set while correcting a posted entry; `null` means the form is a new one. */
    const [editing, setEditing] = useState<{ id: string; reference: string } | null>(null);
    const [detail, setDetail] = useState<ShrinkageDetail | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<ShrinkageRecord | null>(null);
    const [deleting, setDeleting] = useState(false);

    const direction = form.direction;
    const isFound = direction === 'FOUND';

    // Correcting or deleting reverses stock and voids an auto-posted voucher, so
    // those actions are hidden without CANCEL_ENTRY rather than shown and left
    // to a 403. OWNER bypasses the guard server-side and may hold no grants.
    const { permissions, role } = useTenantPlanFeatures();
    const canCorrect = isOwner(role) || hasPermission(permissions, 'CANCEL_ENTRY');

    // The warehouse the server would resolve anyway — the tenant's configured
    // discrepancy default, then the branch's own. Opening the form on a blank
    // required select made every entry start with a choice the system already
    // knew the answer to. A one-warehouse branch never sees the control.
    const { warehouses, defaultWarehouseId, multiple: multipleWarehouses } = useWarehouses('shrinkage');

    useEffect(() => {
        setForm((current) => (current.warehouseId ? current : { ...current, warehouseId: defaultWarehouseId }));
    }, [defaultWarehouseId]);

    useEffect(() => {
        if (!branch.ready) return;
        void loadRecords();
    }, [createdRange, directionFilter, branch.ready, branch.apiStoreId]);

    useEffect(() => {
        void loadReasons();
    }, []);

    const loadRecords = async () => {
        setLoading(true);
        try {
            const data = await api.getInventoryShrinkage({
                ...applyCreatedRangeQuery(createdRange),
                direction: directionFilter || undefined,
                storeId: branch.apiStoreId,
            });
            setRecords(data);
        } catch (error) {
            if (handleBranchForbidden(error, branch, t.dashboardLayout.branchFilterForbidden)) return;
            console.error('Failed to load discrepancies', error);
        } finally {
            setLoading(false);
        }
    };

    // Both reason catalogues in one call: the direction toggle swaps between
    // them without a round trip, and the picker is never briefly empty
    // mid-switch. The products themselves come from the picker's own search.
    const loadReasons = async () => {
        try {
            const reasonData = await api.getInventoryReasons();
            setReasons(reasonData.filter((reason: any) => reason.is_active));
        } catch (error) {
            console.error('Failed to load discrepancy reasons', error);
        }
    };

    const unspecifiedReason = t.inventorySettings.unspecifiedReason;
    const visibleReasons = useMemo(
        () => reasons.filter((reason: any) => reason.type === REASON_TYPE[direction]),
        [reasons, direction],
    );

    const blankForm = (keepDirection: Direction): typeof EMPTY_FORM => ({
        ...EMPTY_FORM,
        direction: keepDirection,
        // The warehouse is the same one for the rest of the shift; re-asking
        // for it on every entry is the kind of blank this form should not have.
        warehouseId: defaultWarehouseId,
        items: [{ ...BLANK_LINE }],
    });

    // A counter working through a stack of found-stock slips shouldn't have to
    // re-pick the entry type on every one, so the last direction survives the
    // close — nothing else does, since a half-typed abandoned entry reappearing
    // on the next open is how the wrong quantity gets posted.
    const openForm = () => {
        setEditing(null);
        setForm((current) => blankForm(current.direction));
        setErrors({ items: {} });
        setFormOpen(true);
    };

    const closeForm = () => {
        setFormOpen(false);
        setEditing(null);
        setErrors({ items: {} });
    };

    /** The posted entry behind a row, with its product stock rows for the form. */
    const fetchRecord = async (id: string): Promise<ShrinkageDetail | null> => {
        try {
            return await api.getInventoryShrinkageRecord(id);
        } catch (error: any) {
            toast.error(error.message || t.common.loadFailed);
            return null;
        }
    };

    const openDetail = async (id: string) => {
        const record = await fetchRecord(id);
        if (record) setDetail(record);
    };

    const openEdit = async (id: string) => {
        const record = await fetchRecord(id);
        if (!record) return;

        setEditing({ id: record.id, reference: record.reference_number });
        setForm({
            // The direction is fixed by the stored entry — a correction cannot
            // turn a write-off into a surplus, and the server refuses to try.
            direction: record.direction === 'FOUND' ? 'FOUND' : 'LOSS',
            warehouseId: record.warehouse_id,
            reasonId: record.reason_id,
            notes: record.notes ?? '',
            items: record.items.map((item) => ({
                productId: item.product_id,
                product: item.product,
                quantity: item.quantity,
            })),
        });
        setErrors({ items: {} });
        setFormOpen(true);
    };

    const setField = (patch: Partial<typeof EMPTY_FORM>) => setForm((current) => ({ ...current, ...patch }));

    const setLine = (index: number, patch: Partial<LineItem>) =>
        setForm((current) => ({
            ...current,
            items: current.items.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
        }));

    /**
     * What a line's product has on hand in the entry's warehouse.
     *
     * `null` when the figure is not known: a product picked from the search
     * carries its stock rows, but one restored from a posted entry may not, and
     * refusing a line on a zero we made up would be worse than letting the
     * server refuse it. Only a write-off is bounded by it — found stock is a
     * surplus, so there is no ceiling to check.
     */
    const availableFor = (line: LineItem): number | null => {
        if (!line.product || !Array.isArray(line.product.stocks)) return null;
        return availableQtyOf(line.product, form.warehouseId || undefined);
    };

    const overStockAt = (line: LineItem): number | null => {
        if (isFound) return null;
        const available = availableFor(line);
        if (available === null) return null;
        const quantity = Number(line.quantity);
        return Number.isInteger(quantity) && quantity > available ? available : null;
    };

    /**
     * Every rule the server enforces, checked here too so the counter sees
     * which field is wrong rather than one banner for the whole form. The
     * server remains the authority — this only saves a round trip, and the
     * over-stock check is the one that used to arrive as a toast naming a
     * product uuid.
     */
    const validate = (): FormErrors | null => {
        const next: FormErrors = { items: {} };
        if (!form.warehouseId) next.warehouseId = t.inventoryShrinkage.warehouseRequired;
        if (!form.reasonId) next.reasonId = t.inventoryShrinkage.reasonRequired;
        if (!form.notes.trim()) next.notes = t.inventoryShrinkage.noteRequired;

        form.items.forEach((line, index) => {
            const lineErrors: { productId?: string; quantity?: string } = {};
            if (!line.productId) lineErrors.productId = t.inventoryShrinkage.productRequired;
            if (!Number.isInteger(Number(line.quantity)) || Number(line.quantity) < 1) {
                lineErrors.quantity = t.inventoryShrinkage.quantityRequired;
            } else {
                const available = overStockAt(line);
                if (available !== null) {
                    lineErrors.quantity = t.inventoryShrinkage.quantityExceedsStock.replace('{qty}', String(available));
                }
            }
            if (Object.keys(lineErrors).length > 0) next.items[index] = lineErrors;
        });

        const hasError =
            Boolean(next.warehouseId || next.reasonId || next.notes) || Object.keys(next.items).length > 0;
        return hasError ? next : null;
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        const invalid = validate();
        setErrors(invalid ?? { items: {} });
        if (invalid) return;

        setSaving(true);
        try {
            const items = form.items.map((item) => ({
                productId: item.productId,
                quantity: Number(item.quantity),
            }));

            if (editing) {
                // Direction and warehouse are the document's identity; only the
                // reason, the note and the lines are sent.
                await api.updateInventoryShrinkage(editing.id, {
                    reasonId: form.reasonId,
                    notes: form.notes.trim(),
                    items,
                });
                toast.success(t.common.saved);
            } else {
                await api.createInventoryShrinkage({
                    direction,
                    warehouseId: form.warehouseId,
                    reasonId: form.reasonId,
                    notes: form.notes.trim(),
                    items,
                });
                toast.success(isFound ? t.inventoryShrinkage.foundPosted : t.inventoryShrinkage.posted);
            }

            setForm(blankForm(direction));
            setFormOpen(false);
            setEditing(null);
            await loadRecords();
        } catch (error: any) {
            toast.error(
                error.message
                    || (editing
                        ? t.common.saveFailed
                        : isFound ? t.inventoryShrinkage.postFoundFailed : t.inventoryShrinkage.postFailed),
            );
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await api.deleteInventoryShrinkage(deleteTarget.id);
            toast.success(t.common.deleted);
            setDeleteTarget(null);
            if (detail?.id === deleteTarget.id) setDetail(null);
            await loadRecords();
        } catch (error: any) {
            toast.error(error.message || t.common.deleteFailed);
        } finally {
            setDeleting(false);
        }
    };

    const columns: ColumnDef<ShrinkageRecord, any>[] = useMemo(
        () => [
            columnHelper.accessor('reference_number', { header: t.inventoryShrinkage.columns.reference, size: 150 }),
            columnHelper.display({
                id: 'direction',
                header: t.inventoryShrinkage.columns.direction,
                // Rows written before found-stock entry existed carry no
                // direction of their own; every one of them is a write-off.
                cell: ({ row }) =>
                    row.original.direction === 'FOUND' ? (
                        <StatusBadge tone="info">{t.inventoryShrinkage.directionFound}</StatusBadge>
                    ) : (
                        <StatusBadge tone="danger">{t.inventoryShrinkage.directionLoss}</StatusBadge>
                    ),
                size: 150,
            }),
            columnHelper.accessor((row) => row.warehouse?.name || '-', { id: 'warehouse', header: t.inventoryShrinkage.columns.warehouse, size: 180 }),
            columnHelper.accessor(
                (row) => (row.reason ? displayInventoryReasonLabel(row.reason, unspecifiedReason) : '-'),
                { id: 'reason', header: t.inventoryShrinkage.columns.reason, size: 170 },
            ),
            columnHelper.accessor((row) => row.items.reduce((sum, item) => sum + item.quantity, 0), {
                id: 'quantity',
                header: t.inventoryShrinkage.columns.totalQty,
                cell: (info) => <span className="tabular-nums">{info.getValue()}</span>,
                size: 110,
                meta: { align: 'end' },
            }),
            createdAtColumn(columnHelper, { header: t.common.createdAt }),
            columnHelper.display({
                id: 'posting',
                header: t.inventoryShrinkage.columns.voucher,
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
                cell: ({ row }) => (
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => void openDetail(row.original.id)}
                            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
                            title={t.common.view}
                            aria-label={t.common.view}
                        >
                            <Eye className="h-4 w-4" />
                        </button>
                        {canCorrect ? (
                            <>
                                <button
                                    type="button"
                                    onClick={() => void openEdit(row.original.id)}
                                    className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
                                    title={t.common.edit}
                                    aria-label={t.common.edit}
                                >
                                    <Pencil className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setDeleteTarget(row.original)}
                                    className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                                    title={t.common.delete}
                                    aria-label={t.common.delete}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </>
                        ) : null}
                    </div>
                ),
                enableSorting: false,
                enableResizing: false,
                size: 120,
            }),
        ],
        [t, canCorrect, unspecifiedReason],
    );

    const filters = useMemo<ListFilter[]>(() => [
        { id: 'created', type: 'date-range', value: createdRange, onChange: setCreatedRange, operators: true },
        {
            id: 'direction',
            type: 'select',
            label: t.inventoryShrinkage.filterLabel,
            value: directionFilter || null,
            onChange: (next) => setDirectionFilter((next as Direction | null) ?? ''),
            options: [
                { value: 'LOSS', label: t.inventoryShrinkage.directionLoss },
                { value: 'FOUND', label: t.inventoryShrinkage.directionFound },
            ],
        },
    ], [createdRange, directionFilter, t]);

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const loss = records.filter((row) => row.direction !== 'FOUND').length;
        const found = records.filter((row) => row.direction === 'FOUND').length;
        const totalQty = records.reduce(
            (sum, row) => sum + row.items.reduce((lineSum, item) => lineSum + item.quantity, 0),
            0,
        );
        const items: ListStat[] = [
            { id: 'total', icon: <Hash aria-hidden />, label: listUi.total, value: n(records.length) },
            { id: 'loss', icon: <AlertTriangle aria-hidden />, label: t.inventoryShrinkage.directionLoss, value: n(loss) },
            { id: 'found', icon: <PackagePlus aria-hidden />, label: t.inventoryShrinkage.directionFound, value: n(found) },
            { id: 'qty', icon: <Scale aria-hidden />, label: listUi.totalQty, value: n(totalQty) },
        ];
        return { items, loading, label: listUi.statsLabel };
    }, [records, loading, locale, listUi, t]);

    const detailValue = detail
        ? detail.items.reduce((sum, item) => sum + Number(item.unit_cost ?? 0) * item.quantity, 0)
        : 0;

    return (
        <PageShell>
                <PageHeader
                    title={t.inventoryShrinkage.title}
                    subtitle={t.inventoryShrinkage.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.inventory,
                        t.inventoryShrinkage.title,
                        'inventory',
                    )}
                    actions={(
                        <>
                            <BranchFilter scope={branch} />
                            <Button onClick={openForm} icon={<Plus className="w-4 h-4" />}>
                                {t.inventoryShrinkage.newEntry}
                            </Button>
                        </>
                    )}
                />

                <DataTable<ShrinkageRecord>
                    tableId="inventory-shrinkage"
                    columns={columns}
                    data={records}
                    title={t.inventoryShrinkage.title}
                    isLoading={loading}
                    emptyMessage={t.inventoryShrinkage.emptyMessage}
                    emptyIcon={<AlertTriangle className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.inventoryShrinkage.searchPlaceholder}
                    filters={filters}
                    filterLayout="row"
                    stats={stats}
                    enableColumnFilters={false}
                    viewOptions
                />

                {detail ? (
                    <ModalShell size="lg" onBackdropClick={() => setDetail(null)}>
                        <ModalHeader
                            title={(
                                <span className="inline-flex items-center gap-2">
                                    {detail.direction === 'FOUND' ? (
                                        <PackagePlus className="w-5 h-5 text-blue-600" />
                                    ) : (
                                        <AlertTriangle className="w-5 h-5 text-danger" />
                                    )}
                                    {detail.reference_number}
                                </span>
                            )}
                            onClose={() => setDetail(null)}
                            closeLabel={t.common.close}
                        />

                        <div className="flex-1 space-y-4 overflow-y-auto p-4">
                            <div className="grid gap-3 md:grid-cols-2">
                                <div>
                                    <p className="text-xs font-medium text-gray-600">{t.inventoryShrinkage.columns.direction}</p>
                                    <p className="mt-1 text-sm">
                                        {detail.direction === 'FOUND'
                                            ? t.inventoryShrinkage.directionFound
                                            : t.inventoryShrinkage.directionLoss}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-xs font-medium text-gray-600">{t.inventoryShrinkage.columns.warehouse}</p>
                                    <p className="mt-1 text-sm">{detail.warehouse?.name || '-'}</p>
                                </div>
                                <div>
                                    <p className="text-xs font-medium text-gray-600">{t.inventoryShrinkage.columns.reason}</p>
                                    <p className="mt-1 text-sm">
                                        {detail.reason
                                            ? displayInventoryReasonLabel(detail.reason, unspecifiedReason)
                                            : '-'}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-xs font-medium text-gray-600">{t.common.createdAt}</p>
                                    <p className="mt-1 text-sm">{formatDateTime(detail.created_at, locale)}</p>
                                </div>
                            </div>

                            <div>
                                <p className="text-xs font-medium text-gray-600">{t.inventoryShrinkage.notes}</p>
                                <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">{detail.notes || '-'}</p>
                            </div>

                            <div className="overflow-hidden rounded border border-gray-200">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 text-xs text-gray-500">
                                        <tr>
                                            <th className="px-3 py-2 text-start font-medium">{t.inventoryShrinkage.selectProduct}</th>
                                            <th className="px-3 py-2 text-end font-medium">{t.inventoryShrinkage.columns.totalQty}</th>
                                            <th className="px-3 py-2 text-end font-medium">{t.inventoryShrinkage.unitCost}</th>
                                            <th className="px-3 py-2 text-end font-medium">{t.common.amount}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {detail.items.map((item) => (
                                            <tr key={item.id} className="border-t border-gray-100">
                                                <td className="px-3 py-2">
                                                    <div className="text-gray-900">{item.product?.name ?? item.product_id}</div>
                                                    {item.note ? <div className="text-xs text-gray-500">{item.note}</div> : null}
                                                </td>
                                                <td className="px-3 py-2 text-end tabular-nums">{item.quantity}</td>
                                                <td className="px-3 py-2 text-end tabular-nums">
                                                    {item.unit_cost == null ? '-' : formatBDT(Number(item.unit_cost), { locale })}
                                                </td>
                                                <td className="px-3 py-2 text-end tabular-nums">
                                                    {formatBDT(Number(item.unit_cost ?? 0) * item.quantity, { locale })}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="bg-gray-50">
                                        <tr className="border-t border-gray-200">
                                            <td className="px-3 py-2 font-medium text-gray-700" colSpan={3}>{t.common.total}</td>
                                            <td className="px-3 py-2 text-end font-semibold tabular-nums">{formatBDT(detailValue, { locale })}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>

                            {detail.voucher_number ? (
                                <p className="text-xs text-gray-500">
                                    {t.inventoryShrinkage.columns.voucher}: {detail.voucher_number}
                                </p>
                            ) : null}
                        </div>

                        <ModalFooter>
                            <Button variant="secondary" onClick={() => setDetail(null)}>
                                {t.common.close}
                            </Button>
                            {canCorrect ? (
                                <Button
                                    onClick={() => {
                                        const id = detail.id;
                                        setDetail(null);
                                        void openEdit(id);
                                    }}
                                    icon={<Pencil className="w-4 h-4" />}
                                >
                                    {t.common.edit}
                                </Button>
                            ) : null}
                        </ModalFooter>
                    </ModalShell>
                ) : null}

                {formOpen ? (
                    <ModalShell size="lg" onBackdropClick={closeForm}>
                        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
                            <ModalHeader
                                title={(
                                    <span className="inline-flex items-center gap-2">
                                        {isFound ? (
                                            <PackagePlus className="w-5 h-5 text-blue-600" />
                                        ) : (
                                            <AlertTriangle className="w-5 h-5 text-danger" />
                                        )}
                                        {editing
                                            ? `${t.common.edit} · ${editing.reference}`
                                            : isFound
                                                ? t.inventoryShrinkage.newFoundEntry
                                                : t.inventoryShrinkage.newEntry}
                                    </span>
                                )}
                                onClose={closeForm}
                                closeLabel={t.common.close}
                            />

                            <div className="flex-1 space-y-4 overflow-y-auto p-4">
                                {visibleReasons.length === 0 ? (
                                    <Alert tone="warning">
                                        {isFound ? t.inventoryShrinkage.noFoundReasons : t.inventoryShrinkage.noLossReasons}{' '}
                                        <Link href={routes.inventory.settings} className="font-medium text-blue-600 underline">
                                            {t.sidebar.modules.inventory}
                                        </Link>
                                    </Alert>
                                ) : null}

                                <div className="grid md:grid-cols-2 gap-3">
                                    <Field label={t.inventoryShrinkage.directionLabel} required htmlFor="shrinkage-direction">
                                        <Select
                                            id="shrinkage-direction"
                                            value={direction}
                                            // Direction decides the reference series and the
                                            // sign of every movement, so a posted entry
                                            // keeps the one it was written with.
                                            disabled={Boolean(editing)}
                                            // The reason catalogues are disjoint, so a reason
                                            // picked for one direction is never valid for the
                                            // other — clear it rather than post a mismatch.
                                            onChange={(event) =>
                                                setField({ direction: event.target.value as Direction, reasonId: '' })
                                            }
                                        >
                                            <option value="LOSS">{t.inventoryShrinkage.directionLoss}</option>
                                            <option value="FOUND">{t.inventoryShrinkage.directionFound}</option>
                                        </Select>
                                    </Field>
                                    {multipleWarehouses && !editing ? (
                                        <Field
                                            label={t.inventoryShrinkage.columns.warehouse}
                                            required
                                            error={errors.warehouseId}
                                            htmlFor="shrinkage-warehouse"
                                        >
                                            <Select
                                                id="shrinkage-warehouse"
                                                error={Boolean(errors.warehouseId)}
                                                value={form.warehouseId}
                                                onChange={(event) => setField({ warehouseId: event.target.value })}
                                            >
                                                <option value="">{t.inventoryShrinkage.selectWarehouse}</option>
                                                {warehouses.map((warehouse) => (
                                                    <option key={warehouse.id} value={warehouse.id}>{warehouseLabel(warehouse, warehouses)}</option>
                                                ))}
                                            </Select>
                                        </Field>
                                    ) : null}
                                    <Field
                                        label={t.inventoryShrinkage.columns.reason}
                                        required
                                        error={errors.reasonId}
                                        htmlFor="shrinkage-reason"
                                    >
                                        <Select
                                            id="shrinkage-reason"
                                            error={Boolean(errors.reasonId)}
                                            value={form.reasonId}
                                            onChange={(event) => setField({ reasonId: event.target.value })}
                                        >
                                            <option value="">{t.inventoryShrinkage.selectReason}</option>
                                            {visibleReasons.map((reason) => (
                                                <option key={reason.id} value={reason.id}>
                                                    {displayInventoryReasonLabel(reason, unspecifiedReason)}
                                                </option>
                                            ))}
                                        </Select>
                                    </Field>
                                    <Field
                                        label={t.inventoryShrinkage.notes}
                                        required
                                        error={errors.notes}
                                        hint={t.inventoryShrinkage.noteHelp}
                                        htmlFor="shrinkage-notes"
                                    >
                                        <Input
                                            id="shrinkage-notes"
                                            error={Boolean(errors.notes)}
                                            value={form.notes}
                                            onChange={(event) => setField({ notes: event.target.value })}
                                            placeholder={t.inventoryShrinkage.notes}
                                        />
                                    </Field>
                                </div>

                                <div className="space-y-3">
                                    {form.items.map((item, index) => {
                                        const overStock = overStockAt(item);
                                        // A product already on another line may not be
                                        // picked again — the server rejects duplicate
                                        // lines, so offering it only leads to a failed
                                        // post after the whole form is filled in.
                                        const takenIds = form.items
                                            .filter((_, lineIndex) => lineIndex !== index)
                                            .map((line) => line.productId)
                                            .filter(Boolean);
                                        return (
                                            <div key={index} className="space-y-1">
                                                <div className="grid md:grid-cols-[1fr_160px_120px] gap-3 items-start">
                                                    <Field
                                                        label={t.inventoryShrinkage.selectProduct}
                                                        required
                                                        error={errors.items[index]?.productId}
                                                        htmlFor={`shrinkage-product-${index}`}
                                                    >
                                                        <StockProductPicker
                                                            id={`shrinkage-product-${index}`}
                                                            value={item.productId}
                                                            takenIds={takenIds}
                                                            onChange={(product) => setLine(index, {
                                                                productId: product?.id ?? '',
                                                                product,
                                                            })}
                                                            placeholder={t.inventoryShrinkage.selectProduct}
                                                            searchPlaceholder={t.inventoryShrinkage.popularProducts}
                                                            emptyLabel={t.inventoryShrinkage.typeToSearch}
                                                            noMatchLabel={t.inventoryShrinkage.noProductsFound}
                                                            clearLabel={t.inventoryShrinkage.clearProduct}
                                                            subtitle={(product) => {
                                                                const stock = availableQtyOf(product, form.warehouseId || undefined);
                                                                const sku = product.sku ? `${product.sku} · ` : '';
                                                                return `${sku}${t.inventoryShrinkage.availableInWarehouse.replace('{qty}', String(stock))}`;
                                                            }}
                                                        />
                                                    </Field>
                                                    <Field
                                                        label={t.inventoryShrinkage.columns.totalQty}
                                                        required
                                                        error={errors.items[index]?.quantity}
                                                        htmlFor={`shrinkage-quantity-${index}`}
                                                    >
                                                        <Input
                                                            id={`shrinkage-quantity-${index}`}
                                                            type="number"
                                                            min="1"
                                                            step="1"
                                                            error={Boolean(errors.items[index]?.quantity)}
                                                            value={item.quantity}
                                                            onChange={(event) => setLine(index, { quantity: event.target.value })}
                                                        />
                                                    </Field>
                                                    <Button
                                                        variant="secondary"
                                                        className="md:mt-5"
                                                        onClick={() =>
                                                            setForm((current) => ({
                                                                ...current,
                                                                items: current.items.length === 1
                                                                    ? current.items
                                                                    : current.items.filter((_, lineIndex) => lineIndex !== index),
                                                            }))
                                                        }
                                                    >
                                                        {t.inventoryShrinkage.remove}
                                                    </Button>
                                                </div>
                                                {item.product ? (
                                                    <p className="ms-1 text-xs text-gray-500">
                                                        {t.inventoryShrinkage.availableInWarehouse.replace(
                                                            '{qty}',
                                                            String(availableFor(item) ?? 0),
                                                        )}
                                                        {overStock !== null ? (
                                                            <span className="text-amber-700"> · {t.inventoryShrinkage.exceedsStock}</span>
                                                        ) : null}
                                                    </p>
                                                ) : null}
                                            </div>
                                        );
                                    })}
                                </div>

                                <Button
                                    variant="secondary"
                                    icon={<Plus className="w-4 h-4" />}
                                    onClick={() =>
                                        setForm((current) => ({ ...current, items: [...current.items, { ...BLANK_LINE }] }))
                                    }
                                >
                                    {t.inventoryShrinkage.addLine}
                                </Button>
                            </div>

                            <ModalFooter>
                                <Button variant="secondary" onClick={closeForm} disabled={saving}>
                                    {t.common.cancel}
                                </Button>
                                <Button type="submit" variant={isFound ? 'primary' : 'danger'} loading={saving}>
                                    {editing
                                        ? t.common.saveChanges
                                        : isFound
                                            ? t.inventoryShrinkage.postFound
                                            : t.inventoryShrinkage.postShrinkage}
                                </Button>
                            </ModalFooter>
                        </form>
                    </ModalShell>
                ) : null}

                <ConfirmDialog
                    open={Boolean(deleteTarget)}
                    title={t.inventoryShrinkage.deleteTitle}
                    prompt={t.inventoryShrinkage.deleteDescription.replace(
                        '{reference}',
                        deleteTarget?.reference_number ?? '',
                    )}
                    confirmLabel={t.common.delete}
                    cancelLabel={t.common.cancel}
                    workingLabel={t.common.delete}
                    loading={deleting}
                    danger
                    onConfirm={() => void handleDelete()}
                    onCancel={() => setDeleteTarget(null)}
                />
    </PageShell>
    );
}
