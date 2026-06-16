'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { HandCoins, Loader2, Plus, Trash2, Wallet } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatBDT, formatDate } from '@/lib/format';

interface LoanPayment {
    id: string;
    amount: string | number;
    payment_date: string;
    payment_method: string;
    notes?: string | null;
}

interface Loan {
    id: string;
    counterparty: string;
    direction: 'PAYABLE' | 'RECEIVABLE';
    principal: string | number;
    interest_rate?: string | number | null;
    start_date: string;
    due_date?: string | null;
    status: 'ACTIVE' | 'CLOSED';
    reference?: string | null;
    notes?: string | null;
    total_paid: number;
    outstanding: number;
    payments?: LoanPayment[];
    store?: { id: string; name: string } | null;
}

interface LoanSummary {
    payable: { count: number; principal: number; paid: number; outstanding: number };
    receivable: { count: number; principal: number; paid: number; outstanding: number };
    activeCount: number;
    closedCount: number;
}

const PAYMENT_METHODS = ['CASH', 'BKASH', 'CARD', 'BANK'] as const;

const columnHelper = createColumnHelper<Loan>();

const today = () => new Date().toISOString().slice(0, 10);

export default function LoansPage() {
    const { t } = useI18n();
    const [loans, setLoans] = useState<Loan[]>([]);
    const [summary, setSummary] = useState<LoanSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [directionFilter, setDirectionFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState({
        counterparty: '',
        direction: 'PAYABLE' as 'PAYABLE' | 'RECEIVABLE',
        principal: '',
        interestRate: '',
        startDate: today(),
        dueDate: '',
        reference: '',
        notes: '',
    });

    const [detail, setDetail] = useState<Loan | null>(null);
    const [payForm, setPayForm] = useState({ amount: '', paymentDate: today(), paymentMethod: 'CASH', notes: '' });
    const [paying, setPaying] = useState(false);

    const loadData = async () => {
        setLoading(true);
        try {
            const [loansData, summaryData] = await Promise.all([
                api.getLoans({
                    direction: directionFilter || undefined,
                    status: statusFilter || undefined,
                    limit: 100,
                }),
                api.getLoanSummary(),
            ]);
            setLoans(Array.isArray(loansData?.items) ? loansData.items : []);
            setSummary(summaryData ?? null);
        } catch (error) {
            console.error('Failed to load loans', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadData();
    }, [directionFilter, statusFilter]);

    const openCreate = () => {
        setEditingId(null);
        setForm({
            counterparty: '',
            direction: 'PAYABLE',
            principal: '',
            interestRate: '',
            startDate: today(),
            dueDate: '',
            reference: '',
            notes: '',
        });
        setShowForm(true);
    };

    const openEdit = (loan: Loan) => {
        setEditingId(loan.id);
        setForm({
            counterparty: loan.counterparty,
            direction: loan.direction,
            principal: String(loan.principal),
            interestRate: loan.interest_rate != null ? String(loan.interest_rate) : '',
            startDate: loan.start_date.slice(0, 10),
            dueDate: loan.due_date ? loan.due_date.slice(0, 10) : '',
            reference: loan.reference ?? '',
            notes: loan.notes ?? '',
        });
        setShowForm(true);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.counterparty.trim() || !form.principal) {
            setToast({ type: 'error', message: t.loans.counterpartyRequired });
            return;
        }
        setSaving(true);
        try {
            const payload = {
                counterparty: form.counterparty.trim(),
                direction: form.direction,
                principal: Number(form.principal),
                interestRate: form.interestRate ? Number(form.interestRate) : undefined,
                startDate: form.startDate,
                dueDate: form.dueDate || undefined,
                reference: form.reference.trim() || undefined,
                notes: form.notes.trim() || undefined,
                storeId: localStorage.getItem('store_id') || undefined,
            };
            if (editingId) {
                await api.updateLoan(editingId, payload);
            } else {
                await api.createLoan(payload);
            }
            setToast({ type: 'success', message: t.loans.loanSaved });
            setShowForm(false);
            await loadData();
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (loan: Loan) => {
        if (!globalThis.confirm(t.loans.deleteConfirm)) return;
        try {
            await api.deleteLoan(loan.id);
            setToast({ type: 'success', message: t.loans.loanDeleted });
            await loadData();
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
        }
    };

    const toggleStatus = async (loan: Loan) => {
        try {
            await api.updateLoan(loan.id, { status: loan.status === 'CLOSED' ? 'ACTIVE' : 'CLOSED' });
            await loadData();
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
        }
    };

    const openDetail = async (loan: Loan) => {
        try {
            const full = await api.getLoan(loan.id);
            setDetail(full);
            setPayForm({ amount: '', paymentDate: today(), paymentMethod: 'CASH', notes: '' });
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
        }
    };

    const handleAddPayment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!detail || !payForm.amount) return;
        setPaying(true);
        try {
            const updated = await api.addLoanPayment(detail.id, {
                amount: Number(payForm.amount),
                paymentDate: payForm.paymentDate,
                paymentMethod: payForm.paymentMethod,
                notes: payForm.notes.trim() || undefined,
            });
            setDetail(updated);
            setPayForm({ amount: '', paymentDate: today(), paymentMethod: 'CASH', notes: '' });
            setToast({ type: 'success', message: t.loans.paymentSaved });
            await loadData();
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
        } finally {
            setPaying(false);
        }
    };

    const handleDeletePayment = async (paymentId: string) => {
        if (!detail || !globalThis.confirm(t.loans.deletePaymentConfirm)) return;
        try {
            const updated = await api.deleteLoanPayment(detail.id, paymentId);
            setDetail(updated);
            setToast({ type: 'success', message: t.loans.paymentDeleted });
            await loadData();
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
        }
    };

    const columns: ColumnDef<Loan, any>[] = useMemo(
        () => [
            columnHelper.accessor('counterparty', {
                header: t.loans.counterparty,
                cell: (info) => (
                    <button
                        type="button"
                        onClick={() => openDetail(info.row.original)}
                        className="text-sm font-bold text-indigo-700 hover:underline text-left"
                    >
                        {info.getValue()}
                    </button>
                ),
                size: 180,
            }),
            columnHelper.accessor('direction', {
                header: t.loans.direction,
                cell: (info) => (
                    <span
                        className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full ${info.getValue() === 'RECEIVABLE' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
                    >
                        {info.getValue() === 'RECEIVABLE' ? t.loans.receivable : t.loans.payable}
                    </span>
                ),
                size: 120,
            }),
            columnHelper.accessor('principal', {
                header: t.loans.principal,
                cell: (info) => <span className="text-sm font-semibold text-gray-700">{formatBDT(Number(info.getValue()))}</span>,
                size: 120,
            }),
            columnHelper.accessor('total_paid', {
                header: t.loans.totalPaid,
                cell: (info) => <span className="text-sm text-emerald-600">{formatBDT(Number(info.getValue() || 0))}</span>,
                size: 110,
            }),
            columnHelper.accessor('outstanding', {
                header: t.loans.outstanding,
                cell: (info) => <span className="text-sm font-black text-rose-600">{formatBDT(Number(info.getValue() || 0))}</span>,
                size: 120,
            }),
            columnHelper.accessor('due_date', {
                header: t.loans.dueDate,
                cell: (info) => <span className="text-sm text-gray-500">{info.getValue() ? formatDate(info.getValue() as string) : '—'}</span>,
                size: 110,
            }),
            columnHelper.accessor('status', {
                header: t.loans.status,
                cell: (info) => (
                    <span className={`text-[10px] font-black uppercase tracking-widest ${info.getValue() === 'CLOSED' ? 'text-gray-400' : 'text-indigo-600'}`}>
                        {info.getValue() === 'CLOSED' ? t.loans.closed : t.loans.active}
                    </span>
                ),
                size: 90,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: ({ row }) => (
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => openEdit(row.original)}
                            className="px-2 py-1 rounded-lg text-xs font-bold text-gray-500 hover:bg-gray-100"
                        >
                            {t.common.edit}
                        </button>
                        <button
                            type="button"
                            onClick={() => handleDelete(row.original)}
                            className="p-2 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50"
                            title={t.common.delete}
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                ),
                size: 110,
            }),
        ],
        [t],
    );

    return (
        <div className="h-full overflow-y-auto bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="w-full space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight inline-flex items-center gap-2">
                            <HandCoins className="w-7 h-7 text-indigo-600" />
                            {t.loans.title}
                        </h1>
                        <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                            {t.loans.subtitle}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={openCreate}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-black hover:bg-indigo-700"
                    >
                        <Plus className="w-4 h-4" />
                        {t.loans.addLoan}
                    </button>
                </div>

                {toast && (
                    <div className={`rounded-xl px-4 py-3 text-sm font-semibold ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
                        {toast.message}
                    </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="rounded-2xl border border-gray-200 bg-white p-5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t.loans.payableOutstanding}</p>
                        <p className="text-2xl font-black text-amber-600 mt-1">{formatBDT(summary?.payable.outstanding ?? 0)}</p>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-white p-5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t.loans.receivableOutstanding}</p>
                        <p className="text-2xl font-black text-emerald-600 mt-1">{formatBDT(summary?.receivable.outstanding ?? 0)}</p>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-white p-5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t.loans.activeLoans}</p>
                        <p className="text-2xl font-black text-indigo-600 mt-1">{summary?.activeCount ?? 0}</p>
                    </div>
                </div>

                <div className="flex flex-wrap gap-3">
                    <label className="space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block">{t.loans.direction}</span>
                        <select value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)} className="rounded-xl border border-gray-100 bg-white px-3 py-2 text-sm">
                            <option value="">{t.loans.allTypes}</option>
                            <option value="PAYABLE">{t.loans.payable}</option>
                            <option value="RECEIVABLE">{t.loans.receivable}</option>
                        </select>
                    </label>
                    <label className="space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block">{t.loans.status}</span>
                        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border border-gray-100 bg-white px-3 py-2 text-sm">
                            <option value="">{t.loans.allStatuses}</option>
                            <option value="ACTIVE">{t.loans.active}</option>
                            <option value="CLOSED">{t.loans.closed}</option>
                        </select>
                    </label>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-20 text-gray-400">
                        <Loader2 className="w-6 h-6 animate-spin mr-2" />
                        {t.common.loading}
                    </div>
                ) : (
                    <DataTable
                        tableId="loans"
                        title="Loans"
                        data={loans}
                        columns={columns}
                        searchPlaceholder={t.loans.searchLoans}
                        emptyMessage={t.common.noData}
                    />
                )}
            </div>

            {showForm && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <form onSubmit={handleSave} className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-gray-100">
                            <h2 className="text-xl font-black">{editingId ? t.loans.editLoan : t.loans.addLoan}</h2>
                        </div>
                        <div className="p-6 space-y-4">
                            <label className="block space-y-1">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{t.loans.direction}</span>
                                <div className="grid grid-cols-2 gap-2">
                                    {(['PAYABLE', 'RECEIVABLE'] as const).map((dir) => (
                                        <button
                                            type="button"
                                            key={dir}
                                            onClick={() => setForm((f) => ({ ...f, direction: dir }))}
                                            className={`rounded-xl border px-3 py-2.5 text-sm font-bold ${form.direction === dir ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500'}`}
                                        >
                                            {dir === 'PAYABLE' ? t.loans.payable : t.loans.receivable}
                                        </button>
                                    ))}
                                </div>
                                <span className="text-[11px] text-gray-400">{form.direction === 'PAYABLE' ? t.loans.payableHint : t.loans.receivableHint}</span>
                            </label>
                            <label className="block space-y-1">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{t.loans.counterparty}</span>
                                <input value={form.counterparty} onChange={(e) => setForm((f) => ({ ...f, counterparty: e.target.value }))} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm" placeholder={t.loans.counterpartyHint} required />
                            </label>
                            <div className="grid grid-cols-2 gap-3">
                                <label className="block space-y-1">
                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{t.loans.principal}</span>
                                    <input type="number" min="0.01" step="0.01" value={form.principal} onChange={(e) => setForm((f) => ({ ...f, principal: e.target.value }))} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm" required />
                                </label>
                                <label className="block space-y-1">
                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{t.loans.interestRate}</span>
                                    <input type="number" min="0" step="0.01" value={form.interestRate} onChange={(e) => setForm((f) => ({ ...f, interestRate: e.target.value }))} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm" />
                                </label>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <label className="block space-y-1">
                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{t.loans.startDate}</span>
                                    <input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm" required />
                                </label>
                                <label className="block space-y-1">
                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{t.loans.dueDate}</span>
                                    <input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm" />
                                </label>
                            </div>
                            <label className="block space-y-1">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{t.loans.reference}</span>
                                <input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm" />
                            </label>
                            <label className="block space-y-1">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{t.loans.notes}</span>
                                <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm" />
                            </label>
                        </div>
                        <div className="p-6 border-t border-gray-100 flex gap-3">
                            <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-3 rounded-2xl font-bold text-gray-500 hover:bg-gray-50">
                                {t.common.cancel}
                            </button>
                            <button type="submit" disabled={saving} className="flex-1 py-3 rounded-2xl font-black bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                                {saving ? t.common.loading : t.common.save}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {detail && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-gray-100 flex items-start justify-between gap-4">
                            <div>
                                <h2 className="text-xl font-black inline-flex items-center gap-2">
                                    <Wallet className="w-5 h-5 text-indigo-600" />
                                    {detail.counterparty}
                                </h2>
                                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mt-0.5">
                                    {detail.direction === 'RECEIVABLE' ? t.loans.receivable : t.loans.payable}
                                    {detail.reference ? ` • ${detail.reference}` : ''}
                                </p>
                            </div>
                            <button type="button" onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-700 text-sm font-bold">✕</button>
                        </div>
                        <div className="p-6 space-y-5">
                            <div className="grid grid-cols-3 gap-3 text-center">
                                <div className="rounded-xl bg-gray-50 p-3">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t.loans.principal}</p>
                                    <p className="text-sm font-black text-gray-700 mt-1">{formatBDT(Number(detail.principal))}</p>
                                </div>
                                <div className="rounded-xl bg-emerald-50 p-3">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500">{t.loans.totalPaid}</p>
                                    <p className="text-sm font-black text-emerald-700 mt-1">{formatBDT(Number(detail.total_paid || 0))}</p>
                                </div>
                                <div className="rounded-xl bg-rose-50 p-3">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-rose-500">{t.loans.outstanding}</p>
                                    <p className="text-sm font-black text-rose-700 mt-1">{formatBDT(Number(detail.outstanding || 0))}</p>
                                </div>
                            </div>

                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-black uppercase tracking-widest text-gray-500">{t.loans.payments}</h3>
                                <button
                                    type="button"
                                    onClick={() => toggleStatus(detail)}
                                    className="text-xs font-bold text-indigo-600 hover:underline"
                                >
                                    {detail.status === 'CLOSED' ? t.loans.markActive : t.loans.markClosed}
                                </button>
                            </div>

                            {detail.payments && detail.payments.length > 0 ? (
                                <div className="space-y-2">
                                    {detail.payments.map((p) => (
                                        <div key={p.id} className="flex items-center justify-between rounded-xl border border-gray-100 px-3 py-2">
                                            <div>
                                                <p className="text-sm font-bold text-gray-700">{formatBDT(Number(p.amount))}</p>
                                                <p className="text-[11px] text-gray-400">{formatDate(p.payment_date)} • {p.payment_method}{p.notes ? ` • ${p.notes}` : ''}</p>
                                            </div>
                                            <button type="button" onClick={() => handleDeletePayment(p.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-gray-400">{t.loans.noPayments}</p>
                            )}

                            {detail.outstanding > 0 && (
                                <form onSubmit={handleAddPayment} className="rounded-2xl border border-gray-100 bg-gray-50 p-4 space-y-3">
                                    <p className="text-xs font-black uppercase tracking-widest text-gray-500">{t.loans.addPayment}</p>
                                    <div className="grid grid-cols-2 gap-3">
                                        <input type="number" min="0.01" step="0.01" max={detail.outstanding} value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} placeholder={t.loans.paymentAmount} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" required />
                                        <input type="date" value={payForm.paymentDate} onChange={(e) => setPayForm((f) => ({ ...f, paymentDate: e.target.value }))} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" required />
                                        <select value={payForm.paymentMethod} onChange={(e) => setPayForm((f) => ({ ...f, paymentMethod: e.target.value }))} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
                                            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                                        </select>
                                        <input value={payForm.notes} onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))} placeholder={t.loans.notes} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" />
                                    </div>
                                    <button type="submit" disabled={paying} className="w-full py-2.5 rounded-xl font-black bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                                        {paying ? t.common.loading : t.loans.addPayment}
                                    </button>
                                </form>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
