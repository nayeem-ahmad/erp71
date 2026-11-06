'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { AlarmClock, ArrowDownLeft, ArrowUpRight, Banknote, CircleCheck, Eye, HandCoins, Landmark, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { DataTable, createdAtColumn, type ListFilter, type ListStat } from '@/components/data-table';
import { applyCreatedRangeQuery, applyDateRangeQuery, tenantDateOnly, type CreatedRange } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';
import { calendarDayOf, inDateRange, matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import { AccountingPageShell, CompactStat } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { BranchFilter, Button, ConfirmDialog, StatusBadge } from '@/components/ui';
import { RowActions, RowActionButton } from '@/components/table';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { formatBDT, formatDate } from '@/lib/format';
import { compactDensity } from '@/lib/ui/compact-density';
import { getWorkspaceItem } from '@/lib/session-store';

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
    created_at: string;
    payments?: LoanPayment[];
    store?: { id: string; name: string } | null;
}

const PAYMENT_METHODS = ['CASH', 'BKASH', 'CARD', 'BANK'] as const;
const DIRECTIONS = ['PAYABLE', 'RECEIVABLE'] as const;
const STATUSES = ['ACTIVE', 'CLOSED'] as const;

const columnHelper = createColumnHelper<Loan>();

const today = () => new Date().toISOString().slice(0, 10);

/** An open loan with money still owed whose due date has passed. */
function isOverdue(loan: Loan, onDay: string): boolean {
    if (loan.status === 'CLOSED' || Number(loan.outstanding || 0) <= 0) return false;
    const due = calendarDayOf(loan.due_date);
    return Boolean(due && due < onDay);
}

