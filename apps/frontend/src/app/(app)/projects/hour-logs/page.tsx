'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BarChart3, Pencil, Plus, Trash2 } from 'lucide-react';
import {
    PageShell,
    PageHeader,
    Button,
    Input,
    Select,
    Field,
    ConfirmDialog,
} from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import DataTable from '@/components/data-table/DataTable';
import TaskDetailPanel from '@/components/projects/TaskDetailPanel';
import { useServerList } from '@/hooks/useServerList';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import {
    HourLogRangeFilter,
    hourLogPresetRange,
    type HourLogRange,
    type HourLogRangePreset,
} from '@/components/projects/HourLogRangeFilter';

interface HourLogRow {
    id: string;
    work_date: string;
    hours: string | number;
    note?: string | null;
    task?: { id: string; title: string } | null;
    project?: { id: string; code: string; name: string } | null;
    user?: { id: string; name?: string | null; email: string } | null;
}

interface ProjectOption {
    id: string;
    code: string;
    name: string;
}

interface PersonOption {
    id: string;
    name: string | null;
    email: string | null;
}

interface ReportSummary {
    totalHours: number;
    entries: number;
    days: number;
    people: number;
    tasks: number;
}

const EMPTY_FORM = { projectId: '', taskId: '', workDate: '', hours: '', note: '' };

const hoursOf = (row: HourLogRow): number => Number(row.hours ?? 0);

/** A logged hour belongs to whoever entered it; historic rows can have lost their author. */
function personLabel(row: HourLogRow, fallback: string): string {
    if (!row.user) return fallback;
    return row.user.name || row.user.email;
}

