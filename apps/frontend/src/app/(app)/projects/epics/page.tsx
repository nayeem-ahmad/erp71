'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
    CheckCircle2,
    CircleDashed,
    Layers,
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
import {
    EPIC_STATUSES,
    EPIC_STATUS_TONE,
    EpicBadge,
    EpicFormModal,
    type Epic,
    type EpicProjectOption,
} from '@/components/projects/EpicFormModal';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { useRememberedFilters } from '@/lib/use-remembered-filters';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

const IMPORT_FIELDS: ImportField[] = [
    { key: 'project', label: 'Project (code or name)', required: true },
    { key: 'code', label: 'Epic ID', required: false },
    { key: 'title', label: 'Title', required: true },
    { key: 'description', label: 'Description', required: false },
    { key: 'status', label: 'Status (OPEN/IN_PROGRESS/DONE/CANCELLED)', required: false },
    { key: 'priority', label: 'Priority (LOW/MEDIUM/HIGH/URGENT)', required: false },
    { key: 'color', label: 'Colour (GRAY/BLUE/EMERALD/AMBER/RED/PURPLE)', required: false },
    { key: 'startDate', label: 'Start date', required: false },
    { key: 'targetDate', label: 'Target date', required: false },
];

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

const PRIORITY_TONE: Record<string, StatusBadgeTone> = {
    LOW: 'neutral',
    MEDIUM: 'neutral',
    HIGH: 'warning',
    URGENT: 'danger',
};

type EpicView = 'list' | 'hierarchy';

const VIEW_STORAGE_KEY = 'project-epics-view';
const TABLE_ID = 'project-epics';

/**
 * Remembered across visits in this browser. Defaults to the flat Sales-style
 * list; the backlog tree stays one click away in View options.
 */
