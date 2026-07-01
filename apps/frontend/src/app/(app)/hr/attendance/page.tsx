'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Clock, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { useI18n } from '@/lib/i18n';

interface Employee {
    id: string;
    employee_code: string;
    name: string;
}

interface AttendanceRecord {
    id: string;
    employee_id: string;
    date: string;
    clock_in?: string | null;
    clock_out?: string | null;
    status: string;
    notes?: string | null;
    employee?: { id: string; name: string; employee_code: string } | null;
}

const STATUS_COLORS: Record<string, string> = {
    PRESENT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    ABSENT: 'bg-red-50 text-red-700 border-red-200',
    HALF_DAY: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    HOLIDAY: 'bg-blue-50 text-blue-700 border-blue-200',
};

function formatTime(val?: string | null): string {
    if (!val) return '—';
    // If it's an ISO string, extract time portion
    const t = val.includes('T') ? val.split('T')[1]?.substring(0, 5) : val.substring(0, 5);
    return t || '—';
}

function getMonthRange() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    return {
        start: `${y}-${m}-01`,
        end: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
    };
}

const columnHelper = createColumnHelper<AttendanceRecord>();

const EMPTY_FORM = {
    employee_id: '',
    date: '',
    status: 'PRESENT',
    clock_in: '',
    clock_out: '',
    notes: '',
};

