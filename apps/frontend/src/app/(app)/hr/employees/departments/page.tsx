'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Layers, Plus, Pencil, Trash2, X } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

interface Department {
    id: string;
    name: string;
    created_at: string;
}

const columnHelper = createColumnHelper<Department>();

export default function DepartmentsPage() {
    const { t } = useI18n();
    const [departments, setDepartments] = useState<Department[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<Department | null>(null);
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [deleteId, setDeleteId] = useState<string | null>(null);

    useEffect(() => {
        void load();
    }, []);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getDepartments();
            setDepartments(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to load departments', err);
        } finally {
            setLoading(false);
        }
    };

    const openCreate = () => {
        setEditTarget(null);
        setName('');
        setError('');
        setModalOpen(true);
    };

    const openEdit = (dept: Department) => {
        setEditTarget(dept);
        setName(dept.name);
        setError('');
        setModalOpen(true);
    };

    const closeModal = () => {
        setModalOpen(false);
        setEditTarget(null);
        setError('');
    };

    const handleSave = async () => {
        if (!name.trim()) {
            setError(t.departments.nameRequired);
            return;
        }
        setSaving(true);
        setError('');
        try {
            if (editTarget) {
                await api.updateDepartment(editTarget.id, { name: name.trim() });
            } else {
                await api.createDepartment({ name: name.trim() });
            }
            closeModal();
            void load();
        } catch (err: any) {
            setError(err.message || t.departments.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await api.deleteDepartment(id);
            void load();
        } catch (err: any) {
            console.error('Failed to delete department', err);
            setError(err.message || t.departments.deleteFailed);
        } finally {
            setDeleteId(null);
        }
    };

    const columns: ColumnDef<Department, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: t.departments.columns.name,
                cell: (info) => (
                    <span className="text-sm font-black text-gray-900">{info.getValue()}</span>
                ),
                size: 300,
            }),
            columnHelper.accessor('created_at', {
                header: t.departments.columns.created,
                cell: (info) => (
                    <span className="text-sm text-gray-500">{formatDate(info.getValue())}</span>
                ),
                size: 150,
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
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.departments.title}</h1>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {t.departments.subtitle}
                        </p>
                    </div>
                    <button
                        onClick={openCreate}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 active:translate-y-0"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        {t.departments.newDepartment}
                    </button>
                </div>

                <DataTable<Department>
                    tableId="departments"
                    columns={columns}
                    data={departments}
                    title={t.departments.title}
                    isLoading={loading}
                    emptyMessage={t.departments.emptyMessage}
                    emptyIcon={<Layers className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.departments.searchPlaceholder}
                />
            </div>

            {modalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl">
                        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                            <h2 className="text-lg font-black tracking-tight">
                                {editTarget ? t.departments.editDepartment : t.departments.newDepartment}
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
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                                    placeholder={t.departments.placeholders.name}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 outline-none"
                                    autoFocus
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
                                {saving ? t.departments.saving : editTarget ? t.common.saveChanges : t.common.create}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {deleteId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-6 space-y-4">
                        <h2 className="text-lg font-black tracking-tight">{t.departments.deleteTitle}</h2>
                        <p className="text-sm text-gray-500">{t.departments.deleteDescription}</p>
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
