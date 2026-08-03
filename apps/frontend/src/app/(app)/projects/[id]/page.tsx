'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import {
    PageShell,
    PageHeader,
    Button,
    Input,
    RichTextEditor,
    Field,
    StatusBadge,
} from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import TaskDetailPanel from '@/components/projects/TaskDetailPanel';
import ProjectTeamCard from '@/components/projects/ProjectTeamCard';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { formatBDT } from '@/lib/format';

interface Progress {
    taskCount: number;
    doneTaskCount: number;
    percentComplete: number;
    estimatedHours: number;
    remainingHours: number;
    loggedHours: number;
    milestones: {
        milestoneId: string;
        taskCount: number;
        doneTaskCount: number;
        percentComplete: number;
    }[];
}

interface Project {
    id: string;
    code: string;
    name: string;
    description?: string | null;
    status: string;
    priority: string;
    budget_amount?: string | null;
    start_date?: string | null;
    target_end_date?: string | null;
    customer?: { id: string; name: string } | null;
    projectType?: { id: string; name: string } | null;
    manager?: { id: string; name?: string | null; email: string } | null;
    members: {
        id: string;
        role: string;
        user?: { id: string; name?: string | null; email: string } | null;
        employee?: { id: string; name: string; employee_code: string } | null;
    }[];
    milestones: { id: string; name: string; target_date?: string | null; completed_at?: string | null }[];
    progress: Progress;
}

interface Task {
    id: string;
    title: string;
    priority: string;
    due_date?: string | null;
    remaining_hours?: string | null;
    estimate_hours?: string | null;
    logged_hours?: number;
    status?: { id: string; name: string; category: string };
    sprint?: { id: string; name: string; status: string } | null;
    assignee?: { id: string; name?: string | null; email: string } | null;
    assigneeEmployee?: { id: string; name: string } | null;
}

const num = (value: unknown): number => (value == null ? 0 : Number(value));

/** A task goes to a user or to an employee with no login; show whichever holds it. */
function assigneeLabel(task: Task): string {
    if (task.assignee) return task.assignee.name || task.assignee.email;
    if (task.assigneeEmployee) return task.assigneeEmployee.name;
    return '—';
}

