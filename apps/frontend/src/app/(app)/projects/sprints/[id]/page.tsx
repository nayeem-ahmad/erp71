'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageShell, PageHeader, Button, Select, Checkbox, StatusBadge } from '@/components/ui';
import BurndownChart, { type BurndownPoint } from '@/components/projects/BurndownChart';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';

interface Sprint {
    id: string;
    name: string;
    goal?: string | null;
    status: string;
    start_date: string;
    end_date: string;
}

interface Task {
    id: string;
    title: string;
    estimate_hours?: string | null;
    remaining_hours?: string | null;
    status?: { id: string; name: string; category: string };
    project?: { id: string; code: string; name: string };
}

const num = (value: unknown): number => (value == null ? 0 : Number(value));

export default function SprintPlanningPage() {
    const params = useParams<{ id: string }>();
    const sprintId = params.id;
    const { t } = useI18n();
    const m = t.projects;

    const [sprint, setSprint] = useState<Sprint | null>(null);
    const [backlog, setBacklog] = useState<Task[]>([]);
    const [inSprint, setInSprint] = useState<Task[]>([]);
    const [projects, setProjects] = useState<{ id: string; code: string; name: string }[]>([]);
    // A tenant-level sprint draws from every project, so this filter is what
    // keeps the left pane usable once there is more than a handful.
    const [projectId, setProjectId] = useState('');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [burndown, setBurndown] = useState<BurndownPoint[] | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const [detail, backlogPage, sprintPage] = await Promise.all([
                api.getSprint(sprintId),
                api.getProjectTasks({
                    backlogOnly: 'true',
                    limit: 200,
                    ...(projectId ? { projectId } : {}),
                }),
                api.getProjectTasks({ sprintId, limit: 200 }),
            ]);
            setSprint(detail as Sprint);
            setBacklog((backlogPage?.items ?? []) as Task[]);
            setInSprint((sprintPage?.items ?? []) as Task[]);
            setSelected(new Set());
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.sprint.loadFailed);
        }
    }, [sprintId, projectId, m.sprint.loadFailed]);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        api.getProjects({ limit: 100 })
            .then((res) => setProjects((res?.items ?? []) as { id: string; code: string; name: string }[]))
            .catch(() => setProjects([]));
    }, []);

    useEffect(() => {
        api.getSprintBurndown(sprintId)
            .then((res: unknown) => setBurndown((res as { series?: BurndownPoint[] })?.series ?? []))
            .catch(() => setBurndown([]));
    }, [sprintId]);

    const toggle = (id: string) =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const selectedHours = useMemo(
        () =>
            backlog
                .filter((task) => selected.has(task.id))
                .reduce((sum, task) => sum + num(task.remaining_hours), 0),
        [backlog, selected],
    );

    const move = async (fn: () => Promise<unknown>, success: string) => {
        setBusy(true);
        try {
            await fn();
            toast.success(success);
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.sprint.saveFailed);
        } finally {
            setBusy(false);
        }
    };

    const committed = inSprint.reduce((sum, task) => sum + num(task.remaining_hours), 0);

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
                        <StatusBadge tone={sprint.status === 'ACTIVE' ? 'info' : 'neutral'}>
                            {(m.sprint[sprint.status.toLowerCase() as keyof typeof m.sprint] as string)
                                ?? sprint.status}
                        </StatusBadge>
                    ) : null
                }
            />

            <section className="grid gap-4 md:grid-cols-2">
                <div className="rounded-md border border-gray-200 bg-white">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-3 py-2">
                        <h2 className="text-sm font-medium">{m.sprint.backlog}</h2>
                        <Select
                            value={projectId}
                            onChange={(e) => setProjectId(e.target.value)}
                            className="w-44"
                        >
                            <option value="">{m.tasks.allProjects}</option>
                            {projects.map((project) => (
                                <option key={project.id} value={project.id}>
                                    {project.code}
                                </option>
                            ))}
                        </Select>
                    </div>

                    {backlog.length === 0 ? (
                        <p className="p-3 text-sm text-gray-500">{m.sprint.emptyBacklog}</p>
                    ) : (
                        <ul className="divide-y divide-gray-200">
                            {backlog.map((task) => (
                                <li key={task.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                                    <Checkbox
                                        checked={selected.has(task.id)}
                                        onChange={() => toggle(task.id)}
                                    />
                                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                                    {/* The project has to be on the row: this list mixes them. */}
                                    <span className="shrink-0 text-xs text-gray-500">
                                        {task.project?.code ?? '—'}
                                    </span>
                                    <span className="w-12 shrink-0 text-right text-xs text-gray-500">
                                        {num(task.remaining_hours)}h
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}

                    <div className="flex items-center justify-between border-t border-gray-200 px-3 py-2">
                        <span className="text-xs text-gray-500">
                            {selected.size} · {selectedHours}h
                        </span>
                        <Button
                            className="min-h-touch"
                            disabled={busy || selected.size === 0}
                            onClick={() =>
                                move(
                                    () => api.assignTasksToSprint(sprintId, [...selected]),
                                    m.sprint.addToSprint,
                                )
                            }
                        >
                            {m.sprint.addToSprint}
                        </Button>
                    </div>
                </div>

                <div className="rounded-md border border-gray-200 bg-white">
                    <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
                        <h2 className="text-sm font-medium">{m.sprint.committed}</h2>
                        <span className="text-xs text-gray-500">{committed}h</span>
                    </div>
                    {inSprint.length === 0 ? (
                        <p className="p-3 text-sm text-gray-500">{m.sprint.emptySprint}</p>
                    ) : (
                        <ul className="divide-y divide-gray-200">
                            {inSprint.map((task) => (
                                <li key={task.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                                    <span className="shrink-0 text-xs text-gray-500">
                                        {task.project?.code ?? '—'}
                                    </span>
                                    <span className="w-12 shrink-0 text-right text-xs text-gray-500">
                                        {num(task.remaining_hours)}h
                                    </span>
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() =>
                                            move(
                                                () => api.removeTasksFromSprint(sprintId, [task.id]),
                                                m.sprint.removeFromSprint,
                                            )
                                        }
                                        className="shrink-0 text-xs text-blue-600 hover:underline"
                                    >
                                        {m.sprint.removeFromSprint}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </section>

            <section className="rounded-md border border-gray-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-sm font-medium">{m.burndown.title}</h2>
                    {/* The chart now spans every project in the sprint, so saying
                        so keeps it from reading as one project's progress. */}
                    <span className="text-xs text-gray-500">{m.burndown.tenantScope}</span>
                </div>
                {burndown && burndown.length > 0 ? (
                    <BurndownChart series={burndown} />
                ) : (
                    <p className="text-sm text-gray-500">{m.burndown.noData}</p>
                )}
            </section>
        </PageShell>
    );
}
