'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeftRight, CalendarCheck, CalendarX, Clock, Plus, Trash2, Users } from 'lucide-react';
import { ListStats, ListToolbar, type ListFilter, type ListStat, type ResolvedListFilter } from '@/components/data-table';
import { RowActionButton } from '@/components/table';
import { createdRangeFromPreset, type CreatedRange } from '@/lib/created-range';
import { matchesAnyOf, matchesSearch } from '@/lib/list-filter';
import { api } from '@/lib/api';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import {
    PageShell,
    Button,
    Field,
    Input,
    Select,
    FormGrid,
    FormFooter,
    Alert,
    ConfirmDialog,
    StatusBadge,
    type StatusBadgeTone,
} from '@/components/ui';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import { IdSearchSelect } from '@/components/document-entry/PartySearchSelect';
import {
    dayHeading,
    dayKeyOfDate,
    formatMinutes,
    groupRowsByDay,
} from '@/lib/day-ledger';

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
    /**
     * Minutes recorded when the day was written, against the schedule in force
     * at the time. Read rather than recomputed from the clock times on purpose:
     * a fresh subtraction ignores breaks and the schedule, and would disagree
     * with the figure payroll consumes.
     */
    worked_minutes?: number | null;
    employee?: { id: string; name: string; employee_code: string } | null;
}

const STATUSES = ['PRESENT', 'ABSENT', 'HALF_DAY', 'HOLIDAY'] as const;

const statusTones: Record<string, StatusBadgeTone> = {
    PRESENT: 'success',
    ABSENT: 'danger',
    HALF_DAY: 'warning',
    HOLIDAY: 'info',
};

function formatTime(val?: string | null): string {
    if (!val) return '—';
    const t = val.includes('T') ? val.split('T')[1]?.substring(0, 5) : val.substring(0, 5);
    return t || '—';
}


const EMPTY_FORM = {
    employee_id: '',
    date: '',
    status: 'PRESENT',
    clock_in: '',
    clock_out: '',
    notes: '',
};

/**
 * Attendance as a day ledger.
 *
 * The same shape the hour log took, for the same reason: a flat table of dated
 * rows answers "who has a record" and nothing else, while a day header carrying
 * that day's worked total and its present/absent split answers the question a
 * manager actually opens this screen with. The two screens share
 * `lib/day-ledger` so a day heading reads the same in both.
 */
