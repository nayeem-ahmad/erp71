'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Tag, Plus, Pencil, Trash2, Upload } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { Button, Field, Alert } from '@/components/ui';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useI18n } from '@/lib/i18n';
import { ImportDialog, type ImportField } from '@/components/import-dialog';

const IMPORT_FIELDS: ImportField[] = [
    { key: 'name', label: 'Name', required: true },
    { key: 'description', label: 'Description', required: false },
];

interface Brand {
    id: string;
    name: string;
    description: string | null;
    logo_url: string | null;
    website_url: string | null;
    created_at: string;
}

const emptyForm = { name: '', description: '', logo_url: '', website_url: '' };

const columnHelper = createColumnHelper<Brand>();

export default function BrandsPage() {
    const { t } = useI18n();
    const [brands, setBrands] = useState<Brand[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<Brand | null>(null);
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
            const data = await api.getBrands();
            setBrands(data);
        } catch (err) {
            console.error('Failed to load brands', err);
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

    const openEdit = (brand: Brand) => {
        setEditTarget(brand);
        setForm({
            name: brand.name,
            description: brand.description ?? '',
            logo_url: brand.logo_url ?? '',
            website_url: brand.website_url ?? '',
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
            setError(t.brands.nameRequired);
            return;
        }
        setSaving(true);
        setError('');
        try {
            const payload = {
                name: form.name.trim(),
                description: form.description.trim() || undefined,
                logo_url: form.logo_url.trim() || undefined,
                website_url: form.website_url.trim() || undefined,
            };
            if (editTarget) {
                await api.updateBrand(editTarget.id, payload);
            } else {
                await api.createBrand(payload);
            }
            closeModal();
            void load();
        } catch (err: any) {
            setError(err.message || t.brands.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await api.deleteBrand(id);
            void load();
        } catch (err) {
            console.error('Failed to delete brand', err);
        } finally {
            setDeleteId(null);
        }
    };

    const columns: ColumnDef<Brand, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: t.brands.columns.brand,
                cell: (info) => (
                    <span className="text-sm font-black text-gray-900">{info.getValue()}</span>
                ),
                size: 200,
            }),
            columnHelper.accessor('description', {
                header: t.common.description,
                cell: (info) => (
                    <span className="text-sm text-gray-500 truncate max-w-xs block">{info.getValue() ?? '-'}</span>
                ),
                size: 260,
            }),
            columnHelper.accessor('website_url', {
                header: t.brands.columns.website,
                cell: (info) => {
                    const url = info.getValue();
                    if (!url) return <span className="text-sm text-gray-400">-</span>;
                    return (
                        <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 hover:underline truncate max-w-xs block"
                        >
                            {url}
                        </a>
                    );
                },
                size: 200,
            }),
            columnHelper.accessor('created_at', {
                header: t.brands.columns.added,
                cell: (info) => (
                    <span className="text-sm text-gray-500">{formatDate(info.getValue())}</span>
                ),
                size: 130,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
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
        [t],
    );

    return (
        <PageShell>
                <PageHeader
                    title={t.brands.title}
                    subtitle={t.brands.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.inventory,
                        t.brands.title,
                        'inventory',
                    )}
                    actions={(
                        <>
                            <Button variant="secondary" onClick={() => setImportOpen(true)} icon={<Upload className="w-4 h-4" />}>
                                Import
                            </Button>
                            <Button onClick={openCreate} icon={<Plus className="w-4 h-4" />}>
                                {t.brands.newBrand}
                            </Button>
                        </>
                    )}
                />

                <DataTable<Brand>
                    tableId="brands"
                    columns={columns}
                    data={brands}
                    title={t.brands.title}
                    isLoading={loading}
                    emptyMessage={t.brands.emptyMessage}
                    emptyIcon={<Tag className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.brands.searchPlaceholder}
                />

            {modalOpen && (
                <ModalShell size="sm" onBackdropClick={closeModal}>
                    <ModalHeader
                        title={editTarget ? t.brands.editBrand : t.brands.newBrand}
                        onClose={closeModal}
                    />
                    <div className="p-6 space-y-4 overflow-y-auto">
                        {error && <Alert tone="danger">{error}</Alert>}
                        <Field label={t.common.name} required htmlFor="brand-name">
                            <input
                                id="brand-name"
                                type="text"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                placeholder={t.brands.placeholders.name}
                                className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 focus:bg-white"
                            />
                        </Field>
                        <Field label={t.common.description} htmlFor="brand-description">
                            <textarea
                                id="brand-description"
                                value={form.description}
                                onChange={(e) => setForm({ ...form, description: e.target.value })}
                                placeholder={t.brands.placeholders.description}
                                rows={2}
                                className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 focus:bg-white resize-none"
                            />
                        </Field>
                        <Field label={t.brands.columns.website} htmlFor="brand-website">
                            <input
                                id="brand-website"
                                type="url"
                                value={form.website_url}
                                onChange={(e) => setForm({ ...form, website_url: e.target.value })}
                                placeholder={t.brands.placeholders.website}
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
                entityLabel="Brands"
                fields={IMPORT_FIELDS}
                importFn={(rows, mode) => api.importBrands(rows, mode)}
                onSuccess={() => void load()}
            />

            {deleteId && (
                <ModalShell size="sm" onBackdropClick={() => setDeleteId(null)}>
                    <ModalHeader title={t.brands.deleteTitle} onClose={() => setDeleteId(null)} />
                    <div className="p-6">
                        <p className="text-sm text-gray-500">
                            {t.brands.deleteDescription}
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