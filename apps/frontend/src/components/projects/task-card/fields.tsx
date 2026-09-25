'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Pencil, X } from 'lucide-react';
import Avatar from '@/components/Avatar';
import {
    dueStateOf,
    labelClass,
    type ProjectLabel,
    type ProjectLabelColor,
} from '@/components/projects/board-tasks';
import ChipPopover from '@/components/projects/ChipPopover';
import { formatCalendarDate } from '@/lib/format';
import { api } from '@/lib/api';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import {
    dateInputValue,
    num,
    relativeDay,
    type AssigneeOption,
    type ProjectMemberRow,
    type StoryOption,
    type Task,
} from './model';

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
 * Who the card is on. The options are the project's roster rather than every
 * user in the workspace: a task can only sensibly land on someone who is on the
 * job, and the roster carries the employees who have no login and would
 * otherwise be unpickable.
 *
 * Both assignee columns are cleared on every change — sending only the one that
 * gained a value would leave a card holding a user *and* an employee.
 */
export function AssigneeField({
    task,
    taskId,
    projectId,
    members,
    membersFailed,
    onSaved,
    onWanted,
}: {
    task: Task;
    taskId: string;
    /** For the link out to the team, where an empty roster is filled in. */
    projectId?: string;
    members: ProjectMemberRow[];
    membersFailed: boolean;
    onSaved: (updated: unknown) => Promise<unknown>;
    /** Fires when the picker is first touched, so the roster loads then. */
    onWanted: () => void;
}) {
    const { t } = useI18n();
    const m = t.projects;
    const [saving, setSaving] = useState(false);

    const options = useMemo(() => assigneeOptionsFor(members, task), [members, task]);

    /**
     * Why the list is short, when it is. Three states used to look identical —
     * the roster still loading, a project nobody is on, and a read that failed —
     * and the picker said nothing about any of them.
     */
    const note = membersFailed ? (
        m.task.assigneeLoadFailed
    ) : members.length > 0 ? null : projectId ? (
        <>
            {m.task.assigneeNoTeam}{' '}
            <Link
                href={routes.projects.detail(projectId)}
                className="font-medium text-blue-600 hover:underline"
            >
                {m.task.assigneeAddTeam}
            </Link>
        </>
    ) : (
        m.task.assigneeNoTeam
    );

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

    const holder = options.find((option) => option.value === assigneeValueOf(task));

    return (
        <ChipPopover
            variant="field"
            label={m.task.assignee}
            value={assigneeValueOf(task)}
            display={
                holder ? (
                    <span className="flex min-w-0 items-center gap-1.5">
                        <Avatar name={holder.label} size="xs" />
                        <span className="truncate">{holder.label}</span>
                    </span>
                ) : (
                    m.task.unassigned
                )
            }
            tone={holder ? 'default' : 'muted'}
            options={options.map((option) => ({
                value: option.value,
                label: option.label,
                leading: <Avatar name={option.label} size="xs" />,
            }))}
            disabled={saving}
            onOpen={onWanted}
            onPick={change}
            emptyLabel={m.task.unassigned}
            note={note}
            filterable
        />
    );
}

/**
 * Which user story this task delivers a piece of.
 *
 * Only the task's own project's stories are offered, because that is all the API
 * accepts — a story belongs to one project, and a card filed under another
 * project's story would be counted into a backlog nobody looking at this board
 * can see.
 */
