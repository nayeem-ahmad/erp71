'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Banknote, Loader2, Plus, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatBDT, formatDate } from '@/lib/format';

interface Employee {
    id: string;
    name: string;
    employee_code: string;
    basic_salary?: string | number | null;
}

interface SalaryPayment {
    id: string;
    amount: string | number;
    pay_period: string;
    payment_date: string;
    payment_method: string;
    notes?: string | null;
    employee?: { id: string; name: string; employee_code: string } | null;
}

const columnHelper = createColumnHelper<SalaryPayment>();

const PAYMENT_METHODS = ['CASH', 'BKASH', 'NAGAD', 'CARD', 'BANK'] as const;

function currentMonth() {
    return new Date().toISOString().slice(0, 7);
}

function defaultFrom() {
    const d = new Date();
    d.setMonth(d.getMonth() - 5);
    d.setDate(1);
    return d.toISOString().slice(0, 10);
}

function defaultTo() {
    return new Date().toISOString().slice(0, 10);
}

export default function SalaryPaymentsPage() {
    const { t } = useI18n();
    const [payments, setPayments] = useState<SalaryPayment[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(defaultTo());
    const [employeeFilter, setEmployeeFilter] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    const [formEmployeeId, setFormEmployeeId] = useState('');
    const [formAmount, setFormAmount] = useState('');
    const [formPayPeriod, setFormPayPeriod] = useState(currentMonth());
    const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
    const [formPaymentMethod, setFormPaymentMethod] = useState<(typeof PAYMENT_METHODS)[number]>('CASH');
    const [formNotes, setFormNotes] = useState('');

    const loadData = async () => {
        setLoading(true);
        try {
            const [paymentsData, employeesData] = await Promise.all([
                api.getSalaryPayments({
                    from: fromDate || undefined,
                    to: toDate || undefined,
                    employeeId: employeeFilter || undefined,
                    limit: 100,
                }),
                api.getEmployees({ status: 'ACTIVE', limit: 200 }),
            ]);
            setPayments(Array.isArray(paymentsData?.items) ? paymentsData.items : []);
            setEmployees(Array.isArray(employeesData) ? employeesData : (employeesData?.items ?? []));
        } catch (error) {
            console.error('Failed to load salary payments', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fromDate, toDate, employeeFilter]);

    const resetForm = () => {
        setFormEmployeeId(employees[0]?.id ?? '');
        setFormAmount(employees[0]?.basic_salary != null ? String(employees[0].basic_salary) : '');
        setFormPayPeriod(currentMonth());
        setFormDate(new Date().toISOString().slice(0, 10));
        setFormPaymentMethod('CASH');
        setFormNotes('');
    };

    // Prefill amount from the selected employee's basic salary.
    const handleEmployeeChange = (id: string) => {
        setFormEmployeeId(id);
        const emp = employees.find((e) => e.id === id);
        if (emp?.basic_salary != null) {
            setFormAmount(String(emp.basic_salary));
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formEmployeeId || !formAmount || !formPayPeriod) {
            setToast({ type: 'error', message: 'Employee, amount and pay period are required.' });
            return;
        }
        setSaving(true);
        try {
            await api.createSalaryPayment({
                employeeId: formEmployeeId,
                amount: Number(formAmount),
                payPeriod: formPayPeriod,
                paymentDate: formDate,
                paymentMethod: formPaymentMethod,
                notes: formNotes.trim() || undefined,
            });
            setToast({ type: 'success', message: 'Salary payment recorded.' });
            setShowForm(false);
            resetForm();
            await loadData();
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (payment: SalaryPayment) => {
        if (!globalThis.confirm('Delete this salary payment?')) return;
        try {
            await api.deleteSalaryPayment(payment.id);
            setToast({ type: 'success', message: 'Salary payment deleted.' });
            await loadData();
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
        }
    };

    const columns: ColumnDef<SalaryPayment, any>[] = useMemo(
        () => [
            columnHelper.accessor('payment_date', {
                header: t.common.date,
                cell: (info) => <span className="text-sm text-gray-700">{formatDate(info.getValue())}</span>,
                sortingFn: 'datetime',
                size: 120,
            }),
            columnHelper.accessor((row) => row.employee?.name ?? '—', {
                id: 'employee',
                header: 'Employee',
                cell: (info) => {
                    const emp = info.row.original.employee;
                    return (
                        <div>
                            <span className="block text-sm font-bold text-gray-800">{emp?.name ?? '—'}</span>
                            <span className="block text-xs font-mono text-gray-400">{emp?.employee_code ?? ''}</span>
                        </div>
                    );
                },
                size: 200,
            }),
            columnHelper.accessor('pay_period', {
                header: 'Pay Period',
                cell: (info) => <span className="text-sm font-semibold text-gray-700">{info.getValue()}</span>,
                size: 110,
            }),
            columnHelper.accessor('payment_method', {
                header: 'Method',
                cell: (info) => (
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">{info.getValue()}</span>
                ),
                size: 100,
            }),
            columnHelper.accessor('notes', {
                header: 'Notes',
                cell: (info) => <span className="text-sm text-gray-500 line-clamp-2">{info.getValue() || '—'}</span>,
                size: 200,
            }),
            columnHelper.accessor('amount', {
                header: t.common.amount,
                cell: (info) => (
                    <span className="text-sm font-black text-emerald-600">{formatBDT(Number(info.getValue()))}</span>
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [t],
    );

    const totalAmount = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

    return (
        <div className="h-full overflow-y-auto bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="w-full space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight inline-flex items-center gap-2">
                            <Banknote className="w-7 h-7 text-emerald-600" />
                            {t.sidebar.items.salaryPayments}
                        </h1>
                        <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                            Record and track staff salary disbursements
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => { resetForm(); setShowForm(true); }}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-black hover:bg-emerald-700"
                    >
                        <Plus className="w-4 h-4" />
                        Pay Salary
                    </button>
                </div>

                {toast && (
                    <div className={`rounded-xl px-4 py-3 text-sm font-semibold ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
                        {toast.message}
                    </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="rounded-2xl border border-gray-200 bg-white p-5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Period Total</p>
                        <p className="text-2xl font-black text-emerald-600 mt-1">{formatBDT(totalAmount)}</p>
                        <p className="text-xs text-gray-400 mt-1">{payments.length} payment(s)</p>
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
                                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Employee</span>
                                <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
                                    <option value="">All employees</option>
                                    {employees.map((emp) => (
                                        <option key={emp.id} value={emp.id}>{emp.name}</option>
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
                        tableId="salary-payments"
                        title="Salary Payments"
                        data={payments}
                        columns={columns}
                        searchPlaceholder="Search payments..."
                        emptyMessage={employees.length === 0 ? 'Add an employee first to record salary payments.' : t.common.noData}
                    />
                )}
            </div>

            {showForm && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <form onSubmit={handleCreate} className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-gray-100">
                            <h2 className="text-xl font-black">Pay Salary</h2>
                        </div>
                        <div className="p-6 space-y-4">
                            {employees.length === 0 ? (
                                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
                                    Add an employee first to record salary payments.
                                </p>
                            ) : (
                                <>
                                    <label className="block space-y-1">
                                        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Employee</span>
                                        <select value={formEmployeeId} onChange={(e) => handleEmployeeChange(e.target.value)} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm" required>
                                            <option value="">Select employee…</option>
                                            {employees.map((emp) => (
                                                <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_code})</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="block space-y-1">
                                        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Pay Period (month)</span>
                                        <input type="month" value={formPayPeriod} onChange={(e) => setFormPayPeriod(e.target.value)} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm" required />
                                    </label>
                                    <label className="block space-y-1">
                                        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{t.common.amount}</span>
                                        <input type="number" min="0.01" step="0.01" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm" required />
                                    </label>
                                    <label className="block space-y-1">
                                        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Payment {t.common.date}</span>
                                        <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm" required />
                                    </label>
                                    <label className="block space-y-1">
                                        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Payment Method</span>
                                        <select value={formPaymentMethod} onChange={(e) => setFormPaymentMethod(e.target.value as typeof formPaymentMethod)} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm">
                                            {PAYMENT_METHODS.map((method) => (
                                                <option key={method} value={method}>{method}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="block space-y-1">
                                        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Notes</span>
                                        <textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={2} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm" />
                                    </label>
                                </>
                            )}
                        </div>
                        <div className="p-6 border-t border-gray-100 flex gap-3">
                            <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-3 rounded-2xl font-bold text-gray-500 hover:bg-gray-50">
                                {t.common.cancel}
                            </button>
                            <button type="submit" disabled={saving || employees.length === 0} className="flex-1 py-3 rounded-2xl font-black bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                                {saving ? t.common.loading : t.common.save}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}
