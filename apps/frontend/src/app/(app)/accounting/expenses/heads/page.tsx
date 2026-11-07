'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { FolderTree, Pencil, Plus, Receipt, Settings2, Tags, Trash2 } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import { AccountingPageShell } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import type { NumberCondition } from '@/lib/number-condition';
import { toast } from '@/lib/toast';
import { Button, ConfirmDialog, Field, Input, Textarea, buttonClassName } from '@/components/ui';
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
    const [categoryExclude, setCategoryExclude] = useState(false);
    const [entriesFilter, setEntriesFilter] = useState<NumberCondition | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState<HeadRow | null>(null);
    const [categoryId, setCategoryId] = useState('');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [accountId, setAccountId] = useState('');
    const [accounts, setAccounts] = useState<AccountOption[]>([]);
    const [saving, setSaving] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<HeadRow | null>(null);
    const [deleting, setDeleting] = useState(false);

    const loadCategories = async () => {
        setLoading(true);
        try {
            const data = await api.getExpenseCategories();
            setCategories(Array.isArray(data) ? data : []);
        } catch (error: any) {
            toast.error(error?.message || t.common.error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadCategories();
        // Loaded once; the loader reads only the copy.
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
            toast.error(!categoryId && !editing ? t.expenses.selectCategory : t.expenses.headNameRequired);
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
                toast.success(t.expenses.headUpdated);
            } else {
                await api.createExpenseHead({ categoryId, ...payload });
                toast.success(t.expenses.headCreated);
            }
            setShowForm(false);
            await loadCategories();
        } catch (error: any) {
            toast.error(error?.message || t.common.error);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!pendingDelete) return;
        setDeleting(true);
        try {
            await api.deleteExpenseHead(pendingDelete.id);
            toast.success(t.expenses.headDeleted);
            setPendingDelete(null);
            await loadCategories();
        } catch (error: any) {
            toast.error(error?.message || t.common.error);
        } finally {
            setDeleting(false);
        }
    };

    const filtered = useMemo(
        () =>
            heads.filter((head) => {
                if (!matchesAnyOf(categoryIds, head.category_id, categoryExclude)) return false;
                if (!matchesNumberCondition(head._count?.entries ?? 0, entriesFilter)) return false;
                const account = head.account ? accountLabel(head.account) : categoryAccountChoice(head.category);
                return matchesSearch(search, head.name, head.categoryName, head.description, account);
            }),
        // accountLabel / categoryAccountChoice read only `t`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [heads, categoryIds, categoryExclude, entriesFilter, search, t],
    );

    const columns: ColumnDef<HeadRow, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: t.expenses.head,
                cell: (info) => <span className="font-medium text-gray-900">{info.getValue()}</span>,
                size: 200,
            }),
            columnHelper.accessor('categoryName', {
                header: t.expenses.category,
                cell: (info) => info.getValue(),
                size: 160,
            }),
            columnHelper.display({
                id: 'account',
                header: t.expenses.expenseAccount,
                meta: { hideOnMobile: true },
                cell: ({ row }) => (
                    row.original.account
                        ? accountLabel(row.original.account)
                        : categoryAccountChoice(row.original.category)
                ),
                size: 220,
            }),
            columnHelper.accessor('description', {
                header: t.expenses.notes,
                meta: { hideOnMobile: true },
                cell: (info) => info.getValue() || t.shared.dash,
                size: 200,
            }),
            columnHelper.accessor((row) => row._count?.entries ?? 0, {
                id: 'entries',
                header: t.expenses.entryCount,
                meta: { align: 'end' },
                cell: (info) => <span className="tabular-nums">{info.getValue().toLocaleString(locale)}</span>,
                size: 100,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: ({ row }) => (
                    <RowActions>
                        <RowActionButton
                            icon={<Pencil />}
                            label={t.expenses.editHead}
                            onClick={() => openEdit(row.original)}
                        />
                        <RowActionButton
                            icon={<Trash2 />}
                            label={t.common.delete}
                            intent="danger"
                            onClick={() => setPendingDelete(row.original)}
                        />
                    </RowActions>
                ),
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 90,
            }),
        ],
        // openEdit is stable enough for the table; it closes over current state setters.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [t, locale],
    );

    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'category',
                type: 'multi-select',
                label: t.expenses.category,
                value: categoryIds,
                onChange: setCategoryIds,
                exclude: { value: categoryExclude, onChange: setCategoryExclude },
                options: categories.map((category) => ({ value: category.id, label: category.name })),
            },
            {
                id: 'entries',
                type: 'number',
                label: t.expenses.entryCount,
                value: entriesFilter,
                onChange: setEntriesFilter,
                more: true,
            },
        ],
        [t, categoryIds, categoryExclude, entriesFilter, categories],
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
                        <Link href={routes.accounting.expenseCategories} className={buttonClassName({ variant: 'secondary' })}>
                            <Settings2 className="h-4 w-4" />
                            {t.expenses.manageCategories}
                        </Link>
                        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                            {t.expenses.addHead}
                        </Button>
                    </>
                )}
            />

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
                emptyIcon={<Tags className="h-16 w-16 text-gray-200" />}
                getRowId={(row) => row.id}
            />

            {showForm && (
                <ModalShell size="sm" onBackdropClick={() => setShowForm(false)}>
                    <form onSubmit={handleSubmit} className="flex max-h-[90vh] flex-col overflow-hidden">
                        <ModalHeader
                            title={editing ? t.expenses.editHead : t.expenses.addHead}
                            subtitle={editing?.categoryName}
                            onClose={() => setShowForm(false)}
                        />
                        <div className="space-y-3 overflow-y-auto p-3 md:p-4">
                            <Field label={t.expenses.category}>
                                {editing ? (
                                    <p className="text-sm text-gray-800">{editing.categoryName}</p>
                                ) : (
                                    <select
                                        value={categoryId}
                                        onChange={(e) => setCategoryId(e.target.value)}
                                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm min-h-touch"
                                        required
                                        aria-label={t.expenses.category}
                                    >
                                        <option value="">{t.expenses.selectCategory}</option>
                                        {categories.map((category) => (
                                            <option key={category.id} value={category.id}>{category.name}</option>
                                        ))}
                                    </select>
                                )}
                            </Field>
                            <Field label={t.expenses.head}>
                                <Input
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    required
                                    aria-label={t.expenses.head}
                                />
                            </Field>
                            <Field label={t.expenses.expenseAccount} hint={t.expenses.headAccountHint}>
                                <AccountSelect
                                    accounts={accounts}
                                    value={accountId}
                                    onChange={setAccountId}
                                    ariaLabel={t.expenses.expenseAccount}
                                    placeholder={categoryAccountChoice(formCategory)}
                                    allowClear
                                    clearLabel={categoryAccountChoice(formCategory)}
                                    className="min-h-touch w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                                />
                            </Field>
                            <Field label={t.expenses.notes}>
                                <Textarea
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    rows={2}
                                    aria-label={t.expenses.notes}
                                />
                            </Field>
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

            <ConfirmDialog
                open={pendingDelete !== null}
                title={t.common.delete}
                prompt={t.expenses.deleteHeadConfirm}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                loading={deleting}
                danger
                onConfirm={() => void handleDelete()}
                onCancel={() => { if (!deleting) setPendingDelete(null); }}
            />
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
