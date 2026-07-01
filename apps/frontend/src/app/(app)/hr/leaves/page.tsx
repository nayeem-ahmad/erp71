'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { CalendarOff, Plus, Check, X, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { useI18n } from '@/lib/i18n';

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

const REQUEST_STATUS_COLORS: Record<string, string> = {
    PENDING: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    REJECTED: 'bg-red-50 text-red-700 border-red-200',
    CANCELLED: 'bg-gray-100 text-gray-500 border-gray-200',
};

const columnHelper = createColumnHelper<LeaveRequest>();

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
    const { t } = useI18n();
    const [tab, setTab] = useState<'requests' | 'types'>('requests');

    // Requests state
    const [requests, setRequests] = useState<LeaveRequest[]>([]);
    const [loadingReqs, setLoadingReqs] = useState(true);
    const [statusFilter, setStatusFilter] = useState('');
    const [employeeFilter, setEmployeeFilter] = useState('');
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
            const data = await api.getLeaveRequests({
                status: statusFilter || undefined,
                employeeId: employeeFilter || undefined,
                limit: 100,
            });
            setRequests(Array.isArray(data) ? data : (data?.items ?? []));
        } catch (err) {
            console.error('Failed to load leave requests', err);
        } finally {
            setLoadingReqs(false);
        }
    }, [statusFilter, employeeFilter]);

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
        api.getEmployees({ limit: 200 }).then((data: any) => {
            setEmployees(Array.isArray(data) ? data : (data?.items ?? []));
        }).catch(() => {});
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
            alert(err.message || t.leaves.updateRequestFailed);
        } finally {
            setReviewingId(null);
        }
    };

    const handleCancel = async (id: string) => {
        if (!confirm(t.leaves.cancelRequestConfirm)) return;
        try {
            await api.cancelLeaveRequest(id);
            loadRequests();
        } catch (err: any) {
            alert(err.message || t.leaves.cancelRequestFailed);
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

    const handleDeleteType = async (id: string) => {
        if (!confirm(t.leaves.deleteTypeConfirm)) return;
        try {
            await api.deleteLeaveType(id);
            loadLeaveTypes();
        } catch (err: any) {
            alert(err.message || t.leaves.deleteTypeFailed);
        }
    };

    const requestColumns: ColumnDef<LeaveRequest, any>[] = useMemo(
        () => [
            columnHelper.accessor((row) => row.employee?.name ?? '', {
                id: 'employee',
                header: t.leaves.columns.employee,
                cell: (info) => {
                    const req = info.row.original;
                    return (
                        <div>
                            <span className="block text-sm font-black text-gray-900">{req.employee?.name ?? '—'}</span>
                            <span className="block text-xs text-gray-400 font-mono">{req.employee?.employee_code ?? ''}</span>
                        </div>
                    );
                },
                size: 160,
            }),
            columnHelper.accessor((row) => row.leave_type?.name ?? '', {
                id: 'leave_type',
                header: t.leaves.columns.leaveType,
                cell: (info) => <span className="text-sm text-gray-700">{info.getValue() || '—'}</span>,
                size: 120,
            }),
            columnHelper.display({
                id: 'dates',
                header: t.leaves.columns.period,
                cell: (info) => {
                    const req = info.row.original;
                    return (
                        <div className="text-sm text-gray-700">
                            <span>{formatDate(req.start_date)}</span>
                            {req.start_date !== req.end_date && (
                                <span className="text-gray-400"> → {formatDate(req.end_date)}</span>
                            )}
                        </div>
                    );
                },
                size: 180,
            }),
            columnHelper.accessor('days', {
                header: t.leaves.columns.days,
                cell: (info) => <span className="text-sm font-bold text-gray-700">{info.getValue()}</span>,
                size: 70,
            }),
            columnHelper.accessor('status', {
                header: t.leaves.columns.status,
                cell: (info) => {
                    const status = info.getValue();
                    const cls = REQUEST_STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-500 border-gray-200';
                    return (
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${cls}`}>
                            {status}
                        </span>
                    );
                },
                size: 100,
            }),
            columnHelper.accessor('reason', {
                header: t.leaves.columns.reason,
                cell: (info) => <span className="text-sm text-gray-500">{info.getValue() || '—'}</span>,
                size: 160,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.leaves.columns.actions,
                cell: (info) => {
                    const req = info.row.original;
                    const isReviewing = reviewingId === req.id;
                    if (req.status !== 'PENDING') {
                        return (
                            <button
                                onClick={() => handleCancel(req.id)}
                                disabled={req.status === 'CANCELLED'}
                                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-50 disabled:opacity-30 transition-colors"
                                title={t.leaves.cancel}
                            >
                                <X className="w-4 h-4" />
                            </button>
                        );
                    }
                    return (
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => handleReview(req.id, 'APPROVED')}
                                disabled={isReviewing}
                                className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 disabled:opacity-50 transition-colors"
                                title={t.leaves.approve}
                            >
                                <Check className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => handleReview(req.id, 'REJECTED')}
                                disabled={isReviewing}
                                className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors"
                                title={t.leaves.reject}
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    );
                },
                enableSorting: false,
                size: 90,
            }),
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [reviewingId],
    );

    const filterPresets = useMemo(() => [
        { label: t.leaves.filterPresets.pending, filters: [{ id: 'status', value: 'PENDING' }] },
        { label: t.leaves.filterPresets.approved, filters: [{ id: 'status', value: 'APPROVED' }] },
        { label: t.leaves.filterPresets.rejected, filters: [{ id: 'status', value: 'REJECTED' }] },
    ], [t]);

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.leaves.title}</h1>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {t.leaves.subtitle}
                        </p>
                    </div>
                    {tab === 'requests' && (
                        <button
                            onClick={() => setShowRequestModal(true)}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 active:translate-y-0"
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            {t.leaves.newRequest}
                        </button>
                    )}
                </div>

                {/* Tabs */}
                <div className="flex gap-2 border-b border-gray-200">
                    {(['requests', 'types'] as const).map((tabKey) => (
                        <button
                            key={tabKey}
                            onClick={() => setTab(tabKey)}
                            className={`px-4 py-2.5 text-sm font-black uppercase tracking-widest border-b-2 transition-colors ${
                                tab === tabKey
                                    ? 'border-blue-600 text-blue-600'
                                    : 'border-transparent text-gray-400 hover:text-gray-700'
                            }`}
                        >
                            {tabKey === 'requests' ? t.leaves.tabs.requests : t.leaves.tabs.types}
                        </button>
                    ))}
                </div>

                {/* Leave Requests Tab */}
                {tab === 'requests' && (
                    <>
                        {/* Filters */}
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                            <div className="flex flex-wrap gap-3 items-end">
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-gray-500 block">{t.leaves.columns.status}</label>
                                    <select
                                        value={statusFilter}
                                        onChange={(e) => setStatusFilter(e.target.value)}
                                        className="bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-3 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all appearance-none min-w-[150px]"
                                    >
                                        <option value="">{t.leaves.allStatuses}</option>
                                        <option value="PENDING">{t.leaves.filterPresets.pending}</option>
                                        <option value="APPROVED">{t.leaves.filterPresets.approved}</option>
                                        <option value="REJECTED">{t.leaves.filterPresets.rejected}</option>
                                        <option value="CANCELLED">{t.leaves.cancel}</option>
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-gray-500 block">{t.leaves.columns.employee}</label>
                                    <select
                                        value={employeeFilter}
                                        onChange={(e) => setEmployeeFilter(e.target.value)}
                                        className="bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-3 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all appearance-none min-w-[180px]"
                                    >
                                        <option value="">{t.leaves.allEmployees}</option>
                                        {employees.map((emp) => (
                                            <option key={emp.id} value={emp.id}>
                                                {emp.name} ({emp.employee_code})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>

                        <DataTable<LeaveRequest>
                            tableId="leave-requests"
                            columns={requestColumns}
                            data={requests}
                            title={t.leaves.tabs.requests}
                            isLoading={loadingReqs}
                            emptyMessage={t.leaves.emptyRequests}
                            emptyIcon={<CalendarOff className="w-16 h-16 text-gray-200" />}
                            searchPlaceholder={t.leaves.searchRequestsPlaceholder}
                            filterPresets={filterPresets}
                        />
                    </>
                )}

                {/* Leave Types Tab */}
                {tab === 'types' && (
                    <div className="space-y-6">
                        {/* Add leave type form */}
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                            <h2 className="text-sm font-black uppercase tracking-widest text-gray-400 mb-4">{t.leaves.addLeaveType}</h2>
                            {typeError && (
                                <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold border border-red-100">
                                    {typeError}
                                </div>
                            )}
                            <form onSubmit={handleCreateType} className="flex gap-3 items-end">
                                <div className="flex-1 space-y-1.5">
                                    <label className="text-xs font-black uppercase tracking-widest text-gray-400 block">{t.leaves.name}</label>
                                    <input
                                        required
                                        type="text"
                                        value={typeForm.name}
                                        onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })}
                                        placeholder={t.leaves.placeholders.leaveTypeName}
                                        className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                                    />
                                </div>
                                <div className="w-40 space-y-1.5">
                                    <label className="text-xs font-black uppercase tracking-widest text-gray-400 block">{t.leaves.columns.daysPerYear}</label>
                                    <input
                                        required
                                        type="number"
                                        min="0"
                                        step="0.5"
                                        value={typeForm.days_per_year}
                                        onChange={(e) => setTypeForm({ ...typeForm, days_per_year: e.target.value })}
                                        placeholder={t.leaves.placeholders.daysPerYear}
                                        className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={submittingType}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-3 rounded-xl font-bold text-sm flex items-center shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 disabled:opacity-50"
                                >
                                    <Plus className="w-4 h-4 mr-1.5" />
                                    {t.leaves.add}
                                </button>
                            </form>
                        </div>

                        {/* Leave types list */}
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                            {loadingTypes ? (
                                <div className="p-8 text-center text-gray-400 font-bold text-sm">{t.common.loading}</div>
                            ) : leaveTypes.length === 0 ? (
                                <div className="p-8 text-center">
                                    <CalendarOff className="w-12 h-12 text-gray-200 mx-auto mb-2" />
                                    <p className="text-sm text-gray-400 font-bold">{t.leaves.noLeaveTypesDefined}</p>
                                </div>
                            ) : (
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-gray-100">
                                            <th className="text-left text-xs font-medium text-gray-500 px-6 py-3">{t.leaves.name}</th>
                                            <th className="text-left text-xs font-medium text-gray-500 px-6 py-3">{t.leaves.columns.daysPerYear}</th>
                                            <th className="text-right px-6 py-3"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {leaveTypes.map((lt) => (
                                            <tr key={lt.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                                                <td className="px-6 py-3.5 text-sm font-bold text-gray-900">{lt.name}</td>
                                                <td className="px-6 py-3.5 text-sm text-gray-600">{lt.days_per_year}</td>
                                                <td className="px-6 py-3.5 text-right">
                                                    <button
                                                        onClick={() => handleDeleteType(lt.id)}
                                                        className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition-colors"
                                                        title={t.common.delete}
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* New Leave Request Modal */}
            {showRequestModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-black tracking-tight">{t.leaves.newLeaveRequest}</h2>
                            <button
                                onClick={() => { setShowRequestModal(false); setRequestForm(EMPTY_REQUEST_FORM); setReqError(''); }}
                                className="text-gray-400 hover:text-gray-700 transition-colors text-xl font-bold leading-none"
                            >
                                ×
                            </button>
                        </div>

                        {reqError && (
                            <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold border border-red-100">
                                {reqError}
                            </div>
                        )}

                        <form onSubmit={handleCreateRequest} className="space-y-4">
                            <div className="space-y-1.5">
                                <label className="text-xs font-black uppercase tracking-widest text-gray-400 block">{t.leaves.columns.employee}</label>
                                <select
                                    required
                                    value={requestForm.employee_id}
                                    onChange={(e) => setRequestForm({ ...requestForm, employee_id: e.target.value })}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                                >
                                    <option value="">{t.leaves.selectEmployee}</option>
                                    {employees.map((emp) => (
                                        <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_code})</option>
                                    ))}
                                </select>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-black uppercase tracking-widest text-gray-400 block">{t.leaves.columns.leaveType}</label>
                                <select
                                    required
                                    value={requestForm.leave_type_id}
                                    onChange={(e) => setRequestForm({ ...requestForm, leave_type_id: e.target.value })}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                                >
                                    <option value="">{t.leaves.selectLeaveType}</option>
                                    {leaveTypes.map((lt) => (
                                        <option key={lt.id} value={lt.id}>{lt.name} ({lt.days_per_year} {t.leaves.daysPerYearSuffix})</option>
                                    ))}
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-black uppercase tracking-widest text-gray-400 block">{t.leaves.columns.startDate}</label>
                                    <input
                                        required
                                        type="date"
                                        value={requestForm.start_date}
                                        onChange={(e) => setRequestForm({ ...requestForm, start_date: e.target.value })}
                                        className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-black uppercase tracking-widest text-gray-400 block">{t.leaves.columns.endDate}</label>
                                    <input
                                        required
                                        type="date"
                                        value={requestForm.end_date}
                                        onChange={(e) => setRequestForm({ ...requestForm, end_date: e.target.value })}
                                        className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                                    />
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-black uppercase tracking-widest text-gray-400 block">{t.leaves.numberOfDays}</label>
                                <input
                                    required
                                    type="number"
                                    min="0.5"
                                    step="0.5"
                                    value={requestForm.days}
                                    onChange={(e) => setRequestForm({ ...requestForm, days: e.target.value })}
                                    placeholder={t.leaves.placeholders.numberOfDays}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-black uppercase tracking-widest text-gray-400 block">{t.leaves.columns.reason} <span className="text-gray-300 font-normal normal-case">({t.common.optional})</span></label>
                                <input
                                    type="text"
                                    value={requestForm.reason}
                                    onChange={(e) => setRequestForm({ ...requestForm, reason: e.target.value })}
                                    placeholder={t.common.notes}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 text-sm text-gray-600 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                                />
                            </div>

                            <div className="pt-2 flex gap-3 justify-end">
                                <button
                                    type="button"
                                    onClick={() => { setShowRequestModal(false); setRequestForm(EMPTY_REQUEST_FORM); setReqError(''); }}
                                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-100 transition-all"
                                >
                                    {t.common.cancel}
                                </button>
                                <button
                                    type="submit"
                                    disabled={submittingReq}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 disabled:opacity-50"
                                >
                                    {submittingReq ? t.leaves.submittingRequest : t.leaves.submitRequest}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
