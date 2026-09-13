'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell, Button, ConfirmDialog, Select, Input } from '@/components/ui';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { formatBDT, formatDate } from '@/lib/format';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import PlatformExpenseCategoriesModal from '@/components/admin/accounting/PlatformExpenseCategoriesModal';
import {
    PLATFORM_PAYMENT_METHODS,
    startOfYearISO,
    todayISO,
    type PlatformExpense,
    type PlatformExpenseCategory,
    type PlatformExpenseList,
} from '@/components/admin/accounting/types';

interface ExpenseForm {
    categoryId: string;
    amount: string;
    expenseDate: string;
    paidFrom: string;
    vendor: string;
    description: string;
    reference: string;
}

function emptyForm(categoryId: string): ExpenseForm {
    return {
        categoryId,
        amount: '',
        expenseDate: todayISO(),
        paidFrom: 'BANK',
        vendor: '',
        description: '',
        reference: '',
    };
}

/**
 * Admin › Accounting › Expenses — the money going out.
 *
 * This is the half of the platform's books nothing in the product recorded
 * before: subscription revenue was at least visible as billing events, but a
 * server bill was visible nowhere at all.
 */
export default function PlatformExpensesPage() {
    const { t } = useI18n();
    const m = t.admin.accounting;
    const mp = m.expensesPage;

    const [categories, setCategories] = useState<PlatformExpenseCategory[]>([]);
    const [list, setList] = useState<PlatformExpenseList | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [from, setFrom] = useState(startOfYearISO());
    const [to, setTo] = useState(todayISO());
    const [categoryFilter, setCategoryFilter] = useState('');
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);

    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<PlatformExpense | null>(null);
    const [form, setForm] = useState<ExpenseForm>(emptyForm(''));
    const [formError, setFormError] = useState('');
    const [saving, setSaving] = useState(false);
    const [categoriesOpen, setCategoriesOpen] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<PlatformExpense | null>(null);
    const [deleting, setDeleting] = useState(false);

    const activeCategories = useMemo(
        // A retired category still names old rows, but must not be offered for a
        // new one — the server rejects it, and an option that always errors is
        // worse than no option.
        () => categories.filter((category) => category.is_active),
        [categories],
    );

    const loadCategories = useCallback(async () => {
        try {
            setCategories(await api.getPlatformExpenseCategories());
        } catch {
            // Non-fatal: the list below still renders, and the form reports the
            // real problem when someone tries to save.
        }
    }, []);

    const loadExpenses = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setList(await api.getPlatformExpenses({
                from: from || undefined,
                to: to || undefined,
                categoryId: categoryFilter || undefined,
                search: search || undefined,
                page,
                limit: 20,
            }));
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [from, to, categoryFilter, search, page, m.loadFailed]);

    useEffect(() => {
        void loadCategories();
    }, [loadCategories]);

    useEffect(() => {
        void loadExpenses();
    }, [loadExpenses]);

    const openCreate = () => {
        setEditing(null);
        setForm(emptyForm(activeCategories[0]?.id ?? ''));
        setFormError('');
        setFormOpen(true);
    };

    const openEdit = (expense: PlatformExpense) => {
        setEditing(expense);
        setForm({
            categoryId: expense.category_id,
            amount: String(expense.amount),
            expenseDate: expense.expense_date.slice(0, 10),
            paidFrom: expense.paid_from,
            vendor: expense.vendor ?? '',
            description: expense.description ?? '',
            reference: expense.reference ?? '',
        });
        setFormError('');
        setFormOpen(true);
    };

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        const amount = Number(form.amount);
        if (!form.categoryId || !Number.isFinite(amount) || amount <= 0) {
            setFormError(mp.saveFailed);
            return;
        }

        setSaving(true);
        setFormError('');
        try {
            const payload = {
                categoryId: form.categoryId,
                amount,
                expenseDate: form.expenseDate,
                paidFrom: form.paidFrom,
                vendor: form.vendor || undefined,
                description: form.description || undefined,
                reference: form.reference || undefined,
            };

            if (editing) {
                await api.updatePlatformExpense(editing.id, payload);
                toast.success(mp.updated);
            } else {
                await api.createPlatformExpense(payload);
                toast.success(mp.created);
            }
            setFormOpen(false);
            await loadExpenses();
        } catch (err: unknown) {
            setFormError(err instanceof Error ? err.message : mp.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        setDeleting(true);
        try {
            await api.deletePlatformExpense(pendingDelete.id);
            toast.success(mp.deleted);
            setPendingDelete(null);
            await loadExpenses();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : mp.saveFailed);
        } finally {
            setDeleting(false);
        }
    };

    const paymentLabel = (method: string) =>
        m.paymentMethods[method as keyof typeof m.paymentMethods] ?? method;

    return (
        <PageShell>
            <div className="space-y-4">
                <PageHeader
                    title={mp.title}
                    subtitle={mp.description}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        'admin',
                        [{ label: m.breadcrumb, href: routes.admin.accounting.root }],
                        mp.title,
                    )}
                    actions={(
                        <>
                            <Button
                                variant="secondary"
                                onClick={() => setCategoriesOpen(true)}
                                icon={<Settings2 className="h-4 w-4" />}
                            >
                                {mp.manageCategories}
                            </Button>
                            <Button onClick={openCreate} icon={<Plus className="h-4 w-4" />}>
                                {mp.add}
                            </Button>
                        </>
                    )}
                />

                <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-100 bg-white p-3">
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-500">{m.range.from}</span>
                        <input
                            type="date"
                            value={from}
                            onChange={(event) => { setFrom(event.target.value); setPage(1); }}
                            className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm"
                        />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-500">{m.range.to}</span>
                        <input
                            type="date"
                            value={to}
                            onChange={(event) => { setTo(event.target.value); setPage(1); }}
                            className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm"
                        />
                    </label>
                    <label className="flex min-w-[10rem] flex-col gap-1">
                        <span className="text-xs font-medium text-gray-500">{mp.columns.category}</span>
                        <Select
                            value={categoryFilter}
                            onChange={(event) => { setCategoryFilter(event.target.value); setPage(1); }}
                        >
                            <option value="">—</option>
                            {categories.map((category) => (
                                <option key={category.id} value={category.id}>{category.name}</option>
                            ))}
                        </Select>
                    </label>
                    <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
                        <span className="text-xs font-medium text-gray-500">{mp.search}</span>
                        <Input
                            value={search}
                            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                            placeholder={mp.search}
                        />
                    </label>
                    {list ? (
                        <div className="ms-auto text-end">
                            <p className="text-xs font-medium text-gray-500">{mp.total}</p>
                            <p className="text-lg font-bold tracking-tight text-gray-900">
                                {formatBDT(list.meta.totalAmount)}
                            </p>
                        </div>
                    ) : null}
                </div>

                {error ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
                ) : null}

                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                    <table className="w-full min-w-[52rem] text-sm">
                        <thead>
                            <tr className="border-b border-gray-200 bg-gray-50/80 text-xs font-medium text-gray-500">
                                <th className="px-2 py-1.5 text-start">{mp.columns.date}</th>
                                <th className="px-2 py-1.5 text-start">{mp.columns.category}</th>
                                <th className="px-2 py-1.5 text-start">{mp.columns.vendor}</th>
                                <th className="px-2 py-1.5 text-start">{mp.columns.description}</th>
                                <th className="px-2 py-1.5 text-start">{mp.columns.paidFrom}</th>
                                <th className="px-2 py-1.5 text-end">{mp.columns.amount}</th>
                                <th className="px-2 py-1.5 text-end">{mp.columns.actions}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={7} className="p-6 text-center text-gray-400">
                                        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                                    </td>
                                </tr>
                            ) : null}

                            {!loading && (list?.data.length ?? 0) === 0 ? (
                                <tr>
                                    <td colSpan={7} className="p-6 text-center text-xs text-gray-400">{mp.empty}</td>
                                </tr>
                            ) : null}

                            {!loading && list?.data.map((expense) => (
                                <tr key={expense.id} className="border-b border-gray-100 last:border-0">
                                    <td className="whitespace-nowrap px-2 py-1.5">{formatDate(expense.expense_date)}</td>
                                    <td className="px-2 py-1.5">{expense.category_name ?? '—'}</td>
                                    <td className="px-2 py-1.5">{expense.vendor || '—'}</td>
                                    <td className="max-w-xs truncate px-2 py-1.5 text-gray-600">
                                        {expense.description || '—'}
                                    </td>
                                    <td className="px-2 py-1.5">{paymentLabel(expense.paid_from)}</td>
                                    <td className="whitespace-nowrap px-2 py-1.5 text-end font-semibold">
                                        {formatBDT(expense.amount)}
                                    </td>
                                    <td className="whitespace-nowrap px-2 py-1.5 text-end">
                                        <button
                                            type="button"
                                            onClick={() => openEdit(expense)}
                                            className="me-1 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                                            aria-label={mp.edit}
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setPendingDelete(expense)}
                                            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                            aria-label={mp.deleteTitle}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {list && list.meta.totalPages > 1 ? (
                    <div className="flex items-center justify-end gap-2">
                        <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</Button>
                        <span className="text-xs text-gray-500">{page} / {list.meta.totalPages}</span>
                        <Button
                            variant="secondary"
                            disabled={page >= list.meta.totalPages}
                            onClick={() => setPage(page + 1)}
                        >
                            ›
                        </Button>
                    </div>
                ) : null}
            </div>

            {formOpen ? (
                <ModalShell size="md" onBackdropClick={() => setFormOpen(false)}>
                    <ModalHeader title={editing ? mp.edit : mp.add} onClose={() => setFormOpen(false)} />
                    <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
                        <div className="flex-1 space-y-3 overflow-y-auto p-4">
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <label className="flex flex-col gap-1">
                                    <span className="text-xs font-medium text-gray-500">{mp.form.category}</span>
                                    <Select
                                        value={form.categoryId}
                                        onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
                                        required
                                    >
                                        <option value="" disabled>—</option>
                                        {activeCategories.map((category) => (
                                            <option key={category.id} value={category.id}>{category.name}</option>
                                        ))}
                                    </Select>
                                </label>
                                <label className="flex flex-col gap-1">
                                    <span className="text-xs font-medium text-gray-500">{mp.form.amount}</span>
                                    <Input
                                        type="number"
                                        min="0.01"
                                        step="0.01"
                                        value={form.amount}
                                        onChange={(event) => setForm({ ...form, amount: event.target.value })}
                                        required
                                    />
                                </label>
                                <label className="flex flex-col gap-1">
                                    <span className="text-xs font-medium text-gray-500">{mp.form.date}</span>
                                    <Input
                                        type="date"
                                        value={form.expenseDate}
                                        onChange={(event) => setForm({ ...form, expenseDate: event.target.value })}
                                        required
                                    />
                                </label>
                                <label className="flex flex-col gap-1">
                                    <span className="text-xs font-medium text-gray-500">{mp.form.paidFrom}</span>
                                    <Select
                                        value={form.paidFrom}
                                        onChange={(event) => setForm({ ...form, paidFrom: event.target.value })}
                                    >
                                        {PLATFORM_PAYMENT_METHODS.map((method) => (
                                            <option key={method} value={method}>{paymentLabel(method)}</option>
                                        ))}
                                    </Select>
                                </label>
                                <label className="flex flex-col gap-1">
                                    <span className="text-xs font-medium text-gray-500">{mp.form.vendor}</span>
                                    <Input
                                        value={form.vendor}
                                        onChange={(event) => setForm({ ...form, vendor: event.target.value })}
                                        placeholder={mp.form.vendorPlaceholder}
                                    />
                                </label>
                                <label className="flex flex-col gap-1">
                                    <span className="text-xs font-medium text-gray-500">{mp.form.reference}</span>
                                    <Input
                                        value={form.reference}
                                        onChange={(event) => setForm({ ...form, reference: event.target.value })}
                                        placeholder={mp.form.referencePlaceholder}
                                    />
                                </label>
                            </div>
                            <label className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-gray-500">{mp.form.description}</span>
                                <Input
                                    value={form.description}
                                    onChange={(event) => setForm({ ...form, description: event.target.value })}
                                />
                            </label>

                            {formError ? <p className="text-xs text-red-600">{formError}</p> : null}
                        </div>
                        <ModalFooter>
                            <Button variant="secondary" onClick={() => setFormOpen(false)}>{mp.form.cancel}</Button>
                            <Button type="submit" loading={saving}>
                                {saving ? mp.form.saving : mp.form.save}
                            </Button>
                        </ModalFooter>
                    </form>
                </ModalShell>
            ) : null}

            {categoriesOpen ? (
                <PlatformExpenseCategoriesModal
                    categories={categories}
                    onClose={() => setCategoriesOpen(false)}
                    onChanged={async () => {
                        await loadCategories();
                        await loadExpenses();
                    }}
                />
            ) : null}

            <ConfirmDialog
                open={Boolean(pendingDelete)}
                title={mp.deleteTitle}
                prompt={mp.deleteBody}
                confirmLabel={mp.form.save}
                cancelLabel={mp.form.cancel}
                workingLabel={mp.form.saving}
                loading={deleting}
                danger
                onConfirm={confirmDelete}
                onCancel={() => setPendingDelete(null)}
            />
        </PageShell>
    );
}
