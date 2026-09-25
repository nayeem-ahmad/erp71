'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Field, Input } from '@/components/ui';
import {
    labelClass,
    type ProjectLabel,
    type ProjectLabelColor,
} from '@/components/projects/board-tasks';
import CollapsibleSection from '@/components/projects/CollapsibleSection';
import ChipPopover from '@/components/projects/ChipPopover';
import { api } from '@/lib/api';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import {
    dateInputValue,
    num,
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
            label={m.task.assignee}
            value={assigneeValueOf(task)}
            display={holder?.label ?? m.task.unassigned}
            tone={holder ? 'default' : 'muted'}
            options={options.map((option) => ({ value: option.value, label: option.label }))}
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
        const rows = [...stories];
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

    const reference = (story: StoryOption) => story.code;

    return (
        <ChipPopover
            label={m.stories.field}
            value={task.userStory?.id ?? ''}
            display={task.userStory ? reference(task.userStory) : m.stories.none}
            tone={task.userStory ? 'default' : 'muted'}
            options={options.map((story) => ({
                value: story.id,
                label: reference(story),
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
 */
export function EstimateField({
    task,
    taskId,
    onSaved,
    compact = false,
}: {
    task: Task;
    taskId: string;
    onSaved: (updated: unknown) => Promise<unknown>;
    /** Render as one of the three figures rather than as a labelled form field. */
    compact?: boolean;
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

    // `compact` puts it in the three-across row beside Logged and Remaining,
    // where it has to read as one of three figures rather than as a form field
    // — same control, same id, borrowing `Metric`'s frame so the row is even.
    if (compact) {
        return (
            <div className="rounded-md border border-gray-200 px-1.5 py-1 text-center">
                <label htmlFor="task-estimate" className="block text-xs text-gray-500">
                    {m.task.estimate}
                </label>
                <input
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
                            event.stopPropagation();
                            setValue(current);
                        }
                    }}
                    className="w-full border-0 bg-transparent p-0 text-center text-sm font-medium tabular-nums text-gray-900 focus:outline-none focus:ring-0"
                />
            </div>
        );
    }

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
 * Start and due, saved on change rather than behind a Save button — there are
 * two fields and no validation to batch, so a button would only be one more
 * click between the user and the thing they came here to do.
 */
export function DatesSection({
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
            {/* Due only. The start date came off the card deliberately: it was
                a second date to keep in step with the first hour logged, which
                already says when work began, and two sources for one fact is
                how they drift. The column is untouched — `start_date` is still
                written by whatever sets it and still read by the Gantt; this
                card just stopped asking someone to type it.

                `Field` only ties its label to the control when given htmlFor —
                without the matching id these inputs have no accessible name. */}
            <div className="grid gap-2">
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
export function LabelsSection({
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
    /** Fires when the section is first opened, so the catalogue loads then. */
    onWanted: () => void;
}) {
    const { t } = useI18n();
    const m = t.projects.labels;
    const [saving, setSaving] = useState(false);

    const selectedIds = new Set(selected.map((label) => label.id));

    /**
     * The cover follows the first label, and is written in the same PATCH.
     *
     * This is what merging the two controls actually means: the cover was a
     * colour chosen with no relation to the labels beside it, so a card could
     * carry a red "Bug" chip and a purple stripe. Deriving it removes the
     * second, independent choice rather than hiding it — and the board still
     * reads `cover_color`, so nothing downstream changes.
     *
     * A task with no labels has no cover, which is `''` — the same clear
     * convention the dates and the old cover picker used.
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
                    const isCover = task.cover_color != null && on && selected[0]?.id === label.id;
                    return (
                        <button
                            key={label.id}
                            type="button"
                            disabled={saving}
                            aria-pressed={on}
                            onClick={() => toggle(label.id)}
                            className={`max-md:min-h-touch rounded px-2 py-1 text-xs font-medium disabled:opacity-60 ${labelClass(label.color)} ${
                                on ? 'ring-2 ring-blue-600' : 'opacity-50'
                            }`}
                        >
                            {label.name}
                            {/* The one that is also the card's cover. Marked so
                                the rule is visible rather than something the
                                board reveals later. */}
                            {isCover && <span className="ms-1 opacity-70">●</span>}
                        </button>
                    );
                })}
            </div>
        </CollapsibleSection>
    );
}
