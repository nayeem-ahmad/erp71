'use client';

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Paperclip, Play, Square, Trash2 } from 'lucide-react';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { formatDate, formatDateTime } from '@/lib/format';
import {
    Button,
    Checkbox,
    Input,
    RichTextEditor,
    Select,
    Textarea,
    Field,
    StatusBadge,
} from '@/components/ui';
import {
    coverClass,
    labelClass,
    labelsOf,
    LABEL_COLORS,
    type ProjectLabel,
    type ProjectLabelColor,
} from '@/components/projects/board-tasks';
import {
    actorName,
    describeActivity,
    mergeFeed,
    type FeedEntry,
} from '@/components/projects/task-activity';
import RemainingHoursChart from '@/components/projects/RemainingHoursChart';
import CollapsibleSection from '@/components/projects/CollapsibleSection';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';

interface RemainingLog {
    id: string;
    previous_hours?: string | null;
    new_hours: string;
    delta: string;
    source: string;
    note?: string | null;
    changed_at: string;
    user?: { id: string; name?: string | null; email: string } | null;
}

interface TimeEntry {
    id: string;
    work_date: string;
    hours: string;
    note?: string | null;
    user?: { id: string; name?: string | null } | null;
}

interface ChecklistItem {
    id: string;
    text: string;
    is_done: boolean;
    sort_order: number;
}

interface Task {
    id: string;
    title: string;
    description?: string | null;
    estimate_hours?: string | null;
    remaining_hours?: string | null;
    logged_hours?: number;
    start_date?: string | null;
    due_date?: string | null;
    project?: { id: string; code: string; name: string } | null;
    status?: { id: string; name: string; category: string };
    assignee?: { id: string; name?: string | null; email: string } | null;
    // Phase 2 made an employee without a login assignable, so "who holds this"
    // is two columns and anything that reads one has to read the other.
    assigneeEmployee?: { id: string; name?: string | null } | null;
    labels?: { label: ProjectLabel }[];
    checklistItems?: ChecklistItem[];
    cover_color?: ProjectLabelColor | null;
    timeEntries?: TimeEntry[];
    /** From `TASK_INCLUDE`; lets the collapsed feed say how much it holds. */
    _count?: { comments?: number; subtasks?: number };
}

/** A row of the project roster, which is where the assignee options come from. */
interface ProjectMemberRow {
    id: string;
    user?: { id: string; name?: string | null; email: string } | null;
    employee?: { id: string; name: string } | null;
}

interface AssigneeOption {
    value: string;
    label: string;
}

/**
 * One key space for both assignee columns, so the picker is a single select
 * rather than two that can contradict each other.
 */
const assigneeValueOf = (task: Task): string => {
    if (task.assignee) return `user:${task.assignee.id}`;
    if (task.assigneeEmployee) return `employee:${task.assigneeEmployee.id}`;
    return '';
};

function assigneeOptionsFor(members: ProjectMemberRow[], task: Task): AssigneeOption[] {
    const options: AssigneeOption[] = [];
    const seen = new Set<string>();
    const push = (value: string, label: string) => {
        if (seen.has(value)) return;
        seen.add(value);
        options.push({ value, label });
    };

    for (const member of members) {
        if (member.user) push(`user:${member.user.id}`, member.user.name || member.user.email);
        else if (member.employee) push(`employee:${member.employee.id}`, member.employee.name);
    }

    // Whoever holds the card is listed even if they have since left the project.
    // Without this the select would fall back to its first option and the card
    // would read as assigned to someone it is not.
    if (task.assignee) {
        push(`user:${task.assignee.id}`, task.assignee.name || task.assignee.email);
    }
    if (task.assigneeEmployee) {
        push(`employee:${task.assigneeEmployee.id}`, task.assigneeEmployee.name ?? '—');
    }

    return options;
}

/**
 * Rendered, not stored: descriptions are markdown text, and react-markdown is
 * heavy enough to be worth keeping out of the bundle until a card is opened.
 */
const Markdown = lazy(() => import('@/components/ui/Markdown'));

const TITLE_MAX = 300;
const DESCRIPTION_MAX = 5000;

/** `@db.Date` arrives as an ISO instant; a date input wants YYYY-MM-DD. */
const dateInputValue = (value?: string | null) => (value ? value.slice(0, 10) : '');

const num = (value: unknown): number => (value == null ? 0 : Number(value));
const today = () => new Date().toISOString().slice(0, 10);
const EMPTY_TIME_FORM = () => ({ hours: '', workDate: today(), note: '', remaining: '' });

/**
 * Whether a write's response is the task itself. `PATCH /project-tasks/:id`
 * answers with one, but nothing in the type system says so — and a response
 * that is not a task must fall back to re-reading the card rather than blanking
 * it.
 */
const isTask = (value: unknown): value is Task =>
    typeof value === 'object' && value !== null && typeof (value as Task).id === 'string';

