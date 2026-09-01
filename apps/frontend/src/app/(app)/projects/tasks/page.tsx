'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Upload } from 'lucide-react';
import {
    PageShell,
    PageHeader,
    Button,
    Input,
    Select,
    Field,
    RichTextEditor,
    StatusBadge,
} from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import DataTable from '@/components/data-table/DataTable';
import { ImportDialog, type ImportField } from '@/components/import-dialog';
import TaskDetailPanel from '@/components/projects/TaskDetailPanel';
import { useServerList } from '@/hooks/useServerList';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
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

/**
 * The columns an import file may carry. Project, board column and assignee are
 * named the way a person writes them — a project code, the column's name, an
 * email — and the server resolves each one, so nobody has to paste an id into a
 * spreadsheet.
 */
const IMPORT_FIELDS: ImportField[] = [
    { key: 'project', label: 'Project (code or name)', required: true },
    { key: 'title', label: 'Title', required: true },
    { key: 'description', label: 'Description', required: false },
    { key: 'status', label: 'Board column', required: false },
    { key: 'priority', label: 'Priority (LOW/MEDIUM/HIGH/URGENT)', required: false },
    { key: 'assignee', label: 'Assignee (email or name)', required: false },
    { key: 'startDate', label: 'Start date', required: false },
    { key: 'dueDate', label: 'Due date', required: false },
    { key: 'estimateHours', label: 'Estimate hours', required: false },
];

const EMPTY_FORM = {
    projectId: '',
    title: '',
    description: '',
    priority: 'MEDIUM',
    dueDate: '',
    estimateHours: '',
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
    const [creating, setCreating] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [formErrors, setFormErrors] = useState<{ projectId?: string; title?: string }>({});

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

    const openCreate = () => {
        // Whatever project the list is filtered to is almost always the one the
        // new task belongs to; a single-project workspace never has to choose.
        const preset = projectId || (projects.length === 1 ? projects[0].id : '');
        setForm({ ...EMPTY_FORM, projectId: preset });
        setFormErrors({});
        setCreating(true);
    };

    const createTask = async (event: React.FormEvent) => {
        event.preventDefault();
        const errors: { projectId?: string; title?: string } = {};
        if (!form.projectId) errors.projectId = m.task.projectRequired;
        if (!form.title.trim()) errors.title = m.task.titleRequired;
        setFormErrors(errors);
        if (errors.projectId || errors.title) return;

        setSaving(true);
        try {
            const created = await api.createProjectTask({
                projectId: form.projectId,
                title: form.title.trim(),
                description: form.description.trim() || undefined,
                priority: form.priority,
                dueDate: form.dueDate || undefined,
                estimateHours: form.estimateHours ? Number(form.estimateHours) : undefined,
            });
            toast.success(m.task.created);
            setCreating(false);
            setForm(EMPTY_FORM);
            await reload();
            // A new task has no assignee, so under the default "assigned to me"
            // filter it lands outside the list. Open it instead of leaving the
            // page looking as though nothing happened.
            const createdId = (created as { id?: string } | null)?.id;
            if (createdId) setOpenTaskId(createdId);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.task.createFailed);
        } finally {
            setSaving(false);
        }
    };

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
                        className="text-start font-medium text-blue-600 hover:underline"
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
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: TaskRow } }) => assigneeLabel(row.original),
            },
            {
                id: 'sprint',
                header: m.fields.sprint,
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: TaskRow } }) => row.original.sprint?.name ?? m.sprint.backlog,
            },
            {
                id: 'priority',
                header: m.fields.priority,
                accessorKey: 'priority',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: TaskRow } }) =>
                    m.priority[row.original.priority as keyof typeof m.priority] ?? row.original.priority,
            },
            {
                id: 'remaining',
                header: m.overview.remaining,
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: TaskRow } }) => `${num(row.original.remaining_hours)}h`,
            },
            {
                id: 'due_date',
                header: m.fields.dueDate,
                accessorKey: 'due_date',
                meta: { hideOnMobile: true },
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
                        <Button className="min-h-touch" onClick={openCreate}>
                            <Plus className="h-4 w-4" />
                            {m.task.newTask}
                        </Button>
                    </>
                }
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
                // The search above queries the server; the built-in one would only
                // sift the page already fetched, which reads as the same control.
                showSearch={false}
                emptyMessage={m.tasks.empty}
            />

            <ImportDialog
                open={importOpen}
                onClose={() => setImportOpen(false)}
                entityLabel={m.tasks.title}
                fields={IMPORT_FIELDS}
                importFn={(rows, mode) => api.importProjectTasks(rows, mode)}
                onSuccess={() => void reload()}
            />

            {creating && (
                <ModalShell onBackdropClick={() => setCreating(false)}>
                    <form onSubmit={createTask}>
                        <ModalHeader title={m.task.newTask} onClose={() => setCreating(false)} />
                        <div className="space-y-3 p-3 md:p-4">
                            <Field
                                label={m.fields.project}
                                required
                                htmlFor="new-task-project"
                                error={formErrors.projectId}
                                hint={projects.length === 0 ? m.task.noProjects : undefined}
                            >
                                <Select
                                    id="new-task-project"
                                    value={form.projectId}
                                    error={Boolean(formErrors.projectId)}
                                    disabled={projects.length === 0}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        setForm((f) => ({ ...f, projectId: value }));
                                        setFormErrors((errors) => ({ ...errors, projectId: undefined }));
                                    }}
                                >
                                    <option value="">{m.task.selectProject}</option>
                                    {projects.map((project) => (
                                        <option key={project.id} value={project.id}>
                                            {project.code} · {project.name}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                            <Field
                                label={m.task.titleField}
                                required
                                htmlFor="new-task-title"
                                error={formErrors.title}
                            >
                                <Input
                                    id="new-task-title"
                                    value={form.title}
                                    error={Boolean(formErrors.title)}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        setForm((f) => ({ ...f, title: value }));
                                        setFormErrors((errors) => ({ ...errors, title: undefined }));
                                    }}
                                    autoFocus
                                />
                            </Field>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label={m.fields.priority} htmlFor="new-task-priority">
                                    <Select
                                        id="new-task-priority"
                                        value={form.priority}
                                        onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                                    >
                                        {Object.entries(m.priority).map(([key, label]) => (
                                            <option key={key} value={key}>
                                                {label}
                                            </option>
                                        ))}
                                    </Select>
                                </Field>
                                <Field label={m.task.dueDate} htmlFor="new-task-due">
                                    <Input
                                        id="new-task-due"
                                        type="date"
                                        value={form.dueDate}
                                        onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                                    />
                                </Field>
                            </div>
                            <Field label={m.task.estimate} htmlFor="new-task-estimate">
                                <Input
                                    id="new-task-estimate"
                                    type="number"
                                    min="0"
                                    step="0.25"
                                    value={form.estimateHours}
                                    onChange={(e) => setForm((f) => ({ ...f, estimateHours: e.target.value }))}
                                />
                            </Field>
                            <Field label={m.description.title}>
                                <RichTextEditor
                                    rows={4}
                                    maxLength={5000}
                                    value={form.description}
                                    placeholder={m.description.placeholder}
                                    ariaLabel={m.description.title}
                                    onChange={(value) => setForm((f) => ({ ...f, description: value }))}
                                />
                            </Field>
                        </div>
                        <ModalFooter>
                            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
                                {t.common.cancel}
                            </Button>
                            <Button type="submit" disabled={saving || projects.length === 0}>
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
                    onChanged={reload}
                />
            )}
        </PageShell>
    );
}
