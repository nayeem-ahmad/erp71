'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Upload } from 'lucide-react';
import {
    Button,
    PageShell,
    PageHeader,
    Input,
    Select,
    StatusBadge,
    type StatusBadgeTone,
} from '@/components/ui';
import DataTable from '@/components/data-table/DataTable';
import { ImportDialog, type ImportField } from '@/components/import-dialog';
import { StoryFormModal, type StoryProjectOption } from '@/components/projects/ProjectStoriesCard';
import { EpicBadge, type EpicChip } from '@/components/projects/ProjectEpicsCard';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { useRememberedFilters } from '@/lib/use-remembered-filters';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

/**
 * Every project's backlog on one screen.
 *
 * Stories can be written and imported from here, for whoever grooms scope
 * across projects rather than inside one. The form is the same `StoryFormModal`
 * the per-project card uses, with a project picker in front — one editor for
 * stories, not a second copy of the same fields. Editing stays on the project
 * page: a row links to the story on the page that owns it.
 */

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

/** Matches `ProjectStoriesCard`, so a story reads the same in both places. */
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

export default function ProjectStoriesPage() {
    const { t, fmt } = useI18n();
    const m = t.projects;

    const [stories, setStories] = useState<StoryRow[]>([]);
    const [projects, setProjects] = useState<StoryProjectOption[]>([]);
    const [epics, setEpics] = useState<(EpicChip & { project?: { code: string } | null })[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [importOpen, setImportOpen] = useState(false);

    /**
     * Remembered for the tab, like the sprint and task lists: opening a story in
     * its project and coming back returns to the slice it was opened from.
     */
    const [filters, setFilter, filtersReady] = useRememberedFilters('project-stories', {
        search: '',
        projectId: '',
        status: '',
        priority: '',
        /** `''` any, `'none'` stories under no epic, otherwise an epic id. */
        epic: '',
    });
    const { search, projectId, status, priority, epic } = filters;

    const load = useCallback(async () => {
        // Nothing is asked for until the remembered filters are in, or a return
        // visit fetches every story and then the remembered slice, painting the
        // wrong list in between.
        if (!filtersReady) return;
        setLoading(true);
        try {
            // The three dropdowns go to the server: each is one deliberate
            // change, and `projectId` in particular is the access-scoped one.
            // Search stays local — see `filtered`.
            const list = await api.getProjectStories({
                projectId: projectId || undefined,
                status: status || undefined,
                priority: priority || undefined,
                epicId: epic && epic !== 'none' ? epic : undefined,
                noEpic: epic === 'none' || undefined,
            });
            setStories(Array.isArray(list) ? (list as StoryRow[]) : []);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.stories.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [epic, filtersReady, m.stories.loadFailed, priority, projectId, status]);

    useEffect(() => {
        load();
    }, [load]);

    // The epic filter's options follow the project filter: an epic belongs to
    // one project, so across all of them the list is grouped by project code.
    useEffect(() => {
        api.getProjectEpics({ projectId: projectId || undefined })
            .then((rows: unknown) => setEpics(Array.isArray(rows) ? (rows as typeof epics) : []))
            .catch(() => setEpics([]));
    }, [projectId]);

    useEffect(() => {
        api.getProjects({ limit: 100 })
            .then((res) => setProjects((res?.items ?? []) as StoryProjectOption[]))
            .catch(() => setProjects([]));
    }, []);

    /**
     * Search is applied here rather than sent, over the same three fields the
     * endpoint searches. The list is unpaginated, so a round trip per keystroke
     * would fetch the very rows already in hand in order to filter them
     * remotely; this keeps typing instant and the result identical.
     */
    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return stories;
        return stories.filter(
            (story) =>
                story.code.toLowerCase().includes(term)
                || story.title.toLowerCase().includes(term)
                || (story.i_want ?? '').toLowerCase().includes(term),
        );
    }, [stories, search]);

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
                                {/* Back to the card that owns it, with this story
                                    already open — there is no story route, and a
                                    second editor is what that would grow into. */}
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
                // The column the page exists for, so it stays on a phone.
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
                // Sorts on the number; an unsized story sorts below every sized
                // one rather than reading as a zero-point story.
                accessorFn: (row: StoryRow) => row.story_points ?? -1,
                meta: { hideOnMobile: true },
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
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: StoryRow } }) => {
                    const progress = row.original.progress
                        ?? { taskCount: 0, doneTaskCount: 0, percentComplete: 0 };
                    return (
                        <span className="tabular-nums text-gray-600">
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

    const anyFilter = Boolean(search.trim() || projectId || status || priority || epic);

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
                actions={
                    <>
                        <Button
                            variant="secondary"
                            className="min-h-touch"
                            onClick={() => setImportOpen(true)}
                        >
                            <Upload className="h-4 w-4" />
                            {t.common.import}
                        </Button>
                        <Button className="min-h-touch" onClick={() => setCreating(true)}>
                            <Plus className="h-4 w-4" />
                            {m.stories.add}
                        </Button>
                    </>
                }
            />

            <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <Input
                    value={search}
                    onChange={(e) => setFilter('search', e.target.value)}
                    placeholder={m.storyList.searchPlaceholder}
                    className="md:max-w-xs"
                />
                <Select
                    value={projectId}
                    onChange={(e) => {
                        setFilter('projectId', e.target.value);
                        // A picked epic may not be in the newly chosen project.
                        if (epic && epic !== 'none') setFilter('epic', '');
                    }}
                    className="md:w-52"
                >
                    <option value="">{m.storyList.allProjects}</option>
                    {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                            {project.code} · {project.name}
                        </option>
                    ))}
                </Select>
                <Select value={epic} onChange={(e) => setFilter('epic', e.target.value)} className="md:w-52">
                    <option value="">{m.storyList.anyEpic}</option>
                    <option value="none">{m.storyList.noEpic}</option>
                    {epics.map((option) => (
                        <option key={option.id} value={option.id}>
                            {option.code} · {option.title}
                        </option>
                    ))}
                </Select>
                <Select value={status} onChange={(e) => setFilter('status', e.target.value)} className="md:w-44">
                    <option value="">{m.storyList.anyStatus}</option>
                    {STATUSES.map((value) => (
                        <option key={value} value={value}>
                            {m.stories.statuses[value]}
                        </option>
                    ))}
                </Select>
                <Select
                    value={priority}
                    onChange={(e) => setFilter('priority', e.target.value)}
                    className="md:w-44"
                >
                    <option value="">{m.storyList.anyPriority}</option>
                    {PRIORITIES.map((value) => (
                        <option key={value} value={value}>
                            {m.priority[value]}
                        </option>
                    ))}
                </Select>
            </div>

            {/* Empty stays a table, as on the sprint list: the columns and the
                filter row are what tell a first-time viewer what this holds. */}
            <DataTable
                title={m.storyList.title}
                tableId="project-stories"
                columns={columns as never}
                data={filtered}
                isLoading={loading}
                showSearch={false}
                emptyMessage={anyFilter ? m.storyList.emptyFiltered : m.storyList.empty}
            />

            <ImportDialog
                open={importOpen}
                onClose={() => setImportOpen(false)}
                entityLabel={m.storyList.title}
                fields={IMPORT_FIELDS}
                importFn={(rows, mode) => api.importProjectStories(rows, mode)}
                onSuccess={() => void load()}
            />

            {creating && (
                <StoryFormModal
                    // The filtered project, if there is one, is the likeliest home.
                    projects={projects}
                    story={null}
                    initialProjectId={projectId || undefined}
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
