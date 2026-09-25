'use client';

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, File as FileIcon, FileText, GripVertical, Link2, Maximize2, Paperclip, Play, Plus, Square, Trash2 } from 'lucide-react';
import Link from 'next/link';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { formatDate, formatDateTime } from '@/lib/format';
import {
    Button,
    Checkbox,
    Input,
    RichTextEditor,
    Field,
    StatusBadge,
} from '@/components/ui';
import {
    labelClass,
    labelsOf,
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
import RemainingSparkline from '@/components/projects/RemainingSparkline';
import { Tabs, TabPanel } from '@/components/ui/compact/Tabs';

/** The five records a card carries, as the bottom tab strip names them. */
type RecordTab = 'comments' | 'activity' | 'time' | 'remaining' | 'attachments';

/**
 * One sidebar field: its name on the left, its control on the right.
 *
 * The five pickers used to wrap as one group, which packed two or three onto a
 * line and left the reader matching chips to meanings by guesswork — "Medium"
 * reads as a priority or a size depending on what you expected to find. A
 * caption column costs one line each and makes the column scannable.
 *
 * `min-w-0` on the control side so a long assignee name or story title
 * ellipsises inside its chip instead of pushing the caption out of the row.
 */
function FieldRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-2">
            <span className="shrink-0 text-xs text-gray-500">{label}</span>
            <div className="flex min-w-0 justify-end">{children}</div>
        </div>
    );
}
import CollapsibleSection from '@/components/projects/CollapsibleSection';
import { movedFar } from '@/components/projects/board-drag';
import { reorderByDrag } from '@/components/projects/checklist-reorder';
import ChipPopover from '@/components/projects/ChipPopover';
import { ImagePreviewModal } from '@/components/ui/ImagePreviewModal';
import { sizedImageUrl } from '@/components/ui/markdown-bridge';
import { api } from '@/lib/api';
import { routes } from '@/lib/routes';
import { useProjectTimerStore } from '@/lib/project-timer-store';
import { useProjectTimerActions } from './use-project-timer';
import { copyTaskLink } from './task-link';
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
    priority?: string;
    assignee?: { id: string; name?: string | null; email: string } | null;
    // Phase 2 made an employee without a login assignable, so "who holds this"
    // is two columns and anything that reads one has to read the other.
    assigneeEmployee?: { id: string; name?: string | null } | null;
    userStory?: { id: string; reference: number; code: string; title: string } | null;
    /** Both come from `TASK_INCLUDE` and were previously discarded here. */
    sprint?: { id: string; name: string; status?: string } | null;
    milestone?: { id: string; name: string } | null;
    labels?: { label: ProjectLabel }[];
    checklistItems?: ChecklistItem[];
    cover_color?: ProjectLabelColor | null;
    timeEntries?: TimeEntry[];
    /** From `TASK_INCLUDE`; lets the collapsed feed say how much it holds. */
    _count?: { comments?: number; subtasks?: number };
}

/** A sprint the task can be moved into. Tenant-wide — see the fetch below. */
interface SprintOption {
    id: string;
    name: string;
    status?: string;
}

