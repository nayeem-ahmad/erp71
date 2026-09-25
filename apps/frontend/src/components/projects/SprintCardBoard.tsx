'use client';

import { useState } from 'react';
import { FolderKanban, GitBranch, GripVertical, MessageSquare, Play, Undo2 } from 'lucide-react';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { useProjectTimerStore } from '@/lib/project-timer-store';
import RunningClock from './RunningClock';
import { useIsTimerRunningFor } from './TimerChip';
import { useProjectTimerActions } from './use-project-timer';
import {
    CARD_ATTR,
    COLUMN_ATTR,
    LANE_ATTR,
    movedFar,
    resolveDropTarget,
    type DropTarget,
} from './board-drag';
import {
    coverClass,
    dueStateOf,
    initialsOf,
    labelClass,
    projectLabelOf,
    type DueState,
} from './board-tasks';
import { CATEGORY_TINT } from './board-view';
import { NO_LANE, assigneeNameOf, hours, laneKeyOf, sumHours, type SprintLane, type SprintLaneMode } from './sprint-table';
import { sortOrderForDrop, tasksByColumn, type SprintCardTask, type StatusColumn } from './sprint-cards';

const DUE_TONE: Record<DueState, StatusBadgeTone> = {
    done: 'success',
    overdue: 'danger',
    today: 'warning',
    soon: 'warning',
    later: 'neutral',
};

interface DragState {
    task: SprintCardTask;
    pointerId: number;
    origin: { x: number; y: number };
    point: { x: number; y: number };
    /** False until a mouse gesture passes the threshold — before that it is a click. */
    active: boolean;
    target: DropTarget | null;
}

/**
 * The sprint's committed work as a board: one column per status, merged by
 * name across the sprint's projects (see `sprint-cards.ts`).
 *
 * Borrowed from the project board: the card itself (cover strip, labels, due
 * and priority badges, the running clock, counts, hours, assignee initials),
 * category-tinted column heads with their count and hours left, and pointer
 * dragging — mouse from anywhere on the card, touch from the grip — so a card
 * moves on a phone too. Dropping a card changes its status; with swimlanes on,
 * a card moves between columns inside its own row.
 */