export default function AttendancePage() {
    const { t, locale } = useI18n();
    const a = t.attendance;
    const [records, setRecords] = useState<AttendanceRecord[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    // Opens on this month, on the workspace's calendar; cleared, the whole log.
    const [dateRange, setDateRange] = useState<CreatedRange | null>(() => createdRangeFromPreset('thisMonth'));
    const [employeeIds, setEmployeeIds] = useState<string[]>([]);
    const [statuses, setStatuses] = useState<string[]>([]);
    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [pendingDelete, setPendingDelete] = useState<AttendanceRecord | null>(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [recs, emps] = await Promise.all([
                // The server narrows by one employee; more are narrowed here.
                api.getAttendance({
                    startDate: dateRange?.from?.slice(0, 10) || undefined,
                    endDate: dateRange?.to?.slice(0, 10) || undefined,
                    employeeId: employeeIds.length === 1 ? employeeIds[0] : undefined,
                }),
                api.getEmployees(),
            ]);
            setRecords(recs ?? []);
            setEmployees(emps ?? []);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : a.emptyMessage);
        } finally {
            setLoading(false);
        }
    }, [dateRange, employeeIds, a.emptyMessage]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const statusLabels: Record<string, string> = useMemo(
        () => ({
            PRESENT: a.statuses.present,
            ABSENT: a.statuses.absent,
            HALF_DAY: a.statuses.halfDay,
            HOLIDAY: a.statuses.holiday,
        }),
        [a],
    );

    // Searched here rather than server-side, because the list is already
    // bounded by the date range and the endpoint takes no name filter.
    const visible = useMemo(
        () => records.filter((record) => matchesAnyOf(employeeIds, record.employee_id)
            && matchesAnyOf(statuses, record.status)
            && matchesSearch(search, record.employee?.name, record.employee?.employee_code, record.notes)),
        [records, employeeIds, statuses, search],
    );

    const filters = useMemo<ResolvedListFilter[]>(() => {
        const list: ListFilter[] = [
            {
                id: 'date',
                type: 'date-range',
                label: a.columns.date,
                value: dateRange,
                onChange: setDateRange,
                operators: true,
            },
            {
                id: 'employee',
                type: 'multi-select',
                label: a.columns.employee,
                value: employeeIds,
                onChange: setEmployeeIds,
                options: employees.map((emp) => ({ value: emp.id, label: `${emp.name} · ${emp.employee_code}` })),
            },
            {
                id: 'status',
                type: 'multi-select',
                label: a.columns.status,
                value: statuses,
                onChange: setStatuses,
                options: STATUSES.map((value) => ({ value, label: statusLabels[value] })),
            },
        ];
        return list as ResolvedListFilter[];
    }, [a, dateRange, employeeIds, employees, statuses, statusLabels]);

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const count = (status: string) => visible.filter((record) => record.status === status).length;
        const absent = count('ABSENT');
        const items: ListStat[] = [
            { id: 'records', icon: <Users aria-hidden />, label: t.hr.listUi.punches.records, value: n(visible.length) },
            { id: 'present', icon: <CalendarCheck aria-hidden />, label: a.statuses.present, value: n(count('PRESENT')) },
            {
                id: 'absent',
                icon: <CalendarX aria-hidden />,
                label: a.statuses.absent,
                value: n(absent),
                tone: absent > 0 ? 'warning' : 'default',
            },
            { id: 'halfDay', icon: <CalendarCheck aria-hidden />, label: a.statuses.halfDay, value: n(count('HALF_DAY')) },
            {
                id: 'worked',
                icon: <Clock aria-hidden />,
                label: a.worked,
                value: formatMinutes(visible.reduce((sum, record) => sum + (record.worked_minutes ?? 0), 0)),
            },
        ];
        return items;
    }, [visible, locale, a, t]);

    const days = useMemo(
        () =>
            groupRowsByDay(visible, (record) => dayKeyOfDate(record.date)).map((day) => {
                const counts = new Map<string, number>();
                let minutes = 0;
                for (const record of day.rows) {
                    counts.set(record.status, (counts.get(record.status) ?? 0) + 1);
                    minutes += record.worked_minutes ?? 0;
                }
                return { ...day, minutes, counts: [...counts.entries()] };
            }),
        [visible],
    );

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        try {
            await api.deleteAttendance(pendingDelete.id);
            toast.success(a.deleted);
            loadData();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : a.deleteFailed);
        } finally {
            setPendingDelete(null);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError('');
        try {
            const payload: Record<string, unknown> = {
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
        } catch (err) {
            setError(err instanceof Error ? err.message : a.logFailed);
        } finally {
            setSubmitting(false);
        }
    };

    const closeModal = () => {
        setShowModal(false);
        setForm(EMPTY_FORM);
        setError('');
    };

    return (
        <PageShell>
            <PageHeader
                title={a.title}
                subtitle={a.pageSubtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.hr,
                    a.title,
                    'hr',
                )}
                actions={(
                    <>
                        {/* The raw in/out log the rows below are derived from. */}
                        <Link href={routes.hr.attendancePunches}>
                            <Button variant="secondary" icon={<ArrowLeftRight className="h-4 w-4" />}>
                                {a.punchesLink}
                            </Button>
                        </Link>
                        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setShowModal(true)}>
                            {a.logAttendance}
                        </Button>
                    </>
                )}
            />

            <ListStats stats={stats} loading={loading} label={t.hr.listUi.attendanceStats} />

            <ListToolbar
                tableId="attendance-days"
                filters={filters}
                // Nothing to choose: the days are not a table, and there is no other layout.
                viewOptions={false}
                search={{ value: search, onChange: setSearch, placeholder: a.searchPlaceholder }}
            />

            <p className="text-xs text-gray-500">{a.workedHint}</p>

            {loading ? (
                <div className="space-y-2" aria-busy="true">
                    {[0, 1, 2].map((index) => (
                        <div key={index} className="h-16 animate-pulse rounded-lg bg-gray-100" />
                    ))}
                </div>
            ) : days.length === 0 ? (
                <div className="rounded-lg border border-gray-100 bg-white p-8 text-center text-sm text-gray-500">
                    {a.emptyMessage}
                </div>
            ) : (
                <div className="space-y-4">
                    {days.map((day) => (
                        <section
                            key={day.key}
                            className="overflow-hidden rounded-lg border border-gray-100 bg-white"
                        >
                            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h2 className="text-sm font-semibold text-gray-700">
                                        {dayHeading(day.key, {
                                            today: a.today,
                                            yesterday: a.yesterday,
                                        })}
                                    </h2>
                                    <ul className="flex flex-wrap items-center gap-1">
                                        {day.counts.map(([status, count]) => (
                                            <li key={status}>
                                                <StatusBadge tone={statusTones[status] ?? 'neutral'}>
                                                    {count} {statusLabels[status] ?? status.replace('_', ' ')}
                                                </StatusBadge>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                                <p className="flex items-baseline gap-1.5 text-xs text-gray-500">
                                    <span>{a.dayRecords.replace('{count}', String(day.rows.length))}</span>
                                    <span>·</span>
                                    <span>{a.worked}</span>
                                    <span className="text-sm font-semibold tabular-nums text-gray-900">
                                        {formatMinutes(day.minutes)}
                                    </span>
                                </p>
                            </header>

                            <ul className="divide-y divide-gray-100">
                                {day.rows.map((record) => (
                                    <li
                                        key={record.id}
                                        className="flex flex-col gap-2 px-3 py-2 transition-colors hover:bg-gray-50 md:flex-row md:items-center md:gap-3"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-medium text-gray-900">
                                                {record.employee?.name ?? '—'}
                                            </p>
                                            <p className="text-xs text-gray-400">
                                                {record.employee?.employee_code ?? ''}
                                            </p>
                                        </div>

                                        <span className="self-start md:self-auto">
                                            <StatusBadge tone={statusTones[record.status] ?? 'neutral'}>
                                                {statusLabels[record.status] ?? record.status.replace('_', ' ')}
                                            </StatusBadge>
                                        </span>

                                        <span className="w-28 text-xs tabular-nums text-gray-500">
                                            {formatTime(record.clock_in)} – {formatTime(record.clock_out)}
                                        </span>

                                        <span className="w-20 text-sm font-semibold tabular-nums text-gray-900">
                                            {formatMinutes(record.worked_minutes ?? 0)}
                                        </span>

                                        <p className="hidden min-w-0 flex-1 truncate text-xs text-gray-500 lg:block">
                                            {record.notes || ''}
                                        </p>

                                        <span className="self-end md:self-auto">
                                            <RowActionButton
                                                icon={<Trash2 />}
                                                label={a.deleteTitle}
                                                intent="danger"
                                                onClick={() => setPendingDelete(record)}
                                            />
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ))}
                </div>
            )}

            {showModal && (
                <ModalShell size="sm" onBackdropClick={closeModal}>
                    <ModalHeader title={a.logAttendance} onClose={closeModal} />

                    <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto p-4">
                        {error && <Alert tone="danger">{error}</Alert>}

                        <Field label={a.modal.employee} required htmlFor="attendance-employee">
                            <IdSearchSelect
                                id="attendance-employee"
                                items={employees}
                                value={form.employee_id}
                                onChange={(id) => setForm({ ...form, employee_id: id })}
                                placeholder={a.modal.selectEmployee}
                                emptyLabel={a.modal.selectEmployee}
                                noMatchLabel={t.common.noData}
                                subtitle={(emp) => emp.employee_code ?? ''}
                            />
                        </Field>

                        <Field label={a.modal.date} required htmlFor="attendance-date">
                            <Input
                                id="attendance-date"
                                required
                                type="date"
                                value={form.date}
                                onChange={(e) => setForm({ ...form, date: e.target.value })}
                            />
                        </Field>

                        <Field label={a.modal.status} htmlFor="attendance-status">
                            <Select
                                id="attendance-status"
                                value={form.status}
                                onChange={(e) => setForm({ ...form, status: e.target.value })}
                            >
                                <option value="PRESENT">{a.statuses.present}</option>
                                <option value="ABSENT">{a.statuses.absent}</option>
                                <option value="HALF_DAY">{a.statuses.halfDay}</option>
                                <option value="HOLIDAY">{a.statuses.holiday}</option>
                            </Select>
                        </Field>

                        <FormGrid>
                            <Field label={a.modal.clockIn} htmlFor="attendance-in">
                                <Input
                                    id="attendance-in"
                                    type="time"
                                    value={form.clock_in}
                                    onChange={(e) => setForm({ ...form, clock_in: e.target.value })}
                                />
                            </Field>
                            <Field label={a.modal.clockOut} htmlFor="attendance-out">
                                <Input
                                    id="attendance-out"
                                    type="time"
                                    value={form.clock_out}
                                    onChange={(e) => setForm({ ...form, clock_out: e.target.value })}
                                />
                            </Field>
                        </FormGrid>

                        <Field label={a.modal.notes} htmlFor="attendance-notes">
                            <Input
                                id="attendance-notes"
                                type="text"
                                value={form.notes}
                                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                                placeholder={a.modal.notesPlaceholder}
                            />
                        </Field>

                        <FormFooter>
                            <Button type="button" variant="secondary" onClick={closeModal}>
                                {t.common.cancel}
                            </Button>
                            <Button type="submit" loading={submitting}>
                                {submitting ? a.modal.submitting : t.common.save}
                            </Button>
                        </FormFooter>
                    </form>
                </ModalShell>
            )}

            <ConfirmDialog
                open={pendingDelete !== null}
                title={a.deleteTitle}
                prompt={a.deleteConfirm}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                danger
                onConfirm={confirmDelete}
                onCancel={() => setPendingDelete(null)}
            />
        </PageShell>
    );
}
