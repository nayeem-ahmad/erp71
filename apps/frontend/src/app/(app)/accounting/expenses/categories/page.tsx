'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FolderTree, Pencil, Plus, Receipt, Tags, Trash2 } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
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
const DEFAULT_ACCOUNT = '__default__';

export default function ExpenseCategoriesPage() {
    const { t, locale } = useI18n();
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
    const [search, setSearch] = useState('');
    const [accountIds, setAccountIds] = useState<string[]>([]);

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

    const accountKey = (category: ExpenseCategory) => category.account?.id ?? category.account_id ?? DEFAULT_ACCOUNT;

    const accountOptions = useMemo(() => {
        const seen = new Map<string, string>();
        let hasDefault = false;
        for (const category of categories) {
            if (category.account) seen.set(category.account.id, accountLabel(category.account));
            else hasDefault = true;
        }
        const options = Array.from(seen, ([value, label]) => ({ value, label }));
        if (hasDefault) options.unshift({ value: DEFAULT_ACCOUNT, label: t.expenses.defaultExpenseAccount });
        return options;
    }, [categories, t]);

    const filtered = useMemo(() => {
        const needle = search.trim().toLowerCase();
        const selected = new Set(accountIds);
        return categories.filter((category) => {
            if (selected.size && !selected.has(accountKey(category))) return false;
            if (!needle) return true;
            const account = accountLabel(category.account).toLowerCase();
            return category.name.toLowerCase().includes(needle)
                || (category.description ?? '').toLowerCase().includes(needle)
                || account.includes(needle);
        });
    }, [categories, accountIds, search, t]);

    const columns: ColumnDef<ExpenseCategory, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: t.expenses.category,
                cell: (info) => <span className="text-sm font-medium text-gray-900">{info.getValue()}</span>,
                size: 200,
            }),
            columnHelper.accessor((row) => row.account?.name ?? '', {
                id: 'account',
                header: t.expenses.expenseAccount,
                meta: { hideOnMobile: true },
                cell: ({ row }) => <span className="text-sm text-gray-600">{accountLabel(row.original.account)}</span>,
                size: 220,
            }),
            columnHelper.accessor('description', {
                header: t.expenses.notes,
                meta: { hideOnMobile: true },
                cell: (info) => <span className="text-sm text-gray-500">{info.getValue() || '—'}</span>,
                size: 220,
            }),
            columnHelper.accessor((row) => row.heads?.length ?? row._count?.heads ?? 0, {
                id: 'heads',
                header: t.expenses.heads,
                cell: ({ row }) => {
                    const count = row.original.heads?.length ?? row.original._count?.heads ?? 0;
                    return (
                        <Link
                            href={`${routes.accounting.expenseHeads}?category=${row.original.id}`}
                            className="inline-flex min-h-touch items-center gap-2 text-sm text-blue-600 hover:underline"
                        >
                            <span className="font-medium text-gray-700">{count}</span>
                            {t.expenses.heads}
                        </Link>
                    );
                },
                size: 140,
            }),
            columnHelper.accessor((row) => row._count?.entries ?? 0, {
                id: 'entries',
                header: t.expenses.entryCount,
                meta: { align: 'end' },
                cell: (info) => <span className="text-sm text-gray-600">{info.getValue()}</span>,
                size: 100,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: ({ row }) => (
                    <div className="flex items-center gap-1">
                        <button type="button" onClick={() => openEdit(row.original)} className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-lg text-gray-400 hover:bg-blue-50 hover:text-blue-600" title={t.expenses.editCategory}>
                            <Pencil className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => handleDelete(row.original)} className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-danger" title={t.common.delete}>
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                ),
                size: 90,
            }),
        ],
        [t],
    );

    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'account',
                type: 'multi-select',
                label: t.expenses.expenseAccount,
                value: accountIds,
                onChange: setAccountIds,
                options: accountOptions,
            },
        ],
        [t, accountIds, accountOptions],
    );

    const stats = useMemo(() => {
        const headCount = filtered.reduce((sum, category) => sum + (category.heads?.length ?? category._count?.heads ?? 0), 0);
        const entryCount = filtered.reduce((sum, category) => sum + (category._count?.entries ?? 0), 0);
        const items: ListStat[] = [
            { id: 'count', icon: <FolderTree aria-hidden />, label: t.expenses.categoryCount, value: filtered.length.toLocaleString(locale) },
            { id: 'heads', icon: <Tags aria-hidden />, label: t.expenses.heads, value: headCount.toLocaleString(locale) },
            { id: 'entries', icon: <Receipt aria-hidden />, label: t.expenses.entryCount, value: entryCount.toLocaleString(locale) },
        ];
        return { items, loading, label: t.expenses.statsLabel };
    }, [filtered, loading, locale, t]);

    return (
        <AccountingPageShell>
            <PageHeader
                title={t.accounting.links.expenseCategories.title}
                subtitle={t.accounting.links.expenseCategories.description}
                breadcrumbs={nestedPageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    'accounting',
                    [{ label: t.expenses.title, href: routes.accounting.expenses }],
                    t.accounting.links.expenseCategories.title,
                )}
                actions={(
                    <>
                        <Link href={routes.accounting.expenseHeads} className={compactDensity.btnSecondary}>
                            <Tags className="w-3.5 h-3.5" />
                            {t.expenses.manageHeads}
                        </Link>
                        <button type="button" onClick={openCreate} className={`${compactDensity.btnPrimary} bg-primary text-white hover:bg-primary-hover`}>
                            <Plus className="w-3.5 h-3.5" />
                            {t.expenses.addCategory}
                        </button>
                    </>
                )}
            />

            {toast && (
                <div className={`rounded-lg px-3 py-2 text-sm ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-danger-light text-danger-text border border-red-200'}`}>
                    {toast.message}
                </div>
            )}

            <DataTable
                tableId="expense-categories"
                title={t.accounting.links.expenseCategories.title}
                data={filtered}
                columns={columns}
                isLoading={loading}
                searchPlaceholder={t.expenses.searchCategories}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                emptyMessage={t.common.noData}
            />

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
        </AccountingPageShell>
    );
}
