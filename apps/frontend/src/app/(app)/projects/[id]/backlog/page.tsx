'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { PageShell, PageHeader, Button, Input, Field, Checkbox, StatusBadge } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { projectChildBreadcrumbs } from '@/lib/page-breadcrumbs';

interface ProjectSummary {
    id: string;
    code: string;
    name: string;
}

interface Task {
    id: string;
    title: string;
    estimate_hours?: string | null;
    remaining_hours?: string | null;
    status?: { id: string; name: string; category: string };
}

interface Sprint {
    id: string;
    name: string;
    goal?: string | null;
    status: string;
    start_date: string;
    end_date: string;
    estimated_hours?: number;
    remaining_hours?: number;
    _count?: { tasks: number };
}

const num = (value: unknown): number => (value == null ? 0 : Number(value));

export default function ProjectBacklogPage() {
    const params = useParams<{ id: string }>();
    const projectId = params.id;
    const { t } = useI18n();
    const m = t.projects;

    const [project, setProject] = useState<ProjectSummary | null>(null);
    const [backlog, setBacklog] = useState<Task[]>([]);
    const [sprints, setSprints] = useState<Sprint[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const [creating, setCreating] = useState(false);
    const [form, setForm] = useState({ name: '', goal: '', startDate: '', endDate: '' });

    const load = useCallback(async () => {
        const [tasks, sprintList] = await Promise.all([
            api.getProjectTasks({ projectId, backlogOnly: 'true', limit: 200 }),
            api.getSprints(projectId),
        ]);
        setBacklog(((tasks as { items?: Task[] })?.items ?? []) as Task[]);
        setSprints(Array.isArray(sprintList) ? sprintList : []);
        setSelected(new Set());
    }, [projectId]);

    // Header identity only, so a failure here leaves the backlog usable with a
    // plain breadcrumb rather than blocking it. Kept out of `load()` because
    // that re-runs on every sprint edit and the project name will not have moved.
    useEffect(() => {
        api.getProject(projectId)
            .then((res: unknown) => setProject(res as ProjectSummary))
            .catch(() => setProject(null));
    }, [projectId]);

    useEffect(() => {
        load().catch(() => undefined);
    }, [load]);

    const toggle = (id: string) =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const selectedHours = backlog
        .filter((task) => selected.has(task.id))
        .reduce((total, task) => total + num(task.remaining_hours), 0);

    const createSprint = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim() || !form.startDate || !form.endDate) return;
        setBusy(true);
        try {
            await api.createSprint({
                projectId,
                name: form.name.trim(),
                goal: form.goal.trim() || undefined,
                startDate: form.startDate,
                endDate: form.endDate,
            });
            setCreating(false);
            setForm({ name: '', goal: '', startDate: '', endDate: '' });
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not create the sprint');
        } finally {
            setBusy(false);
        }
    };

    const addToSprint = async (sprintId: string) => {
        if (selected.size === 0) return;
        setBusy(true);
        try {
            await api.assignTasksToSprint(sprintId, [...selected]);
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not add those tasks');
        } finally {
            setBusy(false);
        }
    };

    const runSprint = async (sprintId: string) => {
        setBusy(true);
        try {
            await api.startSprint(sprintId);
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.sprint.oneActive);
        } finally {
            setBusy(false);
        }
    };

    const finishSprint = async (sprintId: string) => {
        setBusy(true);
        try {
            const result = await api.completeSprint(sprintId);
            const carried = (result as { carried_over?: number })?.carried_over ?? 0;
            toast.success(m.sprint.carriedOver.replace('{count}', String(carried)));
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not complete the sprint');
        } finally {
            setBusy(false);
        }
    };

    return (
        <PageShell>
            <PageHeader
                title={m.sprint.backlog}
                subtitle={m.subtitle}
                breadcrumbs={projectChildBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.projects,
                    project,
                    m.sprint.backlog,
                )}
                actions={
                    <div className="flex flex-wrap gap-2">
                        {/* The board links here but nothing linked back, so the
                            two sibling views were a one-way trip. */}
                        <Link href={routes.projects.board(projectId)}>
                            <Button variant="secondary" className="min-h-touch">
                                {m.tabs.board}
                            </Button>
                        </Link>
                        <Button className="min-h-touch" onClick={() => setCreating(true)}>
                            <Plus className="h-4 w-4" />
                            {m.sprint.newSprint}
                        </Button>
                    </div>
                }
            />

            <section className="grid gap-4 md:grid-cols-2">
                <div className="rounded-md border border-gray-200 bg-white">
                    <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
                        <h2 className="text-sm font-medium">{m.sprint.backlog}</h2>
                        {selected.size > 0 && (
                            <span className="text-xs text-gray-500">
                                {selected.size} · {selectedHours}h
                            </span>
                        )}
                    </div>
                    {backlog.length === 0 ? (
                        <p className="p-3 text-sm text-gray-500">{m.sprint.emptyBacklog}</p>
                    ) : (
                        <ul className="divide-y divide-gray-200">
                            {backlog.map((task) => (
                                <li key={task.id} className="flex min-h-touch items-center gap-2 px-3 py-2">
                                    <Checkbox
                                        checked={selected.has(task.id)}
                                        onChange={() => toggle(task.id)}
                                        aria-label={task.title}
                                    />
                                    <span className="flex-1 truncate text-sm">{task.title}</span>
                                    <span className="shrink-0 text-xs text-gray-500">
                                        {num(task.remaining_hours)}h
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <div className="rounded-md border border-gray-200 bg-white">
                    <h2 className="border-b border-gray-200 px-3 py-2 text-sm font-medium">
                        {m.sprint.sprints}
                    </h2>
                    {sprints.length === 0 ? (
                        <p className="p-3 text-sm text-gray-500">{m.sprint.empty}</p>
                    ) : (
                        <ul className="divide-y divide-gray-200">
                            {sprints.map((sprint) => (
                                <li key={sprint.id} className="space-y-2 px-3 py-2.5">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="truncate text-sm font-medium">{sprint.name}</span>
                                        <StatusBadge
                                            tone={
                                                sprint.status === 'ACTIVE'
                                                    ? 'info'
                                                    : sprint.status === 'COMPLETED'
                                                      ? 'success'
                                                      : 'neutral'
                                            }
                                        >
                                            {m.sprint[
                                                sprint.status.toLowerCase() as 'planned' | 'active' | 'completed'
                                            ] ?? sprint.status}
                                        </StatusBadge>
                                    </div>
                                    <p className="text-xs text-gray-500">
                                        {new Date(sprint.start_date).toLocaleDateString()} –{' '}
                                        {new Date(sprint.end_date).toLocaleDateString()} ·{' '}
                                        {sprint.remaining_hours ?? 0}h
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        {selected.size > 0 && sprint.status !== 'COMPLETED' && (
                                            <Button
                                                variant="secondary"
                                                className="min-h-touch"
                                                disabled={busy}
                                                onClick={() => addToSprint(sprint.id)}
                                            >
                                                {m.sprint.addToSprint}
                                            </Button>
                                        )}
                                        {sprint.status === 'PLANNED' && (
                                            <Button
                                                variant="secondary"
                                                className="min-h-touch"
                                                disabled={busy}
                                                onClick={() => runSprint(sprint.id)}
                                            >
                                                {m.sprint.start}
                                            </Button>
                                        )}
                                        {sprint.status === 'ACTIVE' && (
                                            <Button
                                                variant="secondary"
                                                className="min-h-touch"
                                                disabled={busy}
                                                onClick={() => finishSprint(sprint.id)}
                                            >
                                                {m.sprint.complete}
                                            </Button>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </section>

            {creating && (
                <ModalShell onBackdropClick={() => setCreating(false)}>
                    <form onSubmit={createSprint}>
                        <ModalHeader title={m.sprint.newSprint} onClose={() => setCreating(false)} />
                        <div className="space-y-3 p-4">
                            <Field label={m.sprint.name} required>
                                <Input
                                    value={form.name}
                                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                                    autoFocus
                                />
                            </Field>
                            <Field label={m.sprint.goal}>
                                <Input
                                    value={form.goal}
                                    onChange={(e) => setForm((p) => ({ ...p, goal: e.target.value }))}
                                />
                            </Field>
                            <div className="grid gap-3 md:grid-cols-2">
                                <Field label={m.sprint.startDate} required>
                                    <Input
                                        type="date"
                                        value={form.startDate}
                                        onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
                                    />
                                </Field>
                                <Field label={m.sprint.endDate} required>
                                    <Input
                                        type="date"
                                        value={form.endDate}
                                        onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))}
                                    />
                                </Field>
                            </div>
                        </div>
                        <ModalFooter>
                            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
                                {t.common.cancel}
                            </Button>
                            <Button type="submit" disabled={busy}>
                                {t.common.save}
                            </Button>
                        </ModalFooter>
                    </form>
                </ModalShell>
            )}
        </PageShell>
    );
}
