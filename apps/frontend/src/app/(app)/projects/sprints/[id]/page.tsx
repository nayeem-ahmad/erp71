'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Eye, LayoutGrid, Pencil, Plus, Search, Table2, Trash2, Undo2 } from 'lucide-react';
import {
    PageShell,
    PageHeader,
    Button,
    Select,
    StatusBadge,
    ConfirmDialog,
    Input,
} from '@/components/ui';
import BurndownChart, { type BurndownPoint } from '@/components/projects/BurndownChart';
import SprintBacklogModal from '@/components/projects/SprintBacklogModal';
import SprintCardBoard from '@/components/projects/SprintCardBoard';
import TaskDetailPanel from '@/components/projects/TaskDetailPanel';
import {
    NO_LANE,
    SPRINT_LANE_MODES,
    assigneeNameOf,
    assigneeOptions,
    groupSprintTasks,
    hours,
    laneKeyOf,
    sprintStats,
    sprintTimeline,
    sumHours,
    todayKey,
    type SprintLaneMode,
    type SprintTask,
} from '@/components/projects/sprint-table';
import {
    buildStatusColumns,
    matchesSprintSearch,
    type ProjectStatusColumn,
    type SprintCardTask,
} from '@/components/projects/sprint-cards';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { formatCalendarDate } from '@/lib/format';

interface Sprint {
    id: string;
    name: string;
    goal?: string | null;
    status: string;
    start_date: string;
    end_date: string;
}

/** Per viewer and per browser, like the board's swimlanes: how one person reads the page. */
const LANE_STORAGE_KEY = 'erp71.sprint.swimlanes';
const VIEW_STORAGE_KEY = 'erp71.sprint.view';

type SprintViewMode = 'table' | 'cards';

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        return allowed.includes(raw as T) ? (raw as T) : fallback;
    } catch {
        return fallback;
    }
}

function writeStored(key: string, value: string) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Storage blocked — the choice just does not survive a reload.
    }
}

const cellNum = (value: number | null | undefined) =>
    value == null ? '' : String(Math.round(value * 100) / 100);

