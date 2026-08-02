'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PageShell, PageHeader, Button, StatusBadge } from '@/components/ui';
import BurndownChart, { type BurndownPoint } from '@/components/projects/BurndownChart';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { projectChildBreadcrumbs } from '@/lib/page-breadcrumbs';

interface BoardTask {
    id: string;
    title: string;
    priority: string;
    remaining_hours?: string | null;
    estimate_hours?: string | null;
    logged_hours?: number;
    assignee?: { id: string; name?: string | null; email: string } | null;
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
                                        <article
                                            key={task.id}
                                            draggable
                                            onDragStart={(e) => {
                                                e.dataTransfer.setData('text/plain', task.id);
                                                setDragging(task.id);
                                            }}
                                            onDragEnd={() => setDragging(null)}
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                const taskId =
                                                    e.dataTransfer.getData('text/plain') || dragging;
                                                if (taskId && taskId !== task.id) {
                                                    move(taskId, column.id, index);
                                                }
                                                setDragging(null);
                                            }}
                                            className="cursor-grab rounded-md border border-gray-200 bg-white p-2 text-sm shadow-sm"
                                        >
                                            <p className="font-medium">{task.title}</p>
                                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                                                {task.remaining_hours != null && (
                                                    <StatusBadge tone="info">
                                                        {num(task.remaining_hours)}h
                                                    </StatusBadge>
                                                )}
                                                {task.assignee && (
                                                    <span>{task.assignee.name ?? task.assignee.email}</span>
                                                )}
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {loading && <p className="text-sm text-gray-500">{t.common.loading}</p>}
        </PageShell>
    );
}
