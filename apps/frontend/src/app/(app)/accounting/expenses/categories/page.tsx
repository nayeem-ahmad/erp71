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
import AccountSelect, { type AccountOption } from '@/components/accounting/AccountSelect';

interface ExpenseAccount {
    id: string;
    name: string;
    code?: string | null;
}

interface ExpenseHead {
    id: string;
    name: string;
    description?: string | null;
    category_id: string;
    account_id?: string | null;
    account?: ExpenseAccount | null;
    _count?: { entries: number };
}

interface ExpenseCategory {
    id: string;
    name: string;
    description?: string | null;
    account_id?: string | null;
    account?: ExpenseAccount | null;
    _count?: { entries: number; heads?: number };
    heads?: ExpenseHead[];
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
    const [accountId, setAccountId] = useState('');
    const [accounts, setAccounts] = useState<AccountOption[]>([]);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [headsCategory, setHeadsCategory] = useState<ExpenseCategory | null>(null);
    const [editingHead, setEditingHead] = useState<ExpenseHead | null>(null);
    const [headName, setHeadName] = useState('');
    const [headDescription, setHeadDescription] = useState('');
    const [headAccountId, setHeadAccountId] = useState('');
    const [savingHead, setSavingHead] = useState(false);

    const loadCategories = async (openCategoryId?: string) => {
        if (!openCategoryId) setLoading(true);
        try {
            const data = await api.getExpenseCategories();
            const list: ExpenseCategory[] = Array.isArray(data) ? data : [];
            setCategories(list);
            if (openCategoryId) {
                setHeadsCategory(list.find((category) => category.id === openCategoryId) ?? null);
            }
        } catch (error) {
            console.error('Failed to load categories', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadCategories();
    }, []);

    const loadAccounts = async () => {
        try {
            const data = await api.getAccounts({ type: 'expense' });
            const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
            setAccounts(list);
        } catch (error) {
            console.error('Failed to load expense accounts', error);
            setAccounts([]);
        }
    };

    const openCreate = () => {
        setEditing(null);
        setName('');
        setDescription('');
        setAccountId('');
        setShowForm(true);
        void loadAccounts();
    };

    const openEdit = (category: ExpenseCategory) => {
        setEditing(category);
        setName(category.name);
        setDescription(category.description ?? '');
        setAccountId(category.account_id ?? category.account?.id ?? '');
        setShowForm(true);
        void loadAccounts();
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) {
            setToast({ type: 'error', message: t.expenses.categoryNameRequired });
            return;
        }
        setSaving(true);
        try {
            const payload = {
                name: name.trim(),
                description: description.trim() || undefined,
                accountId: accountId || null,
            };
            if (editing) {
                await api.updateExpenseCategory(editing.id, payload);
                setToast({ type: 'success', message: t.expenses.categoryUpdated });
            } else {
                await api.createExpenseCategory(payload);
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

    const accountLabel = (account?: ExpenseAccount | null) => (
        account ? (account.code ? `${account.code} — ${account.name}` : account.name) : t.expenses.defaultExpenseAccount
    );

    const categoryAccountChoice = (category: ExpenseCategory) => (
        `${t.expenses.categoryAccount} — ${accountLabel(category.account)}`
    );

    const openHeads = (category: ExpenseCategory) => {
        setHeadsCategory(category);
        setEditingHead(null);
        setHeadName('');
        setHeadDescription('');
        setHeadAccountId('');
        void loadAccounts();
    };

    const closeHeads = () => {
        setHeadsCategory(null);
        setEditingHead(null);
        setHeadName('');
        setHeadDescription('');
        setHeadAccountId('');
    };

    const openHeadEdit = (head: ExpenseHead) => {
        setEditingHead(head);
        setHeadName(head.name);
        setHeadDescription(head.description ?? '');
        setHeadAccountId(head.account_id ?? head.account?.id ?? '');
    };

    const handleHeadSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!headsCategory) return;
        if (!headName.trim()) {
            setToast({ type: 'error', message: t.expenses.headNameRequired });
            return;
        }
        setSavingHead(true);
        try {
            const payload = {
                name: headName.trim(),
                description: headDescription.trim(),
                accountId: headAccountId || null,
            };
            if (editingHead) {
                await api.updateExpenseHead(editingHead.id, payload);
                setToast({ type: 'success', message: t.expenses.headUpdated });
            } else {
                await api.createExpenseHead({
                    categoryId: headsCategory.id,
                    ...payload,
                });
                setToast({ type: 'success', message: t.expenses.headCreated });
            }
            setEditingHead(null);
            setHeadName('');
            setHeadDescription('');
            setHeadAccountId('');
            await loadCategories(headsCategory.id);
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
        } finally {
            setSavingHead(false);
        }
    };

    const handleHeadDelete = async (head: ExpenseHead) => {
        if (!headsCategory) return;
        if (!globalThis.confirm(t.expenses.deleteHeadConfirm)) return;
        try {
            await api.deleteExpenseHead(head.id);
            setToast({ type: 'success', message: t.expenses.headDeleted });
            if (editingHead?.id === head.id) {
                setEditingHead(null);
                setHeadName('');
                setHeadDescription('');
                setHeadAccountId('');
            }
            await loadCategories(headsCategory.id);
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
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
            columnHelper.accessor((row) => row.account?.name ?? '', {
                id: 'account',
                header: t.expenses.expenseAccount,
                meta: { hideOnMobile: true },
                cell: ({ row }) => {
                    const account = row.original.account;
                    const label = account
                        ? (account.code ? `${account.code} — ${account.name}` : account.name)
                        : t.expenses.defaultExpenseAccount;
                    return <span className="text-sm text-gray-600">{label}</span>;
                },
                size: 220,
            }),
            columnHelper.accessor('description', {
                header: t.expenses.notes,
                meta: { hideOnMobile: true },
                cell: (info) => <span className="text-sm text-gray-500">{info.getValue() || '—'}</span>,
                size: 220,
            }),
            columnHelper.accessor((row) => row._count?.entries ?? 0, {
                id: 'entries',
                header: t.expenses.entryCount,
                cell: (info) => <span className="text-sm font-bold text-gray-600">{info.getValue()}</span>,
                size: 100,
            }),
            columnHelper.display({
                id: 'heads',
                header: t.expenses.heads,
                cell: ({ row }) => (
                    <button
                        type="button"
                        onClick={() => openHeads(row.original)}
                        className="inline-flex min-h-touch items-center gap-2 px-1 text-sm text-blue-600 hover:underline"
                    >
                        <span className="font-bold text-gray-700">{row.original.heads?.length ?? 0}</span>
                        {t.expenses.heads}
                    </button>
                ),
                size: 140,
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
                    <Loader2 className="w-5 h-5 animate-spin me-2" />
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
                            <div className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{t.expenses.expenseAccount}</span>
                                <AccountSelect
                                    accounts={accounts}
                                    value={accountId}
                                    onChange={setAccountId}
                                    ariaLabel={t.expenses.expenseAccount}
                                    placeholder={t.expenses.defaultExpenseAccount}
                                    allowClear
                                    clearLabel={t.expenses.defaultExpenseAccount}
                                    className={`${compactDensity.formField} min-h-touch`}
                                />
                                <p className="mt-1 text-xs text-gray-500">{t.expenses.expenseAccountHint}</p>
                            </div>
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

            {headsCategory && (
                <ModalShell size="md" onBackdropClick={closeHeads}>
                    <form onSubmit={handleHeadSubmit} className="flex max-h-[90vh] flex-col overflow-hidden">
                        <ModalHeader
                            title={editingHead ? t.expenses.editHead : t.expenses.addHead}
                            subtitle={headsCategory.name}
                            onClose={closeHeads}
                        />
                        <div className={`${compactDensity.modalPadding} ${compactDensity.formStack} overflow-y-auto`}>
                            {(headsCategory.heads ?? []).length === 0 ? (
                                <p className="text-sm text-gray-500">{t.expenses.noHeads}</p>
                            ) : (
                                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                                    {(headsCategory.heads ?? []).map((head) => (
                                        <li key={head.id} className="flex items-center gap-2 px-3 py-2">
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm font-medium text-gray-900">{head.name}</p>
                                                {head.description ? (
                                                    <p className="truncate text-xs text-gray-500">{head.description}</p>
                                                ) : null}
                                                <p className="truncate text-xs text-gray-500">
                                                    {head.account
                                                        ? accountLabel(head.account)
                                                        : categoryAccountChoice(headsCategory)}
                                                </p>
                                                <p className="text-xs text-gray-400">
                                                    {t.expenses.entryCount}: {head._count?.entries ?? 0}
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => openHeadEdit(head)}
                                                className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-lg text-gray-400 hover:bg-blue-50 hover:text-blue-600"
                                                title={t.expenses.editHead}
                                            >
                                                <Pencil className="w-4 h-4" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleHeadDelete(head)}
                                                className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-danger"
                                                title={t.common.delete}
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <label className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{t.expenses.head}</span>
                                <input type="text" value={headName} onChange={(e) => setHeadName(e.target.value)} className={compactDensity.formField} required />
                            </label>
                            <div className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{t.expenses.expenseAccount}</span>
                                <AccountSelect
                                    accounts={accounts}
                                    value={headAccountId}
                                    onChange={setHeadAccountId}
                                    ariaLabel={t.expenses.expenseAccount}
                                    placeholder={categoryAccountChoice(headsCategory)}
                                    allowClear
                                    clearLabel={categoryAccountChoice(headsCategory)}
                                    className={`${compactDensity.formField} min-h-touch`}
                                />
                                <p className="mt-1 text-xs text-gray-500">{t.expenses.headAccountHint}</p>
                            </div>
                            <label className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{t.expenses.notes}</span>
                                <textarea value={headDescription} onChange={(e) => setHeadDescription(e.target.value)} rows={2} className={compactDensity.formField} />
                            </label>
                        </div>
                        <ModalFooter>
                            <Button variant="secondary" type="button" onClick={closeHeads}>{t.common.cancel}</Button>
                            <Button variant="primary" type="submit" loading={savingHead}>
                                {t.common.save}
                            </Button>
                        </ModalFooter>
                    </form>
                </ModalShell>
            )}
        </AccountingPageShell>
    );
}