/** A row of the project's backlog — the options for the story picker. */
interface StoryOption {
    id: string;
    reference: number;
    code: string;
    title: string;
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

/** Marks a checklist row so a drag can tell which one the pointer is over. */
const CHECKLIST_ITEM_ATTR = 'data-checklist-item';

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

/**
 * The card's content, with no shell around it.
 *
 * Split out so the same body can be a modal (the default, and how every list
 * and board still opens a card) and a page at `/projects/tasks/<id>` that can
 * be linked to. Nothing about the sections changed in the split — this is the
 * grid that used to sit inline inside `ModalShell`, moved out whole.
 *
 * The prop list is wide because the split is deliberately behaviour-preserving:
 * every piece of state and every handler still lives in one owner above, so
 * there is no second copy of "how a card saves" to keep in step. Narrowing it
 * is a later refactor, not part of making the body reusable.
 */
export function TaskCardBody({
    task,
    taskId,
    statuses,
    history,
    busy,
    timeForm,
    setTimeForm,
    hours,
    canSaveWork,
    allLabels,
    members,
    membersFailed,
    stories,
    sprints,
    localeInfo,
    apply,
    refresh,
    markChanged,
    changeStatus,
    changePriority,
    changeSprint,
    saveWork,
    deleteEntry,
    onLabelsWanted,
    onMembersWanted,
    onStoriesWanted,
    onSprintsWanted,
}: {
    task: Task;
    taskId: string;
    statuses: { id: string; name: string; category: string }[];
    history: RemainingLog[];
    busy: boolean;
    timeForm: ReturnType<typeof EMPTY_TIME_FORM>;
    setTimeForm: React.Dispatch<React.SetStateAction<ReturnType<typeof EMPTY_TIME_FORM>>>;
    hours: number;
    canSaveWork: boolean;
    allLabels: ProjectLabel[];
    members: ProjectMemberRow[];
    /** The roster read failed, rather than coming back with nobody on it. */
    membersFailed: boolean;
    stories: StoryOption[];
    sprints: SprintOption[];
    localeInfo: ReturnType<typeof useI18n>['localeInfo'];
    apply: (updated: unknown) => Promise<boolean>;
    refresh: () => Promise<void>;
    markChanged: () => void;
    changeStatus: (statusId: string) => Promise<void>;
    changePriority: (priority: string) => Promise<void>;
    changeSprint: (sprintId: string) => Promise<void>;
    saveWork: (event: React.FormEvent) => Promise<void>;
    deleteEntry: (entryId: string) => Promise<void>;
    onLabelsWanted: () => void;
    onMembersWanted: () => void;
    onStoriesWanted: () => void;
    onSprintsWanted: () => void;
}) {
    const { t } = useI18n();
    const m = t.projects;

    /* No tab selected until one is asked for, which is the whole reason the
       collapsibles these replaced existed.

       Defaulting to Comments would have read better — it is the tab someone
       usually wants — but `ActivitySection` fetches on mount, so making it the
       default put the comment feed, the activity log and the watcher list back
       into the cost of opening a card: three requests became six, undoing the
       reduction 4F measured and recorded. A tab strip that starts closed keeps
       that reduction and still costs one click, the same click the collapsible
       header cost. */
    const [recordTab, setRecordTab] = useState<RecordTab | null>(null);

    /* Log time opens on a heading and a "+", not on its four fields: a card is
       opened to read far more often than to log, and an empty timesheet under
       the description made every read scroll past it. The checklist does the
       same, but owns its own flag — its add form lives inside
       `ChecklistSection` rather than out here. */
    const [loggingTime, setLoggingTime] = useState(false);

    return (
        /* Trello's card, in two columns: the work itself in the wide
           one, everything that merely describes it beside it. Placed
           explicitly rather than by source order so the sidebar sits
           under the title on a phone — where status and assignee are
           the first things reached for — and on the right on desktop. */
        /* `grid-cols-1` is not decoration. Without a base column count only
           `md:grid-cols-3` is declared, so below `md` the grid falls back to a
           single *implicit* track, and an implicit track is `auto` — it sizes
           to its widest content rather than to the grid. Measured on a phone:
           one 574px track inside a 302px grid, clipping the chips, the third
           figure and the date input off the right edge with no scroll to reach
           them. `grid-cols-1` emits `repeat(1, minmax(0, 1fr))`, which is the
           constraint that was missing. `min-w-0` on the child cannot fix this:
           the child was already free to shrink; the track was not. */
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* `min-w-0` is load-bearing: a grid item defaults to
                `min-width: auto`, which refuses to shrink below its content's
                intrinsic width. Without it this column lays out at its widest
                child — measured at 574px inside a 302px grid on a phone — and
                clips the chips, the third figure and the date input off the
                right edge, with no scroll to reach them. */}
            <aside className="min-w-0 space-y-3 md:col-start-3 md:row-start-1">
                <section className="space-y-3 rounded-md border border-gray-200 p-3">
                    <h3 className="text-sm font-medium">{m.task.details}</h3>

                    {/* One field per row: a caption on the left, its chip on
                        the right. They used to wrap as one group, which packed
                        two or three onto a line and left the reader matching
                        chips to meanings by colour and guesswork — "Medium"
                        could be a priority or a size. A caption column costs
                        one line each and makes the sidebar scannable.

                        Still chips rather than native selects: a select is
                        right for four options and wrong for a twenty-person
                        roster or a groomed backlog, because it cannot be typed
                        into. Dates and labels keep their own sections below —
                        dates because start and due share a cross-field check
                        that does not fit one chip. */}
                    <div className="flex flex-col gap-1">
                        <FieldRow label={m.fields.status}>
                        <ChipPopover
                            label={m.fields.status}
                            value={task.status?.id ?? ''}
                            display={task.status?.name ?? m.fields.status}
                            tone={task.status ? 'default' : 'muted'}
                            options={statuses.map((status) => ({
                                value: status.id,
                                label: status.name,
                            }))}
                            disabled={busy}
                            onPick={changeStatus}
                        />
                        </FieldRow>

                        <FieldRow label={m.fields.assignee}>
                        <AssigneeField
                            task={task}
                            taskId={taskId}
                            projectId={task.project?.id}
                            members={members}
                            membersFailed={membersFailed}
                            onSaved={apply}
                            onWanted={onMembersWanted}
                        />
                        </FieldRow>

                        <FieldRow label={m.stories.field}>
                        <UserStoryField
                            task={task}
                            taskId={taskId}
                            stories={stories}
                            onSaved={apply}
                            onWanted={onStoriesWanted}
                        />
                        </FieldRow>

                        {/* New here. Priority was only ever set from the create
                            modal and filtered from the list — the card itself
                            could not change it. `UpdateTaskDto` already takes
                            it, so this is the picker catching up. */}
                        <FieldRow label={m.fields.priority}>
                        <ChipPopover
                            label={m.fields.priority}
                            value={task.priority ?? ''}
                            display={
                                task.priority
                                    ? m.priority[task.priority as keyof typeof m.priority]
                                    : m.fields.priority
                            }
                            tone={
                                task.priority === 'URGENT' || task.priority === 'HIGH'
                                    ? 'warning'
                                    : task.priority
                                      ? 'default'
                                      : 'muted'
                            }
                            options={Object.entries(m.priority).map(([value, label]) => ({
                                value,
                                label: label as string,
                            }))}
                            disabled={busy}
                            onPick={changePriority}
                        />
                        </FieldRow>

                        {/* Sprint was already on every task read and shown
                            nowhere. Clearing it returns the task to the
                            backlog — the module's own words for it. */}
                        <FieldRow label={m.fields.sprint}>
                        <ChipPopover
                            label={m.fields.sprint}
                            value={task.sprint?.id ?? ''}
                            display={task.sprint?.name ?? m.sprint.backlog}
                            tone={task.sprint ? 'default' : 'muted'}
                            options={sprints.map((sprint) => ({
                                value: sprint.id,
                                label: sprint.name,
                                subtitle:
                                    sprint.status === 'ACTIVE'
                                        ? m.sprint.active
                                        : sprint.status === 'COMPLETED'
                                          ? m.sprint.completed
                                          : m.sprint.planned,
                            }))}
                            disabled={busy}
                            onOpen={onSprintsWanted}
                            onPick={changeSprint}
                            emptyLabel={m.sprint.backlog}
                            filterable
                        />
                        </FieldRow>
                    </div>

                    {/* Three across rather than an input above a pair of tiles:
                        estimate, logged and remaining are one thought — what
                        the job was going to cost, what it has cost, what is
                        left — and reading them needs them on one line. The
                        estimate is still the only editable one of the three;
                        logged is the sum of the time entries and remaining is
                        set by the form in the main column, which records why
                        it moved. */}
                    <div>
                        <div className="grid grid-cols-3 gap-2">
                            <EstimateField task={task} taskId={taskId} onSaved={apply} compact />
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

                        {/* The clock, under the three figures it moves. It used
                            to lead the reading column on the grounds of being
                            reachable without scrolling — which it still is here,
                            and now it sits with the numbers it changes rather
                            than above a description it has nothing to do with.
                            Full width because the button carries a word, not
                            just an icon, and a third of this column would clip
                            it in the longer locales. */}
                        <TimerButton taskId={taskId} onChanged={refresh} full />
                    </div>

                    {/* The shape of those three figures over time, at a glance.
                        The full chart is a tab away and answers the same
                        question in more detail; this is here because "is this
                        converging" is worth answering without a click, and the
                        history it draws is already loaded for the tab. */}
                    <RemainingSparkline
                        history={history}
                        dateLocale={localeInfo.dateLocale}
                        labels={{
                            title: m.card.spark.title,
                            remaining: m.overview.remaining,
                            hover: m.card.spark.hover,
                        }}
                    />

                    {/* Read-only, unlike the sprint chip above: milestones have
                        create/update/delete endpoints and no list, so there is
                        nothing to populate a picker from. Shown because the task
                        read already carries it and hiding it served nobody. */}
                    {task.milestone && (
                        <Fact label={m.task.milestone} value={task.milestone.name} />
                    )}
                </section>

                <DatesSection task={task} taskId={taskId} onSaved={apply} />

                {/* One control, not two. Colour and labels were separate
                    sections saying the same thing in two idioms — a label
                    already carries a colour, and the cover was a seventh
                    colour chosen independently of them. The cover now follows
                    the task's first label, so the board draws what the card
                    says rather than something set elsewhere. */}
                <LabelsSection
                    task={task}
                    taskId={taskId}
                    all={allLabels}
                    selected={labelsOf(task)}
                    onSaved={apply}
                    onWanted={onLabelsWanted}
                />
            </aside>

            <div className="space-y-4 md:col-span-2 md:col-start-1 md:row-start-1">
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

                {/* Below the work it describes now, not above it. 4F put this first
                    on the measured grounds that logging an afternoon is the module's
                    most frequent write; asked what someone opens a card *to do*, the
                    answer was to read and understand it. So the reading leads and the
                    form follows — still above the collapsed tail, still never
                    seventh. Revert on evidence, not on argument. */}
                <section className="rounded-md border border-gray-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-medium">{m.time.log}</h3>
                        <Button
                            type="button"
                            variant="secondary"
                            className="max-md:min-h-touch"
                            aria-expanded={loggingTime}
                            onClick={() => setLoggingTime((open) => !open)}
                        >
                            <Plus className="h-4 w-4" />
                            {m.card.logTime}
                        </Button>
                    </div>
                    <form
                        onSubmit={saveWork}
                        className={`mt-2 space-y-2 ${loggingTime ? '' : 'hidden'}`}
                    >
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
                                className="max-md:min-h-touch"
                            >
                                {t.common.save}
                            </Button>
                        </div>
                    </form>
                    <p className="mt-2 text-xs text-gray-500">{m.time.remainingHint}</p>
                </section>

                {/* Everything below here is the record rather than the work,
                    and it is four tabs rather than four stacked collapsibles:
                    they answer different questions about the same task and
                    only one is ever wanted at a time, so stacking them made
                    the card a scroll to reach the last of them.

                    The lazy-fetch guarantee the collapsibles existed for is
                    kept, not traded away — `TabPanel` unmounts what is not
                    selected, so a card opening on Comments still fetches only
                    the comment feed. Six of the ten requests opening a card
                    used to make were for these. */}
                <section className="pt-1">
                    <Tabs<RecordTab>
                        tabs={[
                            { key: 'comments', label: m.card.tabs.comments, count: task._count?.comments },
                            { key: 'activity', label: m.card.tabs.activity },
                            { key: 'time', label: m.card.tabs.time, count: (task.timeEntries ?? []).length },
                            { key: 'remaining', label: m.card.tabs.remaining, count: history.length },
                            { key: 'attachments', label: m.card.tabs.attachments },
                        ]}
                        value={recordTab}
                        onChange={setRecordTab}
                        idPrefix="task-record"
                        label={m.card.record}
                    />

                    <TabPanel tabKey="comments" value={recordTab} idPrefix="task-record">
                        <ActivitySection taskId={taskId} onChanged={markChanged} show="comments" />
                    </TabPanel>

                    <TabPanel tabKey="activity" value={recordTab} idPrefix="task-record">
                        <ActivitySection taskId={taskId} onChanged={markChanged} show="activity" />
                    </TabPanel>

                    <TabPanel tabKey="attachments" value={recordTab} idPrefix="task-record">
                        <AttachmentsSection taskId={taskId} />
                    </TabPanel>

                    <TabPanel tabKey="time" value={recordTab} idPrefix="task-record">
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
                                        className="max-md:min-h-touch px-2 text-red-600"
                                        disabled={busy}
                                        onClick={() => deleteEntry(entry.id)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    </TabPanel>

                    <TabPanel tabKey="remaining" value={recordTab} idPrefix="task-record">
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
                    </TabPanel>
                </section>
            </div>
        </div>
    );
}

/**
 * Everything a task card needs to read and write itself, with no opinion about
 * where it is drawn.
 *
 * Extracted so the modal and the page at `/projects/tasks/<id>` share one copy
 * of "how a card loads and saves". Two copies would drift, and the rules here
 * are the subtle ones — `apply` trusting a PATCH response, the lazy fetches
 * keyed on first touch, and `markChanged` catching a blur-commit that lands
 * after the card is already closed.
 *
 * `onClose` is optional: a page has nothing to close back to, so it omits it
 * and ignores `close`.
 */
export function useTaskCard(
    taskId: string,
    { onClose, onChanged }: { onClose?: () => void; onChanged?: () => void } = {},
) {
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
    /**
     * The read failed, as opposed to returning a project nobody is on. These
     * were one state until people reported the picker as broken: a private
     * project 404s for a non-member, a missing `VIEW_PROJECTS` 403s, and a
     * member holding two stores with neither selected 400s — all three drew the
     * same empty list as a project with no team.
     */
    const [membersFailed, setMembersFailed] = useState(false);
    useEffect(() => {
        if (!projectId || !membersWanted) return;
        let live = true;
        api.getProject(projectId)
            .then((result: unknown) => {
                const rows = (result as { members?: ProjectMemberRow[] } | null)?.members;
                if (!live) return;
                setMembers(Array.isArray(rows) ? rows : []);
                setMembersFailed(false);
            })
            .catch(() => {
                if (!live) return;
                setMembers([]);
                setMembersFailed(true);
            });
        return () => {
            live = false;
        };
    }, [projectId, membersWanted]);

    /**
     * The project's user stories, fetched when the picker is first touched. Same
     * deal as the roster above: the card knows which story it is under from the
     * task itself, so the field reads correctly before this has ever run.
     */
    const [stories, setStories] = useState<StoryOption[]>([]);
    const [storiesWanted, setStoriesWanted] = useState(false);
    useEffect(() => {
        if (!projectId || !storiesWanted) return;
        let live = true;
        api.getProjectStories({ projectId })
            .then((rows: unknown) => {
                if (live) setStories((Array.isArray(rows) ? rows : []) as StoryOption[]);
            })
            .catch(() => {
                if (live) setStories([]);
            });
        return () => {
            live = false;
        };
    }, [projectId, storiesWanted]);

    /**
     * Every sprint in the tenant, fetched when the picker is first opened.
     *
     * **No `projectId`, on purpose.** `Sprint` has no `project_id` — sprints are
     * tenant-level time-boxes that span projects — and `GET /sprints?projectId=`
     * filters by *participation*, i.e. sprints that already hold a task from
     * that project. Passing it would hide exactly the newly-planned sprint
     * somebody opens this picker to move the task into.
     */
    const [sprints, setSprints] = useState<SprintOption[]>([]);
    const [sprintsWanted, setSprintsWanted] = useState(false);
    useEffect(() => {
        if (!sprintsWanted) return;
        let live = true;
        api.getSprints()
            .then((rows: unknown) => {
                if (live) setSprints((Array.isArray(rows) ? rows : []) as SprintOption[]);
            })
            .catch(() => {
                if (live) setSprints([]);
            });
        return () => {
            live = false;
        };
    }, [sprintsWanted]);

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

    const changePriority = async (priority: string) => {
        setBusy(true);
        try {
            // Unlike a status change this cannot move the remaining-hours log,
            // so it takes the plain `apply` rather than `applyWithLog`.
            await apply(await api.updateProjectTask(taskId, { priority }));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.task.saveFailed);
        } finally {
            setBusy(false);
        }
    };

