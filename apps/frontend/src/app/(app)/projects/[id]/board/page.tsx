'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AlignLeft, CheckSquare, GitBranch, GripVertical, MessageSquare, Plus, X } from 'lucide-react';
import { PageShell, PageHeader, Button, Input, Select, StatusBadge } from '@/components/ui';
import type { StatusBadgeTone } from '@/components/ui';
import BurndownChart, { type BurndownPoint } from '@/components/projects/BurndownChart';
import TaskDetailPanel from '@/components/projects/TaskDetailPanel';
import {
    CARD_ATTR,
    COLUMN_ATTR,
    movedFar,
    resolveDropTarget,
    toFullIndex,
    type DropTarget,
} from '@/components/projects/board-drag';
import {
    applyFilters,
    assigneeNameOf,
    assigneeOptionsFrom,
    countTasks,
    coverClass,
    dueStateOf,
    hasActiveFilter,
    initialsOf,
    isOverWip,
    labelClass,
    labelsOf,
    NO_FILTERS,
    type BoardColumn,
    type BoardFilters,
    type BoardTask,
    type DueState,
    type ProjectLabel,
} from '@/components/projects/board-tasks';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { projectChildBreadcrumbs } from '@/lib/page-breadcrumbs';

interface Sprint {
    id: string;
    name: string;
    goal?: string | null;
    status: string;
    start_date: string;
    end_date: string;
}

interface ProjectSummary {
    id: string;
    code: string;
    name: string;
}

type Mode = 'kanban' | 'scrum';

const num = (value: unknown): number => (value == null ? 0 : Number(value));

const DUE_TONE: Record<DueState, StatusBadgeTone> = {
    done: 'success',
    overdue: 'danger',
    today: 'warning',
    soon: 'warning',
    later: 'neutral',
};

interface DragState {
    taskId: string;
    pointerId: number;
    origin: { x: number; y: number };
    point: { x: number; y: number };
    /** False until a mouse gesture passes the threshold — before that it is a click. */
    active: boolean;
    target: DropTarget | null;
    title: string;
}

