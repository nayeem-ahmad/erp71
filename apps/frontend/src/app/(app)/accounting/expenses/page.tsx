'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Banknote, BarChart3, Calculator, CreditCard, Plus, Receipt, Settings2, Trash2, Wallet } from 'lucide-react';
import { DataTable, createdAtColumn, type ListFilter, type ListStat } from '@/components/data-table';
import { applyCreatedRangeQuery, createdRangeFromPreset, type CreatedRange } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';
import { AccountingPageShell } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatBDT, formatDate } from '@/lib/format';
import { compactDensity } from '@/lib/ui/compact-density';
import { BranchFilter, Button } from '@/components/ui';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { getWorkspaceItem } from '@/lib/session-store';

interface ExpenseHead {
    id: string;
    name: string;
    category_id?: string;
}

interface ExpenseCategory {
    id: string;
    name: string;
    heads?: ExpenseHead[];
}

interface ExpenseEntry {
    id: string;
    amount: string | number;
    expense_date: string;
    created_at: string;
    description?: string | null;
    payment_method: string;
    category?: ExpenseCategory;
    head?: ExpenseHead | null;
    store?: { id: string; name: string } | null;
}

const columnHelper = createColumnHelper<ExpenseEntry>();

const PAYMENT_METHODS = ['CASH', 'BKASH', 'CARD', 'BANK'] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

function isKnownMethod(method: string): method is PaymentMethod {
    return (PAYMENT_METHODS as readonly string[]).includes(method);
}

/** An amount chip applied to rows already loaded for the date window. */
function matchesAmount(amount: number, condition: NumberCondition | null): boolean {
    if (!condition) return true;
    if (condition.op === 'gt') return amount > condition.value;
    if (condition.op === 'lt') return amount < condition.value;
    if (condition.op === 'eq') return amount === condition.value;
    const upper = condition.to ?? condition.value;
    return amount >= condition.value && amount <= upper;
}

