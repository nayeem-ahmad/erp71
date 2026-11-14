'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
    BookOpen,
    CheckCircle2,
    CircleDashed,
    ListTree,
    Plus,
    Upload,
} from 'lucide-react';
import {
    Button,
    PageHeader,
    PageShell,
    StatusBadge,
    type StatusBadgeTone,
} from '@/components/ui';
import { DataTable, ListToolbar, type ListFilter, type ListStat } from '@/components/data-table';
import type { TableViewLayout } from '@/components/table';
import { ImportDialog, type ImportField } from '@/components/import-dialog';
import BacklogWorkspace from '@/components/projects/backlog/BacklogWorkspace';
import { EpicBadge, type EpicChip } from '@/components/projects/EpicFormModal';
import {
    StoryFormModal,
    type StoryProjectOption,
} from '@/components/projects/StoryFormModal';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { fetchMe } from '@/hooks/use-me';
import { useFilterUrl } from '@/components/projects/use-filter-url';
import {
    EMPTY_STORY_FILTERS,
    filterStories,
    parseStoryFilters,
    storyFiltersToQuery,
    storyRange,
    type StoryFilterDimension,
    type StoryFilterState,
} from '@/components/projects/work-list-filters';
import type { NumberCondition } from '@/lib/number-condition';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { useRememberedFilters } from '@/lib/use-remembered-filters';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

/**
 * The columns an import file may carry. The project is named by code or name,
 * as in the task import; the ID is optional, and a blank one is numbered after
 * the project code.
 */
const IMPORT_FIELDS: ImportField[] = [
    { key: 'project', label: 'Project (code or name)', required: true },
    { key: 'code', label: 'Story ID', required: false },
    { key: 'epic', label: 'Epic (ID or title, same project)', required: false },
    { key: 'title', label: 'Title', required: true },
    { key: 'asA', label: 'As a', required: false },
    { key: 'iWant', label: 'I want', required: false },
    { key: 'soThat', label: 'So that', required: false },
    { key: 'acceptanceCriteria', label: 'Acceptance criteria', required: false },
    { key: 'status', label: 'Status (BACKLOG/READY/IN_PROGRESS/DONE)', required: false },
    { key: 'priority', label: 'Priority (LOW/MEDIUM/HIGH/URGENT)', required: false },
    { key: 'storyPoints', label: 'Story points', required: false },
];

