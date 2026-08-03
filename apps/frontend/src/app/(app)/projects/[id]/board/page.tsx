'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AlignLeft, CheckSquare, GitBranch, MessageSquare } from 'lucide-react';
import { PageShell, PageHeader, Button, StatusBadge } from '@/components/ui';
import type { StatusBadgeTone } from '@/components/ui';
import BurndownChart, { type BurndownPoint } from '@/components/projects/BurndownChart';
import TaskDetailPanel from '@/components/projects/TaskDetailPanel';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { projectChildBreadcrumbs } from '@/lib/page-breadcrumbs';

interface BoardTask {
    id: string;
    title: string;
    description?: string | null;
    priority: string;
    due_date?: string | null;
    completed_at?: string | null;
    remaining_hours?: string | null;
    estimate_hours?: string | null;
    logged_hours?: number;
    assignee?: { id: string; name?: string | null; email: string } | null;
    // Phase 2 made an employee without a login assignable. The card has to read
    // both or those tasks look unassigned.
    assigneeEmployee?: { id: string; name?: string | null } | null;
    checklistItems?: { id: string; is_done: boolean }[];
    _count?: { subtasks?: number; comments?: number } | null;
    status_id: string;
}

interface BoardColumn {
    id: string;
    name: string;
    category: string;
    tasks: BoardTask[];
}

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

/** Local calendar day as YYYY-MM-DD, to compare against a `@db.Date` string. */
function dayKey(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

type DueState = 'done' | 'overdue' | 'today' | 'soon' | 'later';

const DUE_TONE: Record<DueState, StatusBadgeTone> = {
    done: 'success',
    overdue: 'danger',
    today: 'warning',
    soon: 'warning',
    later: 'neutral',
};

/**
 * Compared as date strings rather than Date objects: `due_date` is a `@db.Date`
 * serialised at UTC midnight, so `new Date(due) < new Date()` calls a task due
 * today overdue for anyone east of UTC — which is everyone here.
 */
function dueStateOf(dueDate?: string | null, completedAt?: string | null): DueState | null {
    if (!dueDate) return null;
    if (completedAt) return 'done';

    const due = dueDate.slice(0, 10);
    const today = dayKey(new Date());
    if (due < today) return 'overdue';
    if (due === today) return 'today';

    const soon = new Date();
    soon.setDate(soon.getDate() + 2);
    return due <= dayKey(soon) ? 'soon' : 'later';
}

function initialsOf(name: string): string {
    return name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0] ?? '')
        .join('')
        .toUpperCase();
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
    const [dragging, setDragging] = useState<string | null>(null);
    const [openTaskId, setOpenTaskId] = useState<string | null>(null);

    const activeSprint = useMemo(() => sprints.find((s) => s.status === 'ACTIVE') ?? null, [sprints]);

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

            {/* Columns scroll inside their own container so the page body never
                scrolls sideways on a phone. */}
            <div className="overflow-x-auto pb-2">
                <div className="flex min-w-max gap-3">
                    {columns.map((column) => {
                        const remaining = column.tasks.reduce(
                            (total, task) => total + num(task.remaining_hours),
                            0,
                        );
                        return (
                            <div
                                key={column.id}
                                className="flex w-72 flex-col rounded-md border border-gray-200 bg-gray-50"
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    const taskId = e.dataTransfer.getData('text/plain') || dragging;
                                    if (taskId) move(taskId, column.id, column.tasks.length);
                                    setDragging(null);
                                }}
                            >
                                <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
                                    <span className="text-sm font-medium">{column.name}</span>
                                    <span className="text-xs text-gray-500">
                                        {column.tasks.length}
                                        {remaining > 0 ? ` · ${remaining}${m.board.columnTotal}` : ''}
                                    </span>
                                </div>

                                <div className="flex flex-1 flex-col gap-2 p-2">
                                    {column.tasks.length === 0 && (
                                        <p className="px-1 py-4 text-center text-xs text-gray-400">
                                            {m.board.emptyColumn}
                                        </p>
                                    )}
                                    {column.tasks.map((task, index) => (
                                        <TaskCard
                                            key={task.id}
                                            task={task}
                                            onOpen={() => setOpenTaskId(task.id)}
                                            onDragStart={(e) => {
                                                e.dataTransfer.setData('text/plain', task.id);
                                                setDragging(task.id);
                                            }}
                                            onDragEnd={() => setDragging(null)}
                                            onDropOnCard={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                const taskId =
                                                    e.dataTransfer.getData('text/plain') || dragging;
                                                if (taskId && taskId !== task.id) {
                                                    move(taskId, column.id, index);
                                                }
                                                setDragging(null);
                                            }}
                                        />
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

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

function TaskCard({
    task,
    onOpen,
    onDragStart,
    onDragEnd,
    onDropOnCard,
}: {
    task: BoardTask;
    onOpen: () => void;
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: () => void;
    onDropOnCard: (e: React.DragEvent) => void;
}) {
    const { t, locale } = useI18n();
    const c = t.projects.board.card;

    // A native drag does not fire a click in Chrome but does in some browsers,
    // and a drag that ends where it started reads as a click everywhere. Without
    // this, dropping a card opens it.
    const draggedRef = useRef(false);

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

    const assigneeName =
        task.assignee?.name ?? task.assignee?.email ?? task.assigneeEmployee?.name ?? null;

    return (
        <article
            draggable
            role="button"
            tabIndex={0}
            aria-label={`${c.open}: ${task.title}`}
            onPointerDown={() => {
                draggedRef.current = false;
            }}
            onDragStart={(e) => {
                draggedRef.current = true;
                onDragStart(e);
            }}
            onDragEnd={onDragEnd}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDropOnCard}
            onClick={() => {
                if (draggedRef.current) {
                    draggedRef.current = false;
                    return;
                }
                onOpen();
            }}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen();
                }
            }}
            className="cursor-grab rounded-md border border-gray-200 bg-white p-2 text-left text-sm shadow-sm hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
            <p className="font-medium">{task.title}</p>

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
        </article>
    );
}
