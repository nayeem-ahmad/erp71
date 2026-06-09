'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Clock, Plus, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { formatDate } from '../../../lib/format';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';

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
        if (!confirm('Delete this attendance record?')) return;
        try {
            await api.deleteAttendance(id);
            loadData();
        } catch (err: any) {
            alert(err.message || 'Failed to delete record');
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
            setError(err.message || 'Failed to log attendance');
        } finally {
            setSubmitting(false);
        }
    };

    const columns: ColumnDef<AttendanceRecord, any>[] = useMemo(
        () => [
            columnHelper.accessor((row) => row.employee?.name ?? '', {
                id: 'employee',
                header: 'Employee',
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
                header: 'Date',
                cell: (info) => (
                    <span className="text-sm text-gray-700">{formatDate(info.getValue())}</span>
                ),
                size: 120,
            }),
            columnHelper.accessor('status', {
                header: 'Status',
                cell: (info) => {
                    const status = info.getValue();
                    const cls = STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-500 border-gray-200';
                    return (
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${cls}`}>
                            {status.replace('_', ' ')}
                        </span>
                    );
                },
                size: 110,
            }),
            columnHelper.accessor('clock_in', {
                header: 'Clock In',
                cell: (info) => <span className="text-sm text-gray-600 font-mono">{formatTime(info.getValue())}</span>,
                size: 100,
            }),
            columnHelper.accessor('clock_out', {
                header: 'Clock Out',
                cell: (info) => <span className="text-sm text-gray-600 font-mono">{formatTime(info.getValue())}</span>,
                size: 100,
            }),
            columnHelper.accessor('notes', {
                header: 'Notes',
                cell: (info) => <span className="text-sm text-gray-500">{info.getValue() || '—'}</span>,
                size: 160,
            }),
            columnHelper.display({
                id: 'actions',
                header: 'Actions',
                cell: (info) => (
                    <div className="flex items-center justify-end">
                        <button
                            onClick={() => handleDelete(info.row.original.id)}
                            className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                            title="Delete"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                ),
                enableSorting: false,
                size: 70,
            }),
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1400px] mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">Attendance</h1>
                        <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                            Daily clock-in / clock-out records
                        </p>
                    </div>
                    <button
                        onClick={() => setShowModal(true)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm flex items-center shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 active:translate-y-0"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        Log Attendance
                    </button>
                </div>

                {/* Filters */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <div className="flex flex-wrap gap-3 items-end">
                        <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block">From</label>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-3 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block">To</label>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-3 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block">Employee</label>
                            <select
                                value={filterEmployee}
                                onChange={(e) => setFilterEmployee(e.target.value)}
                                className="bg-gray-50 border border-gray-100 rounded-xl py-2.5 px-3 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all appearance-none min-w-[180px]"
                            >
                                <option value="">All Employees</option>
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
                    title="Attendance Records"
                    isLoading={loading}
                    emptyMessage="No attendance records found"
                    emptyIcon={<Clock className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder="Search by employee name..."
                />
            </div>

            {/* Log Attendance Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-black tracking-tight">Log Attendance</h2>
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
                                <label className="text-xs font-black uppercase tracking-widest text-gray-400 block">Employee</label>
                                <select
                                    required
                                    value={form.employee_id}
                                    onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                                >
                                    <option value="">Select employee…</option>
                                    {employees.map((emp) => (
                                        <option key={emp.id} value={emp.id}>
                                            {emp.name} ({emp.employee_code})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-black uppercase tracking-widest text-gray-400 block">Date</label>
                                <input
                                    required
                                    type="date"
                                    value={form.date}
                                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-black uppercase tracking-widest text-gray-400 block">Status</label>
                                <select
                                    value={form.status}
                                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                                >
                                    <option value="PRESENT">Present</option>
                                    <option value="ABSENT">Absent</option>
                                    <option value="HALF_DAY">Half Day</option>
                                    <option value="HOLIDAY">Holiday</option>
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-black uppercase tracking-widest text-gray-400 block">Clock In</label>
                                    <input
                                        type="time"
                                        value={form.clock_in}
                                        onChange={(e) => setForm({ ...form, clock_in: e.target.value })}
                                        className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-black uppercase tracking-widest text-gray-400 block">Clock Out</label>
                                    <input
                                        type="time"
                                        value={form.clock_out}
                                        onChange={(e) => setForm({ ...form, clock_out: e.target.value })}
                                        className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                                    />
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-black uppercase tracking-widest text-gray-400 block">Notes</label>
                                <input
                                    type="text"
                                    value={form.notes}
                                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                                    placeholder="Optional notes…"
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 text-sm text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                                />
                            </div>

                            <div className="flex justify-end gap-3 pt-1">
                                <button
                                    type="button"
                                    onClick={() => { setShowModal(false); setForm(EMPTY_FORM); setError(''); }}
                                    className="px-4 py-2.5 rounded-xl font-bold text-sm text-gray-600 hover:bg-gray-100 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="px-5 py-2.5 rounded-xl font-black text-sm bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:translate-y-0"
                                >
                                    {submitting ? 'Saving…' : 'Save'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