export function UserStoryField({
    task,
    taskId,
    stories,
    onSaved,
    onWanted,
}: {
    task: Task;
    taskId: string;
    stories: StoryOption[];
    onSaved: (updated: unknown) => Promise<unknown>;
    /** Fires when the picker is first touched, so the backlog loads then. */
    onWanted: () => void;
}) {
    const { t } = useI18n();
    const m = t.projects;
    const [saving, setSaving] = useState(false);

    // Whichever story holds the card is listed even before the backlog has
    // loaded — without it the select would fall back to its first option and the
    // card would read as filed under a story it is not.
    const options = useMemo(() => {
        const rows: StoryOption[] = [...stories];
        if (task.userStory && !rows.some((row) => row.id === task.userStory?.id)) {
            rows.unshift(task.userStory);
        }
        return rows;
    }, [stories, task.userStory]);

    const change = async (value: string) => {
        setSaving(true);
        try {
            // '' rather than undefined, for the reason the assignee gives above.
            await onSaved(await api.updateProjectTask(taskId, { userStoryId: value }));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.task.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ChipPopover
            variant="field"
            label={m.stories.field}
            value={task.userStory?.id ?? ''}
            display={
                task.userStory ? (
                    // The code is the handle people say; the title is what makes
                    // it recognisable, so it gets whatever room is left.
                    <span className="flex min-w-0 items-center gap-1.5">
                        <span className="shrink-0 font-medium">{task.userStory.code}</span>
                        <span className="truncate text-gray-600">{task.userStory.title}</span>
                    </span>
                ) : (
                    m.stories.none
                )
            }
            tone={task.userStory ? 'default' : 'muted'}
            options={options.map((story) => ({
                value: story.id,
                label: story.code,
                subtitle: story.title,
            }))}
            disabled={saving}
            onOpen={onWanted}
            onPick={change}
            emptyLabel={m.stories.none}
            filterable
        />
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
 *
 * Drawn as one of the Time card's three figures, and marked as the one of them
 * that can be typed into: a pencil beside its name, and a dash rather than an
 * empty box when nothing has been estimated yet.
 */
export function EstimateField({
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
        <div className="rounded-md border border-gray-200 px-1.5 py-1.5 text-center transition-colors focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/20 hover:border-gray-300">
            {/* The same three words the project page's figures use. The unit is
                the card's title, which is why this is not `task.estimate`'s
                "Estimate (h)" — that caption wrapped at this width. */}
            <label
                htmlFor="task-estimate"
                className="flex items-center justify-center gap-1 text-xs text-gray-500"
            >
                {m.overview.estimated}
                <Pencil className="h-3 w-3 shrink-0 text-gray-400" aria-hidden />
            </label>
            <input
                id="task-estimate"
                type="number"
                min="0"
                step="0.25"
                value={value}
                placeholder="—"
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
                className="mt-0.5 w-full border-0 bg-transparent p-0 text-center text-sm font-semibold tabular-nums text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
            />
        </div>
    );
}

/**
 * The due date, as one row of the Details list rather than a card of its own.
 *
 * Start date came off the card on 2026-09-14 (the first hour logged already says
 * when work began), which is what lets the due date be a single field: 3P
 * deferred a dates chip because start and due shared a cross-field check.
 *
 * The native date input stays — it is the one control that knows every
 * locale's calendar — but out of sight: an empty one reads `dd/mm/yyyy`, which
 * is what made the old section look unfinished. The visible button opens it
 * through `showPicker()`, and the input keeps its label, so a screen reader
 * still reaches a real date field.
 */
export function DueDateField({
    task,
    taskId,
    onSaved,
}: {
    task: Task;
    taskId: string;
    onSaved: (updated: unknown) => Promise<unknown>;
}) {
    const { t, localeInfo } = useI18n();
    const m = t.projects;
    const [saving, setSaving] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const save = async (value: string) => {
        setSaving(true);
        try {
            // Sends '' rather than undefined to clear: PATCH reads undefined as
            // "leave alone", so only the empty string can mean "no date".
            await onSaved(await api.updateProjectTask(taskId, { dueDate: value }));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.dates.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const openPicker = () => {
        const input = inputRef.current;
        if (!input) return;
        // Chrome 99+, Safari 16+, Firefox 101+. Anything older gets the input
        // focused, where the date can be typed or its own picker opened.
        try {
            if (typeof input.showPicker === 'function') {
                input.showPicker();
                return;
            }
        } catch {
            // Refused outside a user gesture in some engines; fall through.
        }
        input.focus();
    };

    const due = dateInputValue(task.due_date);
    const start = dateInputValue(task.start_date);
    const inverted = start !== '' && due !== '' && start > due;
    const state = dueStateOf(task.due_date, task.completed_at);
    const tone =
        state === 'overdue'
            ? 'text-red-700'
            : state === 'today' || state === 'soon'
              ? 'text-amber-700'
              : due
                ? 'text-gray-900'
                : 'text-gray-400';

    return (
        <div className="flex min-w-0 flex-col">
            <div className="flex min-w-0 items-center">
                <button
                    type="button"
                    onClick={openPicker}
                    disabled={saving}
                    className={`inline-flex min-w-0 items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-start text-sm transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60 max-md:min-h-touch ${tone}`}
                >
                    {due ? (
                        <>
                            <span className="tabular-nums">{formatCalendarDate(due)}</span>
                            {/* Nothing relative once the work is done: "3 days
                                ago" on a finished task reads as a warning. */}
                            {state !== 'done' && (
                                <span
                                    className={
                                        state === 'overdue'
                                            ? 'rounded-full bg-red-50 px-1.5 text-xs font-medium'
                                            : 'text-xs text-gray-500'
                                    }
                                >
                                    {relativeDay(due, localeInfo.dateLocale)}
                                </span>
                            )}
                        </>
                    ) : (
                        m.dates.none
                    )}
                </button>
                {due && (
                    <button
                        type="button"
                        aria-label={m.dates.clear}
                        title={m.dates.clear}
                        disabled={saving}
                        onClick={() => save('')}
                        className="inline-flex shrink-0 items-center justify-center rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-60 max-md:min-h-touch max-md:min-w-touch"
                    >
                        <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                )}
                <input
                    ref={inputRef}
                    id="task-due-date"
                    type="date"
                    aria-label={m.dates.due}
                    // Off the tab order: the button above is how the keyboard
                    // reaches it, and a second stop would be the same field twice.
                    tabIndex={-1}
                    value={due}
                    disabled={saving}
                    onChange={(e) => save(e.target.value)}
                    className="sr-only"
                />
            </div>
            {inverted && <p className="px-2 text-xs text-danger">{m.dates.inverted}</p>}
        </div>
    );
}

/** A label's colour at swatch strength, for the picker's rows. */
const SWATCH: Record<ProjectLabelColor, string> = {
    GRAY: 'bg-gray-400',
    BLUE: 'bg-blue-500',
    EMERALD: 'bg-emerald-500',
    AMBER: 'bg-amber-500',
    RED: 'bg-red-500',
    PURPLE: 'bg-purple-500',
};

/**
 * The labels a task wears, shown as themselves — the chips the board draws —
 * with the picker a click on them away.
 *
 * This was a collapsed section, so a card's labels could not be seen without
 * opening it. The catalogue is still fetched only on first open: the chips a
 * task already wears come with the task.
 */
export function LabelsField({
    task,
    taskId,
    all,
    selected,
    onSaved,
    onWanted,
}: {
    task: Task;
    taskId: string;
    all: ProjectLabel[];
    selected: ProjectLabel[];
    onSaved: (updated: unknown) => Promise<unknown>;
    /** Fires when the picker is first opened, so the catalogue loads then. */
    onWanted: () => void;
}) {
    const { t } = useI18n();
    const m = t.projects.labels;
    const [saving, setSaving] = useState(false);

    const selectedIds = selected.map((label) => label.id);

    /**
     * The cover follows the first label, and is written in the same PATCH.
     *
     * The cover was a colour chosen with no relation to the labels beside it,
     * so a card could carry a red "Bug" chip and a purple stripe. Deriving it
     * removes the second, independent choice rather than hiding it — and the
     * board still reads `cover_color`, so nothing downstream changes.
     *
     * A task with no labels has no cover, which is `''` — the PATCH-clearing
     * convention every other field here uses.
     */
    const coverFor = (ids: string[]): ProjectLabelColor | '' => {
        const first = ids[0];
        if (!first) return '';
        const pool = all.length > 0 ? all : selected;
        return pool.find((label) => label.id === first)?.color ?? '';
    };

    const toggle = async (labelId: string) => {
        const next = new Set(selectedIds);
        if (next.has(labelId)) next.delete(labelId);
        else next.add(labelId);
        const labelIds = [...next];

        setSaving(true);
        try {
            // The whole set every time — the endpoint replaces rather than
            // patches, so there is no add/remove pair to keep in step. The
            // cover rides along so the two cannot disagree.
            await onSaved(
                await api.updateProjectTask(taskId, {
                    labelIds,
                    coverColor: coverFor(labelIds),
                }),
            );
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const pool = all.length > 0 ? all : selected;

    return (
        <ChipPopover
            variant="field"
            multiple
            label={m.title}
            value=""
            values={selectedIds}
            display={
                selected.length === 0 ? (
                    m.add
                ) : (
                    <span className="flex min-w-0 flex-wrap gap-1">
                        {selected.map((label) => (
                            <span
                                key={label.id}
                                className={`rounded px-1.5 py-0.5 text-xs font-medium ${labelClass(label.color)}`}
                            >
                                {label.name}
                            </span>
                        ))}
                    </span>
                )
            }
            tone={selected.length > 0 ? 'default' : 'muted'}
            options={pool.map((label) => ({
                value: label.id,
                label: label.name,
                leading: (
                    <span
                        aria-hidden
                        className={`h-2.5 w-2.5 shrink-0 rounded-sm ${SWATCH[label.color as ProjectLabelColor] ?? SWATCH.GRAY}`}
                    />
                ),
            }))}
            disabled={saving}
            onOpen={onWanted}
            onToggle={toggle}
            note={m.empty}
            footer={
                <span className="flex items-center justify-between gap-2">
                    {/* Said where the choice is made, rather than left for the
                        board to reveal later. */}
                    <span>{task.cover_color || selected.length > 0 ? m.coverNote : null}</span>
                    <Link
                        href={routes.projects.settings}
                        className="shrink-0 font-medium text-blue-600 hover:underline"
                    >
                        {m.manage}
                    </Link>
                </span>
            }
            filterable
        />
    );
}
