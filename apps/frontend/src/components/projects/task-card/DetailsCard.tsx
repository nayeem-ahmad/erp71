'use client';

import type { ReactNode } from 'react';
import {
    BookOpen,
    CalendarDays,
    CircleDot,
    Flag,
    Layers,
    Milestone,
    Repeat,
    Tag,
    User,
    type LucideIcon,
} from 'lucide-react';
import { CompactSection } from '@/components/ui';
import { labelsOf } from '@/components/projects/board-tasks';
import ChipPopover from '@/components/projects/ChipPopover';
import { formatDate } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { relativeTime, type Task } from './model';
import type { TaskCard } from './useTaskCard';
import { AssigneeField, DueDateField, LabelsField, UserStoryField } from './fields';
import StatusDot from './StatusDot';

/**
 * Priority as the colour of its flag — the one place on the card a priority
 * should catch the eye. Urgent is danger and high a warning, per the semantic
 * colours; medium and low stay grey rather than inventing accents.
 */
const PRIORITY_FLAG: Record<string, string> = {
    URGENT: 'fill-red-100 text-red-600',
    HIGH: 'fill-amber-100 text-amber-600',
    MEDIUM: 'text-gray-500',
    LOW: 'text-gray-400',
};

/**
 * One row of the list: its name on the left, its value on the right.
 *
 * A `dt`/`dd` pair in a two-column grid shared by every row, so the name
 * column is as wide as its longest name and no wider. A fixed width would
 * truncate Bangla, which runs about a fifth longer than English; a
 * justify-between row put the value three hundred pixels from its name on a
 * wide screen.
 */
