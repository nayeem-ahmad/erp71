'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Truck, Plus, Pencil, Trash2, Upload } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { Button, Field, Alert } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useI18n } from '@/lib/i18n';
import { ImportDialog, type ImportField } from '@/components/import-dialog';

const IMPORT_FIELDS: ImportField[] = [
    { key: 'name', label: 'Name', required: true },
    { key: 'phone', label: 'Phone', required: false },
    { key: 'email', label: 'Email', required: false },
    { key: 'address', label: 'Address', required: false },
    { key: 'contact_person', label: 'Contact Person', required: false },
];

interface Supplier {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    created_at: string;
}

const emptyForm = { name: '', phone: '', email: '', address: '' };

const columnHelper = createColumnHelper<Supplier>();

export default function SuppliersPage() {
    const { t, locale } = useI18n();
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<Supplier | null>(null);
    const [form, setForm] = useState(emptyForm);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [importOpen, setImportOpen] = useState(false);

    useEffect(() => {
        void load();
    }, []);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getSuppliers();
            setSuppliers(data);
        } catch (err) {
            console.error('Failed to load suppliers', err);
        } finally {
            setLoading(false);
        }
    };

    const openCreate = () => {
        setEditTarget(null);
        setForm(emptyForm);
        setError('');
        setModalOpen(true);
    };

    const openEdit = (supplier: Supplier) => {
        setEditTarget(supplier);
        setForm({
            name: supplier.name,
            phone: supplier.phone ?? '',
            email: supplier.email ?? '',
            address: supplier.address ?? '',
        });
        setError('');
        setModalOpen(true);
    };

    const closeModal = () => {
        setModalOpen(false);
        setEditTarget(null);
        setError('');
    };

    const handleSave = async () => {
        if (!form.name.trim()) {
            setError(t.suppliers.nameRequired);
            return;
        }
        setSaving(true);
        setError('');
        try {
            if (editTarget) {
                await api.updateSupplier(editTarget.id, {
                    name: form.name.trim(),
                    phone: form.phone.trim() || undefined,
                    email: form.email.trim() || undefined,
                    address: form.address.trim() || undefined,
                });
            } else {
                await api.createSupplier({
                    name: form.name.trim(),
                    phone: form.phone.trim() || undefined,
                    email: form.email.trim() || undefined,
                    address: form.address.trim() || undefined,
                });
            }
            closeModal();
            void load();
        } catch (err: any) {
            setError(err.message || t.suppliers.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await api.deleteSupplier(id);
            void load();
        } catch (err) {
            console.error('Failed to delete supplier', err);
        } finally {
            setDeleteId(null);
        }
    };

    const columns: ColumnDef<Supplier, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: t.suppliers.columns.supplier,
                cell: (info) => (
                    <span className="text-sm font-bold text-gray-900">{info.getValue()}</span>
                ),
                size: 220,
            }),
            columnHelper.accessor('phone', {
                header: t.suppliers.columns.phone,
                cell: (info) => (
                    <span className="text-sm text-gray-600">{info.getValue() ?? '-'}</span>
                ),
                size: 150,
            }),
            columnHelper.accessor('email', {
                header: t.suppliers.columns.email,
                cell: (info) => (
                    <span className="text-sm text-gray-600">{info.getValue() ?? '-'}</span>
                ),
                size: 200,
            }),
            columnHelper.accessor('address', {
                header: t.suppliers.columns.address,
                cell: (info) => (
                    <span className="text-sm text-gray-500 truncate max-w-xs block">{info.getValue() ?? '-'}</span>
                ),
                size: 240,
            }),
            columnHelper.accessor('created_at', {
                header: t.suppliers.columns.added,
                cell: (info) => (
                    <span className="text-sm text-gray-500">{formatDate(info.getValue(), locale)}</span>
                ),
                size: 130,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.suppliers.columns.actions,
                cell: (info) => (
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => openEdit(info.row.original)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            title={t.common.edit}
                        >
                            <Pencil className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setDeleteId(info.row.original.id)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            title={t.common.delete}
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                ),
                enableSorting: false,
                enableResizing: false,
                size: 90,
            }),
        ],
        [t, locale],
    );

    return (
        <PageShell>
                <PageHeader
                    title={t.suppliers.title}
                    subtitle={t.suppliers.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.purchase,
                        t.suppliers.title,
                        'purchases',
                    )}
                    actions={(
                        <>
                            <Button variant="secondary" onClick={() => setImportOpen(true)} icon={<Upload className="w-4 h-4" />}>
                                Import
                            </Button>
                            <Button onClick={openCreate} icon={<Plus className="w-4 h-4" />}>
                                {t.suppliers.newSupplier}
                            </Button>
                        </>
                    )}
                />

                <DataTable<Supplier>
                    tableId="suppliers"
                    columns={columns}
                    data={suppliers}
                    title={t.suppliers.tableTitle}
                    isLoading={loading}
                    emptyMessage={t.suppliers.emptyMessage}
                    emptyIcon={<Truck className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.suppliers.searchPlaceholder}
                />

            {modalOpen && (
                <ModalShell size="sm" onBackdropClick={closeModal}>
                    <ModalHeader
                        title={editTarget ? t.suppliers.editSupplier : t.suppliers.newSupplier}
                        onClose={closeModal}
                    />
                    <div className="p-6 space-y-4 overflow-y-auto">
                        {error && <Alert tone="danger">{error}</Alert>}
                        <Field label={t.common.name} required htmlFor="supplier-name">
                            <input
                                id="supplier-name"
                                type="text"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                placeholder={t.purchaseShared.supplierNamePlaceholder}
                                className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 focus:bg-white"
                            />
                        </Field>
                        <Field label={t.common.phone} htmlFor="supplier-phone">
                            <input
                                id="supplier-phone"
                                type="text"
                                value={form.phone}
                                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                                placeholder={t.purchaseShared.phonePlaceholder}
                                className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 focus:bg-white"
                            />
                        </Field>
                        <Field label={t.common.email} htmlFor="supplier-email">
                            <input
                                id="supplier-email"
                                type="email"
                                value={form.email}
                                onChange={(e) => setForm({ ...form, email: e.target.value })}
                                placeholder={t.purchaseShared.emailPlaceholder}
                                className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 focus:bg-white"
                            />
                        </Field>
                        <Field label={t.common.address} htmlFor="supplier-address">
                            <textarea
                                id="supplier-address"
                                value={form.address}
                                onChange={(e) => setForm({ ...form, address: e.target.value })}
                                placeholder={t.purchaseShared.addressPlaceholder}
                                rows={3}
                                className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 focus:bg-white resize-none"
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
                entityLabel="Suppliers"
                fields={IMPORT_FIELDS}
                importFn={(rows, mode) => api.importSuppliers(rows, mode)}
                onSuccess={() => void load()}
            />

            {deleteId && (
                <ModalShell size="sm" onBackdropClick={() => setDeleteId(null)}>
                    <ModalHeader title={t.suppliers.deleteTitle} onClose={() => setDeleteId(null)} />
                    <div className="p-6">
                        <p className="text-sm text-gray-500">
                            {t.suppliers.deleteDescription}
                        </p>
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={() => setDeleteId(null)}>
                            {t.common.cancel}
                        </Button>
                        <Button variant="danger" onClick={() => handleDelete(deleteId)}>
                            {t.common.delete}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}
        </PageShell>
    );
}