'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { CalendarOff, Plus, Check, X, Trash2, Inbox, Hourglass, CheckCircle2, CalendarDays, XCircle, Tags } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, createdAtColumn, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Button, Field, Input, Select, FormFooter, Alert, ConfirmDialog, StatusBadge, type StatusBadgeTone } from '@/components/ui';
import { Tabs } from '@/components/ui/compact/Tabs';
import { IdSearchSelect } from '@/components/document-entry/PartySearchSelect';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import type { CreatedRange } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';
import { calendarDayOf, inDateRange, matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';

interface Employee { id: string; name: string; employee_code: string; }
interface LeaveType { id: string; name: string; days_per_year: number; }
interface LeaveRequest {
    id: string;
    employee_id: string;
    leave_type_id: string;
    start_date: string;
    end_date: string;
    days: number;
    reason?: string | null;
    status: string;
    approver_note?: string | null;
    created_at: string;
    employee?: { id: string; name: string; employee_code: string } | null;
    leave_type?: LeaveType | null;
    approver?: { id: string; name?: string | null; email: string } | null;
}

const REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;

const statusTones: Record<string, StatusBadgeTone> = {
    PENDING: 'warning',
    APPROVED: 'success',
    REJECTED: 'danger',
    CANCELLED: 'neutral',
};

/** A leave overlaps the date chip's range if any of its days fall inside it. */
function overlapsRange(req: LeaveRequest, range: CreatedRange | null): boolean {
    if (!range?.from && !range?.to) return true;
    const start = calendarDayOf(req.start_date);
    const end = calendarDayOf(req.end_date) ?? start;
    if (!start || !end) return false;
    const from = range.from?.slice(0, 10);
    const to = range.to?.slice(0, 10);
    if (from && end < from) return false;
    if (to && start > to) return false;
    return true;
}

const columnHelper = createColumnHelper<LeaveRequest>();
const typeColumnHelper = createColumnHelper<LeaveType>();

const EMPTY_REQUEST_FORM = {
    employee_id: '',
    leave_type_id: '',
    start_date: '',
    end_date: '',
    days: '',
    reason: '',
};

const EMPTY_TYPE_FORM = { name: '', days_per_year: '' };

export default function LeavesPage() {
    const { t, locale } = useI18n();
    const [tab, setTab] = useState<'requests' | 'types'>('requests');

    // Requests state
    const [requests, setRequests] = useState<LeaveRequest[]>([]);
    const [loadingReqs, setLoadingReqs] = useState(true);
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [employeeIds, setEmployeeIds] = useState<string[]>([]);
    const [leaveTypeIds, setLeaveTypeIds] = useState<string[]>([]);
    const [periodRange, setPeriodRange] = useState<CreatedRange | null>(null);
    const [daysFilter, setDaysFilter] = useState<NumberCondition | null>(null);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [search, setSearch] = useState('');
    const [cancelTarget, setCancelTarget] = useState<LeaveRequest | null>(null);
    const [deleteTypeTarget, setDeleteTypeTarget] = useState<LeaveType | null>(null);
    const [typeSearch, setTypeSearch] = useState('');
    const [showRequestModal, setShowRequestModal] = useState(false);
    const [requestForm, setRequestForm] = useState(EMPTY_REQUEST_FORM);
    const [submittingReq, setSubmittingReq] = useState(false);
    const [reqError, setReqError] = useState('');
    const [reviewingId, setReviewingId] = useState<string | null>(null);

    // Leave types state
    const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
    const [loadingTypes, setLoadingTypes] = useState(true);
    const [typeForm, setTypeForm] = useState(EMPTY_TYPE_FORM);
    const [submittingType, setSubmittingType] = useState(false);
    const [typeError, setTypeError] = useState('');

    // Shared
    const [employees, setEmployees] = useState<Employee[]>([]);

    const loadRequests = useCallback(async () => {
        setLoadingReqs(true);
        try {
            // The server narrows by one status and one employee; more than one
            // of either is narrowed here, from the same rows.
            const data = await api.getLeaveRequests({
                status: statusFilter.length === 1 ? statusFilter[0] : undefined,
                employeeId: employeeIds.length === 1 ? employeeIds[0] : undefined,
            });
            setRequests(data ?? []);
        } catch (err) {
            console.error('Failed to load leave requests', err);
        } finally {
            setLoadingReqs(false);
        }
    }, [statusFilter, employeeIds]);

    const loadLeaveTypes = useCallback(async () => {
        setLoadingTypes(true);
        try {
            const data = await api.getLeaveTypes();
            setLeaveTypes(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to load leave types', err);
        } finally {
            setLoadingTypes(false);
        }
    }, []);

    useEffect(() => {
        api.getEmployees().then(setEmployees).catch(() => {});
    }, []);

    useEffect(() => { loadRequests(); }, [loadRequests]);
    useEffect(() => { loadLeaveTypes(); }, [loadLeaveTypes]);

    const handleCreateRequest = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmittingReq(true);
        setReqError('');
        try {
            await api.createLeaveRequest({
                employee_id: requestForm.employee_id,
                leave_type_id: requestForm.leave_type_id,
                start_date: requestForm.start_date,
                end_date: requestForm.end_date,
                days: parseFloat(requestForm.days),
                reason: requestForm.reason || undefined,
            });
            setShowRequestModal(false);
            setRequestForm(EMPTY_REQUEST_FORM);
            loadRequests();
        } catch (err: any) {
            setReqError(err.message || t.leaves.createRequestFailed);
        } finally {
            setSubmittingReq(false);
        }
    };

    const handleReview = async (id: string, status: 'APPROVED' | 'REJECTED') => {
        setReviewingId(id);
        try {
            await api.reviewLeaveRequest(id, { status });
            loadRequests();
        } catch (err: any) {
            toast.error(err?.message || t.leaves.updateRequestFailed);
        } finally {
            setReviewingId(null);
        }
    };

    const handleCancel = async () => {
        if (!cancelTarget) return;
        try {
            await api.cancelLeaveRequest(cancelTarget.id);
            setCancelTarget(null);
            loadRequests();
        } catch (err: any) {
            toast.error(err?.message || t.leaves.cancelRequestFailed);
        }
    };

    const handleCreateType = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmittingType(true);
        setTypeError('');
        try {
            await api.createLeaveType({
                name: typeForm.name,
                days_per_year: parseFloat(typeForm.days_per_year),
            });
            setTypeForm(EMPTY_TYPE_FORM);
            loadLeaveTypes();
        } catch (err: any) {
            setTypeError(err.message || t.leaves.createTypeFailed);
        } finally {
            setSubmittingType(false);
        }
    };

    const handleDeleteType = async () => {
        if (!deleteTypeTarget) return;
        try {
            await api.deleteLeaveType(deleteTypeTarget.id);
            setDeleteTypeTarget(null);
            loadLeaveTypes();
        } catch (err: any) {
            toast.error(err?.message || t.leaves.deleteTypeFailed);
        }
    };

    const statusLabel = useCallback(
        (status: string) => t.leaves.statuses[status.toLowerCase() as keyof typeof t.leaves.statuses] ?? status,
        [t],
    );

    const requestColumns: ColumnDef<LeaveRequest, any>[] = useMemo(
        () => [
            columnHelper.accessor((row) => row.employee?.name ?? '', {
                id: 'employee',
                header: t.leaves.columns.employee,
                cell: (info) => {
                    const req = info.row.original;
                    return (
                        <div>
                            <span className="block">{req.employee?.name ?? '—'}</span>
                            <span className="block text-gray-500">{req.employee?.employee_code ?? ''}</span>
                        </div>
                    );
                },
                size: 160,
            }),
            columnHelper.accessor((row) => row.leave_type?.name ?? '', {
                id: 'leave_type',
                header: t.leaves.columns.leaveType,
                cell: (info) => info.getValue() || '—',
                size: 120,
            }),
            columnHelper.accessor('start_date', {
                id: 'dates',
                header: t.leaves.columns.period,
                cell: (info) => {
                    const req = info.row.original;
                    return (
                        <span>
                            {formatDate(req.start_date, locale)}
                            {req.start_date !== req.end_date && (
                                <span className="text-gray-500"> → {formatDate(req.end_date, locale)}</span>
                            )}
                        </span>
                    );
                },
                size: 180,
            }),
            columnHelper.accessor('days', {
                header: t.leaves.columns.days,
                cell: (info) => info.getValue(),
                size: 70,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('status', {
                header: t.leaves.columns.status,
                cell: (info) => {
                    const status = info.getValue();
                    return <StatusBadge tone={statusTones[status] ?? 'neutral'}>{statusLabel(status)}</StatusBadge>;
                },
                size: 110,
            }),
            columnHelper.accessor('reason', {
                header: t.leaves.columns.reason,
                cell: (info) => info.getValue() || '—',
                size: 160,
                meta: { hideOnMobile: true },
            }),
            createdAtColumn(columnHelper, { header: t.common.createdAt, locale, enableColumnFilter: false }),
            columnHelper.display({
                id: 'actions',
                header: t.leaves.columns.actions,
                cell: (info) => {
                    const req = info.row.original;
                    const isReviewing = reviewingId === req.id;
                    if (req.status !== 'PENDING') {
                        return (
                            <RowActions>
                                <RowActionButton
                                    icon={<X />}
                                    label={t.leaves.cancel}
                                    intent="danger"
                                    disabled={req.status === 'CANCELLED'}
                                    onClick={() => setCancelTarget(req)}
                                />
                            </RowActions>
                        );
                    }
                    return (
                        <RowActions>
                            <RowActionButton
                                icon={<Check />}
                                label={t.leaves.approve}
                                intent="success"
                                disabled={isReviewing}
                                onClick={() => handleReview(req.id, 'APPROVED')}
                            />
                            <RowActionButton
                                icon={<X />}
                                label={t.leaves.reject}
                                intent="danger"
                                disabled={isReviewing}
                                onClick={() => handleReview(req.id, 'REJECTED')}
                            />
                        </RowActions>
                    );
                },
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 90,
            }),
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [reviewingId, t, locale, statusLabel],
    );

    const filteredRequests = useMemo(
        () => requests.filter((req) => {
            if (!matchesAnyOf(statusFilter, req.status)) return false;
            if (!matchesAnyOf(employeeIds, req.employee_id)) return false;
            if (!matchesAnyOf(leaveTypeIds, req.leave_type_id)) return false;
            if (!overlapsRange(req, periodRange)) return false;
            if (!matchesNumberCondition(Number(req.days) || 0, daysFilter)) return false;
            if (!inDateRange(req.created_at, createdRange)) return false;
            return matchesSearch(search, req.employee?.name, req.employee?.employee_code, req.leave_type?.name, req.reason);
        }),
        [requests, statusFilter, employeeIds, leaveTypeIds, periodRange, daysFilter, createdRange, search],
    );

    const requestFilters = useMemo<ListFilter[]>(() => [
        {
            id: 'period',
            type: 'date-range',
            label: t.leaves.columns.period,
            value: periodRange,
            onChange: setPeriodRange,
            operators: true,
        },
        {
            id: 'status',
            type: 'multi-select',
            label: t.leaves.columns.status,
            value: statusFilter,
            onChange: setStatusFilter,
            options: REQUEST_STATUSES.map((value) => ({ value, label: statusLabel(value) })),
        },
        {
            id: 'employee',
            type: 'multi-select',
            label: t.leaves.columns.employee,
            value: employeeIds,
            onChange: setEmployeeIds,
            options: employees.map((emp) => ({ value: emp.id, label: `${emp.name} · ${emp.employee_code}` })),
        },
        {
            id: 'leaveType',
            type: 'multi-select',
            label: t.leaves.columns.leaveType,
            value: leaveTypeIds,
            onChange: setLeaveTypeIds,
            options: leaveTypes.map((lt) => ({ value: lt.id, label: lt.name })),
        },
        {
            id: 'days',
            type: 'number',
            label: t.leaves.columns.days,
            value: daysFilter,
            onChange: setDaysFilter,
            more: true,
        },
        { id: 'created', type: 'date-range', value: createdRange, onChange: setCreatedRange, operators: true, more: true },
    ], [t, periodRange, statusFilter, statusLabel, employeeIds, employees, leaveTypeIds, leaveTypes, daysFilter, createdRange]);

    const requestStats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const count = (status: string) => filteredRequests.filter((req) => req.status === status).length;
        const pending = count('PENDING');
        const approvedDays = filteredRequests
            .filter((req) => req.status === 'APPROVED')
            .reduce((sum, req) => sum + (Number(req.days) || 0), 0);
        const items: ListStat[] = [
            { id: 'count', icon: <Inbox aria-hidden />, label: t.hr.listUi.leaves.requests, value: n(filteredRequests.length) },
            {
                id: 'pending',
                icon: <Hourglass aria-hidden />,
                label: statusLabel('PENDING'),
                value: n(pending),
                tone: pending > 0 ? 'warning' : 'default',
            },
            { id: 'approved', icon: <CheckCircle2 aria-hidden />, label: statusLabel('APPROVED'), value: n(count('APPROVED')) },
            { id: 'approvedDays', icon: <CalendarDays aria-hidden />, label: t.hr.listUi.leaves.approvedDays, value: n(approvedDays) },
            { id: 'rejected', icon: <XCircle aria-hidden />, label: statusLabel('REJECTED'), value: n(count('REJECTED')) },
        ];
        return { items, loading: loadingReqs, label: t.hr.listUi.leaves.statsLabel };
    }, [filteredRequests, loadingReqs, locale, t, statusLabel]);

    const typeColumns: ColumnDef<LeaveType, any>[] = useMemo(
        () => [
            typeColumnHelper.accessor('name', {
                header: t.leaves.name,
                cell: (info) => info.getValue(),
                size: 240,
            }),
            typeColumnHelper.accessor('days_per_year', {
                header: t.leaves.columns.daysPerYear,
                cell: (info) => info.getValue(),
                size: 120,
                meta: { align: 'end' },
            }),
            typeColumnHelper.display({
                id: 'actions',
                header: t.leaves.columns.actions,
                cell: (info) => (
                    <RowActions>
                        <RowActionButton
                            icon={<Trash2 />}
                            label={t.common.delete}
                            intent="danger"
                            onClick={() => setDeleteTypeTarget(info.row.original)}
                        />
                    </RowActions>
                ),
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 80,
            }),
        ],
        [t],
    );

    const filteredTypes = useMemo(
        () => leaveTypes.filter((lt) => matchesSearch(typeSearch, lt.name, lt.days_per_year)),
        [leaveTypes, typeSearch],
    );

    const typeStats = useMemo(() => {
        const items: ListStat[] = [
            { id: 'count', icon: <Tags aria-hidden />, label: t.leaves.tabs.types, value: filteredTypes.length.toLocaleString(locale) },
            {
                id: 'days',
                icon: <CalendarDays aria-hidden />,
                label: t.hr.listUi.leaves.daysPerYearTotal,
                value: filteredTypes.reduce((sum, lt) => sum + (Number(lt.days_per_year) || 0), 0).toLocaleString(locale),
            },
        ];
        return { items, loading: loadingTypes, label: t.hr.listUi.leaves.typesStatsLabel };
    }, [filteredTypes, loadingTypes, locale, t]);

    return (
        <PageShell>
                <PageHeader
                    title={t.leaves.title}
                    subtitle={t.leaves.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.hr,
                        t.leaves.title,
                        'hr',
                    )}
                    actions={tab === 'requests' ? (
                        <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setShowRequestModal(true)}>
                            {t.leaves.newRequest}
                        </Button>
                    ) : undefined}
                />

                <Tabs
                    tabs={[
                        { key: 'requests', label: t.leaves.tabs.requests },
                        { key: 'types', label: t.leaves.tabs.types },
                    ]}
                    value={tab}
                    onChange={(next) => { if (next) setTab(next); }}
                    idPrefix="leaves"
                    label={t.leaves.title}
                />

                {/* Leave Requests Tab */}
                {tab === 'requests' && (
                    <>
                        <DataTable<LeaveRequest>
                            tableId="leave-requests"
                            columns={requestColumns}
                            data={filteredRequests}
                            title={t.leaves.tabs.requests}
                            isLoading={loadingReqs}
                            emptyMessage={t.leaves.emptyRequests}
                            emptyIcon={<CalendarOff className="w-16 h-16 text-gray-200" />}
                            searchPlaceholder={t.leaves.searchRequestsPlaceholder}
                            searchValue={search}
                            onSearchChange={setSearch}
                            filters={requestFilters}
                            filterLayout="row"
                            stats={requestStats}
                            enableColumnFilters={false}
                            viewOptions
                        />
                    </>
                )}

                {/* Leave Types Tab */}
                {tab === 'types' && (
                    <div className="space-y-4">
                        {/* Add leave type form */}
                        <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-4">
                            <h2 className="text-sm font-semibold text-gray-900 mb-4">{t.leaves.addLeaveType}</h2>
                            {typeError && <Alert tone="danger" className="mb-4">{typeError}</Alert>}
                            <form onSubmit={handleCreateType} className="flex gap-3 items-end">
                                <div className="flex-1">
                                    <Field label={t.leaves.name} required>
                                        <Input
                                            required
                                            type="text"
                                            value={typeForm.name}
                                            onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })}
                                            placeholder={t.leaves.placeholders.leaveTypeName}
                                        />
                                    </Field>
                                </div>
                                <div className="w-40">
                                    <Field label={t.leaves.columns.daysPerYear} required>
                                        <Input
                                            required
                                            type="number"
                                            min="0"
                                            step="0.5"
                                            value={typeForm.days_per_year}
                                            onChange={(e) => setTypeForm({ ...typeForm, days_per_year: e.target.value })}
                                            placeholder={t.leaves.placeholders.daysPerYear}
                                        />
                                    </Field>
                                </div>
                                <Button type="submit" variant="primary" loading={submittingType} icon={<Plus className="w-4 h-4" />}>
                                    {t.leaves.add}
                                </Button>
                            </form>
                        </div>

                        <DataTable<LeaveType>
                            tableId="leave-types"
                            columns={typeColumns}
                            data={filteredTypes}
                            title={t.leaves.tabs.types}
                            isLoading={loadingTypes}
                            emptyMessage={t.leaves.noLeaveTypesDefined}
                            emptyIcon={<CalendarOff className="w-16 h-16 text-gray-200" />}
                            searchValue={typeSearch}
                            onSearchChange={setTypeSearch}
                            filterLayout="row"
                            stats={typeStats}
                            enableColumnFilters={false}
                            viewOptions
                        />
                    </div>
                )}

            <ConfirmDialog
                open={cancelTarget !== null}
                title={t.leaves.cancel}
                prompt={t.leaves.cancelRequestConfirm}
                confirmLabel={t.leaves.cancel}
                cancelLabel={t.common.close}
                danger
                onConfirm={() => void handleCancel()}
                onCancel={() => setCancelTarget(null)}
            />

            <ConfirmDialog
                open={deleteTypeTarget !== null}
                title={t.common.delete}
                prompt={t.leaves.deleteTypeConfirm}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                danger
                onConfirm={() => void handleDeleteType()}
                onCancel={() => setDeleteTypeTarget(null)}
            />

            {/* New Leave Request Modal */}
            {showRequestModal && (
                <ModalShell size="sm" onBackdropClick={() => { setShowRequestModal(false); setRequestForm(EMPTY_REQUEST_FORM); setReqError(''); }}>
                    <ModalHeader
                        title={t.leaves.newLeaveRequest}
                        onClose={() => { setShowRequestModal(false); setRequestForm(EMPTY_REQUEST_FORM); setReqError(''); }}
                    />

                    <form onSubmit={handleCreateRequest} className="p-4 space-y-4 overflow-y-auto">
                        {reqError && <Alert tone="danger">{reqError}</Alert>}

                        <Field label={t.leaves.columns.employee} required htmlFor="leave-employee">
                            <IdSearchSelect
                                id="leave-employee"
                                items={employees}
                                value={requestForm.employee_id}
                                onChange={(id) => setRequestForm({ ...requestForm, employee_id: id })}
                                placeholder={t.leaves.selectEmployee}
                                emptyLabel={t.leaves.selectEmployee}
                                noMatchLabel={t.common.noData}
                                subtitle={(emp) => emp.employee_code ?? ''}
                            />
                        </Field>

                        <Field label={t.leaves.columns.leaveType} required>
                            <Select
                                required
                                value={requestForm.leave_type_id}
                                onChange={(e) => setRequestForm({ ...requestForm, leave_type_id: e.target.value })}
                            >
                                <option value="">{t.leaves.selectLeaveType}</option>
                                {leaveTypes.map((lt) => (
                                    <option key={lt.id} value={lt.id}>{lt.name} ({lt.days_per_year} {t.leaves.daysPerYearSuffix})</option>
                                ))}
                            </Select>
                        </Field>

                        <div className="grid grid-cols-2 gap-3">
                            <Field label={t.leaves.columns.startDate} required>
                                <Input
                                    required
                                    type="date"
                                    value={requestForm.start_date}
                                    onChange={(e) => setRequestForm({ ...requestForm, start_date: e.target.value })}
                                />
                            </Field>
                            <Field label={t.leaves.columns.endDate} required>
                                <Input
                                    required
                                    type="date"
                                    value={requestForm.end_date}
                                    onChange={(e) => setRequestForm({ ...requestForm, end_date: e.target.value })}
                                />
                            </Field>
                        </div>

                        <Field label={t.leaves.numberOfDays} required>
                            <Input
                                required
                                type="number"
                                min="0.5"
                                step="0.5"
                                value={requestForm.days}
                                onChange={(e) => setRequestForm({ ...requestForm, days: e.target.value })}
                                placeholder={t.leaves.placeholders.numberOfDays}
                            />
                        </Field>

                        <Field label={t.leaves.columns.reason} hint={`(${t.common.optional})`}>
                            <Input
                                type="text"
                                value={requestForm.reason}
                                onChange={(e) => setRequestForm({ ...requestForm, reason: e.target.value })}
                                placeholder={t.common.notes}
                            />
                        </Field>

                        <FormFooter>
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => { setShowRequestModal(false); setRequestForm(EMPTY_REQUEST_FORM); setReqError(''); }}
                            >
                                {t.common.cancel}
                            </Button>
                            <Button type="submit" variant="primary" loading={submittingReq}>
                                {submittingReq ? t.leaves.submittingRequest : t.leaves.submitRequest}
                            </Button>
                        </FormFooter>
                    </form>
                </ModalShell>
            )}
        </PageShell>
    );
}
