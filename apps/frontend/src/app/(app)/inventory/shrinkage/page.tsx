'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, PackagePlus, Plus } from 'lucide-react';
import { DataTable, createdAtColumn, CreatedRangeFilter } from '@/components/data-table';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import { warehouseLabel } from '@/lib/warehouse-label';
import { api } from '@/lib/api';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import { PostingBadge } from '@/components/PostingBadge';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { Alert, Button, Field, Input, Select, StatusBadge } from '@/components/ui';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useI18n } from '@/lib/i18n';

/**
 * LOSS writes stock off; FOUND puts a surplus back. They are the same document
 * with the sign flipped, so they share this screen rather than splitting into
 * two that would drift apart — but each has its own reason catalogue, because
 * "Theft" can never explain why a shelf holds more than the book says.
 */
type Direction = 'LOSS' | 'FOUND';

const REASON_TYPE: Record<Direction, string> = { LOSS: 'SHRINKAGE', FOUND: 'FOUND' };

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

interface LineItem {
    productId: string;
    quantity: string | number;
}

interface FormErrors {
    warehouseId?: string;
    reasonId?: string;
    notes?: string;
    items: Record<number, { productId?: string; quantity?: string }>;
}

const EMPTY_FORM = {
    direction: 'LOSS' as Direction,
    warehouseId: '',
    reasonId: '',
    notes: '',
    items: [{ productId: '', quantity: 1 }] as LineItem[],
};

const columnHelper = createColumnHelper<ShrinkageRecord>();

