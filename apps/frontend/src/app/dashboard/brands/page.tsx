'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Tag, Plus, Pencil, Trash2, X } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

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
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="w-full space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">{t.brands.title}</h1>
                        <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                            {t.brands.subtitle}
                        </p>
                    </div>
                    <button
                        onClick={openCreate}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm flex items-center shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 active:translate-y-0"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        {t.brands.newBrand}
                    </button>
                </div>

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
            </div>

            {modalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl">
                        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                            <h2 className="text-lg font-black tracking-tight">
                                {editTarget ? t.brands.editBrand : t.brands.newBrand}
                            </h2>
                            <button onClick={closeModal} className="p-2 hover:bg-gray-50 rounded-xl text-gray-400">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            {error && (
                                <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold">{error}</div>
                            )}
                            <div>
                                <label className="text-xs font-black uppercase tracking-widest text-gray-500 block mb-1.5">
                                    {t.common.name} <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    placeholder={t.brands.placeholders.name}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 outline-none"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-black uppercase tracking-widest text-gray-500 block mb-1.5">{t.common.description}</label>
                                <textarea
                                    value={form.description}
                                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                                    placeholder={t.brands.placeholders.description}
                                    rows={2}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 outline-none resize-none"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-black uppercase tracking-widest text-gray-500 block mb-1.5">{t.brands.columns.website}</label>
                                <input
                                    type="url"
                                    value={form.website_url}
                                    onChange={(e) => setForm({ ...form, website_url: e.target.value })}
                                    placeholder={t.brands.placeholders.website}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 outline-none"
                                />
                            </div>
                        </div>
                        <div className="p-6 border-t border-gray-100 flex justify-end gap-3">
                            <button
                                onClick={closeModal}
                                className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-gray-50"
                            >
                                {t.common.cancel}
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-md disabled:opacity-50"
                            >
                                {saving ? t.brands.saving : editTarget ? t.common.saveChanges : t.common.create}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {deleteId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-6 space-y-4">
                        <h2 className="text-lg font-black tracking-tight">{t.brands.deleteTitle}</h2>
                        <p className="text-sm text-gray-500">
                            {t.brands.deleteDescription}
                        </p>
                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                onClick={() => setDeleteId(null)}
                                className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-gray-50"
                            >
                                {t.common.cancel}
                            </button>
                            <button
                                onClick={() => handleDelete(deleteId)}
                                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-md"
                            >
                                {t.common.delete}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}