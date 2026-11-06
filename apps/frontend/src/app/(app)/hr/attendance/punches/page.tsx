'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, CalendarDays, Clock, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import { createdRangeFromPreset, type CreatedRange } from '@/lib/created-range';
import { matchesAnyOf, matchesSearch } from '@/lib/list-filter';
import { useI18n } from '@/lib/i18n';
import { useToastStore } from '@/lib/toast';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { PageShell, Button, Field, Input, Select, FormGrid, FormFooter, Alert, ConfirmDialog, StatusBadge } from '@/components/ui';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import { IdSearchSelect } from '@/components/document-entry/PartySearchSelect';

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

const DIRECTIONS = ['IN', 'OUT'] as const;
const SOURCES = ['SELF', 'ADMIN', 'IMPORT'] as const;

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
    const { t, locale } = useI18n();
    const copy = t.attendancePunches;
    const toast = useToastStore((state) => state.show);

    const [punches, setPunches] = useState<Punch[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    // Opens on this month, on the workspace's calendar; cleared, the whole log.
    const [dateRange, setDateRange] = useState<CreatedRange | null>(() => createdRangeFromPreset('thisMonth'));
    const [employeeIds, setEmployeeIds] = useState<string[]>([]);
    const [directions, setDirections] = useState<string[]>([]);
    const [sources, setSources] = useState<string[]>([]);
    const [search, setSearch] = useState('');

    const [modal, setModal] = useState<{ open: boolean; editing: Punch | null }>({ open: false, editing: null });
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');
    const [deleting, setDeleting] = useState<Punch | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [rows, emps] = await Promise.all([
                // The server narrows by one employee and one direction; more
                // than one of either is narrowed here, from the same rows.
                api.getAttendancePunches({
                    startDate: dateRange?.from?.slice(0, 10) || undefined,
                    endDate: dateRange?.to?.slice(0, 10) || undefined,
                    employeeId: employeeIds.length === 1 ? employeeIds[0] : undefined,
                    direction: directions.length === 1 ? (directions[0] as 'IN' | 'OUT') : undefined,
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
    }, [dateRange, employeeIds, directions, toast, copy.loadFailed]);

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
                        <span className="block">{punch.employee?.name ?? '—'}</span>
                        <span className="block text-gray-500">{punch.employee?.employee_code ?? ''}</span>
                    </div>
                );
            },
            size: 180,
        }),
        columnHelper.accessor('date', {
            header: copy.columns.date,
            cell: (info) => formatDate(info.getValue(), locale),
            size: 120,
        }),
        columnHelper.accessor('direction', {
            header: copy.columns.direction,
            cell: (info) => {
                const isIn = info.getValue() !== 'OUT';
                const Icon = isIn ? ArrowDownLeft : ArrowUpRight;
                return (
                    <StatusBadge tone={isIn ? 'success' : 'warning'}>
                        <Icon className="w-3 h-3" aria-hidden />
                        {directionLabels[info.getValue()] ?? info.getValue()}
                    </StatusBadge>
                );
            },
            size: 110,
        }),
        columnHelper.accessor('punched_at', {
            header: copy.columns.time,
            cell: (info) => <span className="tabular-nums">{formatClock(info.getValue())}</span>,
            size: 90,
        }),
        columnHelper.accessor('source', {
            header: copy.columns.source,
            cell: (info) => sourceLabels[info.getValue()] ?? info.getValue(),
            size: 100,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor('notes', {
            header: copy.columns.notes,
            cell: (info) => info.getValue() || '—',
            size: 180,
            meta: { hideOnMobile: true },
        }),
        columnHelper.display({
            id: 'actions',
            header: copy.columns.actions,
            cell: (info) => (
                <RowActions>
                    <RowActionButton icon={<Pencil />} label={t.common.edit} onClick={() => openModal(info.row.original)} />
                    <RowActionButton
                        icon={<Trash2 />}
                        label={t.common.delete}
                        intent="danger"
                        onClick={() => setDeleting(info.row.original)}
                    />
                </RowActions>
            ),
            enableSorting: false,
            enableColumnFilter: false,
            enableResizing: false,
            size: 90,
        }),
    ], [copy.columns, directionLabels, sourceLabels, t.common.edit, t.common.delete, locale]);

    const filtered = useMemo(
        () => punches.filter((p) => {
            if (!matchesAnyOf(employeeIds, p.employee_id)) return false;
            if (!matchesAnyOf(directions, p.direction)) return false;
            if (!matchesAnyOf(sources, p.source)) return false;
            return matchesSearch(search, p.employee?.name, p.employee?.employee_code, p.notes);
        }),
        [punches, employeeIds, directions, sources, search],
    );

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'date',
            type: 'date-range',
            label: copy.columns.date,
            value: dateRange,
            onChange: setDateRange,
            operators: true,
        },
        {
            id: 'employee',
            type: 'multi-select',
            label: copy.columns.employee,
            value: employeeIds,
            onChange: setEmployeeIds,
            options: employees.map((emp) => ({ value: emp.id, label: `${emp.name} · ${emp.employee_code}` })),
        },
        {
            id: 'direction',
            type: 'multi-select',
            label: copy.columns.direction,
            value: directions,
            onChange: setDirections,
            options: DIRECTIONS.map((value) => ({ value, label: directionLabels[value] })),
        },
        {
            id: 'source',
            type: 'multi-select',
            label: copy.columns.source,
            value: sources,
            onChange: setSources,
            options: SOURCES.map((value) => ({ value, label: sourceLabels[value] })),
        },
    ], [copy.columns, dateRange, employeeIds, employees, directions, directionLabels, sources, sourceLabels]);

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const ins = filtered.filter((p) => p.direction !== 'OUT').length;
        const items: ListStat[] = [
            { id: 'count', icon: <Clock aria-hidden />, label: t.hr.listUi.punches.records, value: n(filtered.length) },
            { id: 'in', icon: <ArrowDownLeft aria-hidden />, label: copy.directions.in, value: n(ins) },
            { id: 'out', icon: <ArrowUpRight aria-hidden />, label: copy.directions.out, value: n(filtered.length - ins) },
            {
                id: 'people',
                icon: <Users aria-hidden />,
                label: t.hr.listUi.punches.people,
                value: n(new Set(filtered.map((p) => p.employee_id)).size),
            },
            {
                id: 'days',
                icon: <CalendarDays aria-hidden />,
                label: t.hr.listUi.punches.days,
                value: n(new Set(filtered.map((p) => p.date.slice(0, 10))).size),
            },
        ];
        return { items, loading, label: t.hr.listUi.punches.statsLabel };
    }, [filtered, loading, locale, copy.directions, t]);

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

            <DataTable<Punch>
                tableId="attendance-punches"
                columns={columns}
                data={filtered}
                title={copy.recordsTitle}
                isLoading={loading}
                emptyMessage={copy.emptyMessage}
                emptyIcon={<Clock className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={copy.searchPlaceholder}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
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
                            <IdSearchSelect
                                id="punch-employee"
                                items={employees}
                                value={form.employee_id}
                                onChange={(id) => setForm({ ...form, employee_id: id })}
                                placeholder={copy.form.selectEmployee}
                                emptyLabel={copy.form.selectEmployee}
                                noMatchLabel={t.common.noData}
                                subtitle={(emp) => emp.employee_code ?? ''}
                                readOnly={Boolean(modal.editing)}
                            />
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

            <ConfirmDialog
                open={deleting !== null}
                title={copy.deleteTitle}
                prompt={copy.deleteConfirm}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                danger
                onConfirm={() => void confirmDelete()}
                onCancel={() => setDeleting(null)}
            />
        </PageShell>
    );
}