export default function InventoryShrinkagePage() {
    const { t } = useI18n();
    const [records, setRecords] = useState<ShrinkageRecord[]>([]);
    const [warehouses, setWarehouses] = useState<any[]>([]);
    const [reasons, setReasons] = useState<any[]>([]);
    const [products, setProducts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [directionFilter, setDirectionFilter] = useState<'' | Direction>('');
    const [formOpen, setFormOpen] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [errors, setErrors] = useState<FormErrors>({ items: {} });

    const direction = form.direction;
    const isFound = direction === 'FOUND';

    useEffect(() => {
        void loadRecords();
    }, [createdRange, directionFilter]);

    useEffect(() => {
        void loadOptions();
    }, []);

    const loadRecords = async () => {
        setLoading(true);
        try {
            const data = await api.getInventoryShrinkage({
                ...applyCreatedRangeQuery(createdRange),
                direction: directionFilter || undefined,
            });
            setRecords(data);
        } catch (error) {
            console.error('Failed to load shrinkage records', error);
        } finally {
            setLoading(false);
        }
    };

    // Both catalogues in one call: the direction toggle swaps between them
    // without a round trip, and the picker is never briefly empty mid-switch.
    const loadOptions = async () => {
        try {
            const [warehouseData, reasonData, productData] = await Promise.all([
                api.getInventoryWarehouses(),
                api.getInventoryReasons(),
                api.getProducts(),
            ]);
            setWarehouses(warehouseData.filter((warehouse: any) => warehouse.is_active));
            setReasons(reasonData.filter((reason: any) => reason.is_active));
            setProducts(productData);
        } catch (error) {
            console.error('Failed to load shrinkage options', error);
        }
    };

    const visibleReasons = useMemo(
        () => reasons.filter((reason: any) => reason.type === REASON_TYPE[direction]),
        [reasons, direction],
    );

    const blankForm = (keepDirection: Direction) => ({
        ...EMPTY_FORM,
        direction: keepDirection,
        items: [{ productId: '', quantity: 1 }],
    });

    // A counter working through a stack of found-stock slips shouldn't have to
    // re-pick the entry type on every one, so the last direction survives the
    // close — nothing else does, since a half-typed abandoned entry reappearing
    // on the next open is how the wrong quantity gets posted.
    const openForm = () => {
        setForm((current) => blankForm(current.direction));
        setErrors({ items: {} });
        setFormOpen(true);
    };

    const closeForm = () => {
        setFormOpen(false);
        setErrors({ items: {} });
    };

    const setField = (patch: Partial<typeof EMPTY_FORM>) => setForm((current) => ({ ...current, ...patch }));

    const setLine = (index: number, patch: Partial<LineItem>) =>
        setForm((current) => ({
            ...current,
            items: current.items.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
        }));

    /**
     * Every rule the server enforces, checked here too so the counter sees
     * which field is wrong rather than one banner for the whole form. The
     * server remains the authority — this only saves a round trip.
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
            }
            if (Object.keys(lineErrors).length > 0) next.items[index] = lineErrors;
        });

        const hasError =
            Boolean(next.warehouseId || next.reasonId || next.notes) || Object.keys(next.items).length > 0;
        return hasError ? next : null;
    };

    const handleCreate = async (event: React.FormEvent) => {
        event.preventDefault();
        const invalid = validate();
        setErrors(invalid ?? { items: {} });
        if (invalid) return;

        setSaving(true);
        try {
            await api.createInventoryShrinkage({
                direction,
                warehouseId: form.warehouseId,
                reasonId: form.reasonId,
                notes: form.notes.trim(),
                items: form.items.map((item) => ({ productId: item.productId, quantity: Number(item.quantity) })),
            });
            toast.success(isFound ? t.inventoryShrinkage.foundPosted : t.inventoryShrinkage.posted);
            setForm(blankForm(direction));
            setFormOpen(false);
            await loadRecords();
        } catch (error: any) {
            toast.error(
                error.message || (isFound ? t.inventoryShrinkage.postFoundFailed : t.inventoryShrinkage.postFailed),
            );
        } finally {
            setSaving(false);
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
            columnHelper.accessor((row) => row.reason?.label || '-', { id: 'reason', header: t.inventoryShrinkage.columns.reason, size: 170 }),
            columnHelper.accessor((row) => row.items.reduce((sum, item) => sum + item.quantity, 0), { id: 'quantity', header: t.inventoryShrinkage.columns.totalQty, size: 110 }),
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
        ],
        [t],
    );

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
                        <Button onClick={openForm} icon={<Plus className="w-4 h-4" />}>
                            {t.inventoryShrinkage.newEntry}
                        </Button>
                    )}
                />

                <div className="flex flex-wrap items-center gap-2">
                    <CreatedRangeFilter value={createdRange} onChange={setCreatedRange} />
                    <Select
                        // Named apart from the form's own entry-type control:
                        // two selects sharing an accessible name leave a screen
                        // reader with no way to tell the filter from the field.
                        aria-label={t.inventoryShrinkage.filterLabel}
                        value={directionFilter}
                        onChange={(event) => setDirectionFilter(event.target.value as '' | Direction)}
                    >
                        <option value="">{t.inventoryShrinkage.filterAll}</option>
                        <option value="LOSS">{t.inventoryShrinkage.directionLoss}</option>
                        <option value="FOUND">{t.inventoryShrinkage.directionFound}</option>
                    </Select>
                </div>
                <DataTable<ShrinkageRecord>
                    tableId="inventory-shrinkage"
                    columns={columns}
                    data={records}
                    title={t.inventoryShrinkage.title}
                    isLoading={loading}
                    emptyMessage={t.inventoryShrinkage.emptyMessage}
                    emptyIcon={<AlertTriangle className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.inventoryShrinkage.searchPlaceholder}
                />

                {formOpen ? (
                    <ModalShell size="lg" onBackdropClick={closeForm}>
                        <form onSubmit={handleCreate} className="flex min-h-0 flex-1 flex-col" noValidate>
                            <ModalHeader
                                title={(
                                    <span className="inline-flex items-center gap-2">
                                        {isFound ? (
                                            <PackagePlus className="w-5 h-5 text-blue-600" />
                                        ) : (
                                            <AlertTriangle className="w-5 h-5 text-danger" />
                                        )}
                                        {isFound ? t.inventoryShrinkage.newFoundEntry : t.inventoryShrinkage.newEntry}
                                    </span>
                                )}
                                onClose={closeForm}
                                closeLabel={t.common.close}
                            />

                            <div className="flex-1 space-y-4 overflow-y-auto p-4">
                                {isFound && visibleReasons.length === 0 ? (
                                    <Alert tone="warning">
                                        {t.inventoryShrinkage.noFoundReasons}{' '}
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
                                                <option key={reason.id} value={reason.id}>{reason.label}</option>
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
                                    {form.items.map((item, index) => (
                                        <div key={index} className="grid md:grid-cols-[1fr_160px_120px] gap-3 items-start">
                                            <Field
                                                label={t.inventoryShrinkage.selectProduct}
                                                required
                                                error={errors.items[index]?.productId}
                                                htmlFor={`shrinkage-product-${index}`}
                                            >
                                                <Select
                                                    id={`shrinkage-product-${index}`}
                                                    error={Boolean(errors.items[index]?.productId)}
                                                    value={item.productId}
                                                    onChange={(event) => setLine(index, { productId: event.target.value })}
                                                >
                                                    <option value="">{t.inventoryShrinkage.selectProduct}</option>
                                                    {products.map((product) => (
                                                        <option key={product.id} value={product.id}>{product.name}</option>
                                                    ))}
                                                </Select>
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
                                    ))}
                                </div>

                                <Button
                                    variant="secondary"
                                    icon={<Plus className="w-4 h-4" />}
                                    onClick={() =>
                                        setForm((current) => ({ ...current, items: [...current.items, { productId: '', quantity: 1 }] }))
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
                                    {isFound ? t.inventoryShrinkage.postFound : t.inventoryShrinkage.postShrinkage}
                                </Button>
                            </ModalFooter>
                        </form>
                    </ModalShell>
                ) : null}
    </PageShell>
    );
}
