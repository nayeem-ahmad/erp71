'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Truck, Plus, Pencil, Trash2, Upload, BookOpen } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { BranchFilter, Button, ConfirmDialog, Field, Alert, Select } from '@/components/ui';
import { useBranchForbiddenReset, useBranchScope } from '@/lib/branch-scope';
import { useServerList } from '@/hooks/useServerList';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { routes } from '@/lib/routes';
import { ImportDialog, type ImportField } from '@/components/import-dialog';

const IMPORT_FIELDS: ImportField[] = [
    { key: 'name', label: 'Name', required: true },
    // Blank numbers the supplier SUP-#####.
    { key: 'supplier_code', label: 'Supplier Code', required: false },
    { key: 'phone', label: 'Phone', required: false },
    { key: 'email', label: 'Email', required: false },
    { key: 'address', label: 'Address', required: false },
    { key: 'contact_person', label: 'Contact Person', required: false },
    // A branch's code or name; empty rows go to the branch picked for the file.
    { key: 'branch', label: 'Branch', required: false },
];

interface Supplier {
    id: string;
    name: string;
    supplier_code: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    created_at: string;
    store_id: string;
}

const emptyForm = { name: '', supplier_code: '', phone: '', email: '', address: '', store_id: '' };

const columnHelper = createColumnHelper<Supplier>();

