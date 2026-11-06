'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Banknote, Calculator, Plus, Receipt, Trash2, Users, Wallet } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import { tenantDateOnly, type CreatedRange } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';
import { inDateRange, matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { formatBDT, formatDate } from '@/lib/format';
import { PageShell, Button, ConfirmDialog, Field, Input, Select, Textarea } from '@/components/ui';
import { IdSearchSelect } from '@/components/document-entry/PartySearchSelect';
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

/** The last six months, from the first of the month five months back, on the workspace's calendar. */
function defaultRange(): CreatedRange {
    const today = tenantDateOnly();
    const [year, month] = today.split('-').map(Number);
    const start = new Date(Date.UTC(year, month - 1 - 5, 1)).toISOString().slice(0, 10);
    return { from: start, to: today };
}

export default function SalaryPaymentsPage() {
    const { t, locale } = useI18n();
    const copy = t.hr.listUi.salaryPayments;
    const [payments, setPayments] = useState<SalaryPayment[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [dateRange, setDateRange] = useState<CreatedRange | null>(defaultRange);
    const [employeeIds, setEmployeeIds] = useState<string[]>([]);
    const [payPeriods, setPayPeriods] = useState<string[]>([]);
    const [methods, setMethods] = useState<string[]>([]);
    const [amountFilter, setAmountFilter] = useState<NumberCondition | null>(null);
    const [search, setSearch] = useState('');
    const [pendingDelete, setPendingDelete] = useState<SalaryPayment | null>(null);
    const [deleting, setDeleting] = useState(false);
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
                // The server narrows by one employee; more are narrowed here.
                api.getSalaryPayments({
                    from: dateRange?.from?.slice(0, 10) || undefined,
                    to: dateRange?.to?.slice(0, 10) || undefined,
                    employeeId: employeeIds.length === 1 ? employeeIds[0] : undefined,
                }),
                api.getEmployees({ status: 'ACTIVE' }),
            ]);
            setPayments(paymentsData ?? []);
            setEmployees(employeesData ?? []);
        } catch (error) {
            console.error('Failed to load salary payments', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dateRange, employeeIds]);

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
            toast.error(copy.required);
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
            toast.success(copy.recorded);
            setShowForm(false);
            resetForm();
            await loadData();
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
            await api.deleteSalaryPayment(pendingDelete.id);
            toast.success(copy.deleted);
            setPendingDelete(null);
            await loadData();
        } catch (error: any) {
            toast.error(error?.message || t.common.error);
        } finally {
            setDeleting(false);
        }
    };

    const methodLabel = (method: string) => copy.methods[method as keyof typeof copy.methods] ?? method;

    const columns: ColumnDef<SalaryPayment, any>[] = useMemo(
        () => [
            columnHelper.accessor('payment_date', {
                header: t.common.date,
                cell: (info) => formatDate(info.getValue(), locale),
                sortingFn: 'datetime',
                size: 120,
            }),
            columnHelper.accessor((row) => row.employee?.name ?? '—', {
                id: 'employee',
                header: copy.employee,
                cell: (info) => {
                    const emp = info.row.original.employee;
                    return (
                        <div>
                            <span className="block">{emp?.name ?? '—'}</span>
                            <span className="block text-gray-500">{emp?.employee_code ?? ''}</span>
                        </div>
                    );
                },
                size: 200,
            }),
            columnHelper.accessor('pay_period', {
                header: copy.payPeriod,
                cell: (info) => info.getValue(),
                size: 110,
            }),
            columnHelper.accessor('payment_method', {
                header: copy.method,
                cell: (info) => methodLabel(info.getValue()),
                size: 100,
            }),
            columnHelper.accessor('notes', {
                header: copy.notes,
                cell: (info) => <span className="line-clamp-2">{info.getValue() || '—'}</span>,
                size: 200,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('amount', {
                header: t.common.amount,
                cell: (info) => formatBDT(Number(info.getValue()), { locale }),
                sortingFn: (a, b) => Number(a.getValue('amount')) - Number(b.getValue('amount')),
                size: 120,
                meta: { align: 'end' },
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: ({ row }) => (
                    <RowActions>
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
                size: 70,
            }),
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [t, locale],
    );

    const filtered = useMemo(
        () => payments.filter((p) => {
            if (!matchesAnyOf(employeeIds, p.employee?.id)) return false;
            if (!matchesAnyOf(payPeriods, p.pay_period)) return false;
            if (!matchesAnyOf(methods, p.payment_method)) return false;
            if (!matchesNumberCondition(Number(p.amount || 0), amountFilter)) return false;
            if (!inDateRange(p.payment_date, dateRange)) return false;
            return matchesSearch(
                search,
                p.employee?.name, p.employee?.employee_code, p.pay_period, p.notes, methodLabel(p.payment_method),
            );
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [payments, employeeIds, payPeriods, methods, amountFilter, dateRange, search, copy],
    );

    // Active staff plus anyone already paid in the window, so a leaver's
    // payments can still be picked out.
    const employeeOptions = useMemo(() => {
        const seen = new Map<string, string>();
        for (const emp of employees) seen.set(emp.id, `${emp.name} · ${emp.employee_code}`);
        for (const p of payments) {
            if (p.employee && !seen.has(p.employee.id)) seen.set(p.employee.id, `${p.employee.name} · ${p.employee.employee_code}`);
        }
        return [...seen].map(([value, label]) => ({ value, label }));
    }, [employees, payments]);

    const periodOptions = useMemo(
        () => [...new Set(payments.map((p) => p.pay_period))].sort().reverse().map((value) => ({ value, label: value })),
        [payments],
    );

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'date',
            type: 'date-range',
            label: copy.paymentDate,
            value: dateRange,
            onChange: setDateRange,
            operators: true,
        },
        {
            id: 'employee',
            type: 'multi-select',
            label: copy.employee,
            value: employeeIds,
            onChange: setEmployeeIds,
            options: employeeOptions,
        },
        {
            id: 'payPeriod',
            type: 'multi-select',
            label: copy.payPeriod,
            value: payPeriods,
            onChange: setPayPeriods,
            options: periodOptions,
        },
        {
            id: 'method',
            type: 'multi-select',
            label: copy.method,
            value: methods,
            onChange: setMethods,
            options: PAYMENT_METHODS.map((value) => ({ value, label: copy.methods[value] })),
        },
        {
            id: 'amount',
            type: 'number',
            label: t.common.amount,
            value: amountFilter,
            onChange: setAmountFilter,
            money: true,
        },
    ], [t, copy, dateRange, employeeIds, employeeOptions, payPeriods, periodOptions, methods, amountFilter]);

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const total = filtered.reduce((sum, p) => sum + Number(p.amount || 0), 0);
        const cash = filtered.reduce((sum, p) => sum + (p.payment_method === 'CASH' ? Number(p.amount || 0) : 0), 0);
        const items: ListStat[] = [
            { id: 'count', icon: <Receipt aria-hidden />, label: copy.payments, value: filtered.length.toLocaleString(locale) },
            { id: 'total', icon: <Banknote aria-hidden />, label: copy.total, value: money(total) },
            {
                id: 'people',
                icon: <Users aria-hidden />,
                label: copy.people,
                value: new Set(filtered.map((p) => p.employee?.id).filter(Boolean)).size.toLocaleString(locale),
            },
            { id: 'average', icon: <Calculator aria-hidden />, label: copy.average, value: money(filtered.length ? total / filtered.length : 0) },
            { id: 'cash', icon: <Wallet aria-hidden />, label: copy.cash, value: money(cash) },
        ];
        return { items, loading, label: copy.statsLabel };
    }, [filtered, loading, locale, copy]);

    return (
        <PageShell>
                <PageHeader
                    title={t.hr.hub.links.salaryPayments.title}
                    subtitle={t.hr.hub.links.salaryPayments.description}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.hr,
                        t.hr.hub.links.salaryPayments.title,
                        'hr',
                    )}
                    actions={(
                        <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => { resetForm(); setShowForm(true); }}>
                            {copy.paySalary}
                        </Button>
                    )}
                />

                <DataTable<SalaryPayment>
                    tableId="salary-payments"
                    title={t.hr.hub.links.salaryPayments.title}
                    data={filtered}
                    columns={columns}
                    isLoading={loading}
                    emptyIcon={<Banknote className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={copy.searchPlaceholder}
                    searchValue={search}
                    onSearchChange={setSearch}
                    filters={filters}
                    filterLayout="row"
                    stats={stats}
                    enableColumnFilters={false}
                    viewOptions
                    emptyMessage={employees.length === 0 ? copy.addEmployeeFirst : t.common.noData}
                />

                <ConfirmDialog
                    open={pendingDelete !== null}
                    title={t.common.delete}
                    prompt={copy.deleteConfirm}
                    confirmLabel={t.common.delete}
                    cancelLabel={t.common.cancel}
                    loading={deleting}
                    danger
                    onConfirm={() => void handleDelete()}
                    onCancel={() => { if (!deleting) setPendingDelete(null); }}
                />

            {showForm && (
                <ModalShell size="sm" onBackdropClick={() => setShowForm(false)}>
                    <ModalHeader title={copy.paySalary} onClose={() => setShowForm(false)} />
                    <form onSubmit={handleCreate} className="contents">
                        <div className="p-4 space-y-4 overflow-y-auto">
                            {employees.length === 0 ? (
                                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
                                    {copy.addEmployeeFirst}
                                </p>
                            ) : (
                                <>
                                    <Field label={copy.employee} required htmlFor="salary-employee">
                                        <IdSearchSelect
                                            id="salary-employee"
                                            items={employees}
                                            value={formEmployeeId}
                                            onChange={handleEmployeeChange}
                                            placeholder={t.leaves.selectEmployee}
                                            emptyLabel={t.leaves.selectEmployee}
                                            noMatchLabel={t.common.noData}
                                            subtitle={(emp) => emp.employee_code ?? ''}
                                        />
                                    </Field>
                                    <Field label={copy.payPeriodMonth} required>
                                        <Input type="month" value={formPayPeriod} onChange={(e) => setFormPayPeriod(e.target.value)} required />
                                    </Field>
                                    <Field label={t.common.amount} required>
                                        <Input type="number" min="0.01" step="0.01" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} required />
                                    </Field>
                                    <Field label={copy.paymentDate} required>
                                        <Input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} required />
                                    </Field>
                                    <Field label={copy.method}>
                                        <Select value={formPaymentMethod} onChange={(e) => setFormPaymentMethod(e.target.value as typeof formPaymentMethod)}>
                                            {PAYMENT_METHODS.map((method) => (
                                                <option key={method} value={method}>{copy.methods[method]}</option>
                                            ))}
                                        </Select>
                                    </Field>
                                    <Field label={copy.notes}>
                                        <Textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={2} />
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
