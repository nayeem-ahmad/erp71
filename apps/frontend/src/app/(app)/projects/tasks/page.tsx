'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageShell, PageHeader, Input, Select, StatusBadge } from '@/components/ui';
import DataTable from '@/components/data-table/DataTable';
import TaskDetailPanel from '@/components/projects/TaskDetailPanel';
import { useServerList } from '@/hooks/useServerList';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

interface TaskRow {
    id: string;
    title: string;
    priority: string;
    due_date?: string | null;
    estimate_hours?: string | null;
    remaining_hours?: string | null;
    status?: { id: string; name: string; category: string };
    project?: { id: string; code: string; name: string };
    sprint?: { id: string; name: string; status: string } | null;
    assignee?: { id: string; name?: string | null; email: string } | null;
    assigneeEmployee?: { id: string; name: string } | null;
}

const CATEGORY_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'info'> = {
    TODO: 'neutral',
    IN_PROGRESS: 'info',
    DONE: 'success',
};

const num = (value: unknown): number => (value == null ? 0 : Number(value));

/** A task goes to a user or to an employee with no login; show whichever holds it. */
function assigneeLabel(task: TaskRow): string {
    if (task.assignee) return task.assignee.name || task.assignee.email;
    if (task.assigneeEmployee) return task.assigneeEmployee.name;
    return '—';
}

export default function TasksPage() {
    const { t } = useI18n();
    const m = t.projects;

    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    // Defaults to the signed-in user, so this page opens on what "My Tasks"
    // used to show rather than on every task in the workspace.
    const [assignee, setAssignee] = useState<'me' | 'anyone'>('me');
    const [projectId, setProjectId] = useState('');
    const [statusCategory, setStatusCategory] = useState('');
    const [userId, setUserId] = useState<string | null>(null);
    const [projects, setProjects] = useState<{ id: string; code: string; name: string }[]>([]);
    const [openTaskId, setOpenTaskId] = useState<string | null>(null);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        api.getMe()
            .then((me: unknown) => setUserId((me as { id?: string })?.id ?? null))
            .catch(() => setUserId(null));
        api.getProjects({ limit: 100 })
            .then((res) => setProjects((res?.items ?? []) as { id: string; code: string; name: string }[]))
            .catch(() => setProjects([]));
    }, []);

    // Holding the fetch until the user id resolves keeps the default filter from
    // briefly showing everyone's tasks and then narrowing.
    const ready = assignee === 'anyone' || userId !== null;

    const { items, loading, serverPagination, reload } = useServerList<TaskRow>({
        tableId: 'project-tasks',
        enabled: ready,
        initialSort: { id: 'due_date', desc: false },
        deps: [debouncedSearch, assignee, projectId, statusCategory, userId],
        fetch: (params) =>
            api.getProjectTasks({
                ...params,
                search: debouncedSearch || undefined,
                assigneeId: assignee === 'me' ? (userId ?? undefined) : undefined,
                projectId: projectId || undefined,
                statusCategory: statusCategory || undefined,
            }),
    });

    const columns = useMemo(
        () => [
            {
                id: 'title',
                header: m.task.title,
                accessorKey: 'title',
                cell: ({ row }: { row: { original: TaskRow } }) => (
                    <button
                        type="button"
                        onClick={() => setOpenTaskId(row.original.id)}
                        className="text-left font-medium text-blue-600 hover:underline"
                    >
                        {row.original.title}
                    </button>
                ),
            },
            {
                id: 'project',
                header: m.fields.project,
                cell: ({ row }: { row: { original: TaskRow } }) =>
                    row.original.project ? (
                        <Link
                            href={routes.projects.detail(row.original.project.id)}
                            className="text-blue-600 hover:underline"
                        >
                            {row.original.project.code}
                        </Link>
                    ) : (
                        '—'
                    ),
            },
            {
                id: 'status',
                header: m.fields.status,
                cell: ({ row }: { row: { original: TaskRow } }) =>
                    row.original.status ? (
                        <StatusBadge tone={CATEGORY_TONE[row.original.status.category] ?? 'neutral'}>
                            {row.original.status.name}
                        </StatusBadge>
                    ) : (
                        '—'
                    ),
            },
            {
                id: 'assignee',
                header: m.fields.assignee,
                hideOnMobile: true,
                cell: ({ row }: { row: { original: TaskRow } }) => assigneeLabel(row.original),
            },
            {
                id: 'sprint',
                header: m.fields.sprint,
                hideOnMobile: true,
                cell: ({ row }: { row: { original: TaskRow } }) => row.original.sprint?.name ?? m.sprint.backlog,
            },
            {
                id: 'priority',
                header: m.fields.priority,
                accessorKey: 'priority',
                hideOnMobile: true,
                cell: ({ row }: { row: { original: TaskRow } }) =>
                    m.priority[row.original.priority as keyof typeof m.priority] ?? row.original.priority,
            },
            {
                id: 'remaining',
                header: m.overview.remaining,
                hideOnMobile: true,
                cell: ({ row }: { row: { original: TaskRow } }) => `${num(row.original.remaining_hours)}h`,
            },
            {
                id: 'due_date',
                header: m.fields.dueDate,
                accessorKey: 'due_date',
                hideOnMobile: true,
                cell: ({ row }: { row: { original: TaskRow } }) =>
                    row.original.due_date ? new Date(row.original.due_date).toLocaleDateString() : '—',
            },
        ],
        [m],
    );

    return (
        <PageShell>
            <PageHeader
                title={m.tasks.title}
                subtitle={m.tasks.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.projects,
                    m.tasks.title,
                    'projects',
                )}
            />

            <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={m.tasks.searchPlaceholder}
                    className="md:max-w-xs"
                />
                <Select
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value as 'me' | 'anyone')}
                    className="md:w-44"
                >
                    <option value="me">{m.tasks.mine}</option>
                    <option value="anyone">{m.tasks.anyone}</option>
                </Select>
                <Select
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="md:w-52"
                >
                    <option value="">{m.tasks.allProjects}</option>
                    {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                            {project.code} · {project.name}
                        </option>
                    ))}
                </Select>
                <Select
                    value={statusCategory}
                    onChange={(e) => setStatusCategory(e.target.value)}
                    className="md:w-44"
                >
                    <option value="">{m.tasks.anyStatus}</option>
                    <option value="TODO">{m.statusCategory.TODO}</option>
                    <option value="IN_PROGRESS">{m.statusCategory.IN_PROGRESS}</option>
                    <option value="DONE">{m.statusCategory.DONE}</option>
                </Select>
            </div>

            <DataTable
                title={m.tasks.title}
                tableId="project-tasks"
                columns={columns as never}
                data={items}
                isLoading={loading}
                serverPagination={serverPagination}
                emptyMessage={m.tasks.empty}
            />

            {openTaskId && (
                <TaskDetailPanel
                    taskId={openTaskId}
                    onClose={() => setOpenTaskId(null)}
                    onChanged={reload}
                />
            )}
        </PageShell>
    );
}