export default function TaskDetailPanel({
    taskId,
    onClose,
    onChanged,
}: {
    taskId: string;
    onClose: () => void;
    onChanged?: () => void;
}) {
    const { t, localeInfo } = useI18n();
    const m = t.projects;

    const [task, setTask] = useState<Task | null>(null);
    const [statuses, setStatuses] = useState<{ id: string; name: string; category: string }[]>([]);
    const [history, setHistory] = useState<RemainingLog[]>([]);
    const [busy, setBusy] = useState(false);

    const [timeForm, setTimeForm] = useState(EMPTY_TIME_FORM);

    const [allLabels, setAllLabels] = useState<ProjectLabel[]>([]);
    const [members, setMembers] = useState<ProjectMemberRow[]>([]);

    /**
     * The card and its remaining-hours log — the two things a write from this
     * panel can move. Everything else the panel shows is reference data loaded
     * once below, because no edit made here can change a tenant's label
     * catalogue or a board's columns.
     */
    const loadTask = useCallback(async () => {
        const [detail, log] = await Promise.all([
            api.getProjectTask(taskId),
            api.getTaskRemainingHistory(taskId),
        ]);
        setTask(detail as Task);
        setHistory(Array.isArray(log) ? log : []);
    }, [taskId]);

    useEffect(() => {
        loadTask().catch(() => setTask(null));
    }, [loadTask]);

    /**
     * The tenant's label catalogue, fetched the first time somebody wants to
     * change a card's labels rather than every time a card is opened. The chips
     * a task already wears come with the task, so the section reads correctly
     * before this has ever run.
     */
    const [labelsWanted, setLabelsWanted] = useState(false);
    useEffect(() => {
        if (!labelsWanted) return;
        api.getProjectLabels()
            .then((labels: unknown) => setAllLabels(Array.isArray(labels) ? labels : []))
            .catch(() => setAllLabels([]));
    }, [labelsWanted]);

    const projectId = task?.project?.id ?? null;

    // The task's own board, not the tenant template. Since Phase 3L those are
    // different sets, and offering the template here would let someone move a
    // card into a column its board does not have.
    useEffect(() => {
        if (!projectId) return;
        let live = true;
        api.getProjectColumns(projectId)
            .then((cols: unknown) => {
                if (live) setStatuses(Array.isArray(cols) ? cols : []);
            })
            .catch(() => {
                if (live) setStatuses([]);
            });
        return () => {
            live = false;
        };
    }, [projectId]);

    /**
     * The roster, fetched when the assignee picker is first touched. The card
     * shows whoever holds it from the task itself, so the field is correct
     * before this runs — it only needs the list to offer somebody else.
     */
    const [membersWanted, setMembersWanted] = useState(false);
    useEffect(() => {
        if (!projectId || !membersWanted) return;
        let live = true;
        api.getProject(projectId)
            .then((result: unknown) => {
                const rows = (result as { members?: ProjectMemberRow[] } | null)?.members;
                if (live) setMembers(Array.isArray(rows) ? rows : []);
            })
            .catch(() => {
                if (live) setMembers([]);
            });
        return () => {
            live = false;
        };
    }, [projectId, membersWanted]);

    /**
     * The surface behind the modal is reloaded once, when the card is put down.
     * `onChanged` used to fire on every field save, which on the board meant
     * re-fetching every column because somebody fixed a typo in a title.
     */
    const dirty = useRef(false);
    const closed = useRef(false);

    const markChanged = useCallback(() => {
        dirty.current = true;
        // A blur-commit started by the very click that closed the panel lands
        // after `close` has already run. Without this its change would never
        // reach the list behind it.
        if (closed.current) {
            dirty.current = false;
            onChanged?.();
        }
    }, [onChanged]);

    const close = useCallback(() => {
        closed.current = true;
        if (dirty.current) {
            dirty.current = false;
            onChanged?.();
        }
        onClose();
    }, [onChanged, onClose]);

    /**
     * Puts a write's own response into state instead of re-reading the card.
     * `ProjectTasksService.update` ends in `findOne`, so `PATCH
     * /project-tasks/:id` already answers with the whole task — fetching it
     * again cost four requests and a parent reload per saved field, with the
     * panel disabled for the round trip.
     *
     * Returns false when the response was not a task and the card had to be
     * re-read anyway, which is how `applyWithLog` knows the log is fresh.
     */
    const apply = useCallback(
        async (updated: unknown): Promise<boolean> => {
            markChanged();
            if (!isTask(updated)) {
                await loadTask();
                return false;
            }
            setTask(updated);
            return true;
        },
        [loadTask, markChanged],
    );

    /**
     * For the two writes that can also move the remaining-hours log: a status
     * crossing into or out of DONE, and an explicit re-estimate. One extra
     * request rather than the five the old path cost.
     */
    const applyWithLog = useCallback(
        async (updated: unknown) => {
            if (!(await apply(updated))) return;
            const log = await api.getTaskRemainingHistory(taskId).catch(() => null);
            if (Array.isArray(log)) setHistory(log);
        },
        [apply, taskId],
    );

    /** For the endpoints that answer with something other than the task. */
    const refresh = useCallback(async () => {
        markChanged();
        await loadTask();
    }, [loadTask, markChanged]);

    const hours = Number(timeForm.hours || 0);
    const remaining = timeForm.remaining === '' ? undefined : Number(timeForm.remaining);
    const canSaveWork = hours > 0 || remaining !== undefined;

    /**
     * Hours and the revised remaining figure are one form, not two. They are the
     * same act — "here is where this task now stands" — and splitting them meant
     * logging an afternoon and re-estimating it were two saves with two notes.
     * With no hours to log, what is left is a plain re-estimate.
     */
    const saveWork = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSaveWork) return;
        const note = timeForm.note.trim() || undefined;
        setBusy(true);
        try {
            if (hours > 0) {
                await api.logProjectTime({
                    taskId,
                    workDate: timeForm.workDate,
                    hours,
                    note,
                    // Blank means "accept the suggestion" — the backend works out
                    // max(0, remaining - hours) rather than the form guessing.
                    remainingHours: remaining,
                });
                toast.success(m.time.logged);
                setTimeForm(EMPTY_TIME_FORM);
                // The time endpoint answers with the entry it wrote, not the
                // task, so this is the one save on the card that re-reads it.
                await refresh();
            } else {
                const updated = await api.updateProjectTask(taskId, {
                    remainingHours: remaining,
                    remainingNote: note,
                });
                toast.success(m.task.updated);
                setTimeForm(EMPTY_TIME_FORM);
                await applyWithLog(updated);
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.task.saveFailed);
        } finally {
            setBusy(false);
        }
    };

    const changeStatus = async (statusId: string) => {
        setBusy(true);
        try {
            // Crossing into or out of DONE writes a remaining-hours row as well
            // as the status, so the log is re-read beside the task.
            await applyWithLog(await api.updateProjectTask(taskId, { statusId }));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.task.saveFailed);
        } finally {
            setBusy(false);
        }
    };

    const deleteEntry = async (entryId: string) => {
        setBusy(true);
        try {
            await api.deleteProjectTimeEntry(entryId);
            toast.success(m.time.deleted);
            await refresh();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not delete the entry');
        } finally {
            setBusy(false);
        }
    };

    return (
        <ModalShell onBackdropClick={close} size="2xl">
            <ModalHeader
                title={
                    task ? (
                        <TitleField title={task.title} taskId={taskId} onSaved={apply} />
                    ) : (
                        m.task.title
                    )
                }
                subtitle={task?.project ? `${task.project.code} · ${task.project.name}` : undefined}
                onClose={close}
            />

            <div className="max-h-[70vh] overflow-y-auto p-3 md:p-4">
                {!task ? (
                    <p className="text-sm text-gray-500">{t.common.loading}</p>
                ) : (
                    /* Trello's card, in two columns: the work itself in the wide
                       one, everything that merely describes it beside it. Placed
                       explicitly rather than by source order so the sidebar sits
                       under the title on a phone — where status and assignee are
                       the first things reached for — and on the right on desktop. */
                    <div className="grid gap-4 md:grid-cols-3">
                        <aside className="space-y-3 md:col-start-3 md:row-start-1">
                            <section className="space-y-3 rounded-md border border-gray-200 p-3">
                                <h3 className="text-sm font-medium">{m.task.details}</h3>

                                <Field label={m.fields.status} htmlFor="task-status">
                                    <Select
                                        id="task-status"
                                        value={task.status?.id ?? ''}
                                        onChange={(e) => changeStatus(e.target.value)}
                                        disabled={busy}
                                    >
                                        {statuses.map((status) => (
                                            <option key={status.id} value={status.id}>
                                                {status.name}
                                            </option>
                                        ))}
                                    </Select>
                                </Field>

                                <AssigneeField
                                    task={task}
                                    taskId={taskId}
                                    members={members}
                                    onSaved={apply}
                                    onWanted={() => setMembersWanted(true)}
                                />

                                <EstimateField task={task} taskId={taskId} onSaved={apply} />

                                {/* Read-only, unlike the estimate above them:
                                    logged is the sum of the time entries and
                                    remaining is set by the form in the main
                                    column, which records why it moved. */}
                                <div className="grid grid-cols-2 gap-2">
                                    <Metric
                                        label={m.task.logged}
                                        value={`${num(task.logged_hours)}h`}
                                    />
                                    <Metric
                                        label={m.task.remaining}
                                        value={`${num(task.remaining_hours)}h`}
                                        highlight
                                    />
                                </div>
                            </section>

                            <DatesSection task={task} taskId={taskId} onSaved={apply} />

                            <LabelsSection
                                taskId={taskId}
                                all={allLabels}
                                selected={labelsOf(task)}
                                onSaved={apply}
                                onWanted={() => setLabelsWanted(true)}
                            />

                            <CoverSection task={task} taskId={taskId} onSaved={apply} />
                        </aside>

                        <div className="space-y-4 md:col-span-2 md:col-start-1 md:row-start-1">
                            {/* First, not seventh. Logging an afternoon is the
                                most frequent write in the module and it used to
                                sit below the description, the checklist and the
                                attachments, inside a scroller. */}
                            <section className="rounded-md border border-gray-200 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h3 className="text-sm font-medium">{m.time.log}</h3>
                                    <TimerButton taskId={taskId} onChanged={refresh} />
                                </div>
                                <form onSubmit={saveWork} className="mt-2 space-y-2">
                                    {/* One row on a desktop, stacked on a phone.
                                        Four fields that are one act do not need
                                        four rows of a modal. */}
                                    <div className="grid gap-2 md:grid-cols-[5rem_9rem_7rem_1fr_auto] md:items-end">
                                        <Field label={m.time.hours} htmlFor="task-log-hours">
                                            <Input
                                                id="task-log-hours"
                                                type="number"
                                                min="0.25"
                                                step="0.25"
                                                value={timeForm.hours}
                                                onChange={(e) =>
                                                    setTimeForm((p) => ({ ...p, hours: e.target.value }))
                                                }
                                            />
                                        </Field>
                                        <Field label={m.time.workDate} htmlFor="task-log-date">
                                            <Input
                                                id="task-log-date"
                                                type="date"
                                                value={timeForm.workDate}
                                                onChange={(e) =>
                                                    setTimeForm((p) => ({ ...p, workDate: e.target.value }))
                                                }
                                            />
                                        </Field>
                                        <Field
                                            label={m.time.remainingAfter}
                                            htmlFor="task-log-remaining"
                                        >
                                            <Input
                                                id="task-log-remaining"
                                                type="number"
                                                min="0"
                                                step="0.25"
                                                placeholder={String(
                                                    Math.max(num(task.remaining_hours) - hours, 0),
                                                )}
                                                value={timeForm.remaining}
                                                onChange={(e) =>
                                                    setTimeForm((p) => ({ ...p, remaining: e.target.value }))
                                                }
                                            />
                                        </Field>
                                        <Field label={m.time.note} htmlFor="task-log-note">
                                            <Input
                                                id="task-log-note"
                                                placeholder={m.remaining.notePlaceholder}
                                                value={timeForm.note}
                                                onChange={(e) =>
                                                    setTimeForm((p) => ({ ...p, note: e.target.value }))
                                                }
                                            />
                                        </Field>
                                        <Button
                                            type="submit"
                                            disabled={busy || !canSaveWork}
                                            className="min-h-touch"
                                        >
                                            {t.common.save}
                                        </Button>
                                    </div>
                                </form>
                                <p className="mt-2 text-xs text-gray-500">{m.time.remainingHint}</p>
                            </section>

                            <DescriptionSection
                                description={task.description ?? ''}
                                taskId={taskId}
                                onSaved={apply}
                            />

                            <ChecklistSection
                                taskId={taskId}
                                items={task.checklistItems ?? []}
                                onChanged={refresh}
                            />

                            {/* Everything below here is the record rather than
                                the work: read on demand, and fetched on demand
                                with it. Six of the ten requests opening a card
                                used to make were for these. */}
                            <CollapsibleSection title={m.attachments.title}>
                                <AttachmentsSection taskId={taskId} />
                            </CollapsibleSection>

                            <CollapsibleSection
                                title={m.tabs.time}
                                count={(task.timeEntries ?? []).length}
                            >
                                {(task.timeEntries ?? []).length === 0 ? (
                                    <p className="text-sm text-gray-500">{m.time.empty}</p>
                                ) : (
                                    <ul className="divide-y divide-gray-200 text-sm">
                                        {(task.timeEntries ?? []).map((entry) => (
                                            <li key={entry.id} className="flex items-center gap-2 py-1.5">
                                                <span className="w-24 shrink-0 text-gray-500">
                                                    {formatDate(entry.work_date)}
                                                </span>
                                                <span className="w-14 shrink-0">{num(entry.hours)}h</span>
                                                <span className="flex-1 truncate text-gray-600">
                                                    {entry.note ?? ''}
                                                </span>
                                                <button
                                                    type="button"
                                                    aria-label={t.common.delete}
                                                    className="min-h-touch px-2 text-red-600"
                                                    disabled={busy}
                                                    onClick={() => deleteEntry(entry.id)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </CollapsibleSection>

                            <CollapsibleSection
                                title={m.remaining.history}
                                count={history.length}
                            >
                                {history.length === 0 ? (
                                    <p className="text-sm text-gray-500">{m.remaining.empty}</p>
                                ) : (
                                    <>
                                        {/* The shape first, the rows under it. The
                                            list answers "what happened"; the line
                                            answers "is this converging", which is
                                            what someone opening a card wants to
                                            know — and it doubles as the chart's
                                            table view, so no figure is reachable
                                            only by hovering a dot. */}
                                        <RemainingHoursChart
                                            history={history}
                                            estimate={
                                                task.estimate_hours == null
                                                    ? null
                                                    : num(task.estimate_hours)
                                            }
                                            dateLocale={localeInfo.dateLocale}
                                            labels={{
                                                title: m.remaining.chart,
                                                remaining: m.overview.remaining,
                                                estimate: m.overview.estimated,
                                                now: m.remaining.chartNow,
                                                upNote: m.remaining.chartUpNote,
                                            }}
                                        />
                                        <ul className="mt-3 divide-y divide-gray-200 text-sm">
                                        {history.map((row) => {
                                            const delta = Number(row.delta);
                                            const up = delta > 0;
                                            return (
                                                <li key={row.id} className="flex items-start gap-2 py-2">
                                                    <span
                                                        className={`mt-0.5 shrink-0 ${up ? 'text-amber-600' : 'text-emerald-600'}`}
                                                        aria-hidden
                                                    >
                                                        {up ? (
                                                            <ArrowUp className="h-4 w-4" />
                                                        ) : (
                                                            <ArrowDown className="h-4 w-4" />
                                                        )}
                                                    </span>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="flex flex-wrap items-center gap-1.5">
                                                            <StatusBadge tone={up ? 'warning' : 'success'}>
                                                                {m.remaining.sources[
                                                                    row.source as keyof typeof m.remaining.sources
                                                                ] ?? row.source}
                                                            </StatusBadge>
                                                            <span className="text-gray-600">
                                                                {num(row.previous_hours)}h → {num(row.new_hours)}h
                                                            </span>
                                                        </p>
                                                        {row.note && (
                                                            <p className="mt-0.5 text-xs text-gray-500">
                                                                {row.note}
                                                            </p>
                                                        )}
                                                        <p className="mt-0.5 text-xs text-gray-400">
                                                            {formatDateTime(row.changed_at)}
                                                            {row.user
                                                                ? ` · ${m.remaining.by} ${row.user.name ?? row.user.email}`
                                                                : ''}
                                                        </p>
                                                    </div>
                                                </li>
                                            );
                                        })}
                                        </ul>
                                    </>
                                )}
                            </CollapsibleSection>

                            <CollapsibleSection
                                title={m.activity.title}
                                count={task._count?.comments}
                            >
                                <ActivitySection taskId={taskId} onChanged={markChanged} />
                            </CollapsibleSection>
                        </div>
                    </div>
                )}
            </div>

            <ModalFooter>
                <Button type="button" variant="secondary" onClick={close}>
                    {t.common.close}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}

/**
 * Who the card is on. The options are the project's roster rather than every
 * user in the workspace: a task can only sensibly land on someone who is on the
 * job, and the roster carries the employees who have no login and would
 * otherwise be unpickable.
 *
 * Both assignee columns are cleared on every change — sending only the one that
 * gained a value would leave a card holding a user *and* an employee.
 */
function AssigneeField({
    task,
    taskId,
    members,
    onSaved,
    onWanted,
}: {
    task: Task;
    taskId: string;
    members: ProjectMemberRow[];
    onSaved: (updated: unknown) => Promise<unknown>;
    /** Fires when the picker is first touched, so the roster loads then. */
    onWanted: () => void;
}) {
    const { t } = useI18n();
    const m = t.projects;
    const [saving, setSaving] = useState(false);

    const options = useMemo(() => assigneeOptionsFor(members, task), [members, task]);

    const change = async (value: string) => {
        setSaving(true);
        try {
            // '' rather than undefined: PATCH reads undefined as "leave alone",
            // so only the empty string can mean "nobody".
            const updated = await api.updateProjectTask(taskId, {
                assigneeId: value.startsWith('user:') ? value.slice('user:'.length) : '',
                assigneeEmployeeId: value.startsWith('employee:')
                    ? value.slice('employee:'.length)
                    : '',
            });
            await onSaved(updated);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.task.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Field label={m.task.assignee} htmlFor="task-assignee">
            <Select
                id="task-assignee"
                value={assigneeValueOf(task)}
                disabled={saving}
                onFocus={onWanted}
                onPointerDown={onWanted}
                onChange={(e) => change(e.target.value)}
            >
                <option value="">{m.task.unassigned}</option>
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </Select>
        </Field>
    );
}

/**
 * The estimate, saved on Enter or on leaving the field rather than on every
 * keystroke — typing "12" through a save-on-change input would briefly commit an
 * estimate of 1.
 *
 * Blank puts the stored figure back. The field has no way to say "no estimate"
 * (the DTO takes a number), and silently reading an emptied box as zero would
 * throw the burndown off without anyone asking for it.
 */
function EstimateField({
    task,
    taskId,
    onSaved,
}: {
    task: Task;
    taskId: string;
    onSaved: (updated: unknown) => Promise<unknown>;
}) {
    const { t } = useI18n();
    const m = t.projects;

    const current = task.estimate_hours == null ? '' : String(num(task.estimate_hours));
    const [value, setValue] = useState(current);
    const [saving, setSaving] = useState(false);

    useEffect(() => setValue(current), [current]);

    const commit = async () => {
        if (value === current) return;
        const hours = Number(value);
        if (value === '' || !Number.isFinite(hours) || hours < 0) {
            setValue(current);
            return;
        }
        setSaving(true);
        try {
            await onSaved(await api.updateProjectTask(taskId, { estimateHours: hours }));
        } catch (error) {
            setValue(current);
            toast.error(error instanceof Error ? error.message : m.task.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Field label={m.task.estimate} htmlFor="task-estimate">
            <Input
                id="task-estimate"
                type="number"
                min="0"
                step="0.25"
                value={value}
                disabled={saving}
                onChange={(e) => setValue(e.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        commit();
                    }
                    if (event.key === 'Escape') {
                        // Kept off the document, where ModalShell would read it
                        // as "close the card" and take the edit with it.
                        event.stopPropagation();
                        setValue(current);
                    }
                }}
            />
        </Field>
    );
}

/**
 * Start the clock on this task, or stop it if it is already running on one.
 *
 * The module has had a `ProjectTimer` and a working `POST /project-time/timer`
 * since Phase 2, driven only from `/projects/hour-logs` — so the person looking
 * at the task they are about to work on had to go to another screen to say so,
 * or type the hours in afterwards from memory. This is the same endpoint, put
 * where the decision is made.
 *
 * There is one timer per person, not one per task, so the button has three
 * states: start, stop (this task), and running-elsewhere — which is disabled
 * rather than hidden, because silently doing nothing is how you end up with two
 * people certain they had a timer going.
 */
function TimerButton({ taskId, onChanged }: { taskId: string; onChanged: () => Promise<void> }) {
    const { t } = useI18n();
    const m = t.projects;

    const [runningOn, setRunningOn] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);

    const read = useCallback(async () => {
        try {
            const timer = await api.getProjectTimer();
            const on = (timer as { task?: { id?: string } } | null)?.task?.id ?? null;
            setRunningOn(on);
            setFailed(false);
        } catch {
            // A card whose timer state cannot be read still opens; the button
            // simply does not offer to start something it cannot reason about.
            setFailed(true);
        }
    }, []);

    useEffect(() => {
        void read();
    }, [read]);

    const run = async (action: () => Promise<unknown>) => {
        setBusy(true);
        try {
            await action();
            await read();
            await onChanged();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.task.saveFailed);
        } finally {
            setBusy(false);
        }
    };

    if (failed) return null;

    const mine = runningOn === taskId;
    const elsewhere = runningOn != null && !mine;

    return (
        <Button
            type="button"
            variant={mine ? 'secondary' : 'ghost'}
            className="min-h-touch"
            disabled={busy || elsewhere}
            title={elsewhere ? m.timer.elsewhere : undefined}
            onClick={() =>
                run(() =>
                    mine ? api.stopProjectTimer() : api.startProjectTimer({ taskId }),
                )
            }
        >
            {mine ? (
                <>
                    <Square className="h-4 w-4" aria-hidden />
                    {m.timer.stop}
                </>
            ) : (
                <>
                    <Play className="h-4 w-4" aria-hidden />
                    {elsewhere ? m.timer.elsewhere : m.timer.start}
                </>
            )}
        </Button>
    );
}

/**
 * The title, as a field.
 *
 * It used to be a heading you clicked to turn into an input — a hidden
 * affordance, and one of five different ways this panel saved a field. It is now
 * simply an input styled as a heading: click it, type, leave it, it saves. Same
 * rule as the estimate, the dates and every other text field on the card.
 *
 * Blank is refused rather than saved: a task with no title is not something the
 * backend takes, and quietly erasing the one thing that names the card would be
 * worse than ignoring the edit.
 */
function TitleField({
    title,
    taskId,
    onSaved,
}: {
    title: string;
    taskId: string;
    onSaved: (updated: unknown) => Promise<unknown>;
}) {
    const { t } = useI18n();
    const m = t.projects.task;

    const [value, setValue] = useState(title);
    const [saving, setSaving] = useState(false);

    useEffect(() => setValue(title), [title]);

    const commit = async () => {
        const next = value.trim();
        if (!next || next === title) {
            setValue(title);
            return;
        }
        setSaving(true);
        try {
            await onSaved(await api.updateProjectTask(taskId, { title: next }));
        } catch (error) {
            setValue(title);
            toast.error(error instanceof Error ? error.message : m.renameFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Input
            value={value}
            maxLength={TITLE_MAX}
            disabled={saving}
            aria-label={m.titleField}
            className="border-transparent bg-transparent px-1 text-base font-semibold hover:border-gray-300"
            onChange={(event) => setValue(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.blur();
                }
                if (event.key === 'Escape') {
                    // Kept off the document, where ModalShell would read it as
                    // "close the card" and take the edit with it.
                    event.stopPropagation();
                    setValue(title);
                }
            }}
        />
    );
}

/**
 * The description, in markdown, under the same rule as every other field on the
 * card: click it, type, click away, it saves.
 *
 * It used to need a pencil button to get into and a Save/Cancel pair to get out
 * of — the two clicks that made "fix a typo" a four-step errand, and the loudest
 * of the five different save idioms this panel used to carry.
 *
 * **The commit is on the container, not the textarea.** The editor has a
 * toolbar, and a toolbar button steals focus from the textarea; committing on
 * the textarea's own blur would save (and close the editor) every time somebody
 * reached for *bold*. `relatedTarget` inside the container means focus merely
 * moved within the editor, which is not leaving it.
 *
 * Stored as the text the user typed rather than as HTML: it stays legible
 * everywhere else the field surfaces (exports, the API, a notification email)
 * and there is nothing to sanitise on the way out — `Markdown` renders it with
 * raw HTML and images disallowed.
 */
function DescriptionSection({
    description,
    taskId,
    onSaved,
}: {
    description: string;
    taskId: string;
    onSaved: (updated: unknown) => Promise<unknown>;
}) {
    const { t } = useI18n();
    const m = t.projects.description;

    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(description);
    const [saving, setSaving] = useState(false);

    useEffect(() => setValue(description), [description]);

    const commit = async () => {
        setEditing(false);
        const next = value.trim();
        if (next === description.trim()) return;
        setSaving(true);
        try {
            // '' clears it — the backend stores an empty description as null.
            await onSaved(await api.updateProjectTask(taskId, { description: next }));
        } catch (error) {
            setValue(description);
            toast.error(error instanceof Error ? error.message : m.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    if (!editing) {
        return (
            <section>
                <h3 className="text-sm font-medium">{m.title}</h3>
                <button
                    type="button"
                    onClick={() => setEditing(true)}
                    aria-label={m.title}
                    className="mt-2 w-full rounded-md border border-transparent px-2 py-1.5 text-start hover:border-gray-300 hover:bg-gray-50"
                >
                    {description === '' ? (
                        <span className="text-sm text-gray-500">{m.add}</span>
                    ) : (
                        <span className="block text-sm text-gray-700">
                            <Suspense fallback={<span className="whitespace-pre-wrap">{description}</span>}>
                                <Markdown content={description} />
                            </Suspense>
                        </span>
                    )}
                </button>
            </section>
        );
    }

    return (
        <section>
            <h3 className="text-sm font-medium">{m.title}</h3>
            <div
                className="mt-2"
                onBlur={(event) => {
                    // Focus moving to the toolbar is not focus leaving the editor.
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                    void commit();
                }}
            >
                <RichTextEditor
                    autoFocus
                    rows={6}
                    value={value}
                    onChange={setValue}
                    disabled={saving}
                    maxLength={DESCRIPTION_MAX}
                    placeholder={m.placeholder}
                    ariaLabel={m.title}
                    onSubmit={commit}
                    onCancel={() => {
                        setValue(description);
                        setEditing(false);
                    }}
                />
            </div>
        </section>
    );
}

/**
 * A strip of colour across the top of the card. Purely visual — nothing reads
 * it but the board.
 */
function CoverSection({
    task,
    taskId,
    onSaved,
}: {
    task: Task;
    taskId: string;
    onSaved: (updated: unknown) => Promise<unknown>;
}) {
    const { t } = useI18n();
    const m = t.projects;
    const [saving, setSaving] = useState(false);

    const pick = async (color: ProjectLabelColor | '') => {
        setSaving(true);
        try {
            // '' clears it, the same PATCH convention the dates use.
            await onSaved(await api.updateProjectTask(taskId, { coverColor: color }));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.task.updated);
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="rounded-md border border-gray-200 p-3">
            <h3 className="mb-2 text-sm font-medium">{m.cover.title}</h3>
            <div className="flex flex-wrap items-center gap-1.5">
                {LABEL_COLORS.map((color) => (
                    <button
                        key={color}
                        type="button"
                        disabled={saving}
                        aria-pressed={task.cover_color === color}
                        aria-label={m.cover.pick.replace('{color}', m.labels.colors[color])}
                        onClick={() => pick(color)}
                        className={`h-7 w-10 rounded disabled:opacity-60 ${coverClass(color)} ${
                            task.cover_color === color ? 'ring-2 ring-blue-600 ring-offset-1' : ''
                        }`}
                    />
                ))}
                <Button
                    type="button"
                    variant="ghost"
                    className="min-h-touch"
                    disabled={saving || !task.cover_color}
                    onClick={() => pick('')}
                >
                    {m.cover.none}
                </Button>
            </div>
        </section>
    );
}

interface Attachment {
    id: string;
    file_url: string;
    file_name: string;
    mime_type?: string | null;
    file_size?: number | null;
    created_at: string;
    creator?: { id: string; name?: string | null; email: string } | null;
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
/** Matches the server's cap; checked here too so a 5 MB upload is not started. */
const MAX_BYTES = 5 * 1024 * 1024;

const readAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
    });

/**
 * `ProjectAttachment` has had a model since Phase 1 and no API. This is the
 * first UI over it.
 *
 * Loads independently of the panel, like the activity feed: a failure here must
 * not cost the hours form above it, and an empty list has to be
 * distinguishable from a broken one.
 */
function AttachmentsSection({ taskId }: { taskId: string }) {
    const { t } = useI18n();
    const m = t.projects.attachments;

    const [items, setItems] = useState<Attachment[]>([]);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);

    const load = useCallback(async () => {
        try {
            const list = await api.getTaskAttachments(taskId);
            setItems(Array.isArray(list) ? list : []);
            setFailed(false);
        } catch {
            setFailed(true);
        }
    }, [taskId]);

    useEffect(() => {
        load();
    }, [load]);

    const upload = async (file: File | undefined) => {
        if (!file) return;
        // Checked before reading: no point turning 20 MB into base64 to be told
        // no, and the message is clearer than a 400 from the server.
        if (!ACCEPTED_TYPES.includes(file.type)) return toast.error(m.unsupported);
        if (file.size > MAX_BYTES) return toast.error(m.tooLarge);

        setBusy(true);
        try {
            const fileBase64 = await readAsDataUrl(file);
            await api.addTaskAttachment(taskId, {
                fileBase64,
                fileName: file.name,
                mimeType: file.type,
            });
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.uploadFailed);
        } finally {
            setBusy(false);
        }
    };

    const remove = async (id: string) => {
        setBusy(true);
        try {
            await api.deleteTaskAttachment(id);
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.uploadFailed);
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="rounded-md border border-gray-200 p-3">
            <h3 className="text-sm font-medium">{m.title}</h3>
            <p className="mt-0.5 text-xs text-gray-500">{m.hint}</p>

            <label className="mt-2 inline-flex min-h-touch cursor-pointer items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                <Paperclip className="h-4 w-4" />
                {m.add}
                <input
                    type="file"
                    className="sr-only"
                    aria-label={m.add}
                    accept={ACCEPTED_TYPES.join(',')}
                    disabled={busy}
                    onChange={(e) => {
                        upload(e.target.files?.[0]);
                        // Clear it, or picking the same file twice fires nothing.
                        e.target.value = '';
                    }}
                />
            </label>

            {failed ? (
                <p className="mt-2 text-sm text-danger">{m.loadFailed}</p>
            ) : items.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">{m.empty}</p>
            ) : (
                <ul className="mt-2 divide-y divide-gray-200 text-sm">
                    {items.map((item) => (
                        <li key={item.id} className="flex items-center gap-2 py-1.5">
                            <a
                                href={item.file_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="min-w-0 flex-1 truncate text-blue-600 hover:underline"
                            >
                                {item.file_name}
                            </a>
                            <span className="shrink-0 text-xs text-gray-400">
                                {Math.max(1, Math.round((item.file_size ?? 0) / 1024))} KB
                            </span>
                            <button
                                type="button"
                                aria-label={`${m.deleteFile} ${item.file_name}`}
                                className="min-h-touch px-2 text-red-600 disabled:opacity-40"
                                disabled={busy}
                                onClick={() => remove(item.id)}
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

/**
 * Comments and the change log in one timeline, because "what happened to this
 * task" is one question. Loads independently of the panel: the feed is the
 * heaviest part of the card and the least urgent, and a failure here must not
 * cost you the hours form above it.
 */
function ActivitySection({
    taskId,
    onChanged,
}: {
    taskId: string;
    onChanged?: () => void;
}) {
    const { t } = useI18n();
    const m = t.projects.activity;

    const [feed, setFeed] = useState<FeedEntry[]>([]);
    const [watching, setWatching] = useState(false);
    const [me, setMe] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editBody, setEditBody] = useState('');
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);

    const load = useCallback(async () => {
        try {
            const [comments, activity, watchers, user] = await Promise.all([
                api.getTaskComments(taskId),
                api.getTaskActivity(taskId),
                api.getTaskWatchers(taskId),
                api.getMe(),
            ]);
            const userId = (user as { id?: string } | null)?.id ?? null;
            setMe(userId);
            setFeed(
                mergeFeed(
                    Array.isArray(comments) ? comments : [],
                    Array.isArray(activity) ? activity : [],
                ),
            );
            setWatching(
                Array.isArray(watchers) &&
                    watchers.some((w: { user_id?: string }) => w.user_id === userId),
            );
            setFailed(false);
        } catch {
            // An empty timeline and a broken one look identical otherwise —
            // the trap logged against useServerList, in miniature.
            setFailed(true);
        }
    }, [taskId]);

    useEffect(() => {
        load();
    }, [load]);

    const run = async (action: () => Promise<unknown>) => {
        setSaving(true);
        try {
            await action();
            await load();
            onChanged?.();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        const body = draft.trim();
        if (!body) return;
        return run(async () => {
            await api.addTaskComment(taskId, body);
            setDraft('');
        });
    };

    const commitEdit = (comment: FeedEntry & { kind: 'comment' }) => {
        const body = editBody.trim();
        setEditingId(null);
        if (!body || body === comment.body) return;
        return run(() => api.updateTaskComment(comment.id, body));
    };

    return (
        <section className="rounded-md border border-gray-200 p-3">
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{m.title}</h3>
                <Button
                    type="button"
                    variant={watching ? 'secondary' : 'ghost'}
                    className="min-h-touch"
                    disabled={saving}
                    aria-pressed={watching}
                    onClick={() =>
                        run(() => (watching ? api.unwatchTask(taskId) : api.watchTask(taskId)))
                    }
                >
                    {watching ? (
                        <Eye className="me-1 h-4 w-4" />
                    ) : (
                        <EyeOff className="me-1 h-4 w-4" />
                    )}
                    {watching ? m.watching : m.watch}
                </Button>
            </div>
            <p className="mt-0.5 text-xs text-gray-500">{m.watchHint}</p>

            <form onSubmit={submit} className="mt-2 space-y-2">
                <Textarea
                    rows={2}
                    value={draft}
                    aria-label={m.commentPlaceholder}
                    placeholder={m.commentPlaceholder}
                    onChange={(e) => setDraft(e.target.value)}
                />
                <Button
                    type="submit"
                    className="min-h-touch"
                    disabled={saving || draft.trim() === ''}
                >
                    {m.comment}
                </Button>
            </form>

            {failed ? (
                <p className="mt-3 text-sm text-danger">{m.loadFailed}</p>
            ) : feed.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">{m.empty}</p>
            ) : (
                <ul className="mt-3 space-y-2">
                    {feed.map((entry) => (
                        <li key={`${entry.kind}-${entry.id}`} className="text-sm">
                            {entry.kind === 'comment' ? (
                                <div className="rounded-md bg-gray-50 p-2">
                                    <p className="text-xs text-gray-500">
                                        {actorName(entry.user) ?? m.someone} ·{' '}
                                        {formatDateTime(entry.created_at)}
                                    </p>
                                    {editingId === entry.id ? (
                                        <div className="mt-1 space-y-2">
                                            <Textarea
                                                rows={2}
                                                autoFocus
                                                value={editBody}
                                                aria-label={m.editComment}
                                                onChange={(e) => setEditBody(e.target.value)}
                                            />
                                            <div className="flex gap-2">
                                                <Button
                                                    type="button"
                                                    className="min-h-touch"
                                                    disabled={saving}
                                                    onClick={() => commitEdit(entry)}
                                                >
                                                    {t.common.save}
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    className="min-h-touch"
                                                    onClick={() => setEditingId(null)}
                                                >
                                                    {t.common.cancel}
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="mt-0.5 whitespace-pre-wrap">{entry.body}</p>
                                    )}

                                    {/* Only your own — an audit trail nobody
                                        else can rewrite. */}
                                    {me && entry.user?.id === me && editingId !== entry.id && (
                                        <div className="mt-1 flex gap-2 text-xs">
                                            <button
                                                type="button"
                                                className="min-h-touch text-blue-600"
                                                onClick={() => {
                                                    setEditingId(entry.id);
                                                    setEditBody(entry.body);
                                                }}
                                            >
                                                {t.common.edit}
                                            </button>
                                            <button
                                                type="button"
                                                className="min-h-touch text-red-600"
                                                disabled={saving}
                                                onClick={() =>
                                                    run(() => api.deleteTaskComment(entry.id))
                                                }
                                            >
                                                {t.common.delete}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <p className="text-gray-600">
                                    <span className="text-gray-900">
                                        {actorName(entry.actor) ?? m.someone}
                                    </span>{' '}
                                    {describeActivity(entry, m.types as Record<string, string>)}
                                    <span className="ms-1 text-xs text-gray-400">
                                        {formatDateTime(entry.created_at)}
                                    </span>
                                </p>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

/**
 * Start and due, saved on change rather than behind a Save button — there are
 * two fields and no validation to batch, so a button would only be one more
 * click between the user and the thing they came here to do.
 */
function DatesSection({
    task,
    taskId,
    onSaved,
}: {
    task: Task;
    taskId: string;
    onSaved: (updated: unknown) => Promise<unknown>;
}) {
    const { t } = useI18n();
    const m = t.projects;
    const [saving, setSaving] = useState(false);

    const save = async (field: 'startDate' | 'dueDate', value: string) => {
        setSaving(true);
        try {
            // Sends '' rather than undefined to clear: PATCH reads undefined as
            // "leave alone", so only the empty string can mean "no date".
            await onSaved(await api.updateProjectTask(taskId, { [field]: value }));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.dates.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const start = dateInputValue(task.start_date);
    const due = dateInputValue(task.due_date);
    const inverted = start !== '' && due !== '' && start > due;

    return (
        <section className="rounded-md border border-gray-200 p-3">
            <h3 className="mb-2 text-sm font-medium">{m.dates.title}</h3>
            {/* Stacked, not side by side: this card lives in the sidebar now,
                where two date inputs in a row are narrower than the dates they
                have to show.

                `Field` only ties its label to the control when given htmlFor —
                without the matching id these inputs have no accessible name. */}
            <div className="grid gap-2">
                <Field label={m.dates.start} htmlFor="task-start-date">
                    <Input
                        id="task-start-date"
                        type="date"
                        value={start}
                        disabled={saving}
                        onChange={(e) => save('startDate', e.target.value)}
                    />
                </Field>
                <Field
                    label={m.dates.due}
                    htmlFor="task-due-date"
                    error={inverted ? m.dates.inverted : undefined}
                >
                    <Input
                        id="task-due-date"
                        type="date"
                        value={due}
                        disabled={saving}
                        onChange={(e) => save('dueDate', e.target.value)}
                    />
                </Field>
            </div>
        </section>
    );
}

/**
 * Toggles rather than a multi-select: a label set is small and visual, and the
 * chip you tap is the chip you will see on the card.
 */
function LabelsSection({
    taskId,
    all,
    selected,
    onSaved,
    onWanted,
}: {
    taskId: string;
    all: ProjectLabel[];
    selected: ProjectLabel[];
    onSaved: (updated: unknown) => Promise<unknown>;
    /** Fires when the section is first opened, so the catalogue loads then. */
    onWanted: () => void;
}) {
    const { t } = useI18n();
    const m = t.projects.labels;
    const [saving, setSaving] = useState(false);

    const selectedIds = new Set(selected.map((label) => label.id));

    const toggle = async (labelId: string) => {
        const next = new Set(selectedIds);
        if (next.has(labelId)) next.delete(labelId);
        else next.add(labelId);

        setSaving(true);
        try {
            // The whole set every time — the endpoint replaces rather than
            // patches, so there is no add/remove pair to keep in step.
            await onSaved(await api.updateProjectTask(taskId, { labelIds: [...next] }));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    // The chips a task already wears come with the task; the catalogue is only
    // needed to offer the ones it does not, so it is fetched on first open.
    return (
        <CollapsibleSection title={m.title} count={selected.length} onFirstOpen={onWanted}>
            <div className="flex flex-wrap gap-1.5">
                {all.length === 0 && selected.length === 0 && (
                    <p className="text-sm text-gray-500">{m.empty}</p>
                )}
                {(all.length > 0 ? all : selected).map((label) => {
                    const on = selectedIds.has(label.id);
                    return (
                        <button
                            key={label.id}
                            type="button"
                            disabled={saving}
                            aria-pressed={on}
                            onClick={() => toggle(label.id)}
                            className={`min-h-touch rounded px-2 py-1 text-xs font-medium disabled:opacity-60 ${labelClass(label.color)} ${
                                on ? 'ring-2 ring-blue-600' : 'opacity-50'
                            }`}
                        >
                            {label.name}
                        </button>
                    );
                })}
            </div>
        </CollapsibleSection>
    );
}

function ChecklistSection({
    taskId,
    items,
    onChanged,
}: {
    taskId: string;
    items: ChecklistItem[];
    onChanged: () => Promise<void>;
}) {
    const { t } = useI18n();
    const m = t.projects.checklist;

    const [newText, setNewText] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [saving, setSaving] = useState(false);

    const done = items.filter((item) => item.is_done).length;
    const percent = items.length === 0 ? 0 : Math.round((done / items.length) * 100);

    const run = async (action: () => Promise<unknown>) => {
        setSaving(true);
        try {
            await action();
            await onChanged();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const add = (e: React.FormEvent) => {
        e.preventDefault();
        const text = newText.trim();
        if (!text) return;
        return run(async () => {
            await api.addTaskChecklistItem(taskId, { text });
            setNewText('');
        });
    };

    const commitEdit = (item: ChecklistItem) => {
        const text = editText.trim();
        setEditingId(null);
        if (!text || text === item.text) return;
        return run(() => api.updateTaskChecklistItem(item.id, { text }));
    };

    // Sends the whole order rather than the swapped pair — a half-applied swap
    // would leave two items sharing a sort_order and the list would reshuffle.
    const moveBy = (index: number, delta: number) => {
        const target = index + delta;
        if (target < 0 || target >= items.length) return;
        const next = [...items];
        [next[index], next[target]] = [next[target], next[index]];
        return run(() => api.reorderTaskChecklist(taskId, next.map((item) => item.id)));
    };

    return (
        <section className="rounded-md border border-gray-200 p-3">
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{m.title}</h3>
                {items.length > 0 && (
                    <span className="text-xs text-gray-500">
                        {done === items.length
                            ? m.allDone
                            : m.progress
                                  .replace('{done}', String(done))
                                  .replace('{total}', String(items.length))}
                    </span>
                )}
            </div>

            {items.length > 0 && (
                <div
                    className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200"
                    role="progressbar"
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={m.title}
                >
                    <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${percent}%` }}
                    />
                </div>
            )}

            {items.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">{m.empty}</p>
            ) : (
                <ul className="mt-2 space-y-0.5">
                    {items.map((item, index) => (
                        <li key={item.id} className="flex items-center gap-2">
                            <Checkbox
                                checked={item.is_done}
                                disabled={saving}
                                aria-label={item.text}
                                onChange={() =>
                                    run(() =>
                                        api.updateTaskChecklistItem(item.id, {
                                            isDone: !item.is_done,
                                        }),
                                    )
                                }
                            />

                            {editingId === item.id ? (
                                <Input
                                    autoFocus
                                    value={editText}
                                    className="flex-1"
                                    onChange={(e) => setEditText(e.target.value)}
                                    onBlur={() => commitEdit(item)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            commitEdit(item);
                                        }
                                        if (e.key === 'Escape') setEditingId(null);
                                    }}
                                />
                            ) : (
                                <button
                                    type="button"
                                    className={`min-h-touch flex-1 text-start text-sm ${
                                        item.is_done ? 'text-gray-400 line-through' : ''
                                    }`}
                                    onClick={() => {
                                        setEditingId(item.id);
                                        setEditText(item.text);
                                    }}
                                >
                                    {item.text}
                                </button>
                            )}

                            <button
                                type="button"
                                aria-label={m.moveUp}
                                className="px-1 text-gray-400 disabled:opacity-30"
                                disabled={saving || index === 0}
                                onClick={() => moveBy(index, -1)}
                            >
                                <ArrowUp className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                aria-label={m.moveDown}
                                className="px-1 text-gray-400 disabled:opacity-30"
                                disabled={saving || index === items.length - 1}
                                onClick={() => moveBy(index, 1)}
                            >
                                <ArrowDown className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                aria-label={m.deleteItem}
                                className="px-1 text-red-600"
                                disabled={saving}
                                onClick={() => run(() => api.deleteTaskChecklistItem(item.id))}
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            <form onSubmit={add} className="mt-2 flex gap-2">
                <Input
                    value={newText}
                    placeholder={m.placeholder}
                    className="flex-1"
                    onChange={(e) => setNewText(e.target.value)}
                />
                <Button
                    type="submit"
                    variant="secondary"
                    className="min-h-touch"
                    disabled={saving || newText.trim() === ''}
                >
                    {m.add}
                </Button>
            </form>
        </section>
    );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
    return (
        <div
            className={`rounded-md border p-2 text-center ${
                highlight
                    ? 'border-blue-200 bg-blue-50'
                    : 'border-gray-200'
            }`}
        >
            <p className="text-xs text-gray-500">{label}</p>
            <p className="mt-0.5 text-sm font-medium">{value}</p>
        </div>
    );
}
