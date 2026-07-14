'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Banknote, Loader2, Plus, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { formatBDT, formatDate } from '@/lib/format';
import { PageShell, Button, Field, Input, Select } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { toast } from '@/lib/toast';

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
            toast.error('Employee, amount and pay period are required.');
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
            toast.success('Salary payment recorded.');
            setShowForm(false);
            resetForm();
            await loadData();
        } catch (error: any) {
            toast.error(error?.message || t.common.error);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (payment: SalaryPayment) => {
        if (!globalThis.confirm('Delete this salary payment?')) return;
        try {
            await api.deleteSalaryPayment(payment.id);
            toast.success('Salary payment deleted.');
            await loadData();
        } catch (error: any) {
            toast.error(error?.message || t.common.error);
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
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{info.getValue()}</span>
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
                    <span className="text-sm font-bold text-emerald-600">{formatBDT(Number(info.getValue()))}</span>
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
        <PageShell>
                <PageHeader
                    title={(
                        <span className="inline-flex items-center gap-2">
                            <Banknote className="w-7 h-7 text-emerald-600" />
                            {t.hr.hub.links.salaryPayments.title}
                        </span>
                    )}
                    subtitle={t.hr.hub.links.salaryPayments.description}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.hr,
                        t.hr.hub.links.salaryPayments.title,
                        'hr',
                    )}
                    actions={(
                        <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => { resetForm(); setShowForm(true); }}>
                            Pay Salary
                        </Button>
                    )}
                />

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                        <p className="text-xs font-medium text-gray-500">Period Total</p>
                        <p className="text-2xl font-bold text-emerald-600 mt-1">{formatBDT(totalAmount)}</p>
                        <p className="text-xs text-gray-400 mt-1">{payments.length} payment(s)</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4 sm:col-span-2">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <label className="space-y-1">
                                <span className="text-xs font-medium text-gray-500">{t.common.date} (from)</span>
                                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm" />
                            </label>
                            <label className="space-y-1">
                                <span className="text-xs font-medium text-gray-500">{t.common.date} (to)</span>
                                <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm" />
                            </label>
                            <label className="space-y-1">
                                <span className="text-xs font-medium text-gray-500">Employee</span>
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

            {showForm && (
                <ModalShell size="sm" onBackdropClick={() => setShowForm(false)}>
                    <ModalHeader title="Pay Salary" onClose={() => setShowForm(false)} />
                    <form onSubmit={handleCreate} className="contents">
                        <div className="p-4 space-y-4 overflow-y-auto">
                            {employees.length === 0 ? (
                                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
                                    Add an employee first to record salary payments.
                                </p>
                            ) : (
                                <>
                                    <Field label="Employee" required>
                                        <Select value={formEmployeeId} onChange={(e) => handleEmployeeChange(e.target.value)} required>
                                            <option value="">Select employee…</option>
                                            {employees.map((emp) => (
                                                <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_code})</option>
                                            ))}
                                        </Select>
                                    </Field>
                                    <Field label="Pay Period (month)" required>
                                        <Input type="month" value={formPayPeriod} onChange={(e) => setFormPayPeriod(e.target.value)} required />
                                    </Field>
                                    <Field label={t.common.amount} required>
                                        <Input type="number" min="0.01" step="0.01" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} required />
                                    </Field>
                                    <Field label={`Payment ${t.common.date}`} required>
                                        <Input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} required />
                                    </Field>
                                    <Field label="Payment Method">
                                        <Select value={formPaymentMethod} onChange={(e) => setFormPaymentMethod(e.target.value as typeof formPaymentMethod)}>
                                            {PAYMENT_METHODS.map((method) => (
                                                <option key={method} value={method}>{method}</option>
                                            ))}
                                        </Select>
                                    </Field>
                                    <Field label="Notes">
                                        <textarea
                                            value={formNotes}
                                            onChange={(e) => setFormNotes(e.target.value)}
                                            rows={2}
                                            className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 focus:bg-white"
                                        />
                                    </Field>
                                </>
                            )}
                        </div>
                        <ModalFooter>
                            <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                                {t.common.cancel}
                            </Button>
                            <Button type="submit" variant="primary" loading={saving} disabled={employees.length === 0}>
                                {saving ? t.common.loading : t.common.save}
                            </Button>
                        </ModalFooter>
                    </form>
                </ModalShell>
            )}
        </PageShell>
    );
}
