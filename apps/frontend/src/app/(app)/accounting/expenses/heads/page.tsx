'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { FolderTree, Pencil, Plus, Receipt, Settings2, Tags, Trash2 } from 'lucide-react';
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
    description?: string | null;
    category_id: string;
    account_id?: string | null;
    account?: ExpenseAccount | null;
    _count?: { entries: number };
}

interface ExpenseCategory {
    id: string;
    name: string;
    account_id?: string | null;
    account?: ExpenseAccount | null;
    heads?: ExpenseHead[];
}

interface HeadRow extends ExpenseHead {
    categoryName: string;
    category?: ExpenseCategory;
}

const columnHelper = createColumnHelper<HeadRow>();

function ExpenseHeadsPageContent() {
    const { t, locale } = useI18n();
    const searchParams = useSearchParams();
    const initialCategory = searchParams.get('category');
    const [categories, setCategories] = useState<ExpenseCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [categoryIds, setCategoryIds] = useState<string[]>(initialCategory ? [initialCategory] : []);
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState<HeadRow | null>(null);
    const [categoryId, setCategoryId] = useState('');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [accountId, setAccountId] = useState('');
    const [accounts, setAccounts] = useState<AccountOption[]>([]);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    const loadCategories = async () => {
        setLoading(true);
        try {
            const data = await api.getExpenseCategories();
            setCategories(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Failed to load expense heads', error);
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

    const heads = useMemo<HeadRow[]>(
        () => categories.flatMap((category) =>
            (category.heads ?? []).map((head) => ({
                ...head,
                category_id: head.category_id || category.id,
                categoryName: category.name,
                category,
            })),
        ),
        [categories],
    );

    const accountLabel = (account?: ExpenseAccount | null) => (
        account ? (account.code ? `${account.code} — ${account.name}` : account.name) : t.expenses.defaultExpenseAccount
    );

    const categoryAccountChoice = (category?: ExpenseCategory) => (
        category
            ? `${t.expenses.categoryAccount} — ${accountLabel(category.account)}`
            : t.expenses.categoryAccount
    );

    const openCreate = () => {
        setEditing(null);
        setCategoryId(categoryIds.length === 1 ? categoryIds[0] : '');
        setName('');
        setDescription('');
        setAccountId('');
        setShowForm(true);
        void loadAccounts();
    };

    const openEdit = (head: HeadRow) => {
        setEditing(head);
        setCategoryId(head.category_id);
        setName(head.name);
        setDescription(head.description ?? '');
        setAccountId(head.account_id ?? head.account?.id ?? '');
        setShowForm(true);
        void loadAccounts();
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || (!editing && !categoryId)) {
            setToast({ type: 'error', message: !categoryId && !editing ? t.expenses.selectCategory : t.expenses.headNameRequired });
            return;
        }
        setSaving(true);
        try {
            const payload = {
                name: name.trim(),
                description: description.trim(),
                accountId: accountId || null,
            };
            if (editing) {
                await api.updateExpenseHead(editing.id, payload);
                setToast({ type: 'success', message: t.expenses.headUpdated });
            } else {
                await api.createExpenseHead({ categoryId, ...payload });
                setToast({ type: 'success', message: t.expenses.headCreated });
            }
            setShowForm(false);
            await loadCategories();
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (head: HeadRow) => {
        if (!globalThis.confirm(t.expenses.deleteHeadConfirm)) return;
        try {
            await api.deleteExpenseHead(head.id);
            setToast({ type: 'success', message: t.expenses.headDeleted });
            await loadCategories();
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
        }
    };

    const filtered = useMemo(() => {
        const needle = search.trim().toLowerCase();
        const selected = new Set(categoryIds);
        return heads.filter((head) => {
            if (selected.size && !selected.has(head.category_id)) return false;
            if (!needle) return true;
            const account = (head.account ? accountLabel(head.account) : categoryAccountChoice(head.category)).toLowerCase();
            return head.name.toLowerCase().includes(needle)
                || head.categoryName.toLowerCase().includes(needle)
                || (head.description ?? '').toLowerCase().includes(needle)
                || account.includes(needle);
        });
    }, [heads, categoryIds, search, t]);

    const columns: ColumnDef<HeadRow, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: t.expenses.head,
                cell: (info) => <span className="text-sm font-medium text-gray-900">{info.getValue()}</span>,
                size: 200,
            }),
            columnHelper.accessor('categoryName', {
                header: t.expenses.category,
                cell: (info) => <span className="text-sm text-gray-600">{info.getValue()}</span>,
                size: 160,
            }),
            columnHelper.display({
                id: 'account',
                header: t.expenses.expenseAccount,
                meta: { hideOnMobile: true },
                cell: ({ row }) => (
                    <span className="text-sm text-gray-600">
                        {row.original.account
                            ? accountLabel(row.original.account)
                            : categoryAccountChoice(row.original.category)}
                    </span>
                ),
                size: 220,
            }),
            columnHelper.accessor('description', {
                header: t.expenses.notes,
                meta: { hideOnMobile: true },
                cell: (info) => <span className="text-sm text-gray-500">{info.getValue() || '—'}</span>,
                size: 200,
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
                        <button type="button" onClick={() => openEdit(row.original)} className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-lg text-gray-400 hover:bg-blue-50 hover:text-blue-600" title={t.expenses.editHead}>
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
                id: 'category',
                type: 'multi-select',
                label: t.expenses.category,
                value: categoryIds,
                onChange: setCategoryIds,
                options: categories.map((category) => ({ value: category.id, label: category.name })),
            },
        ],
        [t, categoryIds, categories],
    );

    const stats = useMemo(() => {
        const categoryCount = new Set(filtered.map((head) => head.category_id)).size;
        const entryCount = filtered.reduce((sum, head) => sum + (head._count?.entries ?? 0), 0);
        const items: ListStat[] = [
            { id: 'count', icon: <Tags aria-hidden />, label: t.expenses.heads, value: filtered.length.toLocaleString(locale) },
            { id: 'categories', icon: <FolderTree aria-hidden />, label: t.expenses.categoryCount, value: categoryCount.toLocaleString(locale) },
            { id: 'entries', icon: <Receipt aria-hidden />, label: t.expenses.entryCount, value: entryCount.toLocaleString(locale) },
        ];
        return { items, loading, label: t.expenses.statsLabel };
    }, [filtered, loading, locale, t]);

    const formCategory = categories.find((category) => category.id === (editing?.category_id ?? categoryId));

    return (
        <AccountingPageShell>
            <PageHeader
                title={t.accounting.links.expenseHeads.title}
                subtitle={t.accounting.links.expenseHeads.description}
                breadcrumbs={nestedPageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    'accounting',
                    [{ label: t.expenses.title, href: routes.accounting.expenses }],
                    t.accounting.links.expenseHeads.title,
                )}
                actions={(
                    <>
                        <Link href={routes.accounting.expenseCategories} className={compactDensity.btnSecondary}>
                            <Settings2 className="w-3.5 h-3.5" />
                            {t.expenses.manageCategories}
                        </Link>
                        <button type="button" onClick={openCreate} className={`${compactDensity.btnPrimary} bg-primary text-white hover:bg-primary-hover`}>
                            <Plus className="w-3.5 h-3.5" />
                            {t.expenses.addHead}
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
                tableId="expense-heads"
                title={t.accounting.links.expenseHeads.title}
                data={filtered}
                columns={columns}
                isLoading={loading}
                searchPlaceholder={t.expenses.searchHeads}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                emptyMessage={categories.length === 0 ? t.expenses.noCategoriesHint : t.expenses.noHeads}
            />

            {showForm && (
                <ModalShell size="sm" onBackdropClick={() => setShowForm(false)}>
                    <form onSubmit={handleSubmit} className="flex max-h-[90vh] flex-col overflow-hidden">
                        <ModalHeader
                            title={editing ? t.expenses.editHead : t.expenses.addHead}
                            subtitle={editing?.categoryName}
                            onClose={() => setShowForm(false)}
                        />
                        <div className={`${compactDensity.modalPadding} ${compactDensity.formStack} overflow-y-auto`}>
                            <label className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{t.expenses.category}</span>
                                {editing ? (
                                    <p className="text-sm text-gray-800">{editing.categoryName}</p>
                                ) : (
                                    <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={compactDensity.formField} required>
                                        <option value="">{t.expenses.selectCategory}</option>
                                        {categories.map((category) => (
                                            <option key={category.id} value={category.id}>{category.name}</option>
                                        ))}
                                    </select>
                                )}
                            </label>
                            <label className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{t.expenses.head}</span>
                                <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={compactDensity.formField} required />
                            </label>
                            <div className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{t.expenses.expenseAccount}</span>
                                <AccountSelect
                                    accounts={accounts}
                                    value={accountId}
                                    onChange={setAccountId}
                                    ariaLabel={t.expenses.expenseAccount}
                                    placeholder={categoryAccountChoice(formCategory)}
                                    allowClear
                                    clearLabel={categoryAccountChoice(formCategory)}
                                    className={`${compactDensity.formField} min-h-touch`}
                                />
                                <p className="mt-1 text-xs text-gray-500">{t.expenses.headAccountHint}</p>
                            </div>
                            <label className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{t.expenses.notes}</span>
                                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={compactDensity.formField} />
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

export default function ExpenseHeadsPage() {
    const { t } = useI18n();
    return (
        <Suspense fallback={<div className="p-8 text-sm text-gray-500">{t.common.loading}</div>}>
            <ExpenseHeadsPageContent />
        </Suspense>
    );
}