export default function ProjectBoardPage() {
    const params = useParams<{ id: string }>();
    const projectId = params.id;
    const { t } = useI18n();
    const m = t.projects;

    const [mode, setMode] = useState<Mode>('kanban');
    const [project, setProject] = useState<ProjectSummary | null>(null);
    const [columns, setColumns] = useState<BoardColumn[]>([]);
    const [sprints, setSprints] = useState<Sprint[]>([]);
    const [burndown, setBurndown] = useState<BurndownPoint[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [openTaskId, setOpenTaskId] = useState<string | null>(null);
    const [filters, setFilters] = useState<BoardFilters>(NO_FILTERS);
    const [labels, setLabels] = useState<ProjectLabel[]>([]);
    const [drag, setDrag] = useState<DragState | null>(null);

    const activeSprint = useMemo(() => sprints.find((s) => s.status === 'ACTIVE') ?? null, [sprints]);

    const visibleColumns = useMemo(() => applyFilters(columns, filters), [columns, filters]);
    const assigneeOptions = useMemo(() => assigneeOptionsFrom(columns), [columns]);
    const filtered = hasActiveFilter(filters);
    const shown = countTasks(visibleColumns);
    const total = countTasks(columns);

    const loadBoard = useCallback(
        async (sprintId?: string) => {
            setLoading(true);
            try {
                const board = await api.getProjectBoard(projectId, sprintId);
                setColumns(((board as { columns?: BoardColumn[] })?.columns ?? []) as BoardColumn[]);
            } catch {
                setColumns([]);
            } finally {
                setLoading(false);
            }
        },
        [projectId],
    );

    useEffect(() => {
        api.getSprints(projectId)
            .then((list: unknown) => setSprints(Array.isArray(list) ? list : []))
            .catch(() => setSprints([]));
    }, [projectId]);

    // Tenant-wide, so it does not need re-fetching when the board or sprint
    // changes. A failure only costs the label filter, not the board.
    useEffect(() => {
        api.getProjectLabels()
            .then((list: unknown) => setLabels(Array.isArray(list) ? list : []))
            .catch(() => setLabels([]));
    }, []);

    // Header identity only. Fetched separately from the board so switching
    // kanban/scrum or sprint does not re-request it, and a failure here leaves
    // the board usable with a plain breadcrumb rather than blocking it.
    useEffect(() => {
        api.getProject(projectId)
            .then((res: unknown) => setProject(res as ProjectSummary))
            .catch(() => setProject(null));
    }, [projectId]);

    useEffect(() => {
        // Scrum mode is the active sprint's slice of the same board; kanban is
        // everything. One fetch either way.
        loadBoard(mode === 'scrum' ? (activeSprint?.id ?? undefined) : undefined);
    }, [mode, activeSprint, loadBoard]);

    useEffect(() => {
        if (mode !== 'scrum' || !activeSprint) {
            setBurndown(null);
            return;
        }
        api.getSprintBurndown(activeSprint.id)
            .then((res: unknown) => setBurndown((res as { series?: BurndownPoint[] })?.series ?? []))
            .catch(() => setBurndown([]));
    }, [mode, activeSprint]);

    const move = async (taskId: string, statusId: string, sortOrder: number) => {
        const previous = columns;
        // Optimistic: the card should follow the cursor, not the round-trip.
        setColumns((cols) => {
            const task = cols.flatMap((c) => c.tasks).find((tk) => tk.id === taskId);
            if (!task) return cols;
            return cols.map((col) => {
                const without = col.tasks.filter((tk) => tk.id !== taskId);
                if (col.id !== statusId) return { ...col, tasks: without };
                const next = [...without];
                next.splice(Math.min(sortOrder, next.length), 0, { ...task, status_id: statusId });
                return { ...col, tasks: next };
            });
        });

        try {
            await api.moveProjectTask(taskId, {
                statusId,
                sortOrder,
                ...(mode === 'scrum' && activeSprint ? { sprintId: activeSprint.id } : {}),
            });
        } catch (error) {
            setColumns(previous);
            toast.error(error instanceof Error ? error.message : m.board.moveFailed);
        }
    };

    const addCard = async (statusId: string, title: string) => {
        try {
            await api.createProjectTask({
                projectId,
                title,
                statusId,
                ...(mode === 'scrum' && activeSprint ? { sprintId: activeSprint.id } : {}),
            });
            await loadBoard(mode === 'scrum' ? (activeSprint?.id ?? undefined) : undefined);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.board.createFailed);
            throw error;
        }
    };

    // ── Pointer dragging ────────────────────────────────────────────────────
    // Replaces HTML5 draggable, which never fires from touch input, so the board
    // was read-only on a phone. A card body only arms a mouse drag; touch has to
    // come through the grip, or the column could not be scrolled by finger.

    const beginDrag = (
        e: React.PointerEvent,
        task: BoardTask,
        { fromHandle }: { fromHandle: boolean },
    ) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (e.pointerType !== 'mouse' && !fromHandle) return;

        const element = e.currentTarget as Element & { setPointerCapture?: (id: number) => void };
        element.setPointerCapture?.(e.pointerId);

        setDrag({
            taskId: task.id,
            pointerId: e.pointerId,
            origin: { x: e.clientX, y: e.clientY },
            point: { x: e.clientX, y: e.clientY },
            // From the grip the intent is unambiguous, so skip the threshold.
            active: fromHandle,
            target: null,
            title: task.title,
        });
    };

    const continueDrag = (e: React.PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointerId) return;

        const point = { x: e.clientX, y: e.clientY };
        const active = drag.active || movedFar(drag.origin, point);
        if (!active) {
            setDrag({ ...drag, point });
            return;
        }

        e.preventDefault();
        setDrag({
            ...drag,
            point,
            active: true,
            target: resolveDropTarget(point, drag.taskId, document),
        });
    };

    const endDrag = (e: React.PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        setDrag(null);

        // Under the threshold the gesture was a tap: open the card.
        if (!drag.active) {
            setOpenTaskId(drag.taskId);
            return;
        }
        if (!drag.target) return;

        const target = drag.target;
        const sourceColumn = columns.find((column) =>
            column.tasks.some((task) => task.id === drag.taskId),
        );
        const sameSpot =
            sourceColumn?.id === target.columnId &&
            sourceColumn?.tasks.findIndex((task) => task.id === drag.taskId) === target.index;
        if (sameSpot) return;

        move(
            drag.taskId,
            target.columnId,
            toFullIndex(
                columns.find((column) => column.id === target.columnId),
                visibleColumns.find((column) => column.id === target.columnId)?.tasks ?? [],
                target.index,
                drag.taskId,
            ),
        );
    };

    const cancelDrag = () => setDrag(null);

    const startSprint = async (sprintId: string) => {
        try {
            await api.startSprint(sprintId);
            const list = await api.getSprints(projectId);
            setSprints(Array.isArray(list) ? list : []);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.sprint.oneActive);
        }
    };

    return (
        <PageShell>
            <PageHeader
                title={m.board.title}
                subtitle={activeSprint && mode === 'scrum' ? activeSprint.name : m.board.allTasks}
                breadcrumbs={projectChildBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.projects,
                    project,
                    m.board.title,
                )}
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="inline-flex overflow-hidden rounded-md border border-gray-200">
                            {(['kanban', 'scrum'] as Mode[]).map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => setMode(value)}
                                    className={`min-h-touch px-3 text-sm ${
                                        mode === value
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-white text-gray-700'
                                    }`}
                                >
                                    {value === 'kanban' ? m.board.kanban : m.board.scrum}
                                </button>
                            ))}
                        </div>
                        {/* Planning is tenant-wide now: a sprint pulls from every
                            project, so it lives in Sprints rather than here. */}
                        <Link href={routes.projects.columns(projectId)}>
                            <Button variant="secondary" className="min-h-touch">
                                {m.columns.title}
                            </Button>
                        </Link>
                        <Link href={routes.projects.sprints}>
                            <Button variant="secondary" className="min-h-touch">
                                {m.sprint.sprints}
                            </Button>
                        </Link>
                    </div>
                }
            />

            {mode === 'scrum' && !activeSprint && (
                <div className="rounded-md border border-gray-200 bg-white p-3 text-sm text-gray-600">
                    <p>{m.board.noSprint}</p>
                    {sprints.filter((s) => s.status === 'PLANNED').length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                            {sprints
                                .filter((s) => s.status === 'PLANNED')
                                .map((sprint) => (
                                    <Button
                                        key={sprint.id}
                                        variant="secondary"
                                        className="min-h-touch"
                                        onClick={() => startSprint(sprint.id)}
                                    >
                                        {m.sprint.start}: {sprint.name}
                                    </Button>
                                ))}
                        </div>
                    )}
                </div>
            )}

            {mode === 'scrum' && activeSprint && burndown && (
                <section className="rounded-md border border-gray-200 bg-white p-3 md:p-4">
                    <h2 className="mb-3 text-sm font-medium">{m.burndown.title}</h2>
                    <BurndownChart series={burndown} />
                </section>
            )}

            <BoardFilterBar
                filters={filters}
                onChange={setFilters}
                assignees={assigneeOptions}
                labels={labels}
                shown={shown}
                total={total}
            />

            {/* Columns scroll inside their own container so the page body never
                scrolls sideways on a phone. */}
            <div className="overflow-x-auto pb-2">
                <div className="flex min-w-max gap-3">
                    {visibleColumns.map((column) => {
                        const remaining = column.tasks.reduce(
                            (total, task) => total + num(task.remaining_hours),
                            0,
                        );
                        const dropIndex =
                            drag?.active && drag.target?.columnId === column.id
                                ? drag.target.index
                                : null;
                        // Against the whole column, not the filtered view: a
                        // filter must not make an over-limit column look fine.
                        const full = columns.find((c) => c.id === column.id);
                        const overWip = isOverWip(full);
                        return (
                            <div
                                key={column.id}
                                {...{ [COLUMN_ATTR]: column.id }}
                                className="flex w-72 flex-col rounded-md border border-gray-200 bg-gray-50"
                            >
                                <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
                                    <span className="text-sm font-medium">{column.name}</span>
                                    <span className="flex items-center gap-1.5 text-xs text-gray-500">
                                        {column.wip_limit ? (
                                            <StatusBadge
                                                tone={overWip ? 'danger' : 'neutral'}
                                                aria-label={
                                                    overWip
                                                        ? m.columns.overLimit.replace(
                                                              '{name}',
                                                              column.name,
                                                          )
                                                        : undefined
                                                }
                                            >
                                                {full?.tasks.length ?? column.tasks.length}/
                                                {column.wip_limit}
                                            </StatusBadge>
                                        ) : (
                                            <span>{column.tasks.length}</span>
                                        )}
                                        {remaining > 0 ? `${remaining}${m.board.columnTotal}` : ''}
                                    </span>
                                </div>

                                <div className="flex flex-1 flex-col gap-2 p-2">
                                    {column.tasks.length === 0 && dropIndex === null && (
                                        <p className="px-1 py-4 text-center text-xs text-gray-400">
                                            {filtered ? m.board.noMatches : m.board.emptyColumn}
                                        </p>
                                    )}
                                    {column.tasks.map((task, index) => (
                                        <Fragment key={task.id}>
                                            {dropIndex === index && <DropIndicator />}
                                            <TaskCard
                                                task={task}
                                                dragging={drag?.active === true && drag.taskId === task.id}
                                                onPointerDownBody={(e) =>
                                                    beginDrag(e, task, { fromHandle: false })
                                                }
                                                onPointerDownHandle={(e) =>
                                                    beginDrag(e, task, { fromHandle: true })
                                                }
                                                onPointerMove={continueDrag}
                                                onPointerUp={endDrag}
                                                onPointerCancel={cancelDrag}
                                                onOpen={() => setOpenTaskId(task.id)}
                                            />
                                        </Fragment>
                                    ))}
                                    {dropIndex === column.tasks.length && <DropIndicator />}

                                    <AddCardComposer
                                        onAdd={(title) => addCard(column.id, title)}
                                        columnName={column.name}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Follows the finger, because on touch there is no cursor to tell
                you the card has been picked up. */}
            {drag?.active && (
                <div
                    aria-hidden
                    className="pointer-events-none fixed z-modal max-w-[16rem] truncate rounded-md border border-blue-300 bg-white px-2 py-1 text-sm shadow-lg"
                    style={{ left: drag.point.x + 12, top: drag.point.y + 12 }}
                >
                    {drag.title}
                </div>
            )}

            {loading && <p className="text-sm text-gray-500">{t.common.loading}</p>}

            {openTaskId && (
                <TaskDetailPanel
                    taskId={openTaskId}
                    onClose={() => setOpenTaskId(null)}
                    onChanged={() =>
                        loadBoard(mode === 'scrum' ? (activeSprint?.id ?? undefined) : undefined)
                    }
                />
            )}
        </PageShell>
    );
}

function DropIndicator() {
    return <div aria-hidden className="h-0.5 rounded-full bg-blue-600" />;
}

function BoardFilterBar({
    filters,
    onChange,
    assignees,
    labels,
    shown,
    total,
}: {
    filters: BoardFilters;
    onChange: (next: BoardFilters) => void;
    assignees: { key: string; label: string }[];
    labels: ProjectLabel[];
    shown: number;
    total: number;
}) {
    const { t } = useI18n();
    const f = t.projects.board.filters;
    const active = hasActiveFilter(filters);

    return (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-gray-200 bg-white p-3">
            <label className="flex flex-col gap-1 text-xs text-gray-500">
                {f.assignee}
                <Select
                    className="min-h-touch"
                    value={filters.assignee}
                    onChange={(e) => onChange({ ...filters, assignee: e.target.value })}
                >
                    <option value="all">{t.common.all}</option>
                    <option value="none">{f.unassigned}</option>
                    {assignees.map((option) => (
                        <option key={option.key} value={option.key}>
                            {option.label}
                        </option>
                    ))}
                </Select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-gray-500">
                {f.priority}
                <Select
                    className="min-h-touch"
                    value={filters.priority}
                    onChange={(e) => onChange({ ...filters, priority: e.target.value })}
                >
                    <option value="all">{t.common.all}</option>
                    {(['URGENT', 'HIGH', 'MEDIUM', 'LOW'] as const).map((value) => (
                        <option key={value} value={value}>
                            {t.projects.priority[value]}
                        </option>
                    ))}
                </Select>
            </label>

            {/* Only offered once the tenant has labels — an empty select is a
                dead control that just makes the bar longer. */}
            {labels.length > 0 && (
                <label className="flex flex-col gap-1 text-xs text-gray-500">
                    {f.label}
                    <Select
                        className="min-h-touch"
                        value={filters.label}
                        onChange={(e) => onChange({ ...filters, label: e.target.value })}
                    >
                        <option value="all">{t.common.all}</option>
                        <option value="none">{f.noLabel}</option>
                        {labels.map((label) => (
                            <option key={label.id} value={label.id}>
                                {label.name}
                            </option>
                        ))}
                    </Select>
                </label>
            )}

            <label className="flex flex-col gap-1 text-xs text-gray-500">
                {f.due}
                <Select
                    className="min-h-touch"
                    value={filters.due}
                    onChange={(e) =>
                        onChange({ ...filters, due: e.target.value as BoardFilters['due'] })
                    }
                >
                    <option value="all">{t.common.all}</option>
                    <option value="overdue">{f.overdue}</option>
                    <option value="today">{f.dueToday}</option>
                    <option value="week">{f.dueThisWeek}</option>
                    <option value="none">{f.noDueDate}</option>
                </Select>
            </label>

            {active && (
                <>
                    <span className="pb-2 text-xs text-gray-500">
                        {f.showing
                            .replace('{shown}', String(shown))
                            .replace('{total}', String(total))}
                    </span>
                    <Button
                        type="button"
                        variant="ghost"
                        className="min-h-touch"
                        onClick={() => onChange(NO_FILTERS)}
                    >
                        <X className="mr-1 h-4 w-4" />
                        {f.clear}
                    </Button>
                </>
            )}
        </div>
    );
}

/**
 * Trello's defining interaction: type a title, press Enter, keep typing. The
 * composer stays open after a save so a column can be filled in one go, and
 * anything more than a title is left to the detail panel.
 */
function AddCardComposer({
    onAdd,
    columnName,
}: {
    onAdd: (title: string) => Promise<void>;
    columnName: string;
}) {
    const { t } = useI18n();
    const m = t.projects.board;

    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState('');
    const [saving, setSaving] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = title.trim();
        if (!trimmed || saving) return;
        setSaving(true);
        try {
            await onAdd(trimmed);
            setTitle('');
        } catch {
            // onAdd has already reported it; keep the text so it is not lost.
        } finally {
            setSaving(false);
        }
    };

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="min-h-touch rounded-md px-2 py-1.5 text-left text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            >
                <Plus className="mr-1 inline h-4 w-4" />
                {m.addCard}
            </button>
        );
    }

    return (
        <form onSubmit={submit} className="space-y-2">
            <Input
                autoFocus
                value={title}
                aria-label={`${m.addCard} — ${columnName}`}
                placeholder={m.newCardPlaceholder}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                        setOpen(false);
                        setTitle('');
                    }
                }}
            />
            <div className="flex items-center gap-2">
                <Button type="submit" className="min-h-touch" disabled={saving || !title.trim()}>
                    {t.common.add}
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    className="min-h-touch"
                    onClick={() => {
                        setOpen(false);
                        setTitle('');
                    }}
                >
                    {t.common.cancel}
                </Button>
            </div>
        </form>
    );
}

