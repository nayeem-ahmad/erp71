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
import {
    EPIC_STATUSES,
    EPIC_STATUS_TONE,
    EpicBadge,
    EpicFormModal,
    type Epic,
    type EpicProjectOption,
} from '@/components/projects/ProjectEpicsCard';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { useRememberedFilters } from '@/lib/use-remembered-filters';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

/**
 * Every project's epics on one screen — the same page as the cross-project
 * backlog, one level up. Epics can be written and imported here; editing stays
 * on the project page, where a row links with the epic already open.
 */

const PRIORITY_TONE: Record<string, StatusBadgeTone> = {
    LOW: 'neutral',
    MEDIUM: 'neutral',
    HIGH: 'warning',
    URGENT: 'danger',
};

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

export default function ProjectEpicsPage() {
    const { t, fmt } = useI18n();
    const m = t.projects;

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
        if (!filtersReady) return;
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
    }, [filtersReady, m.epics.loadFailed, priority, projectId, status]);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        api.getProjects({ limit: 100 })
            .then((res) => setProjects((res?.items ?? []) as EpicProjectOption[]))
            .catch(() => setProjects([]));
    }, []);

    /** Local, over the fields the endpoint searches — see the story list. */
    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return epics;
        return epics.filter(
            (epic) => epic.code.toLowerCase().includes(term) || epic.title.toLowerCase().includes(term),
        );
    }, [epics, search]);

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
                meta: { hideOnMobile: true },
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
                            {m.epics.add}
                        </Button>
                    </>
                }
            />

            <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <Input
                    value={search}
                    onChange={(e) => setFilter('search', e.target.value)}
                    placeholder={m.epicList.searchPlaceholder}
                    className="md:max-w-xs"
                />
                <Select
                    value={projectId}
                    onChange={(e) => setFilter('projectId', e.target.value)}
                    className="md:w-52"
                >
                    <option value="">{m.epicList.allProjects}</option>
                    {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                            {project.code} · {project.name}
                        </option>
                    ))}
                </Select>
                <Select value={status} onChange={(e) => setFilter('status', e.target.value)} className="md:w-44">
                    <option value="">{m.epicList.anyStatus}</option>
                    {EPIC_STATUSES.map((value) => (
                        <option key={value} value={value}>
                            {m.epics.statuses[value]}
                        </option>
                    ))}
                </Select>
                <Select
                    value={priority}
                    onChange={(e) => setFilter('priority', e.target.value)}
                    className="md:w-44"
                >
                    <option value="">{m.epicList.anyPriority}</option>
                    {PRIORITIES.map((value) => (
                        <option key={value} value={value}>
                            {m.priority[value]}
                        </option>
                    ))}
                </Select>
            </div>

            <DataTable
                title={m.epicList.title}
                tableId="project-epics"
                columns={columns as never}
                data={filtered}
                isLoading={loading}
                showSearch={false}
                emptyMessage={anyFilter ? m.epicList.emptyFiltered : m.epicList.empty}
            />

            <ImportDialog
                open={importOpen}
                onClose={() => setImportOpen(false)}
                entityLabel={m.epicList.title}
                fields={IMPORT_FIELDS}
                importFn={(rows, mode) => api.importProjectEpics(rows, mode)}
                onSuccess={() => void load()}
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