    const changeSprint = async (sprintId: string) => {
        setBusy(true);
        try {
            // '' returns the task to the backlog, which is what the domain calls
            // clearing a sprint. The DTO's ValidateIf lets the empty string past.
            await apply(await api.updateProjectTask(taskId, { sprintId }));
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


    const hoursLeftAfter = Math.max(num(task?.remaining_hours) - hours, 0);

    return {
        task, statuses, history, busy, timeForm, setTimeForm,
        hours, canSaveWork, hoursLeftAfter,
        allLabels, members, membersFailed, stories, sprints, localeInfo,
        apply, refresh, markChanged, close,
        changeStatus, changePriority, changeSprint, saveWork, deleteEntry,
        onLabelsWanted: () => setLabelsWanted(true),
        onMembersWanted: () => setMembersWanted(true),
        onStoriesWanted: () => setStoriesWanted(true),
        onSprintsWanted: () => setSprintsWanted(true),
    };
}

export default function TaskDetailPanel({
    taskId,
    onClose,
    onChanged,
}: {
    taskId: string;
    onClose: () => void;
    onChanged?: () => void;
}) {
    const { t } = useI18n();
    const m = t.projects;
    const card = useTaskCard(taskId, { onClose, onChanged });
    const {
        task,
        close,
        statuses,
        history,
        busy,
        timeForm,
        setTimeForm,
        hours,
        canSaveWork,
        allLabels,
        members,
        membersFailed,
        stories,
        localeInfo,
        apply,
        refresh,
        markChanged,
        changeStatus,
        changePriority,
        saveWork,
        deleteEntry,
        onLabelsWanted,
        onMembersWanted,
        onStoriesWanted,
        onSprintsWanted,
        sprints,
        changeSprint,
    } = card;
    return (
        /* `dismissOnBackdrop={false}`: nearly every field on this card saves on
           blur, so a click beside the panel used to close it mid-edit and the
           half-typed description went with it. Escape and the two Close buttons
           are still there for the times closing is what was meant. */
        <ModalShell onBackdropClick={close} dismissOnBackdrop={false} size="2xl">
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
            >
                <button
                    type="button"
                    onClick={() => void copyTaskLink(taskId, m.task)}
                    aria-label={m.task.copyLink}
                    title={m.task.copyLink}
                    className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-blue-600"
                >
                    <Link2 className="h-4 w-4" aria-hidden />
                </button>
                {/* A link rather than a button: it navigates, so middle-click
                    and copy-link-address should behave like any other link. */}
                <Link
                    href={routes.projects.taskDetail(taskId)}
                    aria-label={m.task.openFull}
                    title={m.task.openFull}
                    className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-blue-600"
                >
                    <Maximize2 className="h-4 w-4" aria-hidden />
                </Link>
            </ModalHeader>

            <div className="max-h-[70vh] overflow-y-auto p-3 md:p-4">
                {!task ? (
                    <p className="text-sm text-gray-500">{t.common.loading}</p>
                ) : (
                    <TaskCardBody
                        task={task}
                        taskId={taskId}
                        statuses={statuses}
                        history={history}
                        busy={busy}
                        timeForm={timeForm}
                        setTimeForm={setTimeForm}
                        hours={hours}
                        canSaveWork={canSaveWork}
                        allLabels={allLabels}
                        members={members}
                        membersFailed={membersFailed}
                        stories={stories}
                        localeInfo={localeInfo}
                        apply={apply}
                        refresh={refresh}
                        markChanged={markChanged}
                        changeStatus={changeStatus}
                        changePriority={changePriority}
                        saveWork={saveWork}
                        deleteEntry={deleteEntry}
                        onLabelsWanted={onLabelsWanted}
                        onMembersWanted={onMembersWanted}
                        onStoriesWanted={onStoriesWanted}
                        onSprintsWanted={onSprintsWanted}
                        sprints={sprints}
                        changeSprint={changeSprint}
                    />
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
function UserStoryField({
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
function EstimateField({
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
function TimerButton({
    taskId,
    onChanged,
    full = false,
}: {
    taskId: string;
    onChanged: () => Promise<void>;
    /** Fill the column, for the narrow sidebar the button now lives in. */
    full?: boolean;
}) {
    const { t } = useI18n();
    const m = t.projects;

    // The one running clock lives in the store, not here. A private copy was
    // what kept the floating tracker hidden after starting from a task card:
    // the POST succeeded, this button flipped to "Stop", and the store — which
    // is the only thing the tracker renders from — never heard about it.
    const timer = useProjectTimerStore((state) => state.timer);
    const loaded = useProjectTimerStore((state) => state.loaded);
    const busy = useProjectTimerStore((state) => state.busy);
    const { load, start, stop } = useProjectTimerActions();

    useEffect(() => {
        // The layout's tracker loads this too, but a task card can be opened on
        // a route where the tracker is gated off, so it asks once itself.
        if (!loaded) load();
    }, [loaded, load]);

    const run = async (action: () => Promise<unknown>) => {
        await action();
        await onChanged();
    };

    const runningOn = timer?.task?.id ?? null;
    const mine = runningOn === taskId;
    const elsewhere = runningOn != null && !mine;

    return (
        <Button
            type="button"
            variant={mine ? 'secondary' : 'ghost'}
            className={`max-md:min-h-touch${full ? ' mt-2 w-full justify-center' : ''}`}
            disabled={busy || elsewhere}
            title={elsewhere ? m.timer.elsewhere : undefined}
            onClick={() => run(() => (mine ? stop() : start({ taskId, tagIds: [] })))}
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
    const uploadImage = useTaskImageUpload(taskId);

    /* A pasted image sits in the text as a placeholder until its upload lands,
       so blurring in between would save the placeholder. The commit waits, and
       `pendingCommit` remembers that it was asked to. */
    const uploading = useRef(false);
    const pendingCommit = useRef(false);

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
                    // A resting container, not a bare hover target. The
                    // description is the first thing read and it used to sit
                    // as loose text with no edge, so an empty one showed
                    // nothing to click and a filled one ran into the checklist
                    // below it. `min-h` keeps the shape whether or not there
                    // is anything in it.
                    className="mt-2 min-h-[10rem] w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-start hover:border-gray-300 hover:bg-gray-100"
                >
                    {description === '' ? (
                        <span className="text-sm text-gray-500">{m.add}</span>
                    ) : (
                        <span className="block text-sm text-gray-700">
                            <Suspense fallback={<span className="whitespace-pre-wrap">{description}</span>}>
                                <Markdown content={description} allowImages />
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
                    if (uploading.current) {
                        pendingCommit.current = true;
                        return;
                    }
                    void commit();
                }}
            >
                <RichTextEditor
                    autoFocus
                    rows={10}
                    value={value}
                    onChange={setValue}
                    disabled={saving}
                    maxLength={DESCRIPTION_MAX}
                    placeholder={m.placeholder}
                    ariaLabel={m.title}
                    onSubmit={commit}
                    uploadImage={uploadImage}
                    onUploadingChange={(busy) => {
                        uploading.current = busy;
                        if (busy || !pendingCommit.current) return;
                        // Blurred while it uploaded: save now, with the link the
                        // upload put in place of the placeholder.
                        pendingCommit.current = false;
                        void commit();
                    }}
                    onCancel={() => {
                        setValue(description);
                        setEditing(false);
                    }}
                />
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
/** Wide enough for a tile on a desktop grid, small enough not to ship the original. */
const THUMBNAIL_WIDTH = 320;
/** Matches the server's cap; checked here too so a 5 MB upload is not started. */
const MAX_BYTES = 5 * 1024 * 1024;

const readAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
    });

/** The half of `ACCEPTED_TYPES` a clipboard can produce. */
const ACCEPTED_IMAGE_TYPES = ACCEPTED_TYPES.filter((type) => type.startsWith('image/'));

/**
 * Keeps an image pasted into the description or a comment, and says where it
 * landed so the editor can link to it.
 *
 * Through the attachment endpoint rather than anywhere new: a pasted screenshot
 * *is* an attachment that happens to be referenced from the text, so it is
 * listed with the rest, held to the same 5 MB cap, and swept up with the task
 * when it goes. The alternative — a second upload path with no row behind it —
 * is how you end up paying Cloudinary for files nothing can find.
 *
 * Reports its own failures: the editor hands back a null and takes the
 * placeholder out of the text, and the reason has to come from whoever knows
 * the limits.
 */
function useTaskImageUpload(taskId: string) {
    const { t } = useI18n();
    const m = t.projects.attachments;

    return useCallback(
        async (file: File) => {
            // Checked before reading, as in the attachments list: no point
            // turning 20 MB into base64 to be told no.
            if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
                toast.error(m.unsupported);
                return null;
            }
            if (file.size > MAX_BYTES) {
                toast.error(m.tooLarge);
                return null;
            }
            try {
                const created = (await api.addTaskAttachment(taskId, {
                    fileBase64: await readAsDataUrl(file),
                    // A screenshot off the clipboard arrives nameless.
                    fileName: file.name || 'pasted-image',
                    mimeType: file.type,
                })) as Attachment;
                return { url: created.file_url, name: created.file_name };
            } catch (error) {
                toast.error(error instanceof Error ? error.message : m.uploadFailed);
                return null;
            }
        },
        [taskId, m],
    );
}

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
    /** Which attachment the preview is open on, or null for closed. */
    const [previewAt, setPreviewAt] = useState<number | null>(null);

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

            <label className="mt-2 inline-flex max-md:min-h-touch cursor-pointer items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
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
                <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                    {items.map((item, at) => (
                        <li key={item.id} className="group relative">
                            <button
                                type="button"
                                aria-label={`${m.preview} ${item.file_name}`}
                                onClick={() => setPreviewAt(at)}
                                className="block w-full overflow-hidden rounded-md border border-gray-200 hover:border-blue-600"
                            >
                                {item.mime_type?.startsWith('image/') ? (
                                    /* The thumbnail is the file itself, asked for
                                       small: a screenshot is recognisable long
                                       before its name is. */
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={sizedImageUrl(item.file_url, THUMBNAIL_WIDTH)}
                                        alt={item.file_name}
                                        loading="lazy"
                                        referrerPolicy="no-referrer"
                                        className="h-24 w-full bg-gray-50 object-cover"
                                    />
                                ) : (
                                    <span className="flex h-24 w-full items-center justify-center bg-gray-50 text-gray-400">
                                        {item.mime_type === 'application/pdf' ? (
                                            <FileText className="h-8 w-8" aria-hidden />
                                        ) : (
                                            <FileIcon className="h-8 w-8" aria-hidden />
                                        )}
                                    </span>
                                )}
                            </button>

                            <div className="mt-1 flex items-start gap-1">
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs text-gray-700">
                                        {item.file_name}
                                    </span>
                                    <span className="text-xs text-gray-400">
                                        {Math.max(1, Math.round((item.file_size ?? 0) / 1024))} KB
                                    </span>
                                </span>
                                <button
                                    type="button"
                                    aria-label={`${m.deleteFile} ${item.file_name}`}
                                    className="max-md:min-h-touch shrink-0 px-1 text-red-600 disabled:opacity-40"
                                    disabled={busy}
                                    onClick={() => remove(item.id)}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {previewAt !== null && (
                <ImagePreviewModal
                    items={items.map((item) => ({
                        url: item.file_url,
                        name: item.file_name,
                        mimeType: item.mime_type,
                    }))}
                    index={previewAt}
                    onIndexChange={setPreviewAt}
                    onClose={() => setPreviewAt(null)}
                />
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
    show = 'all',
}: {
    taskId: string;
    onChanged?: () => void;
    /**
     * Which half of the feed to draw. Comments and the activity log answer
     * different questions — "what did someone say" and "what happened to this
     * task" — and interleaving them buried a two-line reply between six status
     * moves. They are two tabs now, but one fetch: `load()` already pulls both
     * and `mergeFeed` already tags each entry with its `kind`, so the split is
     * a filter rather than a second request.
     *
     * The comment box belongs to `comments` only; there is nothing to write on
     * an activity log.
     */
    show?: 'all' | 'comments' | 'activity';
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
    const uploadImage = useTaskImageUpload(taskId);

    /* One fetch, two tabs: `mergeFeed` already tags every entry with its kind,
       so each tab is a filter over the same feed rather than a second request.

       The two vocabularies do not match and must be mapped rather than
       compared: the tab is `comments` (it holds many) while the entry kind is
       `comment` (it is one). Comparing them directly type-checks — both are
       string-literal unions, they simply never overlap on that member — and
       silently empties the tab. */
    const wantedKind = show === 'comments' ? 'comment' : 'activity';
    const shown = show === 'all' ? feed : feed.filter((entry) => entry.kind === wantedKind);

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

    /* Split from `submit` so Ctrl/⌘+Enter inside the editor and the Comment
       button post the same way — the editor has no form event to hand over. */
    const post = () => {
        const body = draft.trim();
        if (!body) return;
        return run(async () => {
            await api.addTaskComment(taskId, body);
            setDraft('');
        });
    };

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        return post();
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
                    className="max-md:min-h-touch"
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

            {/* Nothing to write on an activity log — it records what the
                system saw, not what anyone wants to say about it. */}
            {show !== 'activity' && (
                <form onSubmit={submit} className="mt-2 space-y-2">
                    {/* The same editor the description uses, for the same
                        reason: a screenshot is half of what anyone wants to say
                        about a bug, and describing one in words is the long way
                        round. `hideHint` because the formatting line is three
                        times the height of the box it would sit under. */}
                    <RichTextEditor
                        rows={2}
                        hideHint
                        value={draft}
                        disabled={saving}
                        ariaLabel={m.commentPlaceholder}
                        placeholder={m.commentPlaceholder}
                        onChange={setDraft}
                        onSubmit={post}
                        uploadImage={uploadImage}
                    />
                    <Button
                        type="submit"
                        className="max-md:min-h-touch"
                        disabled={saving || draft.trim() === ''}
                    >
                        {m.comment}
                    </Button>
                </form>
            )}

            {failed ? (
                <p className="mt-3 text-sm text-danger">{m.loadFailed}</p>
            ) : shown.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">{m.empty}</p>
            ) : (
                <ul className="mt-3 space-y-2">
                    {shown.map((entry) => (
                        <li key={`${entry.kind}-${entry.id}`} className="text-sm">
                            {entry.kind === 'comment' ? (
                                <div className="rounded-md bg-gray-50 p-2">
                                    <p className="text-xs text-gray-500">
                                        {actorName(entry.user) ?? m.someone} ·{' '}
                                        {formatDateTime(entry.created_at)}
                                    </p>
                                    {editingId === entry.id ? (
                                        <div className="mt-1 space-y-2">
                                            <RichTextEditor
                                                rows={2}
                                                hideHint
                                                autoFocus
                                                value={editBody}
                                                disabled={saving}
                                                ariaLabel={m.editComment}
                                                onChange={setEditBody}
                                                onSubmit={() => commitEdit(entry)}
                                                onCancel={() => setEditingId(null)}
                                                uploadImage={uploadImage}
                                            />
                                            <div className="flex gap-2">
                                                <Button
                                                    type="button"
                                                    className="max-md:min-h-touch"
                                                    disabled={saving}
                                                    onClick={() => commitEdit(entry)}
                                                >
                                                    {t.common.save}
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    className="max-md:min-h-touch"
                                                    onClick={() => setEditingId(null)}
                                                >
                                                    {t.common.cancel}
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        /* Markdown, like the description: the
                                           box writes it, and a pasted image is
                                           a markdown image — rendered as the
                                           literal `![…](…)` it would be the one
                                           part of a comment nobody can read. */
                                        <div className="mt-0.5">
                                            <Suspense
                                                fallback={
                                                    <p className="whitespace-pre-wrap">{entry.body}</p>
                                                }
                                            >
                                                <Markdown content={entry.body} allowImages />
                                            </Suspense>
                                        </div>
                                    )}

                                    {/* Only your own — an audit trail nobody
                                        else can rewrite. */}
                                    {me && entry.user?.id === me && editingId !== entry.id && (
                                        <div className="mt-1 flex gap-2 text-xs">
                                            <button
                                                type="button"
                                                className="max-md:min-h-touch text-blue-600"
                                                onClick={() => {
                                                    setEditingId(entry.id);
                                                    setEditBody(entry.body);
                                                }}
                                            >
                                                {t.common.edit}
                                            </button>
                                            <button
                                                type="button"
                                                className="max-md:min-h-touch text-red-600"
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
function LabelsSection({
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
    /** The board card already says this; a second "Drag to move" in nine
        catalogues would be the same sentence twice. */
    const dragLabel = t.projects.board.card.drag;
    /** The add form is behind the "+" in this section's header. */
    const [adding, setAdding] = useState(false);

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

    /**
     * Dragging an item to a new place in the list.
     *
     * Pointer events rather than HTML5 `draggable`, for the reason
     * `board-drag.ts` documents: `dragstart` never fires from touch on iOS
     * Safari or Android Chrome, so a phone could see the handle and not move
     * anything. This is the board's *approach*, not its code — those helpers are
     * two-axis and keyed to columns and cards, and a checklist is one axis.
     *
     * The arrow buttons stay. A drag handle alone is unusable by keyboard, and
     * `moveBy` is already the tested path.
     */
    const [dragging, setDragging] = useState<string | null>(null);
    const [over, setOver] = useState<string | null>(null);
    const origin = useRef<{ x: number; y: number } | null>(null);
    const started = useRef(false);

    const endDrag = () => {
        setDragging(null);
        setOver(null);
        origin.current = null;
        started.current = false;
    };

    const onHandleDown = (item: ChecklistItem) => (event: React.PointerEvent) => {
        // Primary button or touch only: a secondary click opens a context menu
        // rather than starting a drag. (Phrased without the usual hyphenated
        // mouse-button words on purpose — `scripts/rtl-codemod.js` rewrites
        // `right-`/`left-` as plain text, so those spellings fail the RTL
        // no-physical-utilities test even inside a comment.)
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        origin.current = { x: event.clientX, y: event.clientY };
        setDragging(item.id);
    };

    const onHandleMove = (event: React.PointerEvent) => {
        if (!dragging || !origin.current) return;
        // Below the threshold this is a click on the handle, not a drag —
        // the same 6px the board uses.
        if (!started.current) {
            if (!movedFar(origin.current, { x: event.clientX, y: event.clientY })) return;
            started.current = true;
        }
        // `elementFromPoint`, not the event target: the handle has pointer
        // capture, so every move reports the handle no matter what is under it.
        const under = document.elementFromPoint(event.clientX, event.clientY);
        const row = under?.closest(`[${CHECKLIST_ITEM_ATTR}]`);
        const id = row?.getAttribute(CHECKLIST_ITEM_ATTR) ?? null;
        setOver(id && id !== dragging ? id : null);
    };

    const onHandleUp = () => {
        // Read before `endDrag` clears them.
        const next = reorderByDrag(items.map((item) => item.id), dragging, over);
        endDrag();
        if (!next) return;
        // The whole order, exactly as moveBy sends it.
        return run(() => api.reorderTaskChecklist(taskId, next));
    };

    return (
        <section className="rounded-md border border-gray-200 p-3">
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">
                    {m.title}
                    {items.length > 0 && (
                        <span className="ms-2 text-xs font-normal text-gray-500">
                            {done === items.length
                                ? m.allDone
                                : m.progress
                                      .replace('{done}', String(done))
                                      .replace('{total}', String(items.length))}
                        </span>
                    )}
                </h3>
                <Button
                    type="button"
                    variant="secondary"
                    className="max-md:min-h-touch"
                    aria-expanded={adding}
                    onClick={() => setAdding((open) => !open)}
                >
                    <Plus className="h-4 w-4" />
                    {t.projects.card.addChecklistItem}
                </Button>
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
                        <li
                            key={item.id}
                            {...{ [CHECKLIST_ITEM_ATTR]: item.id }}
                            className={`flex items-center gap-2 rounded ${
                                dragging === item.id ? 'opacity-40' : ''
                            } ${over === item.id ? 'ring-2 ring-blue-400' : ''}`}
                        >
                            {/* Not a button: it drags, it does not activate.
                                The arrows beside it are the keyboard path. */}
                            <span
                                // Decorative, and honestly so: `aria-hidden`
                                // rather than an `aria-label`, because a drag
                                // is not something a screen-reader user can
                                // perform here. The arrow buttons beside it are
                                // the accessible path, and they stay.
                                aria-hidden
                                title={dragLabel}
                                onPointerDown={onHandleDown(item)}
                                onPointerMove={onHandleMove}
                                onPointerUp={onHandleUp}
                                onPointerCancel={endDrag}
                                className="cursor-grab touch-none px-0.5 text-gray-300 hover:text-gray-500"
                            >
                                <GripVertical className="h-4 w-4" />
                            </span>
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
                                    className={`max-md:min-h-touch flex-1 text-start text-sm ${
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

            {/* Behind the "+" in the header rather than always open: a card is
                read far more often than it is added to, and a permanently
                open input under the last item made every read scroll past a
                field nobody was filling. */}
            {adding && (
                <form onSubmit={add} className="mt-2 flex gap-2">
                    <Input
                        value={newText}
                        placeholder={m.placeholder}
                        className="flex-1"
                        autoFocus
                        onChange={(e) => setNewText(e.target.value)}
                    />
                    <Button
                        type="submit"
                        variant="secondary"
                        className="max-md:min-h-touch"
                        disabled={saving || newText.trim() === ''}
                    >
                        {m.add}
                    </Button>
                </form>
            )}
        </section>
    );
}

/**
 * A labelled fact that is not editable here. Deliberately a row rather than a
 * `Metric` tile: a tile reads as a figure worth comparing, and a milestone name
 * is neither a figure nor comparable.
 */
function Fact({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-xs text-gray-500">{label}</span>
            <span className="min-w-0 truncate font-medium">{value}</span>
        </div>
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