export default function LoansPage() {
    const { t, locale } = useI18n();
    const ui = t.accountingFinanceUi.loans;
    const methodLabels = t.accountingFinanceUi.common.paymentMethods;
    // Which branch's loans (or the company's) to list and total. A new loan is
    // still booked on the header branch.
    const branch = useBranchScope();
    const [loans, setLoans] = useState<Loan[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [directions, setDirections] = useState<string[]>([]);
    const [statuses, setStatuses] = useState<string[]>([]);
    const [statusExclude, setStatusExclude] = useState(false);
    const [overdueOnly, setOverdueOnly] = useState(false);
    const [dateRange, setDateRange] = useState<CreatedRange | null>(null);
    const [dueRange, setDueRange] = useState<CreatedRange | null>(null);
    const [principalFilter, setPrincipalFilter] = useState<NumberCondition | null>(null);
    const [outstandingFilter, setOutstandingFilter] = useState<NumberCondition | null>(null);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);

    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');
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

    const [deleteTarget, setDeleteTarget] = useState<Loan | null>(null);
    const [paymentToDelete, setPaymentToDelete] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    // Branch, start date and created narrow what the server sends; every page
    // of that window arrives, so the other chips and the strip narrow the same
    // rows here.
    const loadData = async () => {
        setLoading(true);
        try {
            const loansData = await api.getLoans({
                storeId: branch.apiStoreId,
                ...applyDateRangeQuery(dateRange),
                ...applyCreatedRangeQuery(createdRange),
            });
            setLoans(Array.isArray(loansData) ? loansData : []);
        } catch (error) {
            if (handleBranchForbidden(error, branch, t.dashboardLayout.branchFilterForbidden)) return;
            console.error('Failed to load loans', error);
            toast.error(error instanceof Error && error.message ? error.message : t.common.error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!branch.ready) return;
        void loadData();
    }, [branch.ready, branch.apiStoreId, dateRange, createdRange]);

    const openCreate = () => {
        setEditingId(null);
        setFormError('');
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
        setFormError('');
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
            setFormError(t.loans.counterpartyRequired);
            return;
        }
        setFormError('');
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
                storeId: getWorkspaceItem('store_id') || undefined,
            };
            if (editingId) {
                await api.updateLoan(editingId, payload);
            } else {
                await api.createLoan(payload);
            }
            toast.success(t.loans.loanSaved);
            setShowForm(false);
            await loadData();
        } catch (error: any) {
            setFormError(error?.message || t.common.error);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setBusy(true);
        try {
            await api.deleteLoan(deleteTarget.id);
            toast.success(t.loans.loanDeleted);
            setDeleteTarget(null);
            await loadData();
        } catch (error: any) {
            toast.error(error?.message || t.common.error);
        } finally {
            setBusy(false);
        }
    };

    const toggleStatus = async (loan: Loan) => {
        try {
            await api.updateLoan(loan.id, { status: loan.status === 'CLOSED' ? 'ACTIVE' : 'CLOSED' });
            await loadData();
        } catch (error: any) {
            toast.error(error?.message || t.common.error);
        }
    };

    const openDetail = async (loan: Loan) => {
        try {
            const full = await api.getLoan(loan.id);
            setDetail(full);
            setPayForm({ amount: '', paymentDate: today(), paymentMethod: 'CASH', notes: '' });
        } catch (error: any) {
            toast.error(error?.message || t.common.error);
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
            toast.success(t.loans.paymentSaved);
            await loadData();
        } catch (error: any) {
            toast.error(error?.message || t.common.error);
        } finally {
            setPaying(false);
        }
    };

    const handleDeletePayment = async () => {
        if (!detail || !paymentToDelete) return;
        setBusy(true);
        try {
            const updated = await api.deleteLoanPayment(detail.id, paymentToDelete);
            setDetail(updated);
            setPaymentToDelete(null);
            toast.success(t.loans.paymentDeleted);
            await loadData();
        } catch (error: any) {
            toast.error(error?.message || t.common.error);
        } finally {
            setBusy(false);
        }
    };

    const directionLabel = (direction: string) => (direction === 'RECEIVABLE' ? t.loans.receivable : t.loans.payable);
    const statusLabel = (status: string) => (status === 'CLOSED' ? t.loans.closed : t.loans.active);
    const methodLabel = (method: string) => methodLabels[method as keyof typeof methodLabels] ?? method;

    const todayKey = tenantDateOnly();

    const filtered = useMemo(
        () => loans.filter((loan) => {
            if (!matchesAnyOf(directions, loan.direction)) return false;
            if (!matchesAnyOf(statuses, loan.status, statusExclude)) return false;
            if (overdueOnly && !isOverdue(loan, todayKey)) return false;
            if (!inDateRange(loan.due_date, dueRange)) return false;
            if (!matchesNumberCondition(Number(loan.principal || 0), principalFilter)) return false;
            if (!matchesNumberCondition(Number(loan.outstanding || 0), outstandingFilter)) return false;
            return matchesSearch(
                search,
                loan.counterparty,
                loan.reference,
                loan.notes,
                loan.store?.name,
                directionLabel(loan.direction),
            );
        }),
        [loans, directions, statuses, statusExclude, overdueOnly, todayKey, dueRange, principalFilter, outstandingFilter, search, t],
    );

    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'direction',
                type: 'multi-select',
                label: t.loans.direction,
                value: directions,
                onChange: setDirections,
                options: DIRECTIONS.map((value) => ({ value, label: directionLabel(value) })),
            },
            {
                id: 'status',
                type: 'multi-select',
                label: t.loans.status,
                value: statuses,
                onChange: setStatuses,
                exclude: { value: statusExclude, onChange: setStatusExclude },
                options: STATUSES.map((value) => ({ value, label: statusLabel(value) })),
            },
            {
                id: 'startDate',
                type: 'date-range',
                label: t.loans.startDate,
                value: dateRange,
                onChange: setDateRange,
                operators: true,
            },
            {
                id: 'principal',
                type: 'number',
                label: t.loans.principal,
                value: principalFilter,
                onChange: setPrincipalFilter,
                money: true,
            },
            {
                id: 'outstanding',
                type: 'number',
                label: t.loans.outstanding,
                value: outstandingFilter,
                onChange: setOutstandingFilter,
                money: true,
            },
            {
                id: 'overdue',
                type: 'toggle',
                label: ui.overdueOnly,
                pressed: overdueOnly,
                onChange: setOverdueOnly,
                control: 'button',
            },
            {
                id: 'dueDate',
                type: 'date-range',
                label: t.loans.dueDate,
                value: dueRange,
                onChange: setDueRange,
                operators: true,
                more: true,
            },
            { id: 'created', type: 'date-range', value: createdRange, onChange: setCreatedRange, operators: true, more: true },
        ],
        [t, ui, directions, statuses, statusExclude, dateRange, principalFilter, outstandingFilter, overdueOnly, dueRange, createdRange],
    );

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const n = (value: number) => value.toLocaleString(locale);
        let principal = 0;
        let repaid = 0;
        let owedByYou = 0;
        let owedToYou = 0;
        let overdueCount = 0;
        let overdueAmount = 0;
        let active = 0;
        for (const loan of filtered) {
            const outstanding = Number(loan.outstanding || 0);
            principal += Number(loan.principal || 0);
            repaid += Number(loan.total_paid || 0);
            if (loan.direction === 'RECEIVABLE') owedToYou += outstanding;
            else owedByYou += outstanding;
            if (loan.status !== 'CLOSED') active += 1;
            if (isOverdue(loan, todayKey)) {
                overdueCount += 1;
                overdueAmount += outstanding;
            }
        }
        const items: ListStat[] = [
            {
                id: 'count',
                icon: <Landmark aria-hidden />,
                label: t.loans.title,
                value: n(filtered.length),
                hint: `${n(active)} ${t.loans.active.toLowerCase()}`,
            },
            { id: 'principal', icon: <Banknote aria-hidden />, label: t.loans.principal, value: money(principal) },
            { id: 'repaid', icon: <CircleCheck aria-hidden />, label: ui.repaid, value: money(repaid) },
            {
                id: 'owedByYou',
                icon: <ArrowUpRight aria-hidden />,
                label: t.loans.payableOutstanding,
                value: money(owedByYou),
                tone: owedByYou > 0 ? 'warning' : 'default',
            },
            {
                id: 'owedToYou',
                icon: <ArrowDownLeft aria-hidden />,
                label: t.loans.receivableOutstanding,
                value: money(owedToYou),
                tone: owedToYou > 0 ? 'warning' : 'default',
            },
            {
                id: 'overdue',
                icon: <AlarmClock aria-hidden />,
                label: ui.overdue,
                value: money(overdueAmount),
                hint: n(overdueCount),
                tone: overdueCount > 0 ? 'danger' : 'default',
            },
        ];
        return { items, loading, label: ui.statsLabel };
    }, [filtered, loading, locale, t, ui, todayKey]);

    const columns: ColumnDef<Loan, any>[] = useMemo(
        () => [
            columnHelper.accessor('counterparty', {
                header: t.loans.counterparty,
                cell: (info) => (
                    <button
                        type="button"
                        onClick={() => openDetail(info.row.original)}
                        className="text-primary hover:underline text-start"
                    >
                        {info.getValue()}
                    </button>
                ),
                size: 180,
            }),
            columnHelper.accessor('direction', {
                header: t.loans.direction,
                cell: (info) => (
                    <StatusBadge tone={info.getValue() === 'RECEIVABLE' ? 'success' : 'warning'}>
                        {directionLabel(info.getValue())}
                    </StatusBadge>
                ),
                size: 120,
            }),
            columnHelper.accessor((row) => Number(row.principal || 0), {
                id: 'principal',
                header: t.loans.principal,
                cell: (info) => formatBDT(info.getValue(), { locale }),
                meta: { align: 'end' },
                size: 120,
            }),
            columnHelper.accessor((row) => Number(row.total_paid || 0), {
                id: 'total_paid',
                header: t.loans.totalPaid,
                cell: (info) => formatBDT(info.getValue(), { locale }),
                meta: { align: 'end', hideOnMobile: true },
                size: 110,
            }),
            columnHelper.accessor((row) => Number(row.outstanding || 0), {
                id: 'outstanding',
                header: t.loans.outstanding,
                cell: (info) => formatBDT(info.getValue(), { locale }),
                meta: { align: 'end' },
                size: 120,
            }),
            columnHelper.accessor('start_date', {
                header: t.loans.startDate,
                cell: (info) => formatDate(info.getValue(), locale),
                sortingFn: 'datetime',
                meta: { hideOnMobile: true },
                size: 110,
            }),
            columnHelper.accessor((row) => row.due_date ?? '', {
                id: 'due_date',
                header: t.loans.dueDate,
                cell: (info) => {
                    const loan = info.row.original;
                    if (!loan.due_date) return '—';
                    return (
                        <span className={isOverdue(loan, todayKey) ? 'text-red-600' : undefined}>
                            {formatDate(loan.due_date, locale)}
                        </span>
                    );
                },
                meta: { hideOnMobile: true },
                size: 110,
            }),
            createdAtColumn(columnHelper, { header: t.common.createdAt, locale }),
            columnHelper.accessor('status', {
                header: t.loans.status,
                cell: (info) => {
                    const loan = info.row.original;
                    if (loan.status === 'CLOSED') return <StatusBadge tone="neutral">{t.loans.closed}</StatusBadge>;
                    if (isOverdue(loan, todayKey)) return <StatusBadge tone="danger">{ui.overdue}</StatusBadge>;
                    return <StatusBadge tone="info">{t.loans.active}</StatusBadge>;
                },
                size: 100,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: ({ row }) => (
                    <RowActions>
                        <RowActionButton icon={<Eye />} label={t.loans.viewDetails} onClick={() => void openDetail(row.original)} />
                        <RowActionButton icon={<Pencil />} label={t.common.edit} onClick={() => openEdit(row.original)} />
                        <RowActionButton
                            icon={<Trash2 />}
                            label={t.common.delete}
                            intent="danger"
                            onClick={() => setDeleteTarget(row.original)}
                        />
                    </RowActions>
                ),
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 120,
            }),
        ],
        [t, ui, locale, todayKey],
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
                    <>
                        <BranchFilter scope={branch} />
                        <Button variant="primary" icon={<Plus className="w-3.5 h-3.5" />} onClick={openCreate}>
                            {t.loans.addLoan}
                        </Button>
                    </>
                )}
            />

            <DataTable
                tableId="loans"
                title={t.loans.title}
                data={filtered}
                columns={columns}
                isLoading={loading}
                searchPlaceholder={t.loans.searchLoans}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                emptyMessage={t.common.noData}
                emptyIcon={<HandCoins className="w-16 h-16 text-gray-200" />}
            />

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
                            {formError && <p role="alert" className="text-xs text-red-600">{formError}</p>}
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
                                <CompactStat label={t.loans.principal} value={formatBDT(Number(detail.principal), { locale })} />
                                <CompactStat label={t.loans.totalPaid} value={formatBDT(Number(detail.total_paid || 0), { locale })} tone="positive" />
                                <CompactStat label={t.loans.outstanding} value={formatBDT(Number(detail.outstanding || 0), { locale })} tone="negative" />
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
                                        <div key={p.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                                            <div>
                                                <p className="text-sm font-semibold text-gray-700">{formatBDT(Number(p.amount), { locale })}</p>
                                                <p className="text-xs text-gray-400">{formatDate(p.payment_date, locale)} • {methodLabel(p.payment_method)}{p.notes ? ` • ${p.notes}` : ''}</p>
                                            </div>
                                            <RowActionButton
                                                icon={<Trash2 />}
                                                label={t.common.delete}
                                                intent="danger"
                                                onClick={() => setPaymentToDelete(p.id)}
                                            />
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
                                            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}
                                        </select>
                                        <input value={payForm.notes} onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))} placeholder={t.loans.notes} className={compactDensity.formField} />
                                    </div>
                                    <Button variant="primary" type="submit" loading={paying} className="w-full justify-center">
                                        {t.loans.addPayment}
                                    </Button>
                                </form>
                            )}
                        </div>
                    </div>
                </ModalShell>
            )}

            <ConfirmDialog
                open={deleteTarget !== null}
                title={ui.deleteTitle}
                prompt={t.loans.deleteConfirm}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                loading={busy}
                danger
                onConfirm={() => void handleDelete()}
                onCancel={() => { if (!busy) setDeleteTarget(null); }}
            />

            <ConfirmDialog
                open={paymentToDelete !== null}
                title={ui.deletePaymentTitle}
                prompt={t.loans.deletePaymentConfirm}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                loading={busy}
                danger
                onConfirm={() => void handleDeletePayment()}
                onCancel={() => { if (!busy) setPaymentToDelete(null); }}
            />
        </AccountingPageShell>
    );
}
