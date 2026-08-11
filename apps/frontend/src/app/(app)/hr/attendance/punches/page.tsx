'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Clock, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { useI18n } from '@/lib/i18n';
import { useToastStore } from '@/lib/toast';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { PageShell, Button, Field, Input, Select, FormGrid, FormFooter, Alert } from '@/components/ui';
import ModalShell, { ModalHeader } from '@/components/ModalShell';

/**
 * In/out records — the raw punch log behind the attendance day rows.
 *
 * Attendance keeps one arrival and one departure per day, which cannot describe
 * a midday errand, a split shift, or a time typed at the wrong hour. This screen
 * edits the individual taps; the server rebuilds the day from them, taking the
 * **first IN as the clock-in and the last OUT as the clock-out**, so a
 * correction here always reaches the attendance report and the two can never
 * disagree.
 */

interface Employee {
    id: string;
    employee_code: string;
    name: string;
}

interface Punch {
    id: string;
    employee_id: string;
    date: string;
    punched_at: string;
    direction: 'IN' | 'OUT' | string;
    source: string;
    notes?: string | null;
    employee?: { id: string; name: string; employee_code: string } | null;
}

function getMonthRange() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
    return {
        start: `${year}-${month}-01`,
        end: `${year}-${month}-${String(lastDay).padStart(2, '0')}`,
    };
}

/** The `YYYY-MM-DD` and `HH:MM` halves of a stored punch, for the form. */
function splitMoment(value: string): { date: string; time: string } {
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) return { date: '', time: '' };
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
        date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
        time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
    };
}

function formatClock(value: string): string {
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) return '—';
    return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

const columnHelper = createColumnHelper<Punch>();

const EMPTY_FORM = { employee_id: '', date: '', time: '', direction: 'IN' as 'IN' | 'OUT', notes: '' };