const STATUSES = ['BACKLOG', 'READY', 'IN_PROGRESS', 'DONE'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

const STATUS_TONE: Record<string, StatusBadgeTone> = {
    BACKLOG: 'neutral',
    READY: 'info',
    IN_PROGRESS: 'info',
    DONE: 'success',
};

const PRIORITY_TONE: Record<string, StatusBadgeTone> = {
    LOW: 'neutral',
    MEDIUM: 'neutral',
    HIGH: 'warning',
    URGENT: 'danger',
};

interface StoryRow {
    id: string;
    reference: number;
    code: string;
    title: string;
    i_want?: string | null;
    status: string;
    priority: string;
    story_points?: number | null;
    project?: { id: string; code: string; name: string; short_name?: string | null } | null;
    epic?: EpicChip | null;
    progress?: { taskCount: number; doneTaskCount: number; percentComplete: number };
}

type StoryView = 'list' | 'hierarchy';

const VIEW_STORAGE_KEY = 'project-stories-view';
const TABLE_ID = 'project-stories';

/**
 * Remembered across visits in this browser. Defaults to the flat Sales-style
 * list; the backlog tree stays one click away in View options.
 */
function useRememberedView(): [StoryView, (view: StoryView) => void] {
    const [view, setView] = useState<StoryView>('list');

    useEffect(() => {
        try {
            if (localStorage.getItem(VIEW_STORAGE_KEY) === 'hierarchy') setView('hierarchy');
        } catch {
            // Storage blocked — the default list is fine.
        }
    }, []);

    const choose = useCallback((next: StoryView) => {
        setView(next);
        try {
            localStorage.setItem(VIEW_STORAGE_KEY, next);
        } catch {
            // Not remembering the choice is better than failing to make it.
        }
    }, []);

    return [view, choose];
}

/**
 * Every project's user stories on one screen. The default is the standard list
 * UI (filter row, stats strip, View options); Hierarchy keeps the backlog tree.
 */
function ProjectStoriesList() {
    const { t, fmt, locale } = useI18n();
    const m = t.projects;
    const listUi = m.storyList.listUi;
    const copy = t.projects.sprint.filters;
    const work = t.projects.workList;
    const searchParams = useSearchParams();
    // Read once, at mount: from here on the controls own these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const initial = useMemo(() => parseStoryFilters(searchParams), []);

    const [view, setView] = useRememberedView();
    const [stories, setStories] = useState<StoryRow[]>([]);
    const [projects, setProjects] = useState<StoryProjectOption[]>([]);
    const [epics, setEpics] = useState<(EpicChip & { project?: { code: string } | null })[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [importOpen, setImportOpen] = useState(false);

    const [filters, setFilter, filtersReady] = useRememberedFilters<StoryFilterState>(
        'project-stories',
        { ...EMPTY_STORY_FILTERS, ...initial.filters },
        initial.owned,
    );
    const [userId, setUserId] = useState<string | null>(null);
    useFilterUrl(filtersReady, filters, storyFiltersToQuery);

    const load = useCallback(async () => {
        if (view !== 'list') return;
        setLoading(true);
        try {
            // The list is the whole backlog the caller can see. Filters run here
            // so each option can show how many stories it would add.
            const list = await api.getProjectStories();
            setStories(Array.isArray(list) ? (list as StoryRow[]) : []);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.stories.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [m.stories.loadFailed, view]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        api.getProjects({ limit: 100 })
            .then((res) => setProjects((res?.items ?? []) as StoryProjectOption[]))
            .catch(() => setProjects([]));
        void Promise.resolve()
            .then(() => fetchMe())
            .then((me) => setUserId(me?.id ?? null))
            .catch(() => setUserId(null));
    }, []);

    useEffect(() => {
        if (view !== 'list') return;
        api.getProjectEpics()
            .then((rows: unknown) => setEpics(Array.isArray(rows) ? (rows as typeof epics) : []))
            .catch(() => setEpics([]));
    }, [view]);

    const filtered = useMemo(
        () => filterStories(stories, filters, userId),
        [stories, filters, userId],
    );
    const countStories = (omit: StoryFilterDimension, pick: (story: StoryRow) => boolean) =>
        filterStories(stories, filters, userId, omit).filter(pick).length;

    const epicOptions = filters.projectIds.length
        ? epics.filter((epic) => {
            const projectId = (epic.project as { id?: string } | null | undefined)?.id;
            return !projectId || filters.projectIds.includes(projectId);
        })
        : epics;
    const owners = new Map<string, string>();
    for (const story of stories) {
        const creator = (story as StoryRow & { creator?: { id: string; name?: string | null; email?: string } }).creator;
        if (creator?.id && !owners.has(creator.id)) owners.set(creator.id, creator.name || creator.email || creator.id);
    }

    const listFilters = useMemo<ListFilter[]>(() => {
        const created = storyRange(filters, 'created');
        const updated = storyRange(filters, 'updated');
        return [
            {
                id: 'status',
                type: 'multi-select',
                label: m.fields.status,
                value: filters.statuses,
                onChange: (statuses) => setFilter('statuses', statuses),
                options: STATUSES.map((value) => ({
                    value,
                    label: m.stories.statuses[value],
                    count: countStories('status', (story) => story.status === value),
                })),
            },
            {
                id: 'priority',
                type: 'multi-select',
                label: m.fields.priority,
                value: filters.priorities,
                onChange: (priorities) => setFilter('priorities', priorities),
                options: PRIORITIES.map((value) => ({
                    value,
                    label: m.priority[value],
                    count: countStories('priority', (story) => story.priority === value),
                })),
            },
            {
                id: 'project',
                type: 'multi-select',
                label: m.fields.project,
                value: filters.projectIds,
                onChange: (projectIds) => setFilter('projectIds', projectIds),
                options: projects.map((project) => ({
                    value: project.id,
                    label: `${project.code} · ${project.name}`,
                    count: countStories('project', (story) => story.project?.id === project.id),
                })),
            },
            {
                id: 'epic',
                type: 'multi-select',
                label: m.epics.field,
                value: filters.epicIds,
                onChange: (epicIds) => setFilter('epicIds', epicIds),
                options: [
                    {
                        value: 'none',
                        label: m.storyList.noEpic,
                        count: countStories('epic', (story) => !story.epic?.id),
                    },
                    ...epicOptions.map((option) => ({
                        value: option.id,
                        label: option.project?.code
                            ? `${option.code} · ${option.project.code}`
                            : `${option.code} · ${option.title}`,
                        count: countStories('epic', (story) => story.epic?.id === option.id),
                    })),
                ],
            },
            {
                id: 'owner',
                type: 'multi-select',
                label: work.owner,
                more: true,
                value: filters.ownerIds,
                onChange: (ownerIds) => setFilter('ownerIds', ownerIds),
                options: [
                    { value: 'me', label: copy.me, count: countStories('owner', (story) => ((story as { creator?: { id?: string }; created_by?: string }).creator?.id ?? (story as { created_by?: string }).created_by) === userId) },
                    { value: 'none', label: work.noOwner, count: countStories('owner', (story) => !((story as { creator?: { id?: string }; created_by?: string }).creator?.id ?? (story as { created_by?: string }).created_by)) },
                    ...[...owners.entries()].map(([value, label]) => ({
                        value,
                        label,
                        count: countStories('owner', (story) => ((story as { creator?: { id?: string }; created_by?: string }).creator?.id ?? (story as { created_by?: string }).created_by) === value),
                    })),
                ],
            },
            {
                id: 'points',
                type: 'number',
                label: work.storyPoints,
                more: true,
                value: filters.points,
                onChange: (points: NumberCondition | null) => setFilter('points', points),
            },
            {
                id: 'created',
                type: 'date-range',
                label: work.createdBetween,
                more: true,
                value: created,
                presets: [],
                onChange: (next) => {
                    setFilter('createdFrom', next?.from ?? '');
                    setFilter('createdTo', next?.to ?? '');
                },
            },
            {
                id: 'updated',
                type: 'date-range',
                label: copy.updatedBetween,
                more: true,
                value: updated,
                presets: [],
                onChange: (next) => {
                    setFilter('updatedFrom', next?.from ?? '');
                    setFilter('updatedTo', next?.to ?? '');
                },
            },
        ];
        // countStories closes over the latest rows. Rebuilding when they change is the point.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [m, work, copy, filters, projects, epicOptions, owners, stories, userId, setFilter]);

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const points = filtered.reduce((sum, story) => sum + (story.story_points ?? 0), 0);
        const items: ListStat[] = [
            {
                id: 'count',
                icon: <BookOpen aria-hidden />,
                label: listUi.stats.stories,
                value: n(filtered.length),
            },
            {
                id: 'backlog',
                icon: <CircleDashed aria-hidden />,
                label: listUi.stats.backlog,
                value: n(filtered.filter((story) => story.status === 'BACKLOG').length),
            },
            {
                id: 'ready',
                icon: <ListTree aria-hidden />,
                label: listUi.stats.ready,
                value: n(filtered.filter((story) => story.status === 'READY').length),
            },
            {
                id: 'inProgress',
                icon: <ListTree aria-hidden />,
                label: listUi.stats.inProgress,
                value: n(filtered.filter((story) => story.status === 'IN_PROGRESS').length),
            },
            {
                id: 'done',
                icon: <CheckCircle2 aria-hidden />,
                label: listUi.stats.done,
                value: n(filtered.filter((story) => story.status === 'DONE').length),
                hint: points > 0 ? fmt(m.stories.pointsShort, { points }) : undefined,
            },
        ];
        return { items, loading, label: listUi.statsLabel };
    }, [filtered, loading, locale, listUi, fmt, m.stories.pointsShort]);

    const viewLayout = useMemo<TableViewLayout>(
        () => ({
            label: m.storyList.view,
            options: [
                { key: 'list', label: m.storyList.viewList },
                { key: 'hierarchy', label: m.storyList.viewHierarchy },
            ],
            value: view,
            onChange: (next) => setView(next as StoryView),
        }),
        [m.storyList.view, m.storyList.viewHierarchy, m.storyList.viewList, setView, view],
    );

    const columns = useMemo(
        () => [
            {
                id: 'story',
                header: m.storyList.story,
                accessorKey: 'title',
                cell: ({ row }: { row: { original: StoryRow } }) => {
                    const story = row.original;
                    return (
                        <div className="min-w-0">
                            <div className="flex min-w-0 items-baseline gap-2">
                                <span className="shrink-0 text-xs tabular-nums text-gray-500">
                                    {story.code}
                                </span>
                                {story.project ? (
                                    <Link
                                        href={routes.projects.storyInProject(story.project.id, story.id)}
                                        title={m.storyList.openInProject}
                                        className="min-w-0 flex-1 truncate font-medium text-blue-600 hover:underline"
                                    >
                                        {story.title}
                                    </Link>
                                ) : (
                                    <span className="min-w-0 flex-1 truncate font-medium">{story.title}</span>
                                )}
                            </div>
                            {story.i_want ? (
                                <span className="block truncate text-xs text-gray-500" title={story.i_want}>
                                    {m.stories.iWant}: {story.i_want}
                                </span>
                            ) : null}
                        </div>
                    );
                },
            },
            {
                id: 'project',
                header: m.fields.project,
                accessorFn: (row: StoryRow) => (row.project ? `${row.project.code} ${row.project.name}` : ''),
                cell: ({ row }: { row: { original: StoryRow } }) => {
                    const project = row.original.project;
                    if (!project) return <span className="text-gray-400">—</span>;
                    return (
                        <Link
                            href={routes.projects.detail(project.id)}
                            className="text-blue-600 hover:underline"
                            title={project.name}
                        >
                            <span className="tabular-nums">{project.code}</span>
                            <span className="hidden md:inline"> · {project.short_name || project.name}</span>
                        </Link>
                    );
                },
            },
            {
                id: 'epic',
                header: m.epics.field,
                accessorFn: (row: StoryRow) => row.epic?.code ?? '',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: StoryRow } }) =>
                    row.original.epic ? (
                        <EpicBadge epic={row.original.epic} />
                    ) : (
                        <span className="text-gray-400">—</span>
                    ),
            },
            {
                id: 'status',
                header: m.fields.status,
                accessorKey: 'status',
                cell: ({ row }: { row: { original: StoryRow } }) => (
                    <StatusBadge tone={STATUS_TONE[row.original.status] ?? 'neutral'}>
                        {m.stories.statuses[row.original.status as keyof typeof m.stories.statuses]
                            ?? row.original.status}
                    </StatusBadge>
                ),
            },
            {
                id: 'priority',
                header: m.fields.priority,
                accessorKey: 'priority',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: StoryRow } }) => (
                    <StatusBadge tone={PRIORITY_TONE[row.original.priority] ?? 'neutral'}>
                        {m.priority[row.original.priority as keyof typeof m.priority]
                            ?? row.original.priority}
                    </StatusBadge>
                ),
            },
            {
                id: 'points',
                header: m.stories.points,
                accessorFn: (row: StoryRow) => row.story_points ?? -1,
                meta: { hideOnMobile: true, align: 'end' as const },
                cell: ({ row }: { row: { original: StoryRow } }) =>
                    row.original.story_points == null ? (
                        <span className="text-gray-400">—</span>
                    ) : (
                        <span className="tabular-nums">
                            {fmt(m.stories.pointsShort, { points: row.original.story_points })}
                        </span>
                    ),
            },
            {
                id: 'tasks',
                header: m.fields.tasks,
                accessorFn: (row: StoryRow) => row.progress?.taskCount ?? 0,
                // "{done}/{total} tasks". Same clip as the epic story count:
                // the 150px default is short of four-digit counts in the
                // longer labels (German "Aufgaben") at the largest list type.
                size: 180,
                minSize: 180,
                meta: { hideOnMobile: true, align: 'end' as const },
                cell: ({ row }: { row: { original: StoryRow } }) => {
                    const progress = row.original.progress
                        ?? { taskCount: 0, doneTaskCount: 0, percentComplete: 0 };
                    return (
                        <span className="whitespace-nowrap tabular-nums text-gray-600">
                            {fmt(m.stories.taskProgress, {
                                done: progress.doneTaskCount,
                                total: progress.taskCount,
                            })}
                        </span>
                    );
                },
            },
        ],
        [fmt, m],
    );

    const anyFilter = filtered.length !== stories.length || Boolean(filters.search.trim());

    const headerActions = (onNew: () => void, onReload?: () => void) => (
        <>
            <Button
                variant="secondary"
                className="min-h-touch"
                onClick={() => setImportOpen(true)}
            >
                <Upload className="h-4 w-4" />
                {t.common.import}
            </Button>
            <Button className="min-h-touch" onClick={onNew}>
                <Plus className="h-4 w-4" />
                {m.stories.add}
            </Button>
            <ImportDialog
                open={importOpen}
                onClose={() => setImportOpen(false)}
                entityLabel={m.storyList.title}
                fields={IMPORT_FIELDS}
                importFn={(rows, mode) => api.importProjectStories(rows, mode)}
                onSuccess={() => {
                    if (onReload) void onReload();
                    else void load();
                }}
            />
        </>
    );

    if (view === 'hierarchy') {
        return (
            <PageShell>
                <Suspense fallback={null}>
                    <BacklogWorkspace
                        initialLevel="stories"
                        storageKey="project-backlog-expanded:all:stories"
                        header={({ newStory, reload }) => (
                            <>
                                <PageHeader
                                    title={m.storyList.title}
                                    subtitle={m.storyList.subtitle}
                                    breadcrumbs={modulePageBreadcrumbs(
                                        t.dashboardHome.breadcrumbHome,
                                        t.sidebar.modules.projects,
                                        m.storyList.title,
                                        'projects',
                                    )}
                                    actions={headerActions(newStory, () => void reload())}
                                />
                                <ListToolbar
                                    tableId={TABLE_ID}
                                    filters={[]}
                                    layout={viewLayout}
                                />
                            </>
                        )}
                    />
                </Suspense>
            </PageShell>
        );
    }

    return (
        <PageShell>
            <PageHeader
                title={m.storyList.title}
                subtitle={m.storyList.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.projects,
                    m.storyList.title,
                    'projects',
                )}
                actions={headerActions(() => setCreating(true))}
            />

            <DataTable
                title={m.storyList.title}
                tableId={TABLE_ID}
                columns={columns as never}
                data={filtered}
                isLoading={loading}
                emptyMessage={anyFilter ? m.storyList.emptyFiltered : m.storyList.empty}
                emptyIcon={<BookOpen className="h-16 w-16 text-gray-200" />}
                searchPlaceholder={m.storyList.searchPlaceholder}
                searchValue={filters.search}
                onSearchChange={(value) => setFilter('search', value)}
                filters={listFilters}
                filterLayout="row"
                scrollFilterRow
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                viewLayout={viewLayout}
            />

            {creating && (
                <StoryFormModal
                    projects={projects}
                    story={null}
                    initialProjectId={filters.projectIds.length === 1 ? filters.projectIds[0] : undefined}
                    onClose={() => setCreating(false)}
                    onSaved={async () => {
                        setCreating(false);
                        await load();
                    }}
                />
            )}
        </PageShell>
    );
}

export default function ProjectStoriesPage() {
    return (
        <Suspense fallback={null}>
            <ProjectStoriesList />
        </Suspense>
    );
}