function useRememberedView(): [EpicView, (view: EpicView) => void] {
    const [view, setView] = useState<EpicView>('list');

    useEffect(() => {
        try {
            if (localStorage.getItem(VIEW_STORAGE_KEY) === 'hierarchy') setView('hierarchy');
        } catch {
            // Storage blocked — the default list is fine.
        }
    }, []);

    const choose = useCallback((next: EpicView) => {
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
 * Every project's epics on one screen. The default is the standard list UI
 * (filter row, stats strip, View options); Hierarchy keeps the backlog tree.
 */
export default function ProjectEpicsPage() {
    const { t, fmt, locale } = useI18n();
    const m = t.projects;
    const listUi = m.epicList.listUi;

    const [view, setView] = useRememberedView();
    const [epics, setEpics] = useState<Epic[]>([]);
    const [projects, setProjects] = useState<EpicProjectOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [importOpen, setImportOpen] = useState(false);

    const [filters, setFilter, filtersReady] = useRememberedFilters('project-epics', {
        search: '',
        projectId: '',
        status: '',
        priority: '',
    });
    const { search, projectId, status, priority } = filters;

    const load = useCallback(async () => {
        if (!filtersReady || view !== 'list') return;
        setLoading(true);
        try {
            const list = await api.getProjectEpics({
                projectId: projectId || undefined,
                status: status || undefined,
                priority: priority || undefined,
            });
            setEpics(Array.isArray(list) ? (list as Epic[]) : []);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.epics.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [filtersReady, m.epics.loadFailed, priority, projectId, status, view]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        api.getProjects({ limit: 100 })
            .then((res) => setProjects((res?.items ?? []) as EpicProjectOption[]))
            .catch(() => setProjects([]));
    }, []);

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return epics;
        return epics.filter(
            (epic) => epic.code.toLowerCase().includes(term) || epic.title.toLowerCase().includes(term),
        );
    }, [epics, search]);

    const listFilters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'project',
                type: 'select',
                label: m.fields.project,
                value: projectId || null,
                onChange: (next) => setFilter('projectId', next ?? ''),
                options: projects.map((project) => ({
                    value: project.id,
                    label: `${project.code} · ${project.name}`,
                })),
            },
            {
                id: 'status',
                type: 'select',
                label: m.fields.status,
                value: status || null,
                onChange: (next) => setFilter('status', next ?? ''),
                options: EPIC_STATUSES.map((value) => ({
                    value,
                    label: m.epics.statuses[value],
                })),
            },
            {
                id: 'priority',
                type: 'select',
                label: m.fields.priority,
                value: priority || null,
                onChange: (next) => setFilter('priority', next ?? ''),
                options: PRIORITIES.map((value) => ({
                    value,
                    label: m.priority[value],
                })),
            },
        ],
        [m, projectId, projects, status, priority, setFilter],
    );

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const items: ListStat[] = [
            {
                id: 'count',
                icon: <Layers aria-hidden />,
                label: listUi.stats.epics,
                value: n(filtered.length),
            },
            {
                id: 'open',
                icon: <CircleDashed aria-hidden />,
                label: listUi.stats.open,
                value: n(filtered.filter((epic) => epic.status === 'OPEN').length),
            },
            {
                id: 'inProgress',
                icon: <ListTree aria-hidden />,
                label: listUi.stats.inProgress,
                value: n(filtered.filter((epic) => epic.status === 'IN_PROGRESS').length),
            },
            {
                id: 'done',
                icon: <CheckCircle2 aria-hidden />,
                label: listUi.stats.done,
                value: n(filtered.filter((epic) => epic.status === 'DONE').length),
            },
            {
                id: 'stories',
                icon: <Layers aria-hidden />,
                label: listUi.stats.stories,
                value: n(filtered.reduce((sum, epic) => sum + (epic.progress?.storyCount ?? 0), 0)),
            },
        ];
        return { items, loading, label: listUi.statsLabel };
    }, [filtered, loading, locale, listUi]);

    const viewLayout = useMemo<TableViewLayout>(
        () => ({
            label: m.epicList.view,
            options: [
                { key: 'list', label: m.epicList.viewList },
                { key: 'hierarchy', label: m.epicList.viewHierarchy },
            ],
            value: view,
            onChange: (next) => setView(next as EpicView),
        }),
        [m.epicList.view, m.epicList.viewHierarchy, m.epicList.viewList, setView, view],
    );

    const columns = useMemo(
        () => [
            {
                id: 'epic',
                header: m.epicList.epic,
                accessorKey: 'title',
                cell: ({ row }: { row: { original: Epic } }) => {
                    const epic = row.original;
                    return (
                        <div className="flex min-w-0 items-center gap-2">
                            <EpicBadge epic={epic} />
                            {epic.project ? (
                                <Link
                                    href={routes.projects.epicInProject(epic.project.id, epic.id)}
                                    title={m.epicList.openInProject}
                                    className="min-w-0 flex-1 truncate font-medium text-blue-600 hover:underline"
                                >
                                    {epic.title}
                                </Link>
                            ) : (
                                <span className="min-w-0 flex-1 truncate font-medium">{epic.title}</span>
                            )}
                        </div>
                    );
                },
            },
            {
                id: 'project',
                header: m.fields.project,
                accessorFn: (row: Epic) => (row.project ? `${row.project.code} ${row.project.name}` : ''),
                cell: ({ row }: { row: { original: Epic } }) => {
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
                id: 'status',
                header: m.fields.status,
                accessorKey: 'status',
                cell: ({ row }: { row: { original: Epic } }) => (
                    <StatusBadge tone={EPIC_STATUS_TONE[row.original.status] ?? 'neutral'}>
                        {m.epics.statuses[row.original.status as keyof typeof m.epics.statuses]
                            ?? row.original.status}
                    </StatusBadge>
                ),
            },
            {
                id: 'priority',
                header: m.fields.priority,
                accessorKey: 'priority',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Epic } }) => (
                    <StatusBadge tone={PRIORITY_TONE[row.original.priority] ?? 'neutral'}>
                        {m.priority[row.original.priority as keyof typeof m.priority]
                            ?? row.original.priority}
                    </StatusBadge>
                ),
            },
            {
                id: 'stories',
                header: m.epicList.stories,
                accessorFn: (row: Epic) => row.progress?.storyCount ?? 0,
                meta: { hideOnMobile: true, align: 'end' as const },
                cell: ({ row }: { row: { original: Epic } }) => {
                    const progress = row.original.progress;
                    return (
                        <span className="tabular-nums text-gray-600">
                            {fmt(m.epics.storyProgress, {
                                done: progress?.doneStoryCount ?? 0,
                                total: progress?.storyCount ?? 0,
                            })}
                            {progress && progress.storyPoints > 0 ? (
                                <span className="text-gray-500">
                                    {' · '}
                                    {fmt(m.epics.pointsProgress, {
                                        done: progress.doneStoryPoints,
                                        total: progress.storyPoints,
                                    })}
                                </span>
                            ) : null}
                        </span>
                    );
                },
            },
            {
                id: 'progress',
                header: m.epicList.progress,
                accessorFn: (row: Epic) => row.progress?.percentComplete ?? 0,
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Epic } }) => {
                    const percent = row.original.progress?.percentComplete ?? 0;
                    return (
                        <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-200" aria-hidden>
                                <div className="h-full rounded-full bg-blue-600" style={{ width: `${percent}%` }} />
                            </div>
                            <span className="text-xs tabular-nums text-gray-500">{percent}%</span>
                        </div>
                    );
                },
            },
            {
                id: 'target',
                header: m.epics.targetDate,
                accessorFn: (row: Epic) => row.target_date ?? '',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Epic } }) =>
                    row.original.target_date ? (
                        <span className="tabular-nums">{row.original.target_date.slice(0, 10)}</span>
                    ) : (
                        <span className="text-gray-400">—</span>
                    ),
            },
        ],
        [fmt, m],
    );

    const anyFilter = Boolean(search.trim() || projectId || status || priority);

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
                {m.epics.add}
            </Button>
            <ImportDialog
                open={importOpen}
                onClose={() => setImportOpen(false)}
                entityLabel={m.epicList.title}
                fields={IMPORT_FIELDS}
                importFn={(rows, mode) => api.importProjectEpics(rows, mode)}
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
                        initialLevel="epics"
                        storageKey="project-backlog-expanded:all:epics"
                        header={({ newEpic, reload }) => (
                            <>
                                <PageHeader
                                    title={m.epicList.title}
                                    subtitle={m.epicList.subtitle}
                                    breadcrumbs={modulePageBreadcrumbs(
                                        t.dashboardHome.breadcrumbHome,
                                        t.sidebar.modules.projects,
                                        m.epicList.title,
                                        'projects',
                                    )}
                                    actions={headerActions(newEpic, () => void reload())}
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
                title={m.epicList.title}
                subtitle={m.epicList.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.projects,
                    m.epicList.title,
                    'projects',
                )}
                actions={headerActions(() => setCreating(true))}
            />

            <DataTable
                title={m.epicList.title}
                tableId={TABLE_ID}
                columns={columns as never}
                data={filtered}
                isLoading={loading}
                emptyMessage={anyFilter ? m.epicList.emptyFiltered : m.epicList.empty}
                emptyIcon={<Layers className="h-16 w-16 text-gray-200" />}
                searchPlaceholder={m.epicList.searchPlaceholder}
                searchValue={search}
                onSearchChange={(value) => setFilter('search', value)}
                filters={listFilters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                viewLayout={viewLayout}
            />

            {creating && (
                <EpicFormModal
                    projects={projects}
                    epic={null}
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