export default function AttendancePunchesPage() {
    const { t } = useI18n();
    const copy = t.attendancePunches;
    const toast = useToastStore((state) => state.show);
    const range = getMonthRange();

    const [punches, setPunches] = useState<Punch[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [startDate, setStartDate] = useState(range.start);
    const [endDate, setEndDate] = useState(range.end);
    const [filterEmployee, setFilterEmployee] = useState('');
    const [filterDirection, setFilterDirection] = useState('');

    const [modal, setModal] = useState<{ open: boolean; editing: Punch | null }>({ open: false, editing: null });
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');
    const [deleting, setDeleting] = useState<Punch | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [rows, emps] = await Promise.all([
                api.getAttendancePunches({
                    startDate: startDate || undefined,
                    endDate: endDate || undefined,
                    employeeId: filterEmployee || undefined,
                    direction: (filterDirection as 'IN' | 'OUT') || undefined,
                }),
                api.getEmployees(),
            ]);
            setPunches(rows ?? []);
            setEmployees(emps ?? []);
        } catch (err: any) {
            toast('error', err?.message || copy.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [startDate, endDate, filterEmployee, filterDirection, toast, copy.loadFailed]);

    useEffect(() => { load(); }, [load]);

    const openModal = (editing: Punch | null) => {
        setFormError('');
        if (editing) {
            const { date, time } = splitMoment(editing.punched_at);
            setForm({
                employee_id: editing.employee_id,
                date,
                time,
                direction: editing.direction === 'OUT' ? 'OUT' : 'IN',
                notes: editing.notes ?? '',
            });
        } else {
            setForm({ ...EMPTY_FORM, date: new Date().toISOString().slice(0, 10) });
        }
        setModal({ open: true, editing });
    };

    const closeModal = () => {
        setModal({ open: false, editing: null });
        setForm(EMPTY_FORM);
        setFormError('');
    };

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError('');

        if (!form.date || !form.time) {
            setFormError(copy.form.timeRequired);
            return;
        }

        // Sent without a zone on purpose: the schedule this is judged against is
        // stored as minutes from local midnight, so the wall-clock reading is
        // the one that has to survive the round trip.
        const punchedAt = `${form.date}T${form.time}:00`;
        setSaving(true);
        try {
            if (modal.editing) {
                await api.updateAttendancePunch(modal.editing.id, {
                    punched_at: punchedAt,
                    direction: form.direction,
                    notes: form.notes,
                });
                toast('success', copy.updated);
            } else {
                await api.createAttendancePunch({
                    employee_id: form.employee_id,
                    punched_at: punchedAt,
                    direction: form.direction,
                    notes: form.notes || undefined,
                });
                toast('success', copy.created);
            }
            closeModal();
            await load();
        } catch (err: any) {
            setFormError(err?.message || copy.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const confirmDelete = async () => {
        if (!deleting) return;
        try {
            await api.deleteAttendancePunch(deleting.id);
            toast('success', copy.deleted);
            setDeleting(null);
            await load();
        } catch (err: any) {
            toast('error', err?.message || copy.deleteFailed);
        }
    };

    const directionLabels: Record<string, string> = useMemo(() => ({
        IN: copy.directions.in,
        OUT: copy.directions.out,
    }), [copy.directions]);

    const sourceLabels: Record<string, string> = useMemo(() => ({
        ADMIN: copy.sources.admin,
        SELF: copy.sources.self,
        IMPORT: copy.sources.import,
    }), [copy.sources]);

    const columns: ColumnDef<Punch, any>[] = useMemo(() => [
        columnHelper.accessor((row) => row.employee?.name ?? '', {
            id: 'employee',
            header: copy.columns.employee,
            cell: (info) => {
                const punch = info.row.original;
                return (
                    <div>
                        <span className="block text-sm font-semibold text-gray-900">{punch.employee?.name ?? '—'}</span>
                        <span className="block text-xs text-gray-400 font-mono">{punch.employee?.employee_code ?? ''}</span>
                    </div>
                );
            },
            size: 180,
        }),
        columnHelper.accessor('date', {
            header: copy.columns.date,
            cell: (info) => <span className="text-sm text-gray-700">{formatDate(info.getValue())}</span>,
            size: 120,
        }),
        columnHelper.accessor('direction', {
            header: copy.columns.direction,
            cell: (info) => {
                const isIn = info.getValue() !== 'OUT';
                const cls = isIn
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200';
                const Icon = isIn ? ArrowDownLeft : ArrowUpRight;
                return (
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${cls}`}>
                        <Icon className="w-3 h-3" />
                        {directionLabels[info.getValue()] ?? info.getValue()}
                    </span>
                );
            },
            size: 110,
        }),
        columnHelper.accessor('punched_at', {
            header: copy.columns.time,
            cell: (info) => <span className="text-sm text-gray-700 font-mono">{formatClock(info.getValue())}</span>,
            size: 90,
        }),
        columnHelper.accessor('source', {
            header: copy.columns.source,
            cell: (info) => (
                <span className="text-xs text-gray-500">{sourceLabels[info.getValue()] ?? info.getValue()}</span>
            ),
            size: 100,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor('notes', {
            header: copy.columns.notes,
            cell: (info) => <span className="text-sm text-gray-500">{info.getValue() || '—'}</span>,
            size: 180,
            meta: { hideOnMobile: true },
        }),
        columnHelper.display({
            id: 'actions',
            header: copy.columns.actions,
            cell: (info) => (
                <div className="flex items-center justify-end gap-1">
                    <button
                        type="button"
                        onClick={() => openModal(info.row.original)}
                        className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                        title={t.common.edit}
                    >
                        <Pencil className="w-4 h-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => setDeleting(info.row.original)}
                        className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                        title={t.common.delete}
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            ),
            enableSorting: false,
            size: 90,
        }),
    ], [copy.columns, directionLabels, sourceLabels, t.common.edit, t.common.delete]);

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={nestedPageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.hr,
                    'hr',
                    [{ label: t.attendance.title, href: routes.hr.attendance }],
                    copy.title,
                )}
                actions={(
                    <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => openModal(null)}>
                        {copy.addPunch}
                    </Button>
                )}
            />

            <Alert tone="info">{copy.derivationNote}</Alert>

            <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-3 md:p-4">
                <div className="flex flex-wrap gap-3 items-end">
                    <Field label={copy.filters.from} htmlFor="punch-filter-from">
                        <Input id="punch-filter-from" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                    </Field>
                    <Field label={copy.filters.to} htmlFor="punch-filter-to">
                        <Input id="punch-filter-to" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                    </Field>
                    <Field label={copy.columns.employee} htmlFor="punch-filter-employee">
                        <Select id="punch-filter-employee" value={filterEmployee} onChange={(e) => setFilterEmployee(e.target.value)}>
                            <option value="">{copy.filters.allEmployees}</option>
                            {employees.map((emp) => (
                                <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_code})</option>
                            ))}
                        </Select>
                    </Field>
                    <Field label={copy.columns.direction} htmlFor="punch-filter-direction">
                        <Select id="punch-filter-direction" value={filterDirection} onChange={(e) => setFilterDirection(e.target.value)}>
                            <option value="">{copy.filters.allDirections}</option>
                            <option value="IN">{copy.directions.in}</option>
                            <option value="OUT">{copy.directions.out}</option>
                        </Select>
                    </Field>
                </div>
            </div>

            <DataTable<Punch>
                tableId="attendance-punches"
                columns={columns}
                data={punches}
                title={copy.recordsTitle}
                isLoading={loading}
                emptyMessage={copy.emptyMessage}
                emptyIcon={<Clock className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={copy.searchPlaceholder}
            />

            {modal.open && (
                <ModalShell size="sm" onBackdropClick={closeModal}>
                    <ModalHeader
                        title={modal.editing ? copy.form.editTitle : copy.form.addTitle}
                        onClose={closeModal}
                    />

                    <form onSubmit={save} className="p-4 space-y-4 overflow-y-auto">
                        {formError && <Alert tone="danger">{formError}</Alert>}

                        <Field label={copy.columns.employee} htmlFor="punch-employee" required>
                            <Select
                                id="punch-employee"
                                required
                                value={form.employee_id}
                                disabled={Boolean(modal.editing)}
                                onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                            >
                                <option value="">{copy.form.selectEmployee}</option>
                                {employees.map((emp) => (
                                    <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_code})</option>
                                ))}
                            </Select>
                        </Field>

                        <FormGrid>
                            <Field label={copy.columns.date} htmlFor="punch-date" required>
                                <Input
                                    id="punch-date"
                                    required
                                    type="date"
                                    value={form.date}
                                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                                />
                            </Field>
                            <Field label={copy.columns.time} htmlFor="punch-time" required>
                                <Input
                                    id="punch-time"
                                    required
                                    type="time"
                                    value={form.time}
                                    onChange={(e) => setForm({ ...form, time: e.target.value })}
                                />
                            </Field>
                        </FormGrid>

                        <Field label={copy.columns.direction} htmlFor="punch-direction" required>
                            <Select
                                id="punch-direction"
                                value={form.direction}
                                onChange={(e) => setForm({ ...form, direction: e.target.value as 'IN' | 'OUT' })}
                            >
                                <option value="IN">{copy.directions.in}</option>
                                <option value="OUT">{copy.directions.out}</option>
                            </Select>
                        </Field>

                        <Field label={copy.columns.notes} htmlFor="punch-notes">
                            <Input
                                id="punch-notes"
                                type="text"
                                value={form.notes}
                                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                                placeholder={copy.form.notesPlaceholder}
                            />
                        </Field>

                        <FormFooter>
                            <Button type="button" variant="secondary" onClick={closeModal}>
                                {t.common.cancel}
                            </Button>
                            <Button type="submit" variant="primary" loading={saving}>
                                {t.common.save}
                            </Button>
                        </FormFooter>
                    </form>
                </ModalShell>
            )}

            {deleting && (
                <ModalShell size="sm" onBackdropClick={() => setDeleting(null)}>
                    <ModalHeader title={copy.deleteTitle} onClose={() => setDeleting(null)} />
                    <div className="p-4 space-y-4">
                        <p className="text-sm text-gray-600">{copy.deleteConfirm}</p>
                        <FormFooter>
                            <Button type="button" variant="secondary" onClick={() => setDeleting(null)}>
                                {t.common.cancel}
                            </Button>
                            <Button type="button" variant="danger" onClick={confirmDelete}>
                                {t.common.delete}
                            </Button>
                        </FormFooter>
                    </div>
                </ModalShell>
            )}
        </PageShell>
    );
}