function TaskCard({
    task,
    dragging,
    onOpen,
    onPointerDownBody,
    onPointerDownHandle,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
}: {
    task: BoardTask;
    dragging: boolean;
    onOpen: () => void;
    onPointerDownBody: (e: React.PointerEvent) => void;
    onPointerDownHandle: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: () => void;
}) {
    const { t, locale } = useI18n();
    const c = t.projects.board.card;

    const labels = labelsOf(task);
    const cover = coverClass(task.cover_color);
    const checklist = task.checklistItems ?? [];
    const checklistDone = checklist.filter((item) => item.is_done).length;
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
            // pan-y keeps the column scrollable by finger; the grip below opts
            // out of that so a touch drag can start there.
            className={`touch-pan-y overflow-hidden rounded-md border border-gray-200 bg-white text-left text-sm shadow-sm hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-600 md:cursor-grab ${
                dragging ? 'opacity-40' : ''
            }`}
        >
            {cover && <div aria-hidden className={`h-1.5 w-full ${cover}`} />}

            <div className="p-2">
            <div className="flex items-start gap-1">
                <button
                    type="button"
                    aria-label={c.drag}
                    tabIndex={-1}
                    onPointerDown={onPointerDownHandle}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerCancel}
                    className="-ml-1 min-h-touch touch-none px-1 text-gray-300 hover:text-gray-500"
                >
                    <GripVertical className="h-4 w-4" />
                </button>
                <p className="flex-1 pt-0.5 font-medium">{task.title}</p>
            </div>

            {/* Above the badges, as on a Trello card: colour is what the eye
                scans a column by, so it should not be buried in the meta row. */}
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

            {(due || task.priority === 'HIGH' || task.priority === 'URGENT') && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {due && <StatusBadge tone={DUE_TONE[due]}>{dueLabel}</StatusBadge>}
                    {(task.priority === 'HIGH' || task.priority === 'URGENT') && (
                        <StatusBadge tone={task.priority === 'URGENT' ? 'danger' : 'warning'}>
                            {t.projects.priority[task.priority as keyof typeof t.projects.priority]}
                        </StatusBadge>
                    )}
                </div>
            )}

            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-gray-500">
                {task.description && (
                    <AlignLeft className="h-3.5 w-3.5" aria-label={c.hasDescription} />
                )}
                {checklist.length > 0 && (
                    <span
                        className={`inline-flex items-center gap-1 ${
                            checklistDone === checklist.length ? 'text-emerald-600' : ''
                        }`}
                        aria-label={c.checklist
                            .replace('{done}', String(checklistDone))
                            .replace('{total}', String(checklist.length))}
                    >
                        <CheckSquare className="h-3.5 w-3.5" aria-hidden />
                        {checklistDone}/{checklist.length}
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
                {task.remaining_hours != null && <span>{num(task.remaining_hours)}h</span>}

                {assigneeName ? (
                    <span
                        title={assigneeName}
                        aria-label={assigneeName}
                        className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-[10px] font-medium text-blue-700"
                    >
                        {initialsOf(assigneeName)}
                    </span>
                ) : (
                    <span className="ml-auto text-gray-400">{c.unassigned}</span>
                )}
            </div>
            </div>
        </article>
    );
}