export default function SprintDetailPage() {
    const params = useParams<{ id: string }>();
    const sprintId = params.id;
    const { t, fmt, locale } = useI18n();
    const m = t.projects;

    const [sprint, setSprint] = useState<Sprint | null>(null);
    const [tasks, setTasks] = useState<SprintCardTask[]>([]);
    const [projectColumns, setProjectColumns] = useState<Record<string, ProjectStatusColumn[]>>({});
    const [search, setSearch] = useState('');
    const [viewMode, setViewMode] = useState<SprintViewMode>('table');
    // `all`, or an assignee key as `laneKeyOf(task, 'assignee')` gives it.
    const [assignee, setAssignee] = useState('all');
    const [burndown, setBurndown] = useState<BurndownPoint[] | null>(null);
    const [laneMode, setLaneMode] = useState<SprintLaneMode>('none');
    const [adding, setAdding] = useState(false);
    const [openTaskId, setOpenTaskId] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<SprintTask | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        setLaneMode(readStored(LANE_STORAGE_KEY, SPRINT_LANE_MODES, 'none'));
        setViewMode(readStored<SprintViewMode>(VIEW_STORAGE_KEY, ['table', 'cards'], 'table'));
    }, []);

    const load = useCallback(async () => {
        try {
            const [detail, sprintPage, burndownRes] = await Promise.all([
                api.getSprint(sprintId),
                api.getProjectTasks({ sprintId, limit: 200 }),
                api.getSprintBurndown(sprintId).catch(() => null),
            ]);
            setSprint(detail as Sprint);
            setTasks((sprintPage?.items ?? []) as SprintCardTask[]);
            setBurndown((burndownRes as { series?: BurndownPoint[] } | null)?.series ?? []);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.sprint.loadFailed);
        }
    }, [sprintId, m.sprint.loadFailed]);

    useEffect(() => {
        void load();
    }, [load]);

    // Each project's own board columns, for the card view's status columns.
    // Keyed by the set of projects so adding a task from a new project fetches
    // that project's columns, and nothing is refetched otherwise.
    const projectIds = useMemo(
        () => [...new Set(tasks.map((task) => task.project?.id).filter(Boolean) as string[])].sort(),
        [tasks],
    );
    const projectKey = projectIds.join(',');
    useEffect(() => {
        if (!projectKey) return;
        let cancelled = false;
        void Promise.all(
            projectKey.split(',').map(async (id) => {
                const columns = await api.getProjectColumns(id).catch(() => []);
                return [id, (Array.isArray(columns) ? columns : []) as ProjectStatusColumn[]] as const;
            }),
        ).then((entries) => {
            if (!cancelled) setProjectColumns(Object.fromEntries(entries));
        });
        return () => {
            cancelled = true;
        };
    }, [projectKey]);

    const changeLaneMode = (mode: SprintLaneMode) => {
        setLaneMode(mode);
        writeStored(LANE_STORAGE_KEY, mode);
    };

    const changeViewMode = (mode: SprintViewMode) => {
        setViewMode(mode);
        writeStored(VIEW_STORAGE_KEY, mode);
    };

    const moveCard = async (task: SprintCardTask, statusId: string, sortOrder: number) => {
        const column = statusColumns.find((candidate) =>
            Object.values(candidate.statusIds).includes(statusId),
        );
        // Moved on screen first, so the card does not snap back while the
        // server answers; the reload that follows puts every figure right.
        if (column) {
            setTasks((prev) =>
                prev.map((candidate) =>
                    candidate.id === task.id
                        ? { ...candidate, status: { id: statusId, name: column.name, category: column.category } }
                        : candidate,
                ),
            );
        }
        setBusy(true);
        try {
            await api.moveProjectTask(task.id, { statusId, sortOrder });
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.board.moveFailed);
        } finally {
            setBusy(false);
            await load();
        }
    };

    const today = todayKey();
    const people = useMemo(() => assigneeOptions(tasks), [tasks]);
    // A person who has since left the sprint would filter it to nothing.
    const assigneeFilter = people.some((option) => option.key === assignee) ? assignee : 'all';
    // Search and the assignee filter narrow both views and their totals; the
    // stats and the charts beside them stay whole, because they describe the sprint.
    const visibleTasks = useMemo(
        () =>
            tasks.filter(
                (task) =>
                    matchesSprintSearch(task, search) &&
                    (assigneeFilter === 'all' || laneKeyOf(task, 'assignee') === assigneeFilter),
            ),
        [tasks, search, assigneeFilter],
    );
    const lanes = useMemo(() => groupSprintTasks(visibleTasks, laneMode), [visibleTasks, laneMode]);
    const statusColumns = useMemo(() => buildStatusColumns(tasks, projectColumns), [tasks, projectColumns]);
    const totals = useMemo(() => sumHours(visibleTasks), [visibleTasks]);
    const stats = useMemo(() => sprintStats(tasks, burndown ?? [], today), [tasks, burndown, today]);
    const timeline = sprint ? sprintTimeline(sprint.start_date, sprint.end_date, today) : null;

    const returnToBacklog = async (task: SprintTask) => {
        setBusy(true);
        try {
            await api.removeTasksFromSprint(sprintId, [task.id]);
            toast.success(m.sprint.removed);
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.sprint.saveFailed);
        } finally {
            setBusy(false);
        }
    };

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        setBusy(true);
        try {
            await api.deleteProjectTask(pendingDelete.id);
            toast.success(m.task.deleted);
            setPendingDelete(null);
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.task.deleteFailed);
        } finally {
            setBusy(false);
        }
    };

    const iconButton =
        'min-h-touch min-w-touch rounded-md p-1.5 transition-colors disabled:opacity-50';

    const laneTitle = (lane: (typeof lanes)[number]) => {
        if (lane.key !== NO_LANE) return lane.code ? `${lane.code} · ${lane.title ?? ''}` : (lane.title ?? '');
        return laneMode === 'story' ? m.board.laneNoStory : m.board.laneUnassigned;
    };

    /** The figures row shared by a lane heading and the table footer. */
    const figureCells = (group: SprintTask[]) => {
        const sum = sumHours(group);
        return (
            <>
                <td className="px-2 py-2 text-end tabular-nums">{cellNum(sum.estimate)}</td>
                <td className="hidden px-2 py-2 text-end tabular-nums md:table-cell">{cellNum(sum.spent)}</td>
                <td className="px-2 py-2 text-end tabular-nums">{cellNum(sum.remaining)}</td>
                <td className="hidden px-2 py-2 md:table-cell" />
                <td className="px-2 py-2" />
            </>
        );
    };

    return (
        <PageShell>
            <PageHeader
                title={sprint?.name ?? m.sprint.title}
                subtitle={sprint?.goal ?? m.sprint.planning}
                breadcrumbs={nestedPageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.projects,
                    'projects',
                    [{ label: m.sprint.sprints, href: routes.projects.sprints }],
                    sprint?.name ?? m.sprint.title,
                )}
                actions={
                    sprint ? (
                        <div className="flex items-center gap-2">
                            <StatusBadge tone={sprint.status === 'ACTIVE' ? 'info' : 'neutral'}>
                                {(m.sprint[sprint.status.toLowerCase() as keyof typeof m.sprint] as string)
                                    ?? sprint.status}
                            </StatusBadge>
                            {sprint.status !== 'COMPLETED' && (
                                <Button className="min-h-touch" onClick={() => setAdding(true)}>
                                    <Plus className="h-4 w-4" />
                                    {m.sprint.addWork}
                                </Button>
                            )}
                        </div>
                    ) : null
                }
            />

            <div className="flex flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-white p-2">
                <div className="relative min-w-0 flex-1 basis-64">
                    <Search
                        className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                        aria-hidden
                    />
                    <Input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={m.sprint.searchTasks}
                        aria-label={m.sprint.searchTasks}
                        className="ps-8"
                    />
                </div>
                <div
                    role="group"
                    aria-label={m.sprint.viewLabel}
                    className="inline-flex overflow-hidden rounded-md border border-gray-200"
                >
                    {(
                        [
                            { key: 'table', label: m.sprint.viewTable, Icon: Table2 },
                            { key: 'cards', label: m.sprint.viewCards, Icon: LayoutGrid },
                        ] as const
                    ).map(({ key, label, Icon }) => (
                        <button
                            key={key}
                            type="button"
                            aria-pressed={viewMode === key}
                            onClick={() => changeViewMode(key)}
                            className={`inline-flex min-h-touch items-center gap-1.5 px-3 text-xs font-medium transition-colors md:min-h-0 md:py-1.5 ${
                                viewMode === key ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                            }`}
                        >
                            <Icon className="h-4 w-4" aria-hidden />
                            {label}
                        </button>
                    ))}
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-600">
                    {m.fields.assignee}
                    <Select
                        value={assigneeFilter}
                        onChange={(e) => setAssignee(e.target.value)}
                        className="w-40"
                        data-testid="sprint-assignee-filter"
                    >
                        <option value="all">{m.sprint.everyone}</option>
                        {people.map((option) => (
                            <option key={option.key} value={option.key}>
                                {option.label ?? m.board.laneUnassigned}
                            </option>
                        ))}
                    </Select>
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-600">
                    {m.board.view.swimlanes}
                    <Select
                        value={laneMode}
                        onChange={(e) => changeLaneMode(e.target.value as SprintLaneMode)}
                        className="w-36"
                        data-testid="sprint-swimlanes"
                    >
                        <option value="none">{m.board.view.swimlanesNone}</option>
                        <option value="assignee">{m.board.view.swimlanesAssignee}</option>
                        <option value="story">{m.board.view.swimlanesStory}</option>
                    </Select>
                </label>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
                <section className="min-w-0 rounded-md border border-gray-200 bg-white">
                    <div className="border-b border-gray-200 px-3 py-2">
                        <h2 className="text-sm font-medium">
                            {m.sprint.committed}
                            <span className="ms-2 text-xs font-normal text-gray-500">
                                {visibleTasks.length === tasks.length
                                    ? tasks.length
                                    : `${visibleTasks.length}/${tasks.length}`}{' '}
                                · {totals.remaining}h
                            </span>
                        </h2>
                    </div>

                    {tasks.length === 0 ? (
                        <p className="p-3 text-sm text-gray-500">{m.sprint.emptySprint}</p>
                    ) : visibleTasks.length === 0 ? (
                        <p className="p-3 text-sm text-gray-500">{m.sprint.noMatches}</p>
                    ) : viewMode === 'cards' ? (
                        <SprintCardBoard
                            lanes={lanes}
                            laneMode={laneMode}
                            columns={statusColumns}
                            busy={busy}
                            onOpen={setOpenTaskId}
                            onReturn={(task) => void returnToBacklog(task)}
                            onMove={(task, statusId, sortOrder) => void moveCard(task, statusId, sortOrder)}
                        />
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-xs">
                                <thead className="bg-gray-50 text-gray-600">
                                    <tr className="border-b border-gray-200">
                                        <th className="sticky start-0 z-10 min-w-48 bg-gray-50 px-3 py-2 text-start font-medium">
                                            {m.sprint.colTask}
                                        </th>
                                        <th className="whitespace-nowrap px-2 py-2 text-end font-medium">
                                            {m.sprint.colEstimate}
                                        </th>
                                        <th className="hidden whitespace-nowrap px-2 py-2 text-end font-medium md:table-cell">
                                            {m.sprint.colSpent}
                                        </th>
                                        <th className="whitespace-nowrap px-2 py-2 text-end font-medium">
                                            {m.sprint.colRemaining}
                                        </th>
                                        <th className="hidden px-2 py-2 text-start font-medium md:table-cell">
                                            {m.fields.assignee}
                                        </th>
                                        <th className="px-2 py-2 text-center font-medium">{m.fields.actions}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lanes.map((lane) => (
                                        <Fragment key={lane.key}>
                                            {laneMode !== 'none' && (
                                                <tr
                                                    className="border-b border-gray-200 bg-gray-100 font-medium text-gray-700"
                                                    data-testid="sprint-lane"
                                                >
                                                    <td className="sticky start-0 z-10 max-w-xs truncate bg-gray-100 px-3 py-2">
                                                        {laneTitle(lane)}
                                                        <span className="ms-2 font-normal text-gray-500">
                                                            {lane.tasks.length}
                                                        </span>
                                                    </td>
                                                    {figureCells(lane.tasks)}
                                                </tr>
                                            )}
                                            {lane.tasks.map((task) => {
                                                const done = task.status?.category === 'DONE';
                                                return (
                                                    <tr
                                                        key={task.id}
                                                        className="group border-b border-gray-100 hover:bg-gray-50"
                                                        data-testid="sprint-task-row"
                                                    >
                                                        <td className="sticky start-0 z-10 max-w-xs bg-white px-3 py-2 group-hover:bg-gray-50">
                                                            <span
                                                                className={`block truncate text-sm ${
                                                                    done ? 'text-gray-500 line-through' : 'text-gray-900'
                                                                }`}
                                                                title={task.title}
                                                            >
                                                                {task.title}
                                                            </span>
                                                            <span className="block truncate text-gray-500">
                                                                {[task.project?.code, task.userStory?.code, task.status?.name]
                                                                    .filter(Boolean)
                                                                    .join(' · ')}
                                                            </span>
                                                        </td>
                                                        <td className="px-2 py-2 text-end tabular-nums">
                                                            {cellNum(hours(task.estimate_hours))}
                                                        </td>
                                                        <td className="hidden px-2 py-2 text-end tabular-nums md:table-cell">
                                                            {cellNum(hours(task.logged_hours))}
                                                        </td>
                                                        <td className="px-2 py-2 text-end font-medium tabular-nums">
                                                            {cellNum(hours(task.remaining_hours))}
                                                        </td>
                                                        <td className="hidden max-w-40 truncate px-2 py-2 md:table-cell">
                                                            {assigneeNameOf(task) ?? (
                                                                <span className="text-gray-400">{m.task.unassigned}</span>
                                                            )}
                                                        </td>
                                                        <td className="px-1 py-1">
                                                            <div className="flex items-center justify-center">
                                                                <Link
                                                                    href={routes.projects.taskDetail(task.id)}
                                                                    aria-label={t.common.view}
                                                                    title={t.common.view}
                                                                    className={`${iconButton} text-gray-600 hover:bg-gray-100`}
                                                                >
                                                                    <Eye className="mx-auto h-4 w-4" />
                                                                </Link>
                                                                <button
                                                                    type="button"
                                                                    aria-label={t.common.edit}
                                                                    title={t.common.edit}
                                                                    onClick={() => setOpenTaskId(task.id)}
                                                                    className={`${iconButton} text-blue-600 hover:bg-blue-50`}
                                                                >
                                                                    <Pencil className="mx-auto h-4 w-4" />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    aria-label={m.sprint.removeFromSprint}
                                                                    title={m.sprint.removeFromSprint}
                                                                    disabled={busy}
                                                                    onClick={() => void returnToBacklog(task)}
                                                                    className={`${iconButton} text-amber-600 hover:bg-amber-50`}
                                                                >
                                                                    <Undo2 className="mx-auto h-4 w-4" />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    aria-label={t.common.delete}
                                                                    title={m.task.deleteTask}
                                                                    disabled={busy}
                                                                    onClick={() => setPendingDelete(task)}
                                                                    className={`${iconButton} text-red-600 hover:bg-red-50`}
                                                                >
                                                                    <Trash2 className="mx-auto h-4 w-4" />
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </Fragment>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="border-t border-gray-300 bg-gray-50 font-medium text-gray-800">
                                        <td className="sticky start-0 z-10 bg-gray-50 px-3 py-2">{m.sprint.total}</td>
                                        {figureCells(visibleTasks)}
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}
                </section>

                <aside className="space-y-4">
                    <section className="rounded-md border border-gray-200 bg-white p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <h2 className="text-sm font-medium">{m.burndown.title}</h2>
                            {/* The chart spans every project in the sprint, so saying
                                so keeps it from reading as one project's progress. */}
                            <span className="text-xs text-gray-500">{m.burndown.tenantScope}</span>
                        </div>
                        {burndown && burndown.length > 0 ? (
                            <BurndownChart series={burndown} compact />
                        ) : (
                            <p className="text-sm text-gray-500">{m.burndown.noData}</p>
                        )}
                    </section>

                    {sprint && timeline && (
                        <section
                            className="space-y-3 rounded-md border border-gray-200 bg-white p-3"
                            data-testid="sprint-info"
                        >
                            <h2 className="text-sm font-medium">{m.sprint.info}</h2>
                            <dl className="space-y-2 text-sm">
                                <div>
                                    <dt className="text-xs text-gray-500">{m.sprint.goal}</dt>
                                    <dd className={sprint.goal ? 'text-gray-900' : 'text-gray-400'}>
                                        {sprint.goal || m.sprint.noGoal}
                                    </dd>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <dt className="text-xs text-gray-500">{m.sprint.startDate}</dt>
                                        <dd className="tabular-nums text-gray-900">
                                            {formatCalendarDate(sprint.start_date.slice(0, 10), locale)}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-xs text-gray-500">{m.sprint.endDate}</dt>
                                        <dd className="tabular-nums text-gray-900">
                                            {formatCalendarDate(sprint.end_date.slice(0, 10), locale)}
                                        </dd>
                                    </div>
                                </div>
                            </dl>
                            <div>
                                <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
                                    <span>{m.sprint.timeElapsed}</span>
                                    <span className="tabular-nums">
                                        {fmt(m.sprint.dayOf, { day: timeline.day, total: timeline.total })} ·{' '}
                                        {timeline.percent}%
                                    </span>
                                </div>
                                <div
                                    role="progressbar"
                                    aria-label={m.sprint.timeElapsed}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={timeline.percent}
                                    className="h-2 overflow-hidden rounded-full bg-gray-100"
                                >
                                    <div
                                        className="h-full rounded-full bg-blue-600 transition-[width]"
                                        style={{ width: `${timeline.percent}%` }}
                                    />
                                </div>
                            </div>
                        </section>
                    )}

                    <section className="rounded-md border border-gray-200 bg-white p-3" data-testid="sprint-stats">
                        <h2 className="mb-1.5 text-sm font-medium">{m.sprint.stats}</h2>
                        {/* Label and figure on one line each, two to a row: seven
                            figures in the height the tiles took for three. */}
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                            {(
                                [
                                    [m.sprint.colEstimate, stats.estimate, ''],
                                    [m.sprint.colSpent, stats.spent, ''],
                                    [m.sprint.colRemaining, stats.remaining, 'text-blue-600'],
                                    [m.sprint.statProgress, `${stats.progress}%`, ''],
                                    [
                                        m.sprint.statTasksDone,
                                        `${stats.doneCount}/${stats.taskCount}`,
                                        stats.taskCount > 0 && stats.doneCount === stats.taskCount
                                            ? 'text-emerald-700'
                                            : '',
                                    ],
                                    [m.sprint.statDaysLeft, stats.workingDaysLeft, ''],
                                ] as const
                            ).map(([label, value, tone]) => (
                                <div key={label} className="flex items-baseline justify-between gap-2">
                                    <dt className="truncate text-gray-500">{label}</dt>
                                    <dd className={`font-semibold tabular-nums text-gray-900 ${tone}`}>{value}</dd>
                                </div>
                            ))}
                            <div className="col-span-2 flex items-baseline justify-between gap-2 border-t border-gray-100 pt-1">
                                <dt className="text-gray-500">{m.sprint.statVariance}</dt>
                                <dd
                                    className={`font-semibold tabular-nums ${
                                        stats.variance == null
                                            ? 'text-gray-900'
                                            : stats.variance >= 0
                                              ? 'text-emerald-700'
                                              : 'text-amber-600'
                                    }`}
                                >
                                    {stats.variance == null
                                        ? '—'
                                        : stats.variance > 0
                                          ? fmt(m.sprint.ahead, { hours: stats.variance })
                                          : stats.variance < 0
                                            ? fmt(m.sprint.behind, { hours: -stats.variance })
                                            : m.sprint.onTrack}
                                </dd>
                            </div>
                        </dl>
                    </section>
                </aside>
            </div>

            {adding && sprint && (
                <SprintBacklogModal
                    sprintId={sprintId}
                    sprintName={sprint.name}
                    onClose={() => setAdding(false)}
                    onAdded={() => void load()}
                />
            )}

            <ConfirmDialog
                open={pendingDelete !== null}
                title={m.task.deleteTask}
                prompt={fmt(m.task.deletePrompt, { title: pendingDelete?.title ?? '' })}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                loading={busy}
                danger
                onConfirm={confirmDelete}
                onCancel={() => setPendingDelete(null)}
            />

            {openTaskId && (
                <TaskDetailPanel
                    taskId={openTaskId}
                    onClose={() => setOpenTaskId(null)}
                    onChanged={() => void load()}
                />
            )}
        </PageShell>
    );
}
