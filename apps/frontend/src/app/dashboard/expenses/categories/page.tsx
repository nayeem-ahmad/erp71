'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Plus, Pencil, Trash2, FolderTree } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface ExpenseCategory {
    id: string;
    name: string;
    description?: string | null;
    _count?: { entries: number };
}

const columnHelper = createColumnHelper<ExpenseCategory>();

export default function ExpenseCategoriesPage() {
    const { t } = useI18n();
    const [categories, setCategories] = useState<ExpenseCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState<ExpenseCategory | null>(null);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    const loadCategories = async () => {
        setLoading(true);
        try {
            const data = await api.getExpenseCategories();
            setCategories(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Failed to load categories', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadCategories();
    }, []);

    const openCreate = () => {
        setEditing(null);
        setName('');
        setDescription('');
        setShowForm(true);
    };

    const openEdit = (category: ExpenseCategory) => {
        setEditing(category);
        setName(category.name);
        setDescription(category.description ?? '');
        setShowForm(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) {
            setToast({ type: 'error', message: t.expenses.categoryNameRequired });
            return;
        }
        setSaving(true);
        try {
            if (editing) {
                await api.updateExpenseCategory(editing.id, {
                    name: name.trim(),
                    description: description.trim() || undefined,
                });
                setToast({ type: 'success', message: t.expenses.categoryUpdated });
            } else {
                await api.createExpenseCategory({
                    name: name.trim(),
                    description: description.trim() || undefined,
                });
                setToast({ type: 'success', message: t.expenses.categoryCreated });
            }
            setShowForm(false);
            await loadCategories();
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (category: ExpenseCategory) => {
        if (!globalThis.confirm(t.expenses.deleteCategoryConfirm)) return;
        try {
            await api.deleteExpenseCategory(category.id);
            setToast({ type: 'success', message: t.expenses.categoryDeleted });
            await loadCategories();
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
        }
    };

    const columns: ColumnDef<ExpenseCategory, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: t.expenses.category,
                cell: (info) => <span className="text-sm font-black text-gray-900">{info.getValue()}</span>,
                size: 200,
            }),
            columnHelper.accessor('description', {
                header: t.expenses.notes,
                cell: (info) => <span className="text-sm text-gray-500">{info.getValue() || '—'}</span>,
                size: 280,
            }),
            columnHelper.accessor((row) => row._count?.entries ?? 0, {
                id: 'entries',
                header: t.expenses.entryCount,
                cell: (info) => <span className="text-sm font-bold text-gray-600">{info.getValue()}</span>,
                size: 100,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: ({ row }) => (
                    <div className="flex items-center gap-1">
                        <button type="button" onClick={() => openEdit(row.original)} className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50">
                            <Pencil className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => handleDelete(row.original)} className="p-2 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50">
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                ),
                size: 90,
            }),
        ],
        [t],
    );

    return (
        <div className="h-full overflow-y-auto bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1000px] mx-auto space-y-6">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <Link href="/dashboard/expenses" className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-gray-700 mb-3">
                            <ArrowLeft className="w-3.5 h-3.5" />
                            {t.expenses.title}
                        </Link>
                        <h1 className="text-2xl font-black tracking-tight inline-flex items-center gap-2">
                            <FolderTree className="w-7 h-7 text-rose-600" />
                            {t.expenses.manageCategories}
                        </h1>
                    </div>
                    <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 text-white text-sm font-black hover:bg-rose-700">
                        <Plus className="w-4 h-4" />
                        {t.expenses.addCategory}
                    </button>
                </div>

                {toast && (
                    <div className={`rounded-xl px-4 py-3 text-sm font-semibold ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
                        {toast.message}
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center justify-center py-20 text-gray-400">
                        <Loader2 className="w-6 h-6 animate-spin mr-2" />
                        {t.common.loading}
                    </div>
                ) : (
                    <DataTable tableId="expense-categories" title="Expense Categories" data={categories} columns={columns} searchPlaceholder={t.expenses.searchCategories} emptyMessage={t.common.noData} />
                )}
            </div>

            {showForm && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <form onSubmit={handleSubmit} className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-gray-100">
                            <h2 className="text-xl font-black">{editing ? t.expenses.editCategory : t.expenses.addCategory}</h2>
                        </div>
                        <div className="p-6 space-y-4">
                            <label className="block space-y-1">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{t.expenses.category}</span>
                                <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm" required />
                            </label>
                            <label className="block space-y-1">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{t.expenses.notes}</span>
                                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm" />
                            </label>
                        </div>
                        <div className="p-6 border-t border-gray-100 flex gap-3">
                            <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-3 rounded-2xl font-bold text-gray-500 hover:bg-gray-50">{t.common.cancel}</button>
                            <button type="submit" disabled={saving} className="flex-1 py-3 rounded-2xl font-black bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
                                {saving ? t.common.loading : t.common.save}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}