export default function ProjectDetailPage() {
    const params = useParams<{ id: string }>();
    const projectId = params.id;
    const { t } = useI18n();
    const m = t.projects;

    const [project, setProject] = useState<Project | null>(null);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [openTaskId, setOpenTaskId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [newTask, setNewTask] = useState({ title: '', description: '', estimateHours: '' });
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        try {
            const [detail, taskPage] = await Promise.all([
                api.getProject(projectId),
                api.getProjectTasks({ projectId, limit: 200 }),
            ]);
            setProject(detail as Project);
            setTasks(((taskPage as { items?: Task[] })?.items ?? []) as Task[]);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not load the project');
        }
    }, [projectId]);

    useEffect(() => {
        load();
    }, [load]);

    const createTask = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTask.title.trim()) return;
        setSaving(true);
        try {
            await api.createProjectTask({
                projectId,
                title: newTask.title.trim(),
                description: newTask.description.trim() || undefined,
                estimateHours: newTask.estimateHours ? Number(newTask.estimateHours) : undefined,
            });
            toast.success(m.task.created);
            setCreating(false);
            setNewTask({ title: '', description: '', estimateHours: '' });
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not create the task');
        } finally {
            setSaving(false);
        }
    };

    if (!project) {
        return (
            <PageShell>
                <p className="text-sm text-gray-500">{t.common.loading}</p>
            </PageShell>
        );
    }

    const progress = project.progress;

    return (
        <PageShell>
            <PageHeader
                title={`${project.code} · ${project.name}`}
                subtitle={project.customer?.name ?? project.projectType?.name ?? m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.projects,
                    `${project.code} · ${project.name}`,
                    'projects',
                )}
                actions={
                    <div className="flex flex-wrap gap-2">
                        <Link href={routes.projects.edit(projectId)}>
                            <Button variant="secondary" className="min-h-touch">
                                {m.editProject}
                            </Button>
                        </Link>
                        <Link href={routes.projects.board(projectId)}>
                            <Button variant="secondary" className="min-h-touch">
                                {m.tabs.board}
                            </Button>
                        </Link>
                        <Button className="min-h-touch" onClick={() => setCreating(true)}>
                            <Plus className="h-4 w-4" />
                            {m.task.newTask}
                        </Button>
                    </div>
                }
            />

            <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Stat label={m.fields.progress} value={`${progress.percentComplete}% ${m.overview.complete}`} />
                <Stat label={m.overview.estimated} value={`${progress.estimatedHours}h`} />
                <Stat label={m.overview.logged} value={`${progress.loggedHours}h`} />
                <Stat label={m.overview.remaining} value={`${progress.remainingHours}h`} />
            </section>

            <section className="grid gap-4 md:grid-cols-3">
                <div className="space-y-3 md:col-span-2">
                    <div className="rounded-md border border-gray-200 bg-white">
                        <h2 className="border-b border-gray-200 px-3 py-2 text-sm font-medium">
                            {m.tabs.tasks}
                        </h2>
                        {tasks.length === 0 ? (
                            <p className="p-3 text-sm text-gray-500">{m.task.noTasks}</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                                            <th className="px-3 py-2 font-medium">{m.task.title}</th>
                                            <th className="px-3 py-2 font-medium">{m.fields.status}</th>
                                            <th className="hidden px-3 py-2 font-medium md:table-cell">
                                                {m.fields.sprint}
                                            </th>
                                            <th className="hidden px-3 py-2 font-medium md:table-cell">
                                                {m.fields.assignee}
                                            </th>
                                            <th className="hidden px-3 py-2 font-medium md:table-cell">
                                                {m.fields.priority}
                                            </th>
                                            <th className="px-3 py-2 text-right font-medium">
                                                {m.overview.remaining}
                                            </th>
                                            <th className="hidden px-3 py-2 font-medium md:table-cell">
                                                {m.fields.dueDate}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                        {tasks.map((task) => (
                                            <tr
                                                key={task.id}
                                                onClick={() => setOpenTaskId(task.id)}
                                                className="cursor-pointer hover:bg-gray-50"
                                            >
                                                <td className="max-w-[16rem] truncate px-3 py-2" title={task.title}>
                                                    {task.title}
                                                </td>
                                                <td className="px-3 py-2">
                                                    {task.status ? (
                                                        <StatusBadge
                                                            tone={task.status.category === 'DONE' ? 'success' : 'neutral'}
                                                        >
                                                            {task.status.name}
                                                        </StatusBadge>
                                                    ) : (
                                                        '—'
                                                    )}
                                                </td>
                                                {/* No sprint IS the backlog — which is why the standalone
                                                    backlog page was redundant with this list. */}
                                                <td className="hidden px-3 py-2 text-gray-600 md:table-cell">
                                                    {task.sprint?.name ?? m.sprint.backlog}
                                                </td>
                                                <td className="hidden px-3 py-2 text-gray-600 md:table-cell">
                                                    {assigneeLabel(task)}
                                                </td>
                                                <td className="hidden px-3 py-2 text-gray-600 md:table-cell">
                                                    {m.priority[task.priority as keyof typeof m.priority] ?? task.priority}
                                                </td>
                                                <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                                                    {num(task.remaining_hours)}h
                                                </td>
                                                <td className="hidden px-3 py-2 text-gray-600 md:table-cell">
                                                    {task.due_date
                                                        ? new Date(task.due_date).toLocaleDateString()
                                                        : '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="rounded-md border border-gray-200 bg-white p-3">
                        <h2 className="mb-2 text-sm font-medium">{m.tabs.overview}</h2>
                        <dl className="space-y-1.5 text-sm">
                            <Row label={m.fields.status}>
                                {m.status[project.status as keyof typeof m.status] ?? project.status}
                            </Row>
                            <Row label={m.fields.priority}>
                                {m.priority[project.priority as keyof typeof m.priority] ?? project.priority}
                            </Row>
                            <Row label={m.fields.manager}>
                                {project.manager?.name ?? project.manager?.email ?? '—'}
                            </Row>
                            <Row label={m.fields.targetEndDate}>
                                {project.target_end_date
                                    ? new Date(project.target_end_date).toLocaleDateString()
                                    : '—'}
                            </Row>
                            <Row label={m.fields.budget}>
                                {project.budget_amount ? formatBDT(Number(project.budget_amount)) : '—'}
                            </Row>
                        </dl>
                    </div>

                    <div className="rounded-md border border-gray-200 bg-white p-3">
                        <h2 className="mb-2 text-sm font-medium">{m.tabs.milestones}</h2>
                        {project.milestones.length === 0 ? (
                            <p className="text-sm text-gray-500">{m.overview.noMilestones}</p>
                        ) : (
                            <ul className="space-y-1.5 text-sm">
                                {project.milestones.map((milestone) => {
                                    const stat = progress.milestones.find(
                                        (row) => row.milestoneId === milestone.id,
                                    );
                                    return (
                                        <li key={milestone.id} className="flex items-center justify-between gap-2">
                                            <span className="truncate">{milestone.name}</span>
                                            <span className="shrink-0 text-xs text-gray-500">
                                                {stat ? `${stat.percentComplete}%` : '0%'}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>

                    <ProjectTeamCard
                        projectId={projectId}
                        members={project.members}
                        onChanged={load}
                    />
                </div>
            </section>

            {creating && (
                <ModalShell onBackdropClick={() => setCreating(false)}>
                    <form onSubmit={createTask}>
                        <ModalHeader title={m.task.newTask} onClose={() => setCreating(false)} />
                        <div className="space-y-3 p-4">
                            <Field label={m.task.titleField} required>
                                <Input
                                    value={newTask.title}
                                    onChange={(e) => setNewTask((p) => ({ ...p, title: e.target.value }))}
                                    autoFocus
                                />
                            </Field>
                            <Field label={m.description.title}>
                                <RichTextEditor
                                    rows={4}
                                    maxLength={5000}
                                    value={newTask.description}
                                    placeholder={m.description.placeholder}
                                    ariaLabel={m.description.title}
                                    onChange={(value) =>
                                        setNewTask((p) => ({ ...p, description: value }))
                                    }
                                />
                            </Field>
                            <Field label={m.task.estimate}>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.25"
                                    value={newTask.estimateHours}
                                    onChange={(e) =>
                                        setNewTask((p) => ({ ...p, estimateHours: e.target.value }))
                                    }
                                />
                            </Field>
                        </div>
                        <ModalFooter>
                            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
                                {t.common.cancel}
                            </Button>
                            <Button type="submit" disabled={saving}>
                                {t.common.save}
                            </Button>
                        </ModalFooter>
                    </form>
                </ModalShell>
            )}

            {openTaskId && (
                <TaskDetailPanel
                    taskId={openTaskId}
                    onClose={() => setOpenTaskId(null)}
                    onChanged={load}
                />
            )}
        </PageShell>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-md border border-gray-200 bg-white p-3">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="mt-0.5 text-sm font-medium">{value}</p>
        </div>
    );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-2">
            <dt className="text-gray-500">{label}</dt>
            <dd className="truncate text-right">{children}</dd>
        </div>
    );
}