export default function HourLogsPage() {
    const { t } = useI18n();
    const m = t.projects;
    const hl = m.hourLogs;

    const [preset, setPreset] = useState<HourLogRangePreset>('30');
    const [range, setRange] = useState<HourLogRange>(() => hourLogPresetRange('30'));
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [projectId, setProjectId] = useState('');
    const [personId, setPersonId] = useState('');
    const [projects, setProjects] = useState<ProjectOption[]>([]);
    const [people, setPeople] = useState<PersonOption[]>([]);
    const [summary, setSummary] = useState<ReportSummary | null>(null);
    const [openTaskId, setOpenTaskId] = useState<string | null>(null);

    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<HourLogRow | null>(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [formErrors, setFormErrors] = useState<{ taskId?: string; hours?: string; workDate?: string }>({});
    const [tasks, setTasks] = useState<{ id: string; title: string }[]>([]);
    const [saving, setSaving] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<HourLogRow | null>(null);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        api.getProjects({ limit: 100 })
            .then((res) => setProjects((res?.items ?? []) as ProjectOption[]))
            .catch(() => setProjects([]));
    }, []);

    // The person options come from the hours themselves rather than the team
    // roster: listing members needs MANAGE_USERS, which someone reading their
    // own timesheet has no reason to hold.
    useEffect(() => {
        let cancelled = false;
        api.getProjectTimePeople({ from: range.from, to: range.to, projectId: projectId || undefined })
            .then((rows: unknown) => {
                if (!cancelled) setPeople(Array.isArray(rows) ? (rows as PersonOption[]) : []);
            })
            .catch(() => {
                if (!cancelled) setPeople([]);
            });
        return () => {
            cancelled = true;
        };
    }, [range.from, range.to, projectId]);

    const valid = range.from <= range.to;

    const { items, loading, serverPagination, reload } = useServerList<HourLogRow>({
        tableId: 'project-hour-logs',
        enabled: valid,
        initialSort: { id: 'work_date', desc: true },
        deps: [range.from, range.to, debouncedSearch, projectId, personId],
        fetch: (params) =>
            api.getProjectTimeEntries({
                ...params,
                from: range.from,
                to: range.to,
                search: debouncedSearch || undefined,
                projectId: projectId || undefined,
                userId: personId || undefined,
            }),
    });

    // The totals strip has to cover the whole filtered set, not the page on
    // screen, so it comes from the report aggregate rather than from `items`.
    // It carries every filter the list does — a strip that ignored the search
    // box would contradict the rows under it.
    const loadSummary = useCallback(() => {
        if (!valid) return;
        api.getProjectTimeReport({
            from: range.from,
            to: range.to,
            groupBy: 'date',
            search: debouncedSearch || undefined,
            projectId: projectId || undefined,
            userId: personId || undefined,
        })
            .then((data: unknown) => setSummary((data as { summary: ReportSummary })?.summary ?? null))
            .catch(() => setSummary(null));
    }, [valid, range.from, range.to, debouncedSearch, projectId, personId]);

    useEffect(() => {
        loadSummary();
    }, [loadSummary]);

    const refresh = useCallback(async () => {
        await reload();
        loadSummary();
    }, [reload, loadSummary]);

    const openCreate = () => {
        const project = projectId || (projects.length === 1 ? projects[0].id : '');
        setEditing(null);
        setForm({ ...EMPTY_FORM, projectId: project, workDate: new Date().toISOString().slice(0, 10) });
        setFormErrors({});
        setFormOpen(true);
    };

    const openEdit = (row: HourLogRow) => {
        setEditing(row);
        setForm({
            projectId: row.project?.id ?? '',
            taskId: row.task?.id ?? '',
            workDate: row.work_date.slice(0, 10),
            hours: String(hoursOf(row)),
            note: row.note ?? '',
        });
        setFormErrors({});
        setFormOpen(true);
    };

    // Only for the create form: an edit keeps whatever task the entry already
    // has, because moving hours between tasks is a different operation.
    useEffect(() => {
        if (!formOpen || editing || !form.projectId) {
            setTasks([]);
            return;
        }
        let cancelled = false;
        api.getProjectTasks({ projectId: form.projectId, limit: 200 })
            .then((res) => {
                if (!cancelled) setTasks((res?.items ?? []) as { id: string; title: string }[]);
            })
            .catch(() => {
                if (!cancelled) setTasks([]);
            });
        return () => {
            cancelled = true;
        };
    }, [formOpen, editing, form.projectId]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const hours = Number(form.hours);
        const errors: typeof formErrors = {};
        if (!editing && !form.taskId) errors.taskId = t.common.required;
        if (!form.workDate) errors.workDate = t.common.required;
        if (!Number.isFinite(hours) || hours <= 0) errors.hours = t.common.required;
        setFormErrors(errors);
        if (Object.keys(errors).length > 0) return;

        setSaving(true);
        try {
            if (editing) {
                await api.updateProjectTimeEntry(editing.id, {
                    workDate: form.workDate,
                    hours,
                    note: form.note.trim(),
                });
                toast.success(hl.updated);
            } else {
                await api.logProjectTime({
                    taskId: form.taskId,
                    workDate: form.workDate,
                    hours,
                    note: form.note.trim() || undefined,
                });
                toast.success(m.time.logged);
            }
            setFormOpen(false);
            await refresh();
        } catch (error) {
            const fallback = editing ? hl.updateFailed : hl.logFailed;
            toast.error(error instanceof Error ? error.message : fallback);
        } finally {
            setSaving(false);
        }
    };

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        try {
            await api.deleteProjectTimeEntry(pendingDelete.id);
            toast.success(m.time.deleted);
            await refresh();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : hl.deleteFailed);
        } finally {
            setPendingDelete(null);
        }
    };

    const columns = useMemo(
        () => [
            {
                id: 'work_date',
                header: m.time.workDate,
                accessorKey: 'work_date',
                cell: ({ row }: { row: { original: HourLogRow } }) =>
                    new Date(row.original.work_date).toLocaleDateString(),
            },
            {
                id: 'task',
                header: m.fields.tasks,
                accessorFn: (row: HourLogRow) => row.task?.title ?? '',
                cell: ({ row }: { row: { original: HourLogRow } }) =>
                    row.original.task ? (
                        <button
                            type="button"
                            className="text-left font-medium text-blue-600 hover:underline"
                            onClick={() => setOpenTaskId(row.original.task!.id)}
                        >
                            {row.original.task.title}
                        </button>
                    ) : (
                        '—'
                    ),
            },
            {
                id: 'project',
                header: m.fields.project,
                accessorFn: (row: HourLogRow) => row.project?.code ?? '',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: HourLogRow } }) =>
                    row.original.project
                        ? `${row.original.project.code} · ${row.original.project.name}`
                        : '—',
            },
            {
                id: 'person',
                header: hl.person,
                accessorFn: (row: HourLogRow) => personLabel(row, hl.unattributed),
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: HourLogRow } }) =>
                    personLabel(row.original, hl.unattributed),
            },
            {
                id: 'hours',
                header: m.time.hours,
                accessorFn: (row: HourLogRow) => hoursOf(row),
                cell: ({ row }: { row: { original: HourLogRow } }) => (
                    <span className="font-medium tabular-nums">{hoursOf(row.original).toFixed(2)}</span>
                ),
            },
            {
                id: 'note',
                header: m.time.note,
                accessorFn: (row: HourLogRow) => row.note ?? '',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: HourLogRow } }) => row.original.note || '—',
            },
            {
                id: 'actions',
                header: m.fields.actions,
                cell: ({ row }: { row: { original: HourLogRow } }) => (
                    <div className="flex items-center justify-end gap-1">
                        <button
                            type="button"
                            aria-label={hl.editEntry}
                            title={hl.editEntry}
                            onClick={() => openEdit(row.original)}
                            className="min-h-touch min-w-touch rounded-lg p-1.5 text-blue-600 transition-colors hover:bg-blue-50"
                        >
                            <Pencil className="mx-auto h-4 w-4" />
                        </button>
                        <button
                            type="button"
                            aria-label={hl.deleteEntry}
                            title={hl.deleteEntry}
                            onClick={() => setPendingDelete(row.original)}
                            className="min-h-touch min-w-touch rounded-lg p-1.5 text-red-600 transition-colors hover:bg-red-50"
                        >
                            <Trash2 className="mx-auto h-4 w-4" />
                        </button>
                    </div>
                ),
            },
        ],
        [m, hl],
    );

    return (
        <PageShell>
            <PageHeader
                title={hl.title}
                subtitle={hl.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.projects,
                    hl.title,
                    'projects',
                )}
                actions={
                    <>
                        <Link href={routes.projects.hourLogReport}>
                            <Button variant="secondary" className="min-h-touch">
                                <BarChart3 className="h-4 w-4" />
                                {hl.openReport}
                            </Button>
                        </Link>
                        <Button className="min-h-touch" onClick={openCreate}>
                            <Plus className="h-4 w-4" />
                            {hl.logHours}
                        </Button>
                    </>
                }
            />

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <SummaryTile label={m.time.totalHours} value={(summary?.totalHours ?? 0).toFixed(2)} accent />
                <SummaryTile label={m.hourLogReport.entries} value={String(summary?.entries ?? 0)} />
                <SummaryTile label={m.hourLogReport.days} value={String(summary?.days ?? 0)} />
                <SummaryTile label={m.hourLogReport.people} value={String(summary?.people ?? 0)} />
            </div>

            <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
                <HourLogRangeFilter
                    preset={preset}
                    range={range}
                    onPresetChange={setPreset}
                    onRangeChange={setRange}
                    labels={{
                        from: hl.from,
                        to: hl.to,
                        preset7: hl.preset7,
                        preset30: hl.preset30,
                        presetMonth: hl.presetMonth,
                        presetCustom: hl.presetCustom,
                    }}
                />
                <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={hl.searchPlaceholder}
                    className="md:max-w-xs"
                />
                <Select
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="md:w-52"
                    aria-label={m.fields.project}
                >
                    <option value="">{hl.allProjects}</option>
                    {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                            {project.code} · {project.name}
                        </option>
                    ))}
                </Select>
                <Select
                    value={personId}
                    onChange={(e) => setPersonId(e.target.value)}
                    className="md:w-48"
                    aria-label={hl.person}
                >
                    <option value="">{hl.allPeople}</option>
                    <option value="me">{hl.mine}</option>
                    {people.map((person) => (
                        <option key={person.id} value={person.id}>
                            {person.name || person.email}
                        </option>
                    ))}
                </Select>
            </div>

            {!valid && <p className="text-sm text-red-600">{hl.rangeInvalid}</p>}

            <DataTable
                title={hl.title}
                tableId="project-hour-logs"
                columns={columns as never}
                data={items}
                isLoading={loading}
                serverPagination={serverPagination}
                // The box above queries the server; the built-in one would only
                // sift the page already fetched, which reads as the same control.
                showSearch={false}
                emptyMessage={hl.empty}
            />

            {formOpen && (
                <ModalShell onBackdropClick={() => setFormOpen(false)}>
                    <form onSubmit={submit}>
                        <ModalHeader
                            title={editing ? hl.editEntry : hl.logHours}
                            onClose={() => setFormOpen(false)}
                        />
                        <div className="space-y-3 p-3 md:p-4">
                            {editing ? (
                                <Field label={m.fields.tasks}>
                                    <p className="text-sm text-gray-700">{editing.task?.title ?? '—'}</p>
                                </Field>
                            ) : (
                                <>
                                    <Field label={m.fields.project} required htmlFor="hour-log-project">
                                        <Select
                                            id="hour-log-project"
                                            value={form.projectId}
                                            disabled={projects.length === 0}
                                            onChange={(e) =>
                                                setForm((f) => ({ ...f, projectId: e.target.value, taskId: '' }))
                                            }
                                        >
                                            <option value="">{m.task.selectProject}</option>
                                            {projects.map((project) => (
                                                <option key={project.id} value={project.id}>
                                                    {project.code} · {project.name}
                                                </option>
                                            ))}
                                        </Select>
                                    </Field>
                                    <Field
                                        label={m.fields.tasks}
                                        required
                                        htmlFor="hour-log-task"
                                        error={formErrors.taskId}
                                        hint={
                                            !form.projectId
                                                ? hl.selectProjectFirst
                                                : tasks.length === 0
                                                  ? hl.noTasks
                                                  : undefined
                                        }
                                    >
                                        <Select
                                            id="hour-log-task"
                                            value={form.taskId}
                                            error={Boolean(formErrors.taskId)}
                                            disabled={!form.projectId || tasks.length === 0}
                                            onChange={(e) => {
                                                const value = e.target.value;
                                                setForm((f) => ({ ...f, taskId: value }));
                                                setFormErrors((errors) => ({ ...errors, taskId: undefined }));
                                            }}
                                        >
                                            <option value="">{hl.selectTask}</option>
                                            {tasks.map((task) => (
                                                <option key={task.id} value={task.id}>
                                                    {task.title}
                                                </option>
                                            ))}
                                        </Select>
                                    </Field>
                                </>
                            )}
                            <div className="grid grid-cols-2 gap-3">
                                <Field
                                    label={m.time.workDate}
                                    required
                                    htmlFor="hour-log-date"
                                    error={formErrors.workDate}
                                >
                                    <Input
                                        id="hour-log-date"
                                        type="date"
                                        value={form.workDate}
                                        error={Boolean(formErrors.workDate)}
                                        onChange={(e) => {
                                            const value = e.target.value;
                                            setForm((f) => ({ ...f, workDate: value }));
                                            setFormErrors((errors) => ({ ...errors, workDate: undefined }));
                                        }}
                                    />
                                </Field>
                                <Field
                                    label={m.time.hours}
                                    required
                                    htmlFor="hour-log-hours"
                                    error={formErrors.hours}
                                >
                                    <Input
                                        id="hour-log-hours"
                                        type="number"
                                        min="0.25"
                                        max="24"
                                        step="0.25"
                                        value={form.hours}
                                        error={Boolean(formErrors.hours)}
                                        onChange={(e) => {
                                            const value = e.target.value;
                                            setForm((f) => ({ ...f, hours: value }));
                                            setFormErrors((errors) => ({ ...errors, hours: undefined }));
                                        }}
                                    />
                                </Field>
                            </div>
                            <Field label={m.time.note} htmlFor="hour-log-note">
                                <Input
                                    id="hour-log-note"
                                    value={form.note}
                                    maxLength={500}
                                    onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                                />
                            </Field>
                        </div>
                        <ModalFooter>
                            <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>
                                {t.common.cancel}
                            </Button>
                            <Button type="submit" disabled={saving}>
                                {t.common.save}
                            </Button>
                        </ModalFooter>
                    </form>
                </ModalShell>
            )}

            <ConfirmDialog
                open={pendingDelete !== null}
                title={hl.deleteEntry}
                prompt={hl.deletePrompt
                    .replace('{hours}', pendingDelete ? hoursOf(pendingDelete).toFixed(2) : '')
                    .replace(
                        '{date}',
                        pendingDelete ? new Date(pendingDelete.work_date).toLocaleDateString() : '',
                    )}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                danger
                onConfirm={confirmDelete}
                onCancel={() => setPendingDelete(null)}
            />

            {openTaskId && (
                <TaskDetailPanel
                    taskId={openTaskId}
                    onClose={() => setOpenTaskId(null)}
                    onChanged={refresh}
                />
            )}
        </PageShell>
    );
}

function SummaryTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
    return (
        <div className="rounded-lg border border-gray-100 bg-white p-3">
            <div className="text-xs font-medium text-gray-500">{label}</div>
            <div
                className={`mt-1 text-xl font-semibold tabular-nums ${accent ? 'text-blue-600' : 'text-gray-900'}`}
            >
                {value}
            </div>
        </div>
    );
}