function ExpensesPageContent() {
    const { t, locale } = useI18n();
    // Which branch's entries to list; a new entry is still booked on the
    // header branch.
    const branch = useBranchScope();
    const searchParams = useSearchParams();
    const [entries, setEntries] = useState<ExpenseEntry[]>([]);
    const [categories, setCategories] = useState<ExpenseCategory[]>([]);
    const [loading, setLoading] = useState(true);
    // Opens on this month, read on the workspace's calendar rather than UTC's.
    const [dateRange, setDateRange] = useState<CreatedRange | null>(() => createdRangeFromPreset('thisMonth'));
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [categoryIds, setCategoryIds] = useState<string[]>([]);
    const [headIds, setHeadIds] = useState<string[]>([]);
    const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
    const [amountFilter, setAmountFilter] = useState<NumberCondition | null>(null);
    const [search, setSearch] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    const [formHeadId, setFormHeadId] = useState('');
    const [formAmount, setFormAmount] = useState('');
    const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
    const [formDescription, setFormDescription] = useState('');
    const [formPaymentMethod, setFormPaymentMethod] = useState<(typeof PAYMENT_METHODS)[number]>('CASH');

    const loadData = async () => {
        setLoading(true);
        try {
            const [entriesData, categoriesData] = await Promise.all([
                api.getExpenseEntries({
                    from: dateRange?.from,
                    to: dateRange?.to,
                    ...applyCreatedRangeQuery(createdRange),
                    storeId: branch.apiStoreId,
                }),
                api.getExpenseCategories(),
            ]);
            setEntries(entriesData ?? []);
            setCategories(Array.isArray(categoriesData) ? categoriesData : []);
        } catch (error) {
            if (handleBranchForbidden(error, branch, t.dashboardLayout.branchFilterForbidden)) return;
            console.error('Failed to load expenses', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!branch.ready) return;
        void loadData();
    }, [dateRange, createdRange, branch.ready, branch.apiStoreId]);

    useEffect(() => {
        if (searchParams.get('new') === '1') {
            setShowForm(true);
        }
    }, [searchParams]);

    const heads = useMemo(
        () => categories.flatMap((category) =>
            (category.heads ?? []).map((head) => ({ ...head, categoryId: category.id, categoryName: category.name })),
        ),
        [categories],
    );
    const methodLabel = (method: string) => (isKnownMethod(method) ? t.expenses.methods[method] : method);

    // Date, created and branch narrow what the server sends. The list walks
    // every page of that window, so the other chips and the strip narrow the
    // same rows here.
    const filteredEntries = useMemo(() => {
        const categorySet = new Set(categoryIds);
        const headSet = new Set(headIds);
        const methodSet = new Set(paymentMethods);
        const query = search.trim().toLowerCase();
        return entries.filter((entry) => {
            const categoryId = entry.category?.id ?? '';
            const headId = entry.head?.id ?? '';
            if (categorySet.size && !categorySet.has(categoryId)) return false;
            if (headSet.size && !headSet.has(headId)) return false;
            if (methodSet.size && !methodSet.has(entry.payment_method)) return false;
            if (!matchesAmount(Number(entry.amount || 0), amountFilter)) return false;
            if (!query) return true;
            const haystack = [
                entry.head?.name,
                entry.category?.name,
                entry.description,
                entry.payment_method,
                methodLabel(entry.payment_method),
                String(entry.amount ?? ''),
            ].filter(Boolean).join(' ').toLowerCase();
            return haystack.includes(query);
        });
    }, [entries, categoryIds, headIds, paymentMethods, amountFilter, search, t]);

    const resetForm = () => {
        setFormHeadId('');
        setFormAmount('');
        setFormDate(new Date().toISOString().slice(0, 10));
        setFormDescription('');
        setFormPaymentMethod('CASH');
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formHeadId || !formAmount) {
            setToast({ type: 'error', message: t.expenses.entryRequired });
            return;
        }
        setSaving(true);
        try {
            await api.createExpenseEntry({
                headId: formHeadId,
                amount: Number(formAmount),
                expenseDate: formDate,
                description: formDescription.trim() || undefined,
                paymentMethod: formPaymentMethod,
                storeId: getWorkspaceItem('store_id') || undefined,
            });
            setToast({ type: 'success', message: t.expenses.entrySaved });
            setShowForm(false);
            resetForm();
            await loadData();
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (entry: ExpenseEntry) => {
        if (!globalThis.confirm(t.expenses.deleteConfirm)) return;
        try {
            await api.deleteExpenseEntry(entry.id);
            setToast({ type: 'success', message: t.expenses.entryDeleted });
            await loadData();
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
        }
    };

    const columns: ColumnDef<ExpenseEntry, any>[] = useMemo(
        () => [
            columnHelper.accessor('expense_date', {
                header: t.common.date,
                cell: (info) => <span className="text-sm text-gray-700">{formatDate(info.getValue())}</span>,
                sortingFn: 'datetime',
                size: 120,
            }),
            createdAtColumn(columnHelper, { header: t.common.createdAt }),
            columnHelper.accessor((row) => row.head?.name ?? row.category?.name ?? '—', {
                id: 'head',
                header: t.expenses.head,
                cell: (info) => <span className="text-sm font-bold text-gray-800">{info.getValue()}</span>,
                size: 180,
            }),
            columnHelper.accessor((row) => row.category?.name ?? '—', {
                id: 'category',
                header: t.expenses.category,
                cell: (info) => <span className="text-sm text-gray-600">{info.getValue()}</span>,
                meta: { hideOnMobile: true },
                size: 140,
            }),
            columnHelper.accessor('description', {
                header: t.expenses.notes,
                cell: (info) => <span className="text-sm text-gray-500 line-clamp-2">{info.getValue() || '—'}</span>,
                size: 220,
            }),
            columnHelper.accessor('payment_method', {
                header: t.expenses.paymentMethod,
                cell: (info) => <span className="text-sm text-gray-600">{methodLabel(info.getValue())}</span>,
                size: 120,
            }),
            columnHelper.accessor('amount', {
                header: t.common.amount,
                cell: (info) => (
                    <span className="text-sm font-bold text-danger">{formatBDT(Number(info.getValue()))}</span>
                ),
                sortingFn: (a, b) => Number(a.getValue('amount')) - Number(b.getValue('amount')),
                size: 120,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: ({ row }) => (
                    <button
                        type="button"
                        onClick={() => handleDelete(row.original)}
                        className="p-2 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50"
                        title={t.common.delete}
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                ),
                size: 70,
            }),
        ],
        [t],
    );

    const headChoices = useMemo(
        () => (categoryIds.length
            ? heads.filter((head) => categoryIds.includes(head.categoryId))
            : heads),
        [heads, categoryIds],
    );

    // The row holds what the old bar held, plus amount. Created waits behind More.
    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'expenseDate',
                type: 'date-range',
                label: t.common.date,
                value: dateRange,
                onChange: setDateRange,
                operators: true,
            },
            {
                id: 'category',
                type: 'multi-select',
                label: t.expenses.category,
                value: categoryIds,
                onChange: (next) => {
                    setCategoryIds(next);
                    if (!next.length) return;
                    const allowed = new Set(
                        heads.filter((head) => next.includes(head.categoryId)).map((head) => head.id),
                    );
                    setHeadIds((current) => current.filter((id) => allowed.has(id)));
                },
                options: categories.map((category) => ({ value: category.id, label: category.name })),
            },
            {
                id: 'head',
                type: 'multi-select',
                label: t.expenses.head,
                value: headIds,
                onChange: setHeadIds,
                options: headChoices.map((head) => ({
                    value: head.id,
                    label: categoryIds.length === 1 ? head.name : `${head.categoryName} — ${head.name}`,
                })),
            },
            {
                id: 'payment',
                type: 'multi-select',
                label: t.expenses.paymentMethod,
                value: paymentMethods,
                onChange: setPaymentMethods,
                options: PAYMENT_METHODS.map((value) => ({ value, label: t.expenses.methods[value] })),
            },
            {
                id: 'amount',
                type: 'number',
                label: t.common.amount,
                value: amountFilter,
                onChange: setAmountFilter,
                money: true,
            },
            { id: 'created', type: 'date-range', value: createdRange, onChange: setCreatedRange, operators: true, more: true },
        ],
        [t, dateRange, categoryIds, categories, headIds, headChoices, paymentMethods, amountFilter, createdRange, heads],
    );

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale });
        const count = filteredEntries.length;
        const total = filteredEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
        const cash = filteredEntries.reduce(
            (sum, entry) => sum + (entry.payment_method === 'CASH' ? Number(entry.amount || 0) : 0),
            0,
        );
        const items: ListStat[] = [
            {
                id: 'count',
                icon: <Receipt aria-hidden />,
                label: t.expenses.entryCount,
                value: count.toLocaleString(locale),
            },
            {
                id: 'total',
                icon: <Banknote aria-hidden />,
                label: t.expenses.periodTotal,
                value: money(total),
                tone: total > 0 ? 'danger' : 'default',
            },
            {
                id: 'average',
                icon: <Calculator aria-hidden />,
                label: t.expenses.average,
                value: money(count ? total / count : 0),
            },
            { id: 'cash', icon: <Wallet aria-hidden />, label: t.expenses.cash, value: money(cash) },
            {
                id: 'other',
                icon: <CreditCard aria-hidden />,
                label: t.expenses.otherMethods,
                value: money(total - cash),
            },
        ];
        return { items, loading, label: t.expenses.statsLabel };
    }, [filteredEntries, loading, locale, t]);

    return (
        <AccountingPageShell>
            <PageHeader
                title={t.expenses.title}
                subtitle={t.expenses.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.expenses.title,
                    'accounting',
                )}
                actions={(
                    <>
                        <BranchFilter scope={branch} />
                        <Link href="/accounting/expenses/categories" className={compactDensity.btnSecondary}>
                            <Settings2 className="w-3.5 h-3.5" />
                            {t.expenses.manageCategories}
                        </Link>
                        <Link href="/accounting/expenses/reports" className={compactDensity.btnSecondary}>
                            <BarChart3 className="w-3.5 h-3.5" />
                            {t.expenses.reports}
                        </Link>
                        <button
                            type="button"
                            onClick={() => { resetForm(); setShowForm(true); }}
                            className={`${compactDensity.btnPrimary} bg-primary text-white hover:bg-primary-hover`}
                        >
                            <Plus className="w-3.5 h-3.5" />
                            {t.expenses.addEntry}
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
                tableId="expenses"
                title={t.expenses.title}
                data={filteredEntries}
                columns={columns}
                isLoading={loading}
                searchPlaceholder={t.expenses.searchEntries}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                emptyMessage={categories.length === 0 ? t.expenses.noCategoriesHint : heads.length === 0 ? t.expenses.noHeadsHint : t.common.noData}
            />

            {showForm && (
                <ModalShell size="sm" onBackdropClick={() => setShowForm(false)}>
                    <form onSubmit={handleCreate} className="flex max-h-[90vh] flex-col overflow-hidden">
                        <ModalHeader title={t.expenses.addEntry} onClose={() => setShowForm(false)} />
                        <div className={`${compactDensity.modalPadding} ${compactDensity.formStack} overflow-y-auto`}>
                            {heads.length === 0 ? (
                                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                                    {categories.length === 0 ? t.expenses.noCategoriesHint : t.expenses.noHeadsHint}
                                </p>
                            ) : (
                                <>
                                    <label className="block">
                                        <span className={`${compactDensity.formLabel} block mb-1`}>{t.expenses.head}</span>
                                        <select value={formHeadId} onChange={(e) => setFormHeadId(e.target.value)} className={compactDensity.formField} required>
                                            <option value="">{t.expenses.selectHead}</option>
                                            {categories.filter((cat) => (cat.heads ?? []).length > 0).map((cat) => (
                                                <optgroup key={cat.id} label={cat.name}>
                                                    {(cat.heads ?? []).map((head) => (
                                                        <option key={head.id} value={head.id}>{head.name}</option>
                                                    ))}
                                                </optgroup>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="block">
                                        <span className={`${compactDensity.formLabel} block mb-1`}>{t.common.amount}</span>
                                        <input type="number" min="0.01" step="0.01" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} className={compactDensity.formField} required />
                                    </label>
                                    <label className="block">
                                        <span className={`${compactDensity.formLabel} block mb-1`}>{t.common.date}</span>
                                        <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} className={compactDensity.formField} required />
                                    </label>
                                    <label className="block">
                                        <span className={`${compactDensity.formLabel} block mb-1`}>{t.expenses.paymentMethod}</span>
                                        <select value={formPaymentMethod} onChange={(e) => setFormPaymentMethod(e.target.value as typeof formPaymentMethod)} className={compactDensity.formField}>
                                            {PAYMENT_METHODS.map((method) => (
                                                <option key={method} value={method}>{t.expenses.methods[method]}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="block">
                                        <span className={`${compactDensity.formLabel} block mb-1`}>{t.expenses.notes}</span>
                                        <textarea value={formDescription} onChange={(e) => setFormDescription(e.target.value)} rows={2} className={compactDensity.formField} />
                                    </label>
                                </>
                            )}
                        </div>
                        <ModalFooter>
                            <Button variant="secondary" type="button" onClick={() => setShowForm(false)}>
                                {t.common.cancel}
                            </Button>
                            <Button variant="primary" type="submit" loading={saving} disabled={heads.length === 0}>
                                {t.common.save}
                            </Button>
                        </ModalFooter>
                    </form>
                </ModalShell>
            )}
        </AccountingPageShell>
    );
}

export default function ExpensesPage() {
    const { t } = useI18n();
    return (
        <Suspense fallback={<div className="p-8 text-sm text-gray-500">{t.common.loading}</div>}>
            <ExpensesPageContent />
        </Suspense>
    );
}