export default function SprintCardBoard({
    lanes,
    laneMode,
    columns,
    busy,
    onOpen,
    onReturn,
    onMove,
}: {
    lanes: SprintLane[];
    laneMode: SprintLaneMode;
    columns: StatusColumn[];
    busy: boolean;
    onOpen: (taskId: string) => void;
    onReturn: (task: SprintCardTask) => void;
    onMove: (task: SprintCardTask, statusId: string, sortOrder: number) => void;
}) {
    const { t, fmt } = useI18n();
    const m = t.projects;
    const [drag, setDrag] = useState<DragState | null>(null);

    const grouped = laneMode !== 'none';

    const begin = (e: React.PointerEvent, task: SprintCardTask, fromHandle: boolean) => {
        if (busy) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (e.pointerType !== 'mouse' && !fromHandle) return;
        (e.currentTarget as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(
            e.pointerId,
        );
        setDrag({
            task,
            pointerId: e.pointerId,
            origin: { x: e.clientX, y: e.clientY },
            point: { x: e.clientX, y: e.clientY },
            active: fromHandle,
            target: null,
        });
    };

    const move = (e: React.PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const point = { x: e.clientX, y: e.clientY };
        const active = drag.active || movedFar(drag.origin, point);
        if (!active) return;
        e.preventDefault();
        setDrag({ ...drag, point, active, target: resolveDropTarget(point, drag.task.id, document) });
    };

    const end = (e: React.PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        setDrag(null);
        if (!drag.active) {
            onOpen(drag.task.id);
            return;
        }
        const target = drag.target;
        if (!target) return;

        const task = drag.task;
        if (grouped && target.laneKey !== laneKeyOf(task, laneMode)) {
            toast.info(m.sprint.laneLocked);
            return;
        }
        const column = columns.find((candidate) => candidate.key === target.columnId);
        if (!column) return;
        const statusId = task.project?.id ? column.statusIds[task.project.id] : undefined;
        if (!statusId) {
            toast.error(
                fmt(m.sprint.noColumnForProject, {
                    project: task.project?.code ?? '—',
                    column: column.name,
                }),
            );
            return;
        }

        const lane = lanes.find((candidate) => (grouped ? candidate.key === target.laneKey : true));
        const visible = tasksByColumn((lane?.tasks ?? []) as SprintCardTask[])[column.key] ?? [];
        const sortOrder = sortOrderForDrop(task, statusId, visible, target.index);
        // Dropped back where it was: nothing to send.
        if (task.status?.id === statusId && visible.findIndex((card) => card.id === task.id) === target.index) {
            return;
        }
        onMove(task, statusId, sortOrder);
    };

    const cancel = () => setDrag(null);

    const handlers = (task: SprintCardTask) => ({
        onPointerDownBody: (e: React.PointerEvent) => begin(e, task, false),
        onPointerDownHandle: (e: React.PointerEvent) => {
            e.stopPropagation();
            begin(e, task, true);
        },
        onPointerMove: move,
        onPointerUp: end,
        onPointerCancel: cancel,
    });

    const renderColumn = (column: StatusColumn, cards: SprintCardTask[], laneKey?: string) => {
        const tint = CATEGORY_TINT[column.category] ?? CATEGORY_TINT.TODO;
        const left = sumHours(cards).remaining;
        const isTarget =
            drag?.active &&
            drag.target?.columnId === column.key &&
            (laneKey === undefined || drag.target.laneKey === laneKey);
        const others = cards.filter((card) => card.id !== drag?.task.id || !drag?.active);
        return (
            <div
                key={column.key}
                className={`flex w-72 shrink-0 flex-col rounded-md border bg-gray-50 ${
                    isTarget ? 'border-blue-400 ring-1 ring-blue-300' : 'border-gray-200'
                }`}
                data-testid="sprint-card-column"
            >
                <div className={`h-1 rounded-t-md ${tint.bar}`} aria-hidden />
                <div className="flex items-center gap-2 px-2 py-1.5">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${tint.dot}`} aria-hidden />
                    <h3 className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-700">{column.name}</h3>
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${tint.chip}`}>
                        {cards.length}
                    </span>
                    <span className="text-[11px] tabular-nums text-gray-500">
                        {left}
                        {m.board.columnTotal}
                    </span>
                </div>
                <div
                    {...{ [COLUMN_ATTR]: column.key }}
                    {...(laneKey !== undefined ? { [LANE_ATTR]: laneKey } : {})}
                    className="flex min-h-16 flex-1 flex-col gap-2 p-2 pt-0"
                >
                    {cards.map((task, index) => {
                        const showIndicator = isTarget && drag?.target?.index === others.indexOf(task);
                        return (
                            <div key={task.id} className="flex flex-col gap-2">
                                {showIndicator && <DropIndicator />}
                                <SprintCard
                                    task={task}
                                    dragging={Boolean(drag?.active && drag.task.id === task.id)}
                                    busy={busy}
                                    onOpen={() => onOpen(task.id)}
                                    onReturn={() => onReturn(task)}
                                    index={index}
                                    {...handlers(task)}
                                />
                            </div>
                        );
                    })}
                    {isTarget && (drag?.target?.index ?? 0) >= others.length && <DropIndicator />}
                </div>
            </div>
        );
    };

    const laneTitle = (lane: SprintLane) => {
        if (lane.key !== NO_LANE) return lane.code ? `${lane.code} · ${lane.title ?? ''}` : (lane.title ?? '');
        return laneMode === 'story' ? m.board.laneNoStory : m.board.laneUnassigned;
    };

    return (
        <div className={`overflow-x-auto p-3 ${drag?.active ? 'select-none' : ''}`}>
            <div className="inline-flex min-w-full flex-col gap-3">
                {lanes.map((lane) => {
                    const byColumn = tasksByColumn(lane.tasks as SprintCardTask[]);
                    return (
                        <section key={lane.key} className="space-y-2" data-testid="sprint-card-lane">
                            {grouped && (
                                <h3 className="sticky start-0 w-fit text-xs font-medium text-gray-700">
                                    {laneTitle(lane)}
                                    <span className="ms-2 font-normal text-gray-500">{lane.tasks.length}</span>
                                </h3>
                            )}
                            <div className="flex items-stretch gap-3">
                                {columns.map((column) =>
                                    renderColumn(column, byColumn[column.key] ?? [], grouped ? lane.key : undefined),
                                )}
                            </div>
                        </section>
                    );
                })}
            </div>
            {drag?.active && (
                <div
                    aria-hidden
                    className="pointer-events-none fixed z-50 max-w-64 truncate rounded-md border border-blue-300 bg-white px-2 py-1 text-xs font-medium text-gray-800 shadow-md"
                    style={{ left: drag.point.x + 12, top: drag.point.y + 12 }}
                >
                    {drag.task.title}
                </div>
            )}
        </div>
    );
}

