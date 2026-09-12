'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Pencil, Plus, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import {
    PageShell,
    PageHeader,
    Button,
    Input,
    Select,
    Field,
    RichTextEditor,
    ConfirmDialog,
} from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import DataTable from '@/components/data-table/DataTable';
import CreatedRangeFilter from '@/components/data-table/CreatedRangeFilter';
import { createdAtColumn } from '@/components/data-table/created-at-column';
import { createColumnHelper } from '@tanstack/react-table';
import type { BulkAction } from '@/components/data-table';
import { ImportDialog, type ImportField } from '@/components/import-dialog';
import TaskDetailPanel from '@/components/projects/TaskDetailPanel';
import TaskQuickAdd from '@/components/projects/TaskQuickAdd';
import TaskRowSelect, {
    assigneeOptions,
    statusOptions,
} from '@/components/projects/TaskRowSelect';
import { useProjectMeta } from '@/components/projects/use-project-meta';
import {
    assigneeColumns,
    assigneeKeyOf,
    assigneeLabelOf,
    defaultAssigneeFor,
} from '@/components/projects/task-assignee';
import { Sparkline } from '@/components/dashboard/Sparkline';
import { useServerList } from '@/hooks/useServerList';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { formatDate } from '@/lib/format';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useRememberedFilters } from '@/lib/use-remembered-filters';
import { readsOwnRecordsOnly, tenantFromMe } from '@/lib/permissions';
import { getWorkspaceItem } from '@/lib/session-store';
import {
    applyCreatedRangeQuery,
    isCreatedRangeEmpty,
    type CreatedRange,
} from '@/lib/created-range';

interface TaskRow {
    id: string;
    title: string;
    priority: string;
    created_at: string;
    due_date?: string | null;
    estimate_hours?: string | null;
    remaining_hours?: string | null;
    /** Recent remaining readings, oldest first. Absent below two readings. */
    remaining_trend?: number[];
    status?: { id: string; name: string; category: string };
    project?: { id: string; code: string; name: string };
    sprint?: { id: string; name: string; status: string } | null;
    assignee?: { id: string; name?: string | null; email: string } | null;
    assigneeEmployee?: { id: string; name: string } | null;
}

/** A row of `/project-tasks/assignees` — whoever holds a task the viewer can see. */
interface AssigneeOption {
    key: string;
    name: string;
    hint?: string | null;
    noLogin?: boolean;
}

const columnHelper = createColumnHelper<TaskRow>();

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
    // The one field the modal used to omit, and the one thing always set next.
    assignee: '',
    dueDate: '',
    estimateHours: '',
};

/**
 * The assignee filter's own value space: `me`, `anyone` and `unassigned` are
 * scopes rather than people, and everything else is one of the
 * `user:`/`employee:` keys the server hands back — the same key space the task
 * detail panel's picker uses.
 */
const DEFAULT_FILTERS = {
    search: '',
    // Defaults to the signed-in user, so this page opens on what "My Tasks"
    // used to show rather than on every task in the workspace.
    assignee: 'me' as string,
    projectId: '',
    statusCategory: '',
    priority: '',
    createdRange: null as CreatedRange | null,
};

/** What the chosen assignee means to `/project-tasks`, once "me" knows who that is. */
function assigneeQuery(
    assignee: string,
    userId: string | null,
): { assigneeId?: string; assigneeEmployeeId?: string; unassigned?: string } {
    if (assignee === 'anyone') return {};
    if (assignee === 'unassigned') return { unassigned: 'true' };
    if (assignee === 'me') return { assigneeId: userId ?? undefined };
    if (assignee.startsWith('user:')) return { assigneeId: assignee.slice('user:'.length) };
    if (assignee.startsWith('employee:')) {
        return { assigneeEmployeeId: assignee.slice('employee:'.length) };
    }
    return {};
}

const num = (value: unknown): number => (value == null ? 0 : Number(value));

const assigneeLabel = (task: TaskRow): string => assigneeLabelOf(task);