export default function SuppliersPage() {
    const { t, locale } = useI18n();
    const [modalOpen, setModalOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<Supplier | null>(null);
    const [form, setForm] = useState(emptyForm);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    // Every supplier belongs to a branch; the list starts on all of them for
    // those who may see them all, as the customer list does.
    const branch = useBranchScope({ startOnAll: true });
    const [importBranch, setImportBranch] = useState('');
    const branchName = useMemo(
        () => new Map(branch.branches.map((b) => [b.id, b.name])),
        [branch.branches],
    );

    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(timer);
    }, [search]);

    const {
        items: suppliers,
        loading,
        error: listError,
        serverPagination,
        reload: load,
    } = useServerList<Supplier>({
        tableId: 'suppliers',
        fetch: (p) => api.getSuppliersPaged({ search: debouncedSearch || undefined, storeId: branch.apiStoreId, ...p }),
        deps: [debouncedSearch, branch.apiStoreId],
        enabled: branch.ready,
        initialSort: { id: 'name', desc: false },
        columnFilters: true,
    });
    useBranchForbiddenReset(listError, branch, t.dashboardLayout.branchFilterForbidden);

    const openCreate = () => {
        setEditTarget(null);
        // A new supplier goes to the header branch unless another is picked.
        setForm({ ...emptyForm, store_id: branch.headerBranchId ?? branch.branches[0]?.id ?? '' });
        setError('');
        setModalOpen(true);
    };

    const openEdit = (supplier: Supplier) => {
        setEditTarget(supplier);
        setForm({
            name: supplier.name,
            supplier_code: supplier.supplier_code ?? '',
            phone: supplier.phone ?? '',
            email: supplier.email ?? '',
            address: supplier.address ?? '',
            store_id: supplier.store_id,
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
        // Blank: a new supplier gets the next code, an edited one keeps its own.
        const code = form.supplier_code.trim();
        try {
            if (editTarget) {
                await api.updateSupplier(editTarget.id, {
                    name: form.name.trim(),
                    ...(code ? { supplier_code: code } : {}),
                    phone: form.phone.trim() || undefined,
                    email: form.email.trim() || undefined,
                    address: form.address.trim() || undefined,
                    // Only owners move a supplier to another branch.
                    ...(branch.canSeeAll && form.store_id && form.store_id !== editTarget.store_id
                        ? { store_id: form.store_id }
                        : {}),
                });
            } else {
                await api.createSupplier({
                    name: form.name.trim(),
                    ...(code ? { supplier_code: code } : {}),
                    phone: form.phone.trim() || undefined,
                    email: form.email.trim() || undefined,
                    address: form.address.trim() || undefined,
                    ...(form.store_id ? { store_id: form.store_id } : {}),
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
        setDeleting(true);
        try {
            await api.deleteSupplier(id);
            toast.success(t.common.deleted);
            void load();
        } catch (err: any) {
            toast.error(err?.message || t.common.deleteFailed);
        } finally {
            setDeleting(false);
            setDeleteId(null);
        }
    };

    const columns: ColumnDef<Supplier, any>[] = useMemo(
        () => [
            columnHelper.accessor('supplier_code', {
                header: t.suppliers.columns.code,
                cell: (info) => info.getValue() || '-',
                size: 120,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('name', {
                header: t.suppliers.columns.supplier,
                size: 220,
            }),
            columnHelper.accessor('phone', {
                header: t.suppliers.columns.phone,
                cell: (info) => info.getValue() ?? '-',
                size: 150,
            }),
            ...(branch.canSeeAll && !branch.hidden
                ? [columnHelper.accessor('store_id', {
                    id: 'branch',
                    header: t.common.branch,
                    cell: (info) => branchName.get(info.getValue()) ?? '—',
                    enableSorting: false,
                    meta: { hideOnMobile: true },
                    size: 140,
                })]
                : []),
            columnHelper.accessor('email', {
                header: t.suppliers.columns.email,
                cell: (info) => info.getValue() ?? '-',
                size: 200,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('address', {
                header: t.suppliers.columns.address,
                cell: (info) => <span className="block truncate">{info.getValue() ?? '-'}</span>,
                size: 240,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('created_at', {
                header: t.suppliers.columns.added,
                // A timestamp: no typed text the server could match it against.
                enableColumnFilter: false,
                cell: (info) => formatDate(info.getValue(), locale),
                size: 130,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.suppliers.columns.actions,
                cell: (info) => (
                    <RowActions>
                        <RowActionButton
                            icon={<BookOpen />}
                            label={t.suppliers.viewLedger}
                            href={routes.purchases.supplierLedgerFor(info.row.original.id)}
                        />
                        <RowActionButton icon={<Pencil />} label={t.common.edit} onClick={() => openEdit(info.row.original)} />
                        <RowActionButton
                            icon={<Trash2 />}
                            label={t.common.delete}
                            intent="danger"
                            onClick={() => setDeleteId(info.row.original.id)}
                        />
                    </RowActions>
                ),
                enableSorting: false,
                enableResizing: false,
                size: 120,
            }),
        ],
        [t, locale, branch.canSeeAll, branch.hidden, branchName],
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
                            <BranchFilter scope={branch} />
                            <Button variant="secondary" onClick={() => { setImportBranch(branch.headerBranchId ?? ''); setImportOpen(true); }} icon={<Upload className="w-4 h-4" />}>
                                {t.common.import}
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
                    onSearchChange={setSearch}
                    viewOptions
                    serverPagination={serverPagination}
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
                        <Field
                            label={t.suppliers.codeLabel}
                            hint={editTarget ? t.suppliers.codeEditHint : t.suppliers.codeHint}
                            htmlFor="supplier-code"
                        >
                            <input
                                id="supplier-code"
                                type="text"
                                value={form.supplier_code}
                                onChange={(e) => setForm({ ...form, supplier_code: e.target.value })}
                                placeholder={t.suppliers.codePlaceholder}
                                className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 font-mono text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 focus:bg-white"
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
                        {!branch.hidden && (
                            <Field label={t.common.branch} required htmlFor="supplier-branch">
                                <Select
                                    id="supplier-branch"
                                    value={form.store_id}
                                    onChange={(e) => setForm({ ...form, store_id: e.target.value })}
                                    // A supplier keeps its branch unless an owner moves it.
                                    disabled={Boolean(editTarget) && !branch.canSeeAll}
                                    className="w-full"
                                >
                                    {branch.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                                    {form.store_id && !branchName.has(form.store_id) ? (
                                        <option value={form.store_id}>{form.store_id}</option>
                                    ) : null}
                                </Select>
                            </Field>
                        )}
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
                importFn={(rows, mode) => api.importSuppliers(rows, mode, importBranch || undefined)}
                onSuccess={() => void load()}
                options={branch.hidden ? undefined : (
                    <Field label={t.branchParties.importBranchLabel} hint={t.branchParties.importBranchHint} htmlFor="supplier-import-branch">
                        <Select id="supplier-import-branch" value={importBranch} onChange={(e) => setImportBranch(e.target.value)} className="w-full">
                            {branch.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </Select>
                    </Field>
                )}
            />

            <ConfirmDialog
                open={deleteId !== null}
                title={t.suppliers.deleteTitle}
                prompt={t.suppliers.deleteDescription}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                loading={deleting}
                danger
                onConfirm={() => { if (deleteId) void handleDelete(deleteId); }}
                onCancel={() => { if (!deleting) setDeleteId(null); }}
            />
        </PageShell>
    );
}