function DropIndicator() {
    return <div aria-hidden className="h-0.5 rounded bg-blue-600" />;
}

function SprintCard({
    task,
    dragging,
    busy,
    onOpen,
    onReturn,
    onPointerDownBody,
    onPointerDownHandle,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
}: {
    task: SprintCardTask;
    index: number;
    dragging: boolean;
    busy: boolean;
    onOpen: () => void;
    onReturn: () => void;
    onPointerDownBody: (e: React.PointerEvent) => void;
    onPointerDownHandle: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: () => void;
}) {
    const { t, locale } = useI18n();
    const c = t.projects.board.card;
    const tm = t.projects.timer;

    const timerRunning = useIsTimerRunningFor(task.id);
    const timerBusy = useProjectTimerStore((state) => state.busy);
    const { start: startTimer, stop: stopTimer } = useProjectTimerActions();

    const cover = coverClass(task.cover_color);
    const labels = (task.labels ?? []).map((entry) => entry.label);
    const comments = task._count?.comments ?? 0;
    const subtasks = task._count?.subtasks ?? 0;
    const due = dueStateOf(task.due_date, task.completed_at);
    const dueLabel =
        due === 'overdue'
            ? c.overdue
            : due === 'today'
              ? c.dueToday
              : c.due.replace('{date}', formatDate(task.due_date, locale));
    const assigneeName = assigneeNameOf(task);
    const projectLabel = projectLabelOf(task.project ?? null);
    const urgent = task.priority === 'HIGH' || task.priority === 'URGENT';
    const done = task.status?.category === 'DONE';
    const estimate = hours(task.estimate_hours);
    const remaining = hours(task.remaining_hours);

    const stop = (e: React.SyntheticEvent) => e.stopPropagation();

    return (
        <article
            {...{ [CARD_ATTR]: task.id }}
            role="button"
            tabIndex={0}
            aria-label={`${c.open}: ${task.title}`}
            onPointerDown={onPointerDownBody}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen();
                }
            }}
            data-testid="sprint-card"
            className={`group relative touch-pan-y overflow-hidden rounded-md border bg-white text-start text-sm shadow-sm transition-[border-color,box-shadow] duration-150 hover:border-blue-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-600 md:cursor-grab ${
                timerRunning ? 'border-emerald-500 ring-1 ring-emerald-300' : 'border-gray-200'
            } ${dragging ? 'opacity-40' : ''}`}
        >
            {cover && <div aria-hidden className={`h-1.5 w-full ${cover}`} />}
            <div className="p-2.5">
                <div className="flex items-start gap-1">
                    <button
                        type="button"
                        aria-label={c.drag}
                        tabIndex={-1}
                        onPointerDown={onPointerDownHandle}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerCancel}
                        className="-ms-1 min-h-touch touch-none px-1 text-gray-300 hover:text-gray-500 md:hidden"
                    >
                        <GripVertical className="h-4 w-4" />
                    </button>
                    <p
                        className={`min-w-0 flex-1 pt-0.5 text-sm font-medium leading-snug ${
                            done ? 'text-gray-500 line-through' : 'text-gray-900'
                        }`}
                    >
                        {task.title}
                    </p>
                    <span className="flex shrink-0 items-center md:absolute md:end-1 md:top-1 md:rounded md:border md:border-gray-200 md:bg-white md:p-0.5 md:opacity-0 md:shadow-sm md:transition-opacity md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                        <button
                            type="button"
                            aria-label={t.projects.sprint.removeFromSprint}
                            title={t.projects.sprint.removeFromSprint}
                            tabIndex={-1}
                            disabled={busy}
                            onPointerDown={stop}
                            onClick={(e) => {
                                e.stopPropagation();
                                onReturn();
                            }}
                            className="max-md:min-h-touch max-md:min-w-touch inline-flex items-center justify-center rounded px-1 text-gray-400 hover:text-amber-600 disabled:opacity-40"
                        >
                            <Undo2 className="h-3.5 w-3.5" />
                        </button>
                    </span>
                </div>

                {labels.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                        {labels.map((label) => (
                            <span
                                key={label.id}
                                className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${labelClass(label.color)}`}
                            >
                                {label.name}
                            </span>
                        ))}
                    </div>
                )}

                {timerRunning && (
                    <div className="mt-1.5 flex items-center gap-1">
                        <RunningClock
                            label={tm.running}
                            stopLabel={tm.stop}
                            busy={timerBusy}
                            onStop={() => void stopTimer()}
                        />
                    </div>
                )}

                {(due || urgent) && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {due && <StatusBadge tone={DUE_TONE[due]}>{dueLabel}</StatusBadge>}
                        {urgent && (
                            <StatusBadge tone={task.priority === 'URGENT' ? 'danger' : 'warning'}>
                                {t.projects.priority[task.priority as keyof typeof t.projects.priority]}
                            </StatusBadge>
                        )}
                    </div>
                )}

                <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-gray-500">
                    {projectLabel && (
                        <span
                            title={task.project?.name ?? undefined}
                            className="inline-flex min-w-0 max-w-32 items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-gray-600"
                        >
                            <FolderKanban className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span className="sr-only">{c.project}: </span>
                            <span className="truncate">{projectLabel}</span>
                        </span>
                    )}
                    {task.userStory && (
                        <span title={task.userStory.title} className="font-medium text-gray-600">
                            {task.userStory.code}
                        </span>
                    )}
                    {comments > 0 && (
                        <span
                            className="inline-flex items-center gap-1"
                            aria-label={c.comments.replace('{count}', String(comments))}
                        >
                            <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                            {comments}
                        </span>
                    )}
                    {subtasks > 0 && (
                        <span
                            className="inline-flex items-center gap-1"
                            aria-label={c.subtasks.replace('{count}', String(subtasks))}
                        >
                            <GitBranch className="h-3.5 w-3.5" aria-hidden />
                            {subtasks}
                        </span>
                    )}
                    <span className="tabular-nums" title={`${t.projects.sprint.colRemaining} / ${t.projects.sprint.colEstimate}`}>
                        {remaining}/{estimate}h
                    </span>
                    {!timerRunning && (
                        <button
                            type="button"
                            aria-label={tm.start}
                            title={tm.start}
                            tabIndex={-1}
                            onPointerDown={stop}
                            onClick={(e) => {
                                e.stopPropagation();
                                void startTimer({ taskId: task.id, tagIds: [] });
                            }}
                            disabled={timerBusy}
                            className="max-md:min-h-touch max-md:min-w-touch inline-flex items-center justify-center rounded px-1 text-gray-300 transition-colors hover:text-emerald-600 disabled:opacity-40 md:group-hover:text-gray-400"
                        >
                            <Play className="h-3.5 w-3.5" />
                        </button>
                    )}
                    {assigneeName ? (
                        <span
                            title={assigneeName}
                            aria-label={assigneeName}
                            className="ms-auto inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-[10px] font-medium text-blue-700"
                        >
                            {initialsOf(assigneeName)}
                        </span>
                    ) : (
                        <span className="ms-auto text-gray-400">{c.unassigned}</span>
                    )}
                </div>
            </div>
        </article>
    );
}
