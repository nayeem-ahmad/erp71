'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Pencil, Trash2 } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { AccountingPageShell } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { compactDensity } from '@/lib/ui/compact-density';
import { Button } from '@/components/ui';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';

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
                cell: (info) => <span className="text-sm font-bold text-gray-900">{info.getValue()}</span>,
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
                        <button type="button" onClick={() => handleDelete(row.original)} className="p-2 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50">
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
        <AccountingPageShell>
            <PageHeader
                title={t.accounting.links.expenseCategories.title}
                breadcrumbs={nestedPageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    'accounting',
                    [{ label: t.expenses.title, href: routes.accounting.expenses }],
                    t.accounting.links.expenseCategories.title,
                )}
                actions={(
                    <button type="button" onClick={openCreate} className={`${compactDensity.btnPrimary}${compactDensity.btnPrimary} bg-primary text-white hover:bg-primary-hover`}>
                        <Plus className="w-3.5 h-3.5" />
                        {t.expenses.addCategory}
                    </button>
                )}
            />

            {toast && (
                <div className={`rounded-lg px-3 py-2 text-sm ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-danger-light text-danger-text border border-red-200'}`}>
                    {toast.message}
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-12 text-gray-400">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    {t.common.loading}
                </div>
            ) : (
                <DataTable tableId="expense-categories" title="Expense Categories" data={categories} columns={columns} searchPlaceholder={t.expenses.searchCategories} emptyMessage={t.common.noData} />
            )}

            {showForm && (
                <ModalShell size="sm" onBackdropClick={() => setShowForm(false)}>
                    <form onSubmit={handleSubmit} className="flex max-h-[90vh] flex-col overflow-hidden">
                        <ModalHeader title={editing ? t.expenses.editCategory : t.expenses.addCategory} onClose={() => setShowForm(false)} />
                        <div className={`${compactDensity.modalPadding} ${compactDensity.formStack} overflow-y-auto`}>
                            <label className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{t.expenses.category}</span>
                                <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={compactDensity.formField} required />
                            </label>
                            <label className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{t.expenses.notes}</span>
                                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={compactDensity.formField} />
                            </label>
                        </div>
                        <ModalFooter>
                            <Button variant="secondary" type="button" onClick={() => setShowForm(false)}>{t.common.cancel}</Button>
                            <Button variant="primary" type="submit" loading={saving}>
                                {t.common.save}
                            </Button>
                        </ModalFooter>
                    </form>
                </ModalShell>
            )}
        </AccountingPageShell>
    );
}