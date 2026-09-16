'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Warehouse, Plus, Pencil, Upload, Power, Star } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { Button, Field, StatusBadge } from '@/components/ui';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useI18n } from '@/lib/i18n';
import { ImportDialog, type ImportField } from '@/components/import-dialog';

const IMPORT_FIELDS: ImportField[] = [
    { key: 'name', label: 'Name', required: true },
];

interface WarehouseRow {
    id: string;
    name: string;
    code: string | null;
    store_id: string;
    is_default: boolean;
    is_active: boolean;
}

interface Store {
    id: string;
    name: string;
}

const emptyForm = { storeId: '', name: '', code: '' };

const columnHelper = createColumnHelper<WarehouseRow>();

export default function WarehousesPage() {
    const { t } = useI18n();
    const s = t.warehousesPage;
    const settings = t.inventorySettings;

    const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
    const [stores, setStores] = useState<Store[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<WarehouseRow | null>(null);
    const [form, setForm] = useState(emptyForm);
    const [errors, setErrors] = useState<{ name?: string; storeId?: string }>({});
    const [saving, setSaving] = useState(false);
    const [importOpen, setImportOpen] = useState(false);

    useEffect(() => {
        void load();
    }, []);

    const load = async () => {
        setLoading(true);
        try {
            const [warehouseData, storeData] = await Promise.all([
                api.getInventoryWarehouses(),
                api.getStores(),
            ]);
            setWarehouses(warehouseData);
            setStores(storeData);
        } catch (error) {
            console.error('Failed to load warehouses', error);
        } finally {
            setLoading(false);
        }
    };

    const storeName = (id: string) => stores.find((store) => store.id === id)?.name ?? '-';

    const openCreate = () => {
        setEditTarget(null);
        // One branch is the overwhelmingly common case, so preselect it rather
        // than making the user choose from a list of one.
        setForm({ ...emptyForm, storeId: stores.length === 1 ? stores[0].id : '' });
        setErrors({});
        setModalOpen(true);
    };

    const openEdit = (warehouse: WarehouseRow) => {
        setEditTarget(warehouse);
        setForm({ storeId: warehouse.store_id, name: warehouse.name, code: warehouse.code ?? '' });
        setErrors({});
        setModalOpen(true);
    };

    const closeModal = () => {
        setModalOpen(false);
        setEditTarget(null);
        setErrors({});
    };

    const handleSave = async () => {
        const name = form.name.trim();
        // The branch a warehouse belongs to is fixed once it exists, so an edit
        // is always checked against the branch it is already in.
        const storeId = editTarget ? editTarget.store_id : form.storeId;
        const nextErrors: { name?: string; storeId?: string } = {};

        if (!name) nextErrors.name = s.nameRequired;
        // A branch may not hold two warehouses of the same name — the pickers on
        // the entry screens show the name alone. The server enforces this; doing
        // it here too means the answer arrives as the user types rather than
        // after a round trip that loses the form.
        else if (warehouses.some((warehouse) => (
            warehouse.id !== editTarget?.id
            && warehouse.store_id === storeId
            && warehouse.name.trim().toLowerCase() === name.toLowerCase()
        ))) nextErrors.name = s.nameDuplicate;

        // The branch is fixed once a warehouse exists — moving stock between
        // branches is a transfer, not an edit — so only creation validates it.
        if (!editTarget && !form.storeId) nextErrors.storeId = s.branchRequired;
        if (Object.keys(nextErrors).length > 0) {
            setErrors(nextErrors);
            return;
        }

        setSaving(true);
        try {
            if (editTarget) {
                await api.updateInventoryWarehouse(editTarget.id, {
                    name,
                    code: form.code.trim() || undefined,
                });
                toast.success(settings.warehouseUpdated);
            } else {
                await api.createInventoryWarehouse({
                    storeId: form.storeId,
                    name,
                    code: form.code.trim() || undefined,
                });
                toast.success(settings.warehouseCreated);
            }
            closeModal();
            await load();
        } catch (error: any) {
            toast.error(error.message || settings.warehouseUpdateFailed);
        } finally {
            setSaving(false);
        }
    };

    const handleToggle = async (warehouse: WarehouseRow) => {
        try {
            await api.updateInventoryWarehouse(warehouse.id, { isActive: !warehouse.is_active });
            toast.success(settings.warehouseUpdated);
            await load();
        } catch (error: any) {
            toast.error(error.message || settings.warehouseUpdateFailed);
        }
    };

    const handleMakeDefault = async (warehouse: WarehouseRow) => {
        try {
            await api.updateInventoryWarehouse(warehouse.id, { isDefault: true });
            toast.success(settings.warehouseDefaultUpdated);
            await load();
        } catch (error: any) {
            toast.error(error.message || settings.warehouseDefaultFailed);
        }
    };

    const columns: ColumnDef<WarehouseRow, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: settings.warehouseName,
                cell: (info) => (
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-gray-900">{info.getValue()}</span>
                        {info.row.original.is_default && (
                            <StatusBadge tone="info">{settings.default}</StatusBadge>
                        )}
                    </div>
                ),
                size: 240,
            }),
            columnHelper.accessor('code', {
                header: s.code,
                cell: (info) => <span className="text-sm text-gray-500">{info.getValue() || '-'}</span>,
                size: 120,
            }),
            columnHelper.accessor('store_id', {
                header: s.branch,
                cell: (info) => <span className="text-sm text-gray-500">{storeName(info.getValue())}</span>,
                size: 180,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('is_active', {
                header: s.status,
                cell: (info) => (
                    <StatusBadge tone={info.getValue() ? 'success' : 'neutral'}>
                        {info.getValue() ? settings.active : settings.inactive}
                    </StatusBadge>
                ),
                size: 110,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: (info) => {
                    const warehouse = info.row.original;
                    return (
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => openEdit(warehouse)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors min-h-touch md:min-h-0"
                                title={t.common.edit}
                            >
                                <Pencil className="w-4 h-4" />
                            </button>
                            {!warehouse.is_default && warehouse.is_active && (
                                <button
                                    onClick={() => void handleMakeDefault(warehouse)}
                                    className="px-2 py-1.5 rounded-lg text-xs font-bold text-gray-600 hover:text-blue-600 hover:bg-blue-50 transition-colors inline-flex items-center gap-1 min-h-touch md:min-h-0"
                                >
                                    <Star className="w-3.5 h-3.5" />
                                    {settings.makeDefault}
                                </button>
                            )}
                            {/* The default has no Deactivate: the server refuses it, because a
                                store whose default is inactive has nothing to fall back on. */}
                            {!warehouse.is_default && (
                                <button
                                    onClick={() => void handleToggle(warehouse)}
                                    className="px-2 py-1.5 rounded-lg text-xs font-bold text-gray-600 hover:text-blue-600 hover:bg-blue-50 transition-colors inline-flex items-center gap-1 min-h-touch md:min-h-0"
                                >
                                    <Power className="w-3.5 h-3.5" />
                                    {warehouse.is_active ? settings.deactivate : settings.activate}
                                </button>
                            )}
                        </div>
                    );
                },
                enableSorting: false,
                enableResizing: false,
                size: 220,
            }),
        ],
        [t, stores],
    );

    return (
        <PageShell>
            <PageHeader
                title={s.title}
                subtitle={s.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.inventory,
                    s.title,
                    'inventory',
                )}
                actions={(
                    <>
                        <Button variant="secondary" onClick={() => setImportOpen(true)} icon={<Upload className="w-4 h-4" />}>
                            Import
                        </Button>
                        <Button onClick={openCreate} icon={<Plus className="w-4 h-4" />}>
                            {s.newWarehouse}
                        </Button>
                    </>
                )}
            />

            <DataTable<WarehouseRow>
                tableId="warehouses"
                columns={columns}
                data={warehouses}
                title={s.title}
                isLoading={loading}
                emptyMessage={s.emptyMessage}
                emptyIcon={<Warehouse className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={s.searchPlaceholder}
            />

            {modalOpen && (
                <ModalShell size="sm" onBackdropClick={closeModal}>
                    <ModalHeader
                        title={editTarget ? s.editWarehouse : s.newWarehouse}
                        onClose={closeModal}
                    />
                    <div className="p-6 space-y-4 overflow-y-auto">
                        <Field label={t.common.name} required error={errors.name} htmlFor="warehouse-name">
                            <input
                                id="warehouse-name"
                                type="text"
                                value={form.name}
                                onChange={(e) => {
                                    setForm({ ...form, name: e.target.value });
                                    if (errors.name) setErrors({ ...errors, name: undefined });
                                }}
                                className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 focus:bg-white"
                            />
                        </Field>
                        <Field
                            label={s.branch}
                            required={!editTarget}
                            error={errors.storeId}
                            htmlFor="warehouse-store"
                        >
                            <select
                                id="warehouse-store"
                                value={form.storeId}
                                disabled={Boolean(editTarget)}
                                onChange={(e) => setForm({ ...form, storeId: e.target.value })}
                                className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 focus:bg-white disabled:text-gray-500"
                            >
                                <option value="">{s.selectBranch}</option>
                                {stores.map((store) => (
                                    <option key={store.id} value={store.id}>{store.name}</option>
                                ))}
                            </select>
                        </Field>
                        <Field label={s.code} hint={s.codeHint} htmlFor="warehouse-code">
                            <input
                                id="warehouse-code"
                                type="text"
                                value={form.code}
                                onChange={(e) => setForm({ ...form, code: e.target.value })}
                                className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 focus:bg-white"
                            />
                        </Field>
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={closeModal}>
                            {t.common.cancel}
                        </Button>
                        <Button onClick={handleSave} disabled={saving} loading={saving}>
                            {editTarget ? t.common.saveChanges : t.common.create}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}

            <ImportDialog
                open={importOpen}
                onClose={() => setImportOpen(false)}
                entityLabel="Warehouses"
                fields={IMPORT_FIELDS}
                importFn={(rows, mode) => api.importWarehouses(rows, mode)}
                onSuccess={() => void load()}
            />
        </PageShell>
    );
}