export default function AttendancePage() {
    const { t } = useI18n();
    const range = getMonthRange();
    const [records, setRecords] = useState<AttendanceRecord[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [startDate, setStartDate] = useState(range.start);
    const [endDate, setEndDate] = useState(range.end);
    const [filterEmployee, setFilterEmployee] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [recs, emps] = await Promise.all([
                api.getAttendance({
                    startDate: startDate || undefined,
                    endDate: endDate || undefined,
                    employeeId: filterEmployee || undefined,
                }),
                api.getEmployees({ limit: 200 }),
            ]);
            setRecords(Array.isArray(recs) ? recs : (recs?.items ?? []));
            setEmployees(Array.isArray(emps) ? emps : (emps?.items ?? []));
        } catch (err) {
            console.error('Failed to load attendance', err);
        } finally {
            setLoading(false);
        }
    }, [startDate, endDate, filterEmployee]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleDelete = async (id: string) => {
        if (!confirm(t.attendance.deleteConfirm)) return;
        try {
            await api.deleteAttendance(id);
            loadData();
        } catch (err: any) {
            alert(err.message || t.attendance.deleteFailed);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError('');
        try {
            const payload: any = {
                employee_id: form.employee_id,
                date: form.date,
                status: form.status,
            };
            if (form.clock_in) payload.clock_in = form.clock_in;
            if (form.clock_out) payload.clock_out = form.clock_out;
            if (form.notes) payload.notes = form.notes;
            await api.upsertAttendance(payload);
            setShowModal(false);
            setForm(EMPTY_FORM);
            loadData();
        } catch (err: any) {
            setError(err.message || t.attendance.logFailed);
        } finally {
            setSubmitting(false);
        }
    };

    const statusLabels: Record<string, string> = {
        PRESENT: t.attendance.statuses.present,
        ABSENT: t.attendance.statuses.absent,
        HALF_DAY: t.attendance.statuses.halfDay,
        HOLIDAY: t.attendance.statuses.holiday,
    };

    const columns: ColumnDef<AttendanceRecord, any>[] = useMemo(
        () => [
            columnHelper.accessor((row) => row.employee?.name ?? '', {
                id: 'employee',
                header: t.attendance.columns.employee,
                cell: (info) => {
                    const rec = info.row.original;
                    return (
                        <div>
                            <span className="block text-sm font-black text-gray-900">{rec.employee?.name ?? '—'}</span>
                            <span className="block text-xs text-gray-400 font-mono">{rec.employee?.employee_code ?? ''}</span>
                        </div>
                    );
                },
                size: 180,
            }),
            columnHelper.accessor('date', {
                header: t.attendance.columns.date,
                cell: (info) => (
                    <span className="text-sm text-gray-700">{formatDate(info.getValue())}</span>
                ),
                size: 120,
            }),
            columnHelper.accessor('status', {
                header: t.attendance.columns.status,
                cell: (info) => {
                    const status = info.getValue();
                    const cls = STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-500 border-gray-200';
                    return (
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${cls}`}>
                            {statusLabels[status] ?? status.replace('_', ' ')}
                        </span>
                    );
                },
                size: 110,
            }),
            columnHelper.accessor('clock_in', {
                header: t.attendance.columns.clockIn,
                cell: (info) => <span className="text-sm text-gray-600 font-mono">{formatTime(info.getValue())}</span>,
                size: 100,
            }),
            columnHelper.accessor('clock_out', {
                header: t.attendance.columns.clockOut,
                cell: (info) => <span className="text-sm text-gray-600 font-mono">{formatTime(info.getValue())}</span>,
                size: 100,
            }),
            columnHelper.accessor('notes', {
                header: t.attendance.columns.notes,
                cell: (info) => <span className="text-sm text-gray-500">{info.getValue() || '—'}</span>,
                size: 160,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.attendance.columns.actions,
                cell: (info) => (
                    <div className="flex items-center justify-end">
                        <button
                            onClick={() => handleDelete(info.row.original.id)}
                            className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                            title={t.common.delete}
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                ),
                enableSorting: false,
                size: 70,
            }),
        ],
        [t, statusLabels],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.attendance.title}</h1>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {t.attendance.pageSubtitle}
                        </p>
                    </div>
                    <button
                        onClick={() => setShowModal(true)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 active:translate-y-0"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        {t.attendance.logAttendance}
                    </button>
                </div>

                {/* Filters */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <div className="flex flex-wrap gap-3 items-end">
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-500 block">{t.attendance.filters.from}</label>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-3 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-500 block">{t.attendance.filters.to}</label>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-3 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-500 block">{t.attendance.columns.employee}</label>
                            <select
                                value={filterEmployee}
                                onChange={(e) => setFilterEmployee(e.target.value)}
                                className="bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-3 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all appearance-none min-w-[180px]"
                            >
                                <option value="">{t.attendance.allEmployees}</option>
                                {employees.map((emp) => (
                                    <option key={emp.id} value={emp.id}>
                                        {emp.name} ({emp.employee_code})
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* Data table */}
                <DataTable<AttendanceRecord>
                    tableId="attendance"
                    columns={columns}
                    data={records}
                    title={t.attendance.recordsTitle}
                    isLoading={loading}
                    emptyMessage={t.attendance.emptyMessage}
                    emptyIcon={<Clock className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.attendance.searchPlaceholder}
                />
            </div>

            {/* {t.attendance.logAttendance} Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-black tracking-tight">{t.attendance.logAttendance}</h2>
                            <button
                                onClick={() => { setShowModal(false); setForm(EMPTY_FORM); setError(''); }}
                                className="text-gray-400 hover:text-gray-700 transition-colors text-xl font-bold leading-none"
                            >
                                ×
                            </button>
                        </div>

                        {error && (
                            <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold border border-red-100">
                                {error}
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-1.5">
                                <label className="text-xs font-black uppercase tracking-widest text-gray-400 block">{t.attendance.modal.employee}</label>
                                <select
                                    required
                                    value={form.employee_id}
                                    onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                                >
                                    <option value="">{t.attendance.modal.selectEmployee}</option>
                                    {employees.map((emp) => (
                                        <option key={emp.id} value={emp.id}>
                                            {emp.name} ({emp.employee_code})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-black uppercase tracking-widest text-gray-400 block">{t.attendance.modal.date}</label>
                                <input
                                    required
                                    type="date"
                                    value={form.date}
                                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-black uppercase tracking-widest text-gray-400 block">{t.attendance.modal.status}</label>
                                <select
                                    value={form.status}
                                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                                >
                                    <option value="PRESENT">{t.attendance.statuses.present}</option>
                                    <option value="ABSENT">{t.attendance.statuses.absent}</option>
                                    <option value="HALF_DAY">{t.attendance.statuses.halfDay}</option>
                                    <option value="HOLIDAY">{t.attendance.statuses.holiday}</option>
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-black uppercase tracking-widest text-gray-400 block">{t.attendance.modal.clockIn}</label>
                                    <input
                                        type="time"
                                        value={form.clock_in}
                                        onChange={(e) => setForm({ ...form, clock_in: e.target.value })}
                                        className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-black uppercase tracking-widest text-gray-400 block">{t.attendance.modal.clockOut}</label>
                                    <input
                                        type="time"
                                        value={form.clock_out}
                                        onChange={(e) => setForm({ ...form, clock_out: e.target.value })}
                                        className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                                    />
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-black uppercase tracking-widest text-gray-400 block">{t.attendance.modal.notes}</label>
                                <input
                                    type="text"
                                    value={form.notes}
                                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                                    placeholder={t.attendance.modal.notesPlaceholder}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 text-sm text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                                />
                            </div>

                            <div className="flex justify-end gap-3 pt-1">
                                <button
                                    type="button"
                                    onClick={() => { setShowModal(false); setForm(EMPTY_FORM); setError(''); }}
                                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
                                >
                                    {t.common.cancel}
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="px-5 py-2.5 rounded-xl font-black text-sm bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:translate-y-0"
                                >
                                    {submitting ? t.attendance.modal.submitting : t.common.save}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
