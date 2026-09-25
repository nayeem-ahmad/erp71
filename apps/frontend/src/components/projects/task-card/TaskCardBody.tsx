'use client';

import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button, Field, Input, StatusBadge } from '@/components/ui';
import { Tabs, TabPanel } from '@/components/ui/compact/Tabs';
import { formatDate, formatDateTime } from '@/lib/format';
import { labelsOf, type ProjectLabel } from '@/components/projects/board-tasks';
import ChipPopover from '@/components/projects/ChipPopover';
import RemainingHoursChart from '@/components/projects/RemainingHoursChart';
import RemainingSparkline from '@/components/projects/RemainingSparkline';
import { useI18n } from '@/lib/i18n';
import {
    EMPTY_TIME_FORM,
    num,
    type ProjectMemberRow,
    type RecordTab,
    type RemainingLog,
    type SprintOption,
    type StoryOption,
    type Task,
} from './model';
import {
    AssigneeField,
    DatesSection,
    EstimateField,
    LabelsSection,
    UserStoryField,
} from './fields';
import TimerButton from './TimerButton';
import DescriptionSection from './DescriptionSection';
import ChecklistSection from './ChecklistSection';
import ActivitySection from './ActivitySection';
import AttachmentsSection from './AttachmentsSection';

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
