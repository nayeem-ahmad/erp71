'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Loader2, Plus, Trash2, Wallet } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import {
    AccountingPageShell,
    CompactStat,
} from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { Button } from '@/components/ui';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatBDT, formatDate } from '@/lib/format';
import { compactDensity } from '@/lib/ui/compact-density';

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
            setLoans(
                Array.isArray(loansData)
                    ? loansData
                    : Array.isArray(loansData?.items)
                      ? loansData.items
                      : [],
            );
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
                        className="text-sm font-bold text-primary hover:underline text-left"
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
                        className={`text-[10px] font-semibold px-2 py-1 rounded-full ${info.getValue() === 'RECEIVABLE' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
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
                cell: (info) => <span className="text-sm font-bold text-danger">{formatBDT(Number(info.getValue() || 0))}</span>,
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
                    <span className={`text-[10px] font-semibold ${info.getValue() === 'CLOSED' ? 'text-gray-400' : 'text-primary'}`}>
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
                            className="p-2 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50"
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
        <AccountingPageShell>
            <PageHeader
                title={t.loans.title}
                subtitle={t.loans.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.loans.title,
                    'accounting',
                )}
                actions={(
                    <button type="button" onClick={openCreate} className={`${compactDensity.btnPrimary} bg-primary text-white hover:bg-primary-hover`}>
                        <Plus className="w-3.5 h-3.5" />
                        {t.loans.addLoan}
                    </button>
                )}
            />

            {toast && (
                <div className={`rounded-lg px-3 py-2 text-sm ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-danger-light text-danger-text border border-red-200'}`}>
                    {toast.message}
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <CompactStat label={t.loans.payableOutstanding} value={formatBDT(summary?.payable.outstanding ?? 0)} tone="warning" />
                <CompactStat label={t.loans.receivableOutstanding} value={formatBDT(summary?.receivable.outstanding ?? 0)} tone="positive" />
                <CompactStat label={t.loans.activeLoans} value={summary?.activeCount ?? 0} tone="info" />
            </div>

            <div className={compactDensity.filterBar}>
                <label className="block">
                    <span className={`${compactDensity.formLabel} block mb-1`}>{t.loans.direction}</span>
                    <select value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)} className={compactDensity.formField}>
                        <option value="">{t.loans.allTypes}</option>
                        <option value="PAYABLE">{t.loans.payable}</option>
                        <option value="RECEIVABLE">{t.loans.receivable}</option>
                    </select>
                </label>
                <label className="block">
                    <span className={`${compactDensity.formLabel} block mb-1`}>{t.loans.status}</span>
                    <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={compactDensity.formField}>
                        <option value="">{t.loans.allStatuses}</option>
                        <option value="ACTIVE">{t.loans.active}</option>
                        <option value="CLOSED">{t.loans.closed}</option>
                    </select>
                </label>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-12 text-gray-400">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
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

            {showForm && (
                <ModalShell size="sm" onBackdropClick={() => setShowForm(false)}>
                    <form onSubmit={handleSave} className="flex max-h-[90vh] flex-col overflow-hidden">
                        <ModalHeader title={editingId ? t.loans.editLoan : t.loans.addLoan} onClose={() => setShowForm(false)} />
                        <div className={`${compactDensity.modalPadding} ${compactDensity.formStack} overflow-y-auto`}>
                            <label className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{t.loans.direction}</span>
                                <div className="grid grid-cols-2 gap-2">
                                    {(['PAYABLE', 'RECEIVABLE'] as const).map((dir) => (
                                        <button
                                            type="button"
                                            key={dir}
                                            onClick={() => setForm((f) => ({ ...f, direction: dir }))}
                                            className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${form.direction === dir ? 'border-primary bg-primary-light text-primary' : 'border-gray-200 text-gray-500'}`}
                                        >
                                            {dir === 'PAYABLE' ? t.loans.payable : t.loans.receivable}
                                        </button>
                                    ))}
                                </div>
                                <span className="text-[11px] text-gray-400">{form.direction === 'PAYABLE' ? t.loans.payableHint : t.loans.receivableHint}</span>
                            </label>
                            <label className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{t.loans.counterparty}</span>
                                <input value={form.counterparty} onChange={(e) => setForm((f) => ({ ...f, counterparty: e.target.value }))} className={compactDensity.formField} placeholder={t.loans.counterpartyHint} required />
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                                <label className="block">
                                    <span className={`${compactDensity.formLabel} block mb-1`}>{t.loans.principal}</span>
                                    <input type="number" min="0.01" step="0.01" value={form.principal} onChange={(e) => setForm((f) => ({ ...f, principal: e.target.value }))} className={compactDensity.formField} required />
                                </label>
                                <label className="block">
                                    <span className={`${compactDensity.formLabel} block mb-1`}>{t.loans.interestRate}</span>
                                    <input type="number" min="0" step="0.01" value={form.interestRate} onChange={(e) => setForm((f) => ({ ...f, interestRate: e.target.value }))} className={compactDensity.formField} />
                                </label>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <label className="block">
                                    <span className={`${compactDensity.formLabel} block mb-1`}>{t.loans.startDate}</span>
                                    <input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} className={compactDensity.formField} required />
                                </label>
                                <label className="block">
                                    <span className={`${compactDensity.formLabel} block mb-1`}>{t.loans.dueDate}</span>
                                    <input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} className={compactDensity.formField} />
                                </label>
                            </div>
                            <label className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{t.loans.reference}</span>
                                <input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} className={compactDensity.formField} />
                            </label>
                            <label className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{t.loans.notes}</span>
                                <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className={compactDensity.formField} />
                            </label>
                        </div>
                        <ModalFooter>
                            <Button variant="secondary" type="button" onClick={() => setShowForm(false)}>
                                {t.common.cancel}
                            </Button>
                            <Button variant="primary" type="submit" loading={saving}>
                                {t.common.save}
                            </Button>
                        </ModalFooter>
                    </form>
                </ModalShell>
            )}

            {detail && (
                <ModalShell size="md" onBackdropClick={() => setDetail(null)}>
                    <div className="flex max-h-[90vh] flex-col overflow-hidden">
                        <ModalHeader
                            title={(
                                <span className="inline-flex items-center gap-2">
                                    <Wallet className="w-4 h-4 text-primary" />
                                    {detail.counterparty}
                                </span>
                            )}
                            subtitle={`${detail.direction === 'RECEIVABLE' ? t.loans.receivable : t.loans.payable}${detail.reference ? ` • ${detail.reference}` : ''}`}
                            onClose={() => setDetail(null)}
                        />
                        <div className={`${compactDensity.modalPadding} space-y-4 overflow-y-auto`}>
                            <div className="grid grid-cols-3 gap-2 text-center">
                                <CompactStat label={t.loans.principal} value={formatBDT(Number(detail.principal))} />
                                <CompactStat label={t.loans.totalPaid} value={formatBDT(Number(detail.total_paid || 0))} tone="positive" />
                                <CompactStat label={t.loans.outstanding} value={formatBDT(Number(detail.outstanding || 0))} tone="negative" />
                            </div>

                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-gray-500">{t.loans.payments}</h3>
                                <button
                                    type="button"
                                    onClick={() => toggleStatus(detail)}
                                    className="text-xs font-bold text-primary hover:underline"
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
                                            <button type="button" onClick={() => handleDeletePayment(p.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-gray-400">{t.loans.noPayments}</p>
                            )}

                            {detail.outstanding > 0 && (
                                <form onSubmit={handleAddPayment} className={`${compactDensity.cardFlat} space-y-2`}>
                                    <p className={compactDensity.sectionLabel}>{t.loans.addPayment}</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        <input type="number" min="0.01" step="0.01" max={detail.outstanding} value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} placeholder={t.loans.paymentAmount} className={compactDensity.formField} required />
                                        <input type="date" value={payForm.paymentDate} onChange={(e) => setPayForm((f) => ({ ...f, paymentDate: e.target.value }))} className={compactDensity.formField} required />
                                        <select value={payForm.paymentMethod} onChange={(e) => setPayForm((f) => ({ ...f, paymentMethod: e.target.value }))} className={compactDensity.formField}>
                                            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                                        </select>
                                        <input value={payForm.notes} onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))} placeholder={t.loans.notes} className={compactDensity.formField} />
                                    </div>
                                    <button type="submit" disabled={paying} className={`${compactDensity.btnPrimary} w-full bg-primary text-white hover:bg-primary-hover disabled:opacity-50`}>
                                        {paying ? t.common.loading : t.loans.addPayment}
                                    </button>
                                </form>
                            )}
                        </div>
                    </div>
                </ModalShell>
            )}
        </AccountingPageShell>
    );
}
