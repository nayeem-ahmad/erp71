'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Loader2, Plus, Receipt, Settings2, BarChart3, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatBDT, formatDate } from '@/lib/format';

interface ExpenseCategory {
    id: string;
    name: string;
}

interface ExpenseEntry {
    id: string;
    amount: string | number;
    expense_date: string;
    description?: string | null;
    payment_method: string;
    category?: ExpenseCategory;
    store?: { id: string; name: string } | null;
}

const columnHelper = createColumnHelper<ExpenseEntry>();

const PAYMENT_METHODS = ['CASH', 'BKASH', 'CARD', 'BANK'] as const;

function defaultFrom() {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
}

function defaultTo() {
    return new Date().toISOString().slice(0, 10);
}

export default function ExpensesPage() {
    const { t } = useI18n();
    const [entries, setEntries] = useState<ExpenseEntry[]>([]);
    const [categories, setCategories] = useState<ExpenseCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(defaultTo());
    const [categoryFilter, setCategoryFilter] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    const [formCategoryId, setFormCategoryId] = useState('');
    const [formAmount, setFormAmount] = useState('');
    const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
    const [formDescription, setFormDescription] = useState('');
    const [formPaymentMethod, setFormPaymentMethod] = useState<(typeof PAYMENT_METHODS)[number]>('CASH');

    const loadData = async () => {
        setLoading(true);
        try {
            const [entriesData, categoriesData] = await Promise.all([
                api.getExpenseEntries({
                    from: fromDate || undefined,
                    to: toDate || undefined,
                    categoryId: categoryFilter || undefined,
                    limit: 100,
                }),
                api.getExpenseCategories(),
            ]);
            setEntries(Array.isArray(entriesData?.items) ? entriesData.items : []);
            setCategories(Array.isArray(categoriesData) ? categoriesData : []);
        } catch (error) {
            console.error('Failed to load expenses', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadData();
    }, [fromDate, toDate, categoryFilter]);

    const resetForm = () => {
        setFormCategoryId(categories[0]?.id ?? '');
        setFormAmount('');
        setFormDate(new Date().toISOString().slice(0, 10));
        setFormDescription('');
        setFormPaymentMethod('CASH');
    };

    useEffect(() => {
        if (categories.length > 0 && !formCategoryId) {
            setFormCategoryId(categories[0].id);
        }
    }, [categories, formCategoryId]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formCategoryId || !formAmount) {
            setToast({ type: 'error', message: t.expenses.entryRequired });
            return;
        }
        setSaving(true);
        try {
            await api.createExpenseEntry({
                categoryId: formCategoryId,
                amount: Number(formAmount),
                expenseDate: formDate,
                description: formDescription.trim() || undefined,
                paymentMethod: formPaymentMethod,
                storeId: localStorage.getItem('store_id') || undefined,
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
            columnHelper.accessor((row) => row.category?.name ?? '—', {
                id: 'category',
                header: t.expenses.category,
                cell: (info) => <span className="text-sm font-bold text-gray-800">{info.getValue()}</span>,
                size: 160,
            }),
            columnHelper.accessor('description', {
                header: t.expenses.notes,
                cell: (info) => <span className="text-sm text-gray-500 line-clamp-2">{info.getValue() || '—'}</span>,
                size: 220,
            }),
            columnHelper.accessor('payment_method', {
                header: t.expenses.paymentMethod,
                cell: (info) => (
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">{info.getValue()}</span>
                ),
                size: 100,
            }),
            columnHelper.accessor('amount', {
                header: t.common.amount,
                cell: (info) => (
                    <span className="text-sm font-black text-rose-600">{formatBDT(Number(info.getValue()))}</span>
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
                        className="p-2 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50"
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

    const totalAmount = entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

    return (
        <div className="h-full overflow-y-auto bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="w-full space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight inline-flex items-center gap-2">
                            <Receipt className="w-7 h-7 text-rose-600" />
                            {t.expenses.title}
                        </h1>
                        <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                            {t.expenses.subtitle}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Link
                            href="/dashboard/expenses/categories"
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-bold hover:border-gray-300"
                        >
                            <Settings2 className="w-4 h-4" />
                            {t.expenses.manageCategories}
                        </Link>
                        <Link
                            href="/dashboard/expenses/reports"
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-bold hover:border-gray-300"
                        >
                            <BarChart3 className="w-4 h-4" />
                            {t.expenses.reports}
                        </Link>
                        <button
                            type="button"
                            onClick={() => { resetForm(); setShowForm(true); }}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 text-white text-sm font-black hover:bg-rose-700"
                        >
                            <Plus className="w-4 h-4" />
                            {t.expenses.addEntry}
                        </button>
                    </div>
                </div>

                {toast && (
                    <div className={`rounded-xl px-4 py-3 text-sm font-semibold ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
                        {toast.message}
                    </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="rounded-2xl border border-gray-200 bg-white p-5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t.expenses.periodTotal}</p>
                        <p className="text-2xl font-black text-rose-600 mt-1">{formatBDT(totalAmount)}</p>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:col-span-2">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <label className="space-y-1">
                                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t.common.date} (from)</span>
                                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm" />
                            </label>
                            <label className="space-y-1">
                                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t.common.date} (to)</span>
                                <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm" />
                            </label>
                            <label className="space-y-1">
                                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t.expenses.category}</span>
                                <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
                                    <option value="">{t.expenses.allCategories}</option>
                                    {categories.map((cat) => (
                                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                                    ))}
                                </select>
                            </label>
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-20 text-gray-400">
                        <Loader2 className="w-6 h-6 animate-spin mr-2" />
                        {t.common.loading}
                    </div>
                ) : (
                    <DataTable
                        tableId="expenses"
                        title="Expenses"
                        data={entries}
                        columns={columns}
                        searchPlaceholder={t.expenses.searchEntries}
                        emptyMessage={categories.length === 0 ? t.expenses.noCategoriesHint : t.common.noData}
                    />
                )}
            </div>

            {showForm && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <form onSubmit={handleCreate} className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-gray-100">
                            <h2 className="text-xl font-black">{t.expenses.addEntry}</h2>
                        </div>
                        <div className="p-6 space-y-4">
                            {categories.length === 0 ? (
                                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
                                    {t.expenses.noCategoriesHint}
                                </p>
                            ) : (
                                <>
                                    <label className="block space-y-1">
                                        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{t.expenses.category}</span>
                                        <select value={formCategoryId} onChange={(e) => setFormCategoryId(e.target.value)} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm" required>
                                            {categories.map((cat) => (
                                                <option key={cat.id} value={cat.id}>{cat.name}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="block space-y-1">
                                        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{t.common.amount}</span>
                                        <input type="number" min="0.01" step="0.01" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm" required />
                                    </label>
                                    <label className="block space-y-1">
                                        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{t.common.date}</span>
                                        <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm" required />
                                    </label>
                                    <label className="block space-y-1">
                                        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{t.expenses.paymentMethod}</span>
                                        <select value={formPaymentMethod} onChange={(e) => setFormPaymentMethod(e.target.value as typeof formPaymentMethod)} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm">
                                            {PAYMENT_METHODS.map((method) => (
                                                <option key={method} value={method}>{method}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="block space-y-1">
                                        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{t.expenses.notes}</span>
                                        <textarea value={formDescription} onChange={(e) => setFormDescription(e.target.value)} rows={2} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm" />
                                    </label>
                                </>
                            )}
                        </div>
                        <div className="p-6 border-t border-gray-100 flex gap-3">
                            <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-3 rounded-2xl font-bold text-gray-500 hover:bg-gray-50">
                                {t.common.cancel}
                            </button>
                            <button type="submit" disabled={saving || categories.length === 0} className="flex-1 py-3 rounded-2xl font-black bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
                                {saving ? t.common.loading : t.common.save}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}