export default function TasksPage() {
    const { t, fmt, localeInfo } = useI18n();
    const m = t.projects;

    const [filters, setFilter, filtersReady] = useRememberedFilters('project-tasks', DEFAULT_FILTERS);
    const { search, assignee, projectId, statusCategory, priority, createdRange } = filters;

    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [typing, setTyping] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    // Narrowed members read only their own rows, so the assignee filter has
    // nothing to offer them — see `readsOwnRecordsOnly`. The server filters
    // regardless; this only decides whether the control is worth rendering.
    const [ownRecordsOnly, setOwnRecordsOnly] = useState(false);
    const [scopeReady, setScopeReady] = useState(false);
    const [projects, setProjects] = useState<{ id: string; code: string; name: string }[]>([]);
    const [assignees, setAssignees] = useState<AssigneeOption[]>([]);
    const [openTaskId, setOpenTaskId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [formErrors, setFormErrors] = useState<{ projectId?: string; title?: string }>({});
    const [pendingDelete, setPendingDelete] = useState<TaskRow | null>(null);
    const [pendingBulkDelete, setPendingBulkDelete] = useState<TaskRow[] | null>(null);
    const [selectionEpoch, setSelectionEpoch] = useState(0);
    const [busy, setBusy] = useState(false);
    // The composer's own project, held across saves so a run of tasks for one
    // project is one choice rather than one per task.
    const [quickProject, setQuickProject] = useState('');
    const [allLabels, setAllLabels] = useState<{ id: string; name: string }[]>([]);
    const [showPriority, setShowPriority] = useState(false);
    const [showDescription, setShowDescription] = useState(false);
    const projectMeta = useProjectMeta();

    // Debounced only while somebody is actually typing, so a remembered search
    // restored on arrival reaches the query at once rather than 300ms late.
    useEffect(() => {
        if (!typing) {
            setDebouncedSearch(search.trim());
            return;
        }
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search, typing]);

    useEffect(() => {
        api.getMe()
            .then((me: unknown) => {
                const payload = me as {
                    id?: string;
                    tenants?: { id: string; role?: string | null; record_scope?: string | null }[];
                };
                setUserId(payload?.id ?? null);
                setOwnRecordsOnly(
                    readsOwnRecordsOnly(tenantFromMe(payload, getWorkspaceItem('tenant_id'))),
                );
            })
            .catch(() => setUserId(null))
            .finally(() => setScopeReady(true));
        api.getProjects({ limit: 100 })
            .then((res) => setProjects((res?.items ?? []) as { id: string; code: string; name: string }[]))
            .catch(() => setProjects([]));
        api.getProjectTaskAssignees()
            .then((rows: unknown) => setAssignees(Array.isArray(rows) ? (rows as AssigneeOption[]) : []))
            .catch(() => setAssignees([]));
        // For the composer's `#label` tokens. A tenant with no labels simply has
        // no `#` grammar; nothing else depends on this.
        api.getProjectLabels()
            .then((rows: unknown) =>
                setAllLabels(Array.isArray(rows) ? (rows as { id: string; name: string }[]) : []),
            )
            .catch(() => setAllLabels([]));
    }, []);

    /**
     * What the chosen assignee means for a member who reads only their own
     * records: nothing. The server already limits them to the rows they hold,
     * and the page's own `me` default would narrow that *further* — dropping the
     * tasks they raised that nobody has picked up yet.
     *
     * Read through rather than written back, so their remembered choice survives
     * their scope being widened later, and so the list is fetched once rather
     * than once per correction.
     */
    const effectiveAssignee = ownRecordsOnly ? 'anyone' : assignee;

    // Holding the fetch until the user id resolves keeps the default filter from
    // briefly showing everyone's tasks and then narrowing; holding it until the
    // remembered filters land keeps a return visit from fetching the default
    // slice and then the remembered one. `scopeReady` is the same argument for
    // the record scope: fetching before it lands would send a filter the member
    // does not in fact have.
    const ready = filtersReady && scopeReady && (effectiveAssignee !== 'me' || userId !== null);

    const { items, loading, serverPagination, reload } = useServerList<TaskRow>({
        tableId: 'project-tasks',
        enabled: ready,
        initialSort: { id: 'due_date', desc: false },
        deps: [
            debouncedSearch,
            effectiveAssignee,
            projectId,
            statusCategory,
            priority,
            createdRange?.from,
            createdRange?.to,
            userId,
        ],
        fetch: (params) =>
            api.getProjectTasks({
                ...params,
                search: debouncedSearch || undefined,
                ...assigneeQuery(effectiveAssignee, userId),
                projectId: projectId || undefined,
                statusCategory: statusCategory || undefined,
                priority: priority || undefined,
                ...applyCreatedRangeQuery(createdRange),
            }),
    });

    const filtered =
        Boolean(debouncedSearch)
        // The effective one: a hidden, inert assignee filter must not light up
        // the "filters applied" state for a member who cannot change it.
        || effectiveAssignee !== 'anyone'
        || Boolean(projectId)
        || Boolean(statusCategory)
        || Boolean(priority)
        || !isCreatedRangeEmpty(createdRange);

    const clearFilters = () => {
        setTyping(false);
        setFilter('search', '');
        // "Anyone", not the page's own default: clearing filters means showing
        // everything, not narrowing back to the signed-in user.
        setFilter('assignee', 'anyone');
        setFilter('projectId', '');
        setFilter('statusCategory', '');
        setFilter('priority', '');
        setFilter('createdRange', null);
    };

    // DataTable owns the selection; bumping this is how a caller clears it.
    const clearSelection = useCallback(() => setSelectionEpoch((epoch) => epoch + 1), []);

    // Whatever project the list is filtered to is almost always the one a new
    // task belongs to; a single-project workspace never has to choose.
    const presetProject = projectId || (projects.length === 1 ? projects[0].id : '');

    const openCreate = () => {
        setForm({
            ...EMPTY_FORM,
            projectId: quickProject || presetProject,
            // The holder the task would get anyway, shown rather than implied —
            // the field is there to be changed, not to be a surprise.
            assignee: assignee.startsWith('user:') || assignee.startsWith('employee:')
                ? assignee
                : assignee === 'unassigned' || !userId
                  ? ''
                  : `user:${userId}`,
        });
        setFormErrors({});
        setShowPriority(false);
        setShowDescription(false);
        setCreating(true);
    };

    /** One line from the composer: parsed tokens, then the same defaults. */
    const quickCreate = async (parsed: {
        title: string;
        assigneeId?: string;
        assigneeEmployeeId?: string;
        labelIds?: string[];
        priority?: string;
        estimateHours?: number;
        dueDate?: string;
    }) => {
        const holder =
            parsed.assigneeId || parsed.assigneeEmployeeId
                ? { assigneeId: parsed.assigneeId, assigneeEmployeeId: parsed.assigneeEmployeeId }
                : defaultAssigneeFor(assignee, userId);
        try {
            await api.createProjectTask({
                projectId: quickProject || presetProject,
                title: parsed.title.trim(),
                ...holder,
                ...(parsed.labelIds ? { labelIds: parsed.labelIds } : {}),
                ...(parsed.priority ? { priority: parsed.priority } : {}),
                ...(parsed.estimateHours != null ? { estimateHours: parsed.estimateHours } : {}),
                ...(parsed.dueDate ? { dueDate: parsed.dueDate } : {}),
            });
            toast.success(m.task.created);
            await reload();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.task.createFailed);
        }
    };

    /** `again` keeps the dialog open with the project, for filing a run of tasks. */
    const createTask = async (event: React.FormEvent, again = false) => {
        event.preventDefault();
        const errors: { projectId?: string; title?: string } = {};
        if (!form.projectId) errors.projectId = m.task.projectRequired;
        if (!form.title.trim()) errors.title = m.task.titleRequired;
        setFormErrors(errors);
        if (errors.projectId || errors.title) return;

        setSaving(true);
        try {
            await api.createProjectTask({
                projectId: form.projectId,
                title: form.title.trim(),
                description: form.description.trim() || undefined,
                priority: form.priority,
                dueDate: form.dueDate || undefined,
                estimateHours: form.estimateHours ? Number(form.estimateHours) : undefined,
                // An explicit choice wins; an untouched field falls back to the
                // same default the composer uses.
                ...(form.assignee
                    ? assigneeColumns(form.assignee)
                    : defaultAssigneeFor(assignee, userId)),
            });
            toast.success(m.task.created);
            // The task now lands inside the current filter, so the list showing
            // it is the confirmation — no second dialog, which is what the
            // forced-open detail panel used to be standing in for.
            if (again) setForm({ ...EMPTY_FORM, projectId: form.projectId, assignee: form.assignee });
            else setCreating(false);
            await reload();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.task.createFailed);
        } finally {
            setSaving(false);
        }
    };

    /** An inline row edit. Saves, then refreshes just the list behind it. */
    const patchRow = async (taskId: string, data: Record<string, unknown>) => {
        try {
            await api.updateProjectTask(taskId, data);
            await reload();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.task.saveFailed);
        }
    };

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        setBusy(true);
        try {
            await api.deleteProjectTask(pendingDelete.id);
            toast.success(m.task.deleted);
            setPendingDelete(null);
            await reload();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.task.deleteFailed);
        } finally {
            setBusy(false);
        }
    };

    const confirmBulkDelete = async () => {
        const rows = pendingBulkDelete;
        if (!rows?.length) return;
        setBusy(true);
        try {
            // No bulk endpoint for tasks, so these go one at a time. `allSettled`
            // rather than `all`: one task in a project the viewer cannot manage
            // must not throw away the deletes that did land.
            const results = await Promise.allSettled(
                rows.map((row) => api.deleteProjectTask(row.id)),
            );
            const failed = results.filter((result) => result.status === 'rejected').length;
            const deleted = results.length - failed;
            if (deleted > 0) toast.success(fmt(m.tasks.deletedCount, { count: deleted }));
            if (failed > 0) toast.error(fmt(m.tasks.deleteFailedCount, { count: failed }));
            setPendingBulkDelete(null);
            clearSelection();
            await reload();
        } finally {
            setBusy(false);
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
                // Editable in place: "mark it done" and "move it along" are the
                // two commonest edits in the module, and neither is worth the
                // ten requests of opening the card.
                cell: ({ row }: { row: { original: TaskRow } }) => {
                    const task = row.original;
                    const project = task.project?.id ?? '';
                    if (!task.status || !project) return '—';
                    return (
                        <TaskRowSelect
                            testId="row-status"
                            label={m.fields.status}
                            value={task.status.id}
                            current={task.status.name}
                            options={statusOptions(projectMeta.peek(project))}
                            onOpen={() => void projectMeta.load(project)}
                            onChange={(statusId) => patchRow(task.id, { statusId })}
                            disabled={busy}
                            tone={CATEGORY_TONE[task.status.category] === 'success'
                                ? 'text-emerald-700'
                                : undefined}
                        />
                    );
                },
            },
            {
                id: 'assignee',
                header: m.fields.assignee,
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: TaskRow } }) => {
                    const task = row.original;
                    const project = task.project?.id ?? '';
                    if (!project) return assigneeLabel(task);
                    return (
                        <TaskRowSelect
                            testId="row-assignee"
                            label={m.fields.assignee}
                            value={assigneeKeyOf(task)}
                            current={assigneeLabel(task)}
                            options={assigneeOptions(projectMeta.peek(project), m.task.unassigned)}
                            onOpen={() => void projectMeta.load(project)}
                            onChange={(key) => patchRow(task.id, assigneeColumns(key))}
                            disabled={busy}
                        />
                    );
                },
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
                // The figure, and where it has been. A column of bare numbers
                // cannot tell a task converging from one stuck at 12h for a
                // fortnight, which is the whole question somebody scanning this
                // list is asking.
                cell: ({ row }: { row: { original: TaskRow } }) => {
                    const trend = row.original.remaining_trend;
                    return (
                        <span className="flex items-center justify-end gap-2">
                            <span className="tabular-nums">{num(row.original.remaining_hours)}h</span>
                            {trend && trend.length > 1 && (
                                <span className="w-14 shrink-0" data-testid="remaining-trend">
                                    <Sparkline
                                        points={trend}
                                        // Down is the good direction here, which
                                        // is the opposite of a sales tile.
                                        positive={trend[trend.length - 1] <= trend[0]}
                                    />
                                </span>
                            )}
                        </span>
                    );
                },
            },
            {
                id: 'due_date',
                header: m.fields.dueDate,
                accessorKey: 'due_date',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: TaskRow } }) =>
                    formatDate(row.original.due_date),
            },
            createdAtColumn(columnHelper, { header: t.common.createdAt }),
            {
                id: 'actions',
                header: m.fields.actions,
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 90,
                cell: ({ row }: { row: { original: TaskRow } }) => (
                    <div className="flex items-center justify-end gap-1">
                        <button
                            type="button"
                            aria-label={t.common.edit}
                            title={m.task.editTask}
                            onClick={() => setOpenTaskId(row.original.id)}
                            className="min-h-touch min-w-touch rounded-lg p-1.5 text-blue-600 transition-colors hover:bg-blue-50"
                        >
                            <Pencil className="mx-auto h-4 w-4" />
                        </button>
                        <button
                            type="button"
                            aria-label={t.common.delete}
                            title={m.task.deleteTask}
                            onClick={() => setPendingDelete(row.original)}
                            className="min-h-touch min-w-touch rounded-lg p-1.5 text-red-600 transition-colors hover:bg-red-50"
                        >
                            <Trash2 className="mx-auto h-4 w-4" />
                        </button>
                    </div>
                ),
            },
        ],
        // `patchRow` closes over `reload`, which useServerList recreates every
        // render; listing it would rebuild every column on every keystroke in
        // the search box.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [m, t.common.createdAt, t.common.delete, t.common.edit, busy, projectMeta],
    );

    const bulkActions: BulkAction<TaskRow>[] = useMemo(
        () => [
            {
                label: t.common.delete,
                tone: 'danger',
                icon: <Trash2 className="h-4 w-4" />,
                onClick: (rows) => setPendingBulkDelete(rows),
            },
        ],
        [t.common.delete],
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
                            aria-label={t.common.refresh}
                            title={t.common.refresh}
                            onClick={() => void reload()}
                        >
                            <RefreshCw className="h-4 w-4" />
                        </Button>
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

            <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
                <Input
                    value={search}
                    onChange={(e) => {
                        setTyping(true);
                        setFilter('search', e.target.value);
                    }}
                    placeholder={m.tasks.searchPlaceholder}
                    className="md:max-w-xs"
                />
                {!ownRecordsOnly && (
                    <Select
                        value={assignee}
                        onChange={(e) => setFilter('assignee', e.target.value)}
                        aria-label={m.fields.assignee}
                        className="md:w-52"
                    >
                        <option value="me">{m.tasks.mine}</option>
                        <option value="anyone">{m.tasks.anyone}</option>
                        <option value="unassigned">{m.task.unassigned}</option>
                        {assignees.length > 0 && (
                            <optgroup label={m.fields.assignee}>
                                {assignees.map((person) => (
                                    <option key={person.key} value={person.key}>
                                        {person.noLogin ? `${person.name} (${m.team.noLogin})` : person.name}
                                    </option>
                                ))}
                            </optgroup>
                        )}
                    </Select>
                )}
                <Select
                    value={projectId}
                    onChange={(e) => setFilter('projectId', e.target.value)}
                    aria-label={m.fields.project}
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
                    onChange={(e) => setFilter('statusCategory', e.target.value)}
                    aria-label={m.fields.status}
                    className="md:w-44"
                >
                    <option value="">{m.tasks.anyStatus}</option>
                    <option value="TODO">{m.statusCategory.TODO}</option>
                    <option value="IN_PROGRESS">{m.statusCategory.IN_PROGRESS}</option>
                    <option value="DONE">{m.statusCategory.DONE}</option>
                </Select>
                <Select
                    value={priority}
                    onChange={(e) => setFilter('priority', e.target.value)}
                    aria-label={m.fields.priority}
                    className="md:w-44"
                >
                    <option value="">{m.tasks.anyPriority}</option>
                    {Object.entries(m.priority).map(([key, label]) => (
                        <option key={key} value={key}>
                            {label}
                        </option>
                    ))}
                </Select>
                <CreatedRangeFilter
                    value={createdRange}
                    onChange={(next) => setFilter('createdRange', next)}
                />
                {filtered && (
                    <Button variant="ghost" className="min-h-touch" onClick={clearFilters}>
                        <X className="h-4 w-4" />
                        {t.common.clearAll}
                    </Button>
                )}
            </div>

            <TaskQuickAdd
                projects={projects}
                projectId={quickProject || presetProject}
                onProjectChange={setQuickProject}
                vocabulary={{
                    labels: allLabels,
                    assignees: assignees
                        .filter((option) => option.key.includes(':'))
                        .map((option) => ({ key: option.key, name: option.name })),
                    locale: localeInfo.dateLocale,
                    today: m.quickAdd.today,
                    tomorrow: m.quickAdd.tomorrow,
                }}
                labels={{
                    placeholder: m.quickAdd.placeholder,
                    hint: m.quickAdd.hint,
                    project: m.fields.project,
                    selectProject: m.task.selectProject,
                    add: m.quickAdd.add,
                    more: m.quickAdd.more,
                    noProjects: m.task.noProjects,
                }}
                busy={busy}
                onCreate={quickCreate}
                onOpenFull={openCreate}
            />

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
                enableRowSelection
                getRowId={(row) => row.id}
                clearSelectionSignal={selectionEpoch}
                bulkActions={bulkActions}
                bulkActionsDisabled={busy}
                emptyMessage={filtered ? m.tasks.empty : m.task.noTasks}
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
                            {/* The field the modal used to leave out, and the one
                                thing always set next. It opens on the holder the
                                task would get anyway rather than blank, so the
                                default is visible instead of implied. */}
                            <Field label={m.fields.assignee} htmlFor="new-task-assignee">
                                <Select
                                    id="new-task-assignee"
                                    value={form.assignee}
                                    onFocus={() => form.projectId && void projectMeta.load(form.projectId)}
                                    onChange={(e) => setForm((f) => ({ ...f, assignee: e.target.value }))}
                                >
                                    <option value="">{m.task.unassigned}</option>
                                    {(projectMeta.peek(form.projectId)?.assignees ?? []).map((person) => (
                                        <option key={person.value} value={person.value}>
                                            {person.label}
                                        </option>
                                    ))}
                                    {/* Whoever is preselected, even before the
                                        roster has loaded — otherwise the select
                                        falls back to its first option and the
                                        form quietly disagrees with itself. */}
                                    {form.assignee &&
                                        !(projectMeta.peek(form.projectId)?.assignees ?? []).some(
                                            (person) => person.value === form.assignee,
                                        ) && (
                                            <option value={form.assignee}>
                                                {assignees.find((a) => a.key === form.assignee)?.name ??
                                                    m.quickAdd.me}
                                            </option>
                                        )}
                                </Select>
                            </Field>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label={m.task.dueDate} htmlFor="new-task-due">
                                    <Input
                                        id="new-task-due"
                                        type="date"
                                        value={form.dueDate}
                                        onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                                    />
                                </Field>
                                <Field label={m.task.estimate} htmlFor="new-task-estimate">
                                    <Input
                                        id="new-task-estimate"
                                        type="number"
                                        min="0"
                                        step="0.25"
                                        value={form.estimateHours}
                                        onChange={(e) =>
                                            setForm((f) => ({ ...f, estimateHours: e.target.value }))
                                        }
                                    />
                                </Field>
                            </div>

                            {/* Priority is quiet until it is not MEDIUM. Four
                                tasks in five never leave the default, and a
                                select that always says "Medium" is a row of the
                                form spent saying nothing. */}
                            {showPriority || form.priority !== 'MEDIUM' ? (
                                <Field label={m.fields.priority} htmlFor="new-task-priority">
                                    <Select
                                        id="new-task-priority"
                                        value={form.priority}
                                        onChange={(e) =>
                                            setForm((f) => ({ ...f, priority: e.target.value }))
                                        }
                                    >
                                        {Object.entries(m.priority).map(([key, label]) => (
                                            <option key={key} value={key}>
                                                {label}
                                            </option>
                                        ))}
                                    </Select>
                                </Field>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setShowPriority(true)}
                                    className="min-h-touch text-sm text-blue-600 hover:underline"
                                >
                                    {m.quickAdd.setPriority}
                                </button>
                            )}

                            {/* Collapsed, because it was the tallest control in
                                the dialog serving the field most tasks never
                                get. */}
                            {showDescription || form.description ? (
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
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setShowDescription(true)}
                                    className="min-h-touch text-sm text-blue-600 hover:underline"
                                >
                                    {m.quickAdd.addDescription}
                                </button>
                            )}
                        </div>
                        <ModalFooter>
                            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
                                {t.common.cancel}
                            </Button>
                            {/* Filing a run of tasks is the case the old dialog
                                served worst: one save, one dismissal, one reopen,
                                one re-pick of the project, for every task. */}
                            <Button
                                type="button"
                                variant="secondary"
                                disabled={saving || projects.length === 0}
                                onClick={(event) => void createTask(event, true)}
                            >
                                {m.quickAdd.saveAndAdd}
                            </Button>
                            <Button type="submit" disabled={saving || projects.length === 0}>
                                {t.common.save}
                            </Button>
                        </ModalFooter>
                    </form>
                </ModalShell>
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

            <ConfirmDialog
                open={pendingBulkDelete !== null}
                title={m.task.deleteTask}
                prompt={fmt(m.tasks.bulkDeletePrompt, { count: pendingBulkDelete?.length ?? 0 })}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                loading={busy}
                danger
                onConfirm={confirmBulkDelete}
                onCancel={() => setPendingBulkDelete(null)}
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
