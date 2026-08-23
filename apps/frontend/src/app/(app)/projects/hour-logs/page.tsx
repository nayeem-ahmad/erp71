'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BarChart3, ChevronLeft, ChevronRight } from 'lucide-react';
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
import TaskDetailPanel from '@/components/projects/TaskDetailPanel';
import HourLogCaptureBar, {
    type ManualLogInput,
    type RunningTimer,
} from '@/components/projects/HourLogCaptureBar';
import HourLogDayList, { type DayTotal } from '@/components/projects/HourLogDayList';
import { groupByDay, hoursOf, type HourLogEntry, type HourLogTag } from '@/components/projects/hour-log-day';
import { labelClass } from '@/components/projects/board-tasks';
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

interface ReportRow {
    key: string;
    hours: number;
    entries: number;
}

const EMPTY_FORM = {
    projectId: '',
    taskId: '',
    workDate: '',
    hours: '',
    startTime: '',
    endTime: '',
    note: '',
    tagIds: [] as string[],
};

/** A 409 from the overlap guard, as opposed to any other failure. */
const isOverlapConflict = (error: unknown): boolean =>
    error instanceof Error && /overlap/i.test(error.message);

const errorText = (error: unknown, fallback: string): string =>
    error instanceof Error ? error.message : fallback;

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
    const [tagId, setTagId] = useState('');
    const [projects, setProjects] = useState<ProjectOption[]>([]);
    const [people, setPeople] = useState<PersonOption[]>([]);
    const [tags, setTags] = useState<HourLogTag[]>([]);
    const [summary, setSummary] = useState<ReportSummary | null>(null);
    const [dayTotals, setDayTotals] = useState<Record<string, DayTotal>>({});
    const [openTaskId, setOpenTaskId] = useState<string | null>(null);

    // The capture bar's own project/task pair, separate from the filter above
    // the list: narrowing what you are reading should not change what you are
    // about to log against, and vice versa.
    const [captureProjectId, setCaptureProjectId] = useState('');
    const [captureTasks, setCaptureTasks] = useState<{ id: string; title: string }[]>([]);
    const [timer, setTimer] = useState<RunningTimer | null>(null);
    const [timerBusy, setTimerBusy] = useState(false);

    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<HourLogEntry | null>(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [formErrors, setFormErrors] = useState<{ taskId?: string; hours?: string; workDate?: string }>({});
    const [tasks, setTasks] = useState<{ id: string; title: string }[]>([]);
    const [saving, setSaving] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<HourLogEntry | null>(null);
    /** A save the overlap guard refused, held while we ask whether to keep both. */
    const [pendingOverlap, setPendingOverlap] = useState<{ message: string; retry: () => Promise<void> } | null>(null);

    useEffect(() => {
        const timeout = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timeout);
    }, [search]);

    useEffect(() => {
        api.getProjects({ limit: 100 })
            .then((res) => setProjects((res?.items ?? []) as ProjectOption[]))
            .catch(() => setProjects([]));
        api.getProjectTimeTags()
            .then((rows: unknown) => setTags(Array.isArray(rows) ? (rows as HourLogTag[]) : []))
            .catch(() => setTags([]));
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

    const { items, loading, total, page, pageSize, serverPagination, reload } =
        useServerList<HourLogEntry>({
            tableId: 'project-hour-logs',
            enabled: valid,
            initialSort: { id: 'work_date', desc: true },
            deps: [range.from, range.to, debouncedSearch, projectId, personId, tagId],
            fetch: (params) =>
                api.getProjectTimeEntries({
                    ...params,
                    from: range.from,
                    to: range.to,
                    search: debouncedSearch || undefined,
                    projectId: projectId || undefined,
                    userId: personId || undefined,
                    tagId: tagId || undefined,
                }),
        });

    // The totals strip and every day header come from the report aggregate, not
    // from `items`. Two reasons, and the second is the load-bearing one: the
    // strip has to cover the whole filtered set rather than the page on screen,
    // and a day split across a page boundary must still show the whole day's
    // hours in its header. Summing the rows in view would quietly report a
    // fraction of a day as the day.
    const loadSummary = useCallback(() => {
        if (!valid) return;
        api.getProjectTimeReport({
            from: range.from,
            to: range.to,
            groupBy: 'date',
            search: debouncedSearch || undefined,
            projectId: projectId || undefined,
            userId: personId || undefined,
            tagId: tagId || undefined,
        })
            .then((data: unknown) => {
                const report = data as { summary?: ReportSummary; rows?: ReportRow[] } | null;
                setSummary(report?.summary ?? null);
                setDayTotals(
                    Object.fromEntries(
                        (report?.rows ?? []).map((row) => [
                            row.key,
                            { hours: row.hours, entries: row.entries },
                        ]),
                    ),
                );
            })
            .catch(() => {
                setSummary(null);
                setDayTotals({});
            });
    }, [valid, range.from, range.to, debouncedSearch, projectId, personId, tagId]);

    useEffect(() => {
        loadSummary();
    }, [loadSummary]);

    const loadTimer = useCallback(() => {
        api.getProjectTimer()
            .then((data: unknown) => setTimer((data as RunningTimer) ?? null))
            .catch(() => setTimer(null));
    }, []);

    useEffect(() => {
        loadTimer();
    }, [loadTimer]);

    // The tasks the capture bar can start against.
    useEffect(() => {
        if (!captureProjectId) {
            setCaptureTasks([]);
            return;
        }
        let cancelled = false;
        api.getProjectTasks({ projectId: captureProjectId, limit: 200 })
            .then((res) => {
                if (!cancelled) setCaptureTasks((res?.items ?? []) as { id: string; title: string }[]);
            })
            .catch(() => {
                if (!cancelled) setCaptureTasks([]);
            });
        return () => {
            cancelled = true;
        };
    }, [captureProjectId]);

    const refresh = useCallback(async () => {
        await reload();
        loadSummary();
    }, [reload, loadSummary]);

    const days = useMemo(() => groupByDay(items), [items]);
    // Only worth a column when there is more than one person to tell apart.
    const showPerson = !personId && (summary?.people ?? 0) > 1;

    // ── The running clock ──────────────────────────────────────────────────

    /**
     * Every timer call goes through here: one busy flag so a double press
     * cannot double-write, one place that reports a failure, and a refetch
     * afterwards either way — a start that failed and a start that succeeded
     * both leave the bar needing to know what the server thinks is running.
     */
    const runTimerAction = async (
        action: () => Promise<unknown>,
        fallback: string,
    ): Promise<void> => {
        setTimerBusy(true);
        try {
            await action();
        } catch (error) {
            toast.error(errorText(error, fallback));
        } finally {
            setTimerBusy(false);
            loadTimer();
        }
    };

    const startTimer = (input: { taskId: string; note?: string; tagIds: string[] }) =>
        runTimerAction(async () => {
            await api.startProjectTimer(input);
            toast.success(hl.timerStarted);
        }, hl.timerStartFailed);

    const stopTimer = () =>
        runTimerAction(async () => {
            const result = (await api.stopProjectTimer()) as
                | { discarded?: boolean; overlap?: { taskTitle?: string | null } | null }
                | null;
            if (result?.discarded) {
                // Nothing was written. Saying "saved" here would be a lie, and
                // saying nothing leaves someone hunting for a missing entry.
                toast.info(hl.timerDiscardedShort);
            } else {
                toast.success(m.time.logged);
                if (result?.overlap) {
                    toast.info(
                        hl.timerOverlapped.replace('{task}', result.overlap.taskTitle ?? '—'),
                    );
                }
            }
            await refresh();
        }, hl.timerStopFailed);

    const discardTimer = () =>
        runTimerAction(async () => {
            await api.discardProjectTimer();
            toast.info(hl.timerDiscarded);
        }, hl.timerStopFailed);

    const patchTimer = (patch: { note?: string; tagIds?: string[] }) =>
        runTimerAction(() => api.updateProjectTimer(patch), hl.timerUpdateFailed);

    /**
     * Clockify's ▷ restarts the row. So does this: yesterday's afternoon is one
     * press away from being today's clock, with its note and tags carried over.
     * With a timer already running it says so rather than quietly starting a
     * second one or logging something the person did not ask for.
     */
    const logAgain = (entry: HourLogEntry) => {
        if (!entry.task) return;
        if (timer) {
            toast.info(hl.timerAlreadyRunning.replace('{task}', timer.task?.title ?? '—'));
            return;
        }
        void startTimer({
            taskId: entry.task.id,
            note: entry.note ?? undefined,
            tagIds: (entry.tags ?? []).map((tag) => tag.id),
        });
    };

    // ── Writes ─────────────────────────────────────────────────────────────

    /**
     * Runs a save, and when the overlap guard refuses it, holds the retry
     * behind a confirmation instead of failing outright. Keeping both is a
     * decision someone can make; being unable to fix a mistyped span is not.
     */
    const saveGuardingOverlap = async (
        attempt: (allowOverlap: boolean) => Promise<void>,
        fallback: string,
    ) => {
        try {
            await attempt(false);
        } catch (error) {
            if (isOverlapConflict(error)) {
                setPendingOverlap({
                    message: errorText(error, fallback),
                    retry: () => attempt(true),
                });
                return;
            }
            toast.error(errorText(error, fallback));
        }
    };

    const logManual = async (input: ManualLogInput) => {
        setTimerBusy(true);
        await saveGuardingOverlap(async (allowOverlap) => {
            await api.logProjectTime({
                taskId: input.taskId,
                workDate: input.workDate,
                hours: input.hours,
                startTime: input.startTime,
                endTime: input.endTime,
                note: input.note,
                tagIds: input.tagIds,
                ...(allowOverlap ? { allowOverlap: true } : {}),
            });
            toast.success(m.time.logged);
            await refresh();
        }, hl.logFailed);
        setTimerBusy(false);
    };

    /** The inline edits: one field, one PATCH, no modal. */
    const patchEntry = async (entry: HourLogEntry, patch: { hours?: number; note?: string }) => {
        try {
            await api.updateProjectTimeEntry(entry.id, patch);
            await refresh();
        } catch (error) {
            toast.error(errorText(error, hl.updateFailed));
            // Rethrown so the row can put back what it was showing.
            throw error;
        }
    };

    const openEdit = (entry: HourLogEntry) => {
        setEditing(entry);
        setForm({
            projectId: entry.project?.id ?? '',
            taskId: entry.task?.id ?? '',
            workDate: entry.work_date.slice(0, 10),
            hours: String(hoursOf(entry)),
            startTime: entry.start_time ?? '',
            endTime: entry.end_time ?? '',
            note: entry.note ?? '',
            tagIds: (entry.tags ?? []).map((tag) => tag.id),
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
        const timed = Boolean(form.startTime && form.endTime);
        const hours = Number(form.hours);
        const errors: typeof formErrors = {};
        if (!editing && !form.taskId) errors.taskId = t.common.required;
        if (!form.workDate) errors.workDate = t.common.required;
        // A span carries its own hours, so the box may be left empty; without
        // one it is the entry and has to be a number.
        if (!timed && (!Number.isFinite(hours) || hours <= 0)) errors.hours = t.common.required;
        setFormErrors(errors);
        if (Object.keys(errors).length > 0) return;

        setSaving(true);
        await saveGuardingOverlap(async (allowOverlap) => {
            if (editing) {
                await api.updateProjectTimeEntry(editing.id, {
                    workDate: form.workDate,
                    ...(timed ? {} : { hours }),
                    // `''` is what clears a span; sending both is what sets one.
                    startTime: form.startTime,
                    endTime: form.endTime,
                    note: form.note.trim(),
                    tagIds: form.tagIds,
                    ...(allowOverlap ? { allowOverlap: true } : {}),
                });
                toast.success(hl.updated);
            } else {
                await api.logProjectTime({
                    taskId: form.taskId,
                    workDate: form.workDate,
                    hours: timed ? (hours > 0 ? hours : 0.01) : hours,
                    startTime: form.startTime || undefined,
                    endTime: form.endTime || undefined,
                    note: form.note.trim() || undefined,
                    tagIds: form.tagIds,
                    ...(allowOverlap ? { allowOverlap: true } : {}),
                });
                toast.success(m.time.logged);
            }
            setFormOpen(false);
            await refresh();
        }, editing ? hl.updateFailed : hl.logFailed);
        setSaving(false);
    };

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        try {
            await api.deleteProjectTimeEntry(pendingDelete.id);
            toast.success(m.time.deleted);
            await refresh();
        } catch (error) {
            toast.error(errorText(error, hl.deleteFailed));
        } finally {
            setPendingDelete(null);
        }
    };

    const confirmOverlap = async () => {
        const pending = pendingOverlap;
        setPendingOverlap(null);
        if (!pending) return;
        try {
            await pending.retry();
        } catch (error) {
            toast.error(errorText(error, hl.logFailed));
        }
    };

    const toggleFormTag = (id: string) =>
        setForm((f) => ({
            ...f,
            tagIds: f.tagIds.includes(id)
                ? f.tagIds.filter((value) => value !== id)
                : [...f.tagIds, id],
        }));

    const lastPage = Math.max(1, Math.ceil(total / Math.max(pageSize, 1)));

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
                    <Link href={routes.projects.hourLogReport}>
                        <Button variant="secondary" className="min-h-touch">
                            <BarChart3 className="h-4 w-4" />
                            {hl.openReport}
                        </Button>
                    </Link>
                }
            />

            <HourLogCaptureBar
                labels={{
                    placeholder: hl.capturePlaceholder,
                    // Deliberately not the same names the filters below carry:
                    // two controls called "Project" on one screen, one choosing
                    // what you are reading and one choosing what you are about
                    // to log against, is ambiguous to anyone reading the labels
                    // aloud and to anyone reading them at all.
                    project: hl.captureProject,
                    task: hl.captureTask,
                    selectProject: m.task.selectProject,
                    selectTask: hl.selectTask,
                    selectProjectFirst: hl.selectProjectFirst,
                    noTasks: hl.noTasks,
                    tags: hl.tags,
                    noTags: hl.noTags,
                    start: hl.start,
                    stop: hl.stop,
                    discard: hl.discardTimer,
                    log: hl.logHours,
                    hours: m.time.hours,
                    date: m.time.workDate,
                    startTime: hl.startTime,
                    endTime: hl.endTime,
                    timerMode: hl.timerMode,
                    manualMode: hl.manualMode,
                    running: hl.running,
                }}
                projects={projects}
                tasks={captureTasks}
                tags={tags}
                timer={timer}
                busy={timerBusy}
                projectId={captureProjectId}
                onProjectChange={setCaptureProjectId}
                onStart={startTimer}
                onStop={stopTimer}
                onDiscard={discardTimer}
                onUpdateTimer={patchTimer}
                onLogManual={logManual}
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
                {tags.length > 0 ? (
                    <Select
                        value={tagId}
                        onChange={(e) => setTagId(e.target.value)}
                        className="md:w-40"
                        aria-label={hl.tags}
                    >
                        <option value="">{hl.allTags}</option>
                        {tags.map((tag) => (
                            <option key={tag.id} value={tag.id}>
                                {tag.name}
                            </option>
                        ))}
                    </Select>
                ) : null}
            </div>

            {!valid && <p className="text-sm text-red-600">{hl.rangeInvalid}</p>}

            <HourLogDayList
                days={days}
                dayTotals={dayTotals}
                showPerson={showPerson}
                loading={loading}
                labels={{
                    today: hl.today,
                    yesterday: hl.yesterday,
                    total: hl.total,
                    addDescription: hl.addDescription,
                    logAgain: hl.logAgain,
                    editEntry: hl.editEntry,
                    deleteEntry: hl.deleteEntry,
                    expand: hl.expandGroup,
                    collapse: hl.collapseGroup,
                    // "Duration", not "Hours": the capture bar above already
                    // owns that name for the box you type a figure into, and two
                    // controls with one accessible name is a screen nobody can
                    // navigate by label.
                    hours: hl.duration,
                    note: m.time.note,
                    unattributed: hl.unattributed,
                    empty: hl.empty,
                    partialDay: hl.partialDay,
                }}
                onLogAgain={logAgain}
                onEdit={openEdit}
                onDelete={setPendingDelete}
                onPatch={patchEntry}
                onOpenTask={setOpenTaskId}
            />

            {lastPage > 1 ? (
                <nav className="flex items-center justify-between gap-3" aria-label={hl.title}>
                    <p className="text-xs text-gray-500">
                        {hl.pageOf.replace('{page}', String(page)).replace('{pages}', String(lastPage))}
                    </p>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="secondary"
                            disabled={page <= 1}
                            onClick={() => serverPagination.onPageChange(page - 1)}
                            icon={<ChevronLeft className="h-4 w-4" />}
                        >
                            {hl.previous}
                        </Button>
                        <Button
                            variant="secondary"
                            disabled={page >= lastPage}
                            onClick={() => serverPagination.onPageChange(page + 1)}
                        >
                            {hl.next}
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </nav>
            ) : null}

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
                                    required={!(form.startTime && form.endTime)}
                                    htmlFor="hour-log-hours"
                                    error={formErrors.hours}
                                    hint={form.startTime && form.endTime ? hl.hoursFromSpan : undefined}
                                >
                                    <Input
                                        id="hour-log-hours"
                                        type="number"
                                        min="0.25"
                                        max="24"
                                        step="0.25"
                                        value={form.hours}
                                        disabled={Boolean(form.startTime && form.endTime)}
                                        error={Boolean(formErrors.hours)}
                                        onChange={(e) => {
                                            const value = e.target.value;
                                            setForm((f) => ({ ...f, hours: value }));
                                            setFormErrors((errors) => ({ ...errors, hours: undefined }));
                                        }}
                                    />
                                </Field>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label={hl.startTime} htmlFor="hour-log-start" hint={hl.spanHint}>
                                    <Input
                                        id="hour-log-start"
                                        type="time"
                                        value={form.startTime}
                                        onChange={(e) =>
                                            setForm((f) => ({ ...f, startTime: e.target.value }))
                                        }
                                    />
                                </Field>
                                <Field label={hl.endTime} htmlFor="hour-log-end">
                                    <Input
                                        id="hour-log-end"
                                        type="time"
                                        value={form.endTime}
                                        onChange={(e) =>
                                            setForm((f) => ({ ...f, endTime: e.target.value }))
                                        }
                                    />
                                </Field>
                            </div>
                            {tags.length > 0 ? (
                                <Field label={hl.tags}>
                                    <ul className="flex flex-wrap gap-1.5">
                                        {tags.map((tag) => {
                                            const on = form.tagIds.includes(tag.id);
                                            return (
                                                <li key={tag.id}>
                                                    <button
                                                        type="button"
                                                        aria-pressed={on}
                                                        onClick={() => toggleFormTag(tag.id)}
                                                        className={`min-h-touch rounded-md px-2 text-xs font-medium transition-opacity md:min-h-0 md:py-1 ${labelClass(tag.color)} ${
                                                            on ? '' : 'opacity-40'
                                                        }`}
                                                    >
                                                        {tag.name}
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </Field>
                            ) : null}
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

            <ConfirmDialog
                open={pendingOverlap !== null}
                title={hl.overlapTitle}
                prompt={`${pendingOverlap?.message ?? ''}\n\n${hl.overlapPrompt}`}
                confirmLabel={hl.overlapKeepBoth}
                cancelLabel={t.common.cancel}
                onConfirm={confirmOverlap}
                onCancel={() => setPendingOverlap(null)}
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