function Property({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
    return (
        <>
            <dt className="flex min-h-8 items-center gap-1.5 text-xs text-gray-500">
                <Icon className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
                {label}
            </dt>
            <dd className="flex min-w-0 items-center">{children}</dd>
        </>
    );
}

/**
 * The card's decision fields, one per line, as a property list.
 *
 * They were a column of chips, and every set chip was the same blue pill, so
 * status, priority and sprint looked alike and none of them said anything by
 * its colour. They are quiet values now — no border until hovered, grey when
 * empty — and colour appears only where it means something: the status dot,
 * the priority flag, an overdue date, the labels' own colours.
 */
export default function DetailsCard({ task, card }: { task: Task; card: TaskCard }) {
    const { t, localeInfo } = useI18n();
    const m = t.projects;
    const epic = task.userStory?.epic ?? null;
    const creatorName = task.creator ? task.creator.name || task.creator.email : null;

    return (
        <CompactSection title={m.task.details} titleStyle="heading">
            <dl className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-4 gap-y-0.5">
                <Property icon={CircleDot} label={m.fields.status}>
                    <ChipPopover
                        variant="field"
                        label={m.fields.status}
                        value={task.status?.id ?? ''}
                        display={
                            task.status ? (
                                <span className="flex min-w-0 items-center gap-1.5">
                                    <StatusDot category={task.status.category} />
                                    <span className="truncate">{task.status.name}</span>
                                </span>
                            ) : (
                                m.fields.status
                            )
                        }
                        tone={task.status ? 'default' : 'muted'}
                        options={card.statuses.map((status) => ({
                            value: status.id,
                            label: status.name,
                            leading: <StatusDot category={status.category} />,
                        }))}
                        disabled={card.busy}
                        onPick={card.changeStatus}
                    />
                </Property>

                <Property icon={User} label={m.fields.assignee}>
                    <AssigneeField
                        task={task}
                        taskId={task.id}
                        projectId={task.project?.id}
                        members={card.members}
                        membersFailed={card.membersFailed}
                        onSaved={card.apply}
                        onWanted={card.onMembersWanted}
                    />
                </Property>

                <Property icon={Flag} label={m.fields.priority}>
                    <ChipPopover
                        variant="field"
                        label={m.fields.priority}
                        value={task.priority ?? ''}
                        display={
                            task.priority ? (
                                <span className="flex items-center gap-1.5">
                                    <Flag
                                        className={`h-3.5 w-3.5 shrink-0 ${PRIORITY_FLAG[task.priority] ?? 'text-gray-500'}`}
                                        aria-hidden
                                    />
                                    {m.priority[task.priority as keyof typeof m.priority]}
                                </span>
                            ) : (
                                m.fields.priority
                            )
                        }
                        tone={task.priority ? 'default' : 'muted'}
                        options={Object.entries(m.priority).map(([value, label]) => ({
                            value,
                            label: label as string,
                            leading: (
                                <Flag
                                    className={`h-3.5 w-3.5 shrink-0 ${PRIORITY_FLAG[value] ?? 'text-gray-500'}`}
                                    aria-hidden
                                />
                            ),
                        }))}
                        disabled={card.busy}
                        onPick={card.changePriority}
                    />
                </Property>

                <Property icon={CalendarDays} label={m.dates.due}>
                    <DueDateField task={task} taskId={task.id} onSaved={card.apply} />
                </Property>

                <Property icon={Tag} label={m.labels.title}>
                    <LabelsField
                        task={task}
                        taskId={task.id}
                        all={card.allLabels}
                        selected={labelsOf(task)}
                        onSaved={card.apply}
                        onWanted={card.onLabelsWanted}
                    />
                </Property>

                <Property icon={BookOpen} label={m.stories.field}>
                    <UserStoryField
                        task={task}
                        taskId={task.id}
                        stories={card.stories}
                        onSaved={card.apply}
                        onWanted={card.onStoriesWanted}
                    />
                </Property>

                {/* Read-only: a task reaches its epic through its story, and
                    moving it to another epic means moving the story. Shown only
                    when there is one, like the milestone below. */}
                {epic && (
                    <Property icon={Layers} label={m.epicList.epic}>
                        <span className="flex min-w-0 items-center gap-1.5 px-2 py-1 text-sm text-gray-700">
                            <span className="shrink-0 font-medium">{epic.code}</span>
                            <span className="truncate">{epic.title}</span>
                        </span>
                    </Property>
                )}

                {/* Clearing it returns the task to the backlog — the module's
                    own word for having no sprint. */}
                <Property icon={Repeat} label={m.fields.sprint}>
                    <ChipPopover
                        variant="field"
                        label={m.fields.sprint}
                        value={task.sprint?.id ?? ''}
                        display={
                            task.sprint ? (
                                <span className="flex min-w-0 items-center gap-1.5">
                                    <span className="truncate">{task.sprint.name}</span>
                                    {task.sprint.status === 'ACTIVE' && (
                                        <span className="shrink-0 rounded-full bg-blue-50 px-1.5 text-[11px] font-medium text-blue-700">
                                            {m.sprint.active}
                                        </span>
                                    )}
                                </span>
                            ) : (
                                m.sprint.backlog
                            )
                        }
                        tone={task.sprint ? 'default' : 'muted'}
                        options={card.sprints.map((sprint) => ({
                            value: sprint.id,
                            label: sprint.name,
                            subtitle:
                                sprint.status === 'ACTIVE'
                                    ? m.sprint.active
                                    : sprint.status === 'COMPLETED'
                                      ? m.sprint.completed
                                      : m.sprint.planned,
                        }))}
                        disabled={card.busy}
                        onOpen={card.onSprintsWanted}
                        onPick={card.changeSprint}
                        emptyLabel={m.sprint.backlog}
                        filterable
                    />
                </Property>

                {/* Read-only, unlike the sprint: milestones have no list
                    endpoint, so there is nothing to populate a picker from. */}
                {task.milestone && (
                    <Property icon={Milestone} label={m.task.milestone}>
                        <span className="truncate px-2 py-1 text-sm text-gray-700">{task.milestone.name}</span>
                    </Property>
                )}
            </dl>

            {task.created_at && (
                <div className="mt-3 space-y-0.5 border-t border-gray-100 pt-2 text-xs text-gray-500">
                    <p>
                        {creatorName
                            ? formatMessage(m.task.createdBy, {
                                  date: formatDate(task.created_at),
                                  name: creatorName,
                              })
                            : formatMessage(m.task.createdOn, { date: formatDate(task.created_at) })}
                    </p>
                    {task.updated_at && (
                        <p title={formatDate(task.updated_at)}>
                            {formatMessage(m.task.updatedAt, {
                                when: relativeTime(task.updated_at, localeInfo.dateLocale),
                            })}
                        </p>
                    )}
                </div>
            )}
        </CompactSection>
    );
}
