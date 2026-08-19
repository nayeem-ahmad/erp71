'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2 } from 'lucide-react';
import {
    PageShell,
    PageHeader,
    Button,
    Input,
    Select,
    Field,
    StatusBadge,
    ConfirmDialog,
} from '@/components/ui';
import DataTable from '@/components/data-table/DataTable';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

interface Sprint {
    id: string;
    name: string;
    goal?: string | null;
    status: string;
    start_date: string;
    end_date: string;
    estimated_hours: number;
    remaining_hours: number;
    /** Derived from the sprint's tasks — a sprint has no project column any more. */
    projects: { id: string; code: string; name: string }[];
    _count?: { tasks: number };
}

const TONE: Record<string, 'neutral' | 'info' | 'success'> = {
    PLANNED: 'neutral',
    ACTIVE: 'info',
    COMPLETED: 'success',
};

export default function SprintsPage() {
    const { t } = useI18n();
    const m = t.projects;

    const [sprints, setSprints] = useState<Sprint[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('');
    const [projectId, setProjectId] = useState('');
    const [projects, setProjects] = useState<{ id: string; code: string; name: string }[]>([]);
    const [creating, setCreating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<Sprint | null>(null);
    const [form, setForm] = useState({ name: '', goal: '', startDate: '', endDate: '' });

    const load = useCallback(async () => {
        setLoading(true);
        try {
            // The endpoint filters by participation, so the project filter is the
            // one that has to go to the server.
            const list = await api.getSprints(projectId || undefined);
            setSprints(Array.isArray(list) ? list : []);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.sprint.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [m.sprint.loadFailed, projectId]);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        api.getProjects({ limit: 100 })
            .then((res) => setProjects((res?.items ?? []) as { id: string; code: string; name: string }[]))
            .catch(() => setProjects([]));
    }, []);

    // Name, goal and status come back with the list, so those two filters need no
    // second round trip.
    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        return sprints.filter((sprint) => {
            if (status && sprint.status !== status) return false;
            if (!term) return true;
            return (
                sprint.name.toLowerCase().includes(term)
                || (sprint.goal ?? '').toLowerCase().includes(term)
            );
        });
    }, [sprints, search, status]);

    const create = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim() || !form.startDate || !form.endDate) return;
        setSaving(true);
        try {
            await api.createSprint({
                name: form.name.trim(),
                goal: form.goal.trim() || undefined,
                startDate: form.startDate,
                endDate: form.endDate,
            });
            toast.success(m.sprint.created);
            setCreating(false);
            setForm({ name: '', goal: '', startDate: '', endDate: '' });
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.sprint.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const act = useCallback(
        async (fn: () => Promise<unknown>, success: string) => {
            try {
                await fn();
                toast.success(success);
                await load();
            } catch (error) {
                // The one-active-per-tenant rule surfaces here as a 409; show the
                // server's sentence rather than a generic failure.
                toast.error(error instanceof Error ? error.message : m.sprint.saveFailed);
            }
        },
        [load, m.sprint.saveFailed],
    );

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        await act(() => api.deleteSprint(pendingDelete.id), m.sprint.deleted);
        setPendingDelete(null);
    };

    const columns = useMemo(
        () => [
            {
                id: 'name',
                header: m.sprint.name,
                accessorKey: 'name',
                cell: ({ row }: { row: { original: Sprint } }) => (
                    <div className="min-w-0">
                        <Link
                            href={routes.projects.sprintDetail(row.original.id)}
                            className="font-medium text-blue-600 hover:underline"
                        >
                            {row.original.name}
                        </Link>
                        {row.original.goal ? (
                            <span className="block truncate text-xs text-gray-500">{row.original.goal}</span>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'status',
                header: m.fields.status,
                accessorKey: 'status',
                cell: ({ row }: { row: { original: Sprint } }) => (
                    <StatusBadge tone={TONE[row.original.status] ?? 'neutral'}>
                        {(m.sprint[row.original.status.toLowerCase() as keyof typeof m.sprint] as string)
                            ?? row.original.status}
                    </StatusBadge>
                ),
            },
            {
                id: 'dates',
                header: m.sprint.dates,
                // Sorts on the start date — the order a sprint list is read in.
                accessorFn: (row: Sprint) => row.start_date,
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Sprint } }) =>
                    `${new Date(row.original.start_date).toLocaleDateString()} — ${new Date(
                        row.original.end_date,
                    ).toLocaleDateString()}`,
            },
            {
                id: 'projects',
                header: m.sprint.projects,
                accessorFn: (row: Sprint) => row.projects.map((project) => project.code).join(', '),
                meta: { hideOnMobile: true },
                // A sprint spans whatever projects its tasks came from.
                cell: ({ row }: { row: { original: Sprint } }) =>
                    row.original.projects.length === 0
                        ? m.sprint.noProjects
                        : row.original.projects.map((project) => project.code).join(', '),
            },
            {
                id: 'tasks',
                header: m.fields.tasks,
                accessorFn: (row: Sprint) => row._count?.tasks ?? 0,
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Sprint } }) => row.original._count?.tasks ?? 0,
            },
            {
                id: 'remaining',
                header: m.overview.remaining,
                accessorFn: (row: Sprint) => row.remaining_hours,
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Sprint } }) => `${row.original.remaining_hours}h`,
            },
            {
                id: 'actions',
                header: m.fields.actions,
                cell: ({ row }: { row: { original: Sprint } }) => (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        {row.original.status === 'PLANNED' && (
                            <Button
                                variant="secondary"
                                className="min-h-touch"
                                onClick={() => act(() => api.startSprint(row.original.id), m.sprint.started)}
                            >
                                {m.sprint.start}
                            </Button>
                        )}
                        {row.original.status === 'ACTIVE' && (
                            <Button
                                variant="secondary"
                                className="min-h-touch"
                                onClick={() =>
                                    act(() => api.completeSprint(row.original.id), m.sprint.completedMsg)
                                }
                            >
                                {m.sprint.complete}
                            </Button>
                        )}
                        <button
                            type="button"
                            aria-label={t.common.delete}
                            title={m.sprint.deleteSprint}
                            onClick={() => setPendingDelete(row.original)}
                            className="min-h-touch min-w-touch rounded-lg p-1.5 text-red-600 transition-colors hover:bg-red-50"
                        >
                            <Trash2 className="mx-auto h-4 w-4" />
                        </button>
                    </div>
                ),
            },
        ],
        // `act` closes over `load`, which changes with the project filter.
        [m, t.common.delete, act],
    );

    return (
        <PageShell>
            <PageHeader
                title={m.sprint.sprints}
                subtitle={m.sprint.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.projects,
                    m.sprint.sprints,
                    'projects',
                )}
                actions={
                    <Button className="min-h-touch" onClick={() => setCreating(true)}>
                        <Plus className="h-4 w-4" />
                        {m.sprint.newSprint}
                    </Button>
                }
            />

            <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={m.sprint.searchPlaceholder}
                    className="md:max-w-xs"
                />
                <Select value={status} onChange={(e) => setStatus(e.target.value)} className="md:w-44">
                    <option value="">{m.sprint.anyStatus}</option>
                    <option value="PLANNED">{m.sprint.planned}</option>
                    <option value="ACTIVE">{m.sprint.active}</option>
                    <option value="COMPLETED">{m.sprint.completed}</option>
                </Select>
                <Select
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="md:w-52"
                >
                    <option value="">{m.sprint.allProjects}</option>
                    {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                            {project.code} · {project.name}
                        </option>
                    ))}
                </Select>
            </div>

            {/* Empty stays a table: the columns, filters and toolbar are what tell a
                first-time viewer what a sprint list holds. */}
            <DataTable
                title={m.sprint.sprints}
                tableId="project-sprints"
                columns={columns as never}
                data={filtered}
                isLoading={loading}
                showSearch={false}
                emptyMessage={search.trim() || status || projectId ? m.sprint.emptyFiltered : m.sprint.empty}
            />

            {creating && (
            <ModalShell onBackdropClick={() => setCreating(false)}>
                <ModalHeader title={m.sprint.newSprint} onClose={() => setCreating(false)} />
                <form onSubmit={create}>
                    <div className="space-y-3 p-4">
                        <Field label={m.sprint.name} required htmlFor="sprint-name">
                            <Input
                                id="sprint-name"
                                value={form.name}
                                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                                autoFocus
                            />
                        </Field>
                        <Field label={m.sprint.goal} htmlFor="sprint-goal">
                            <Input
                                id="sprint-goal"
                                value={form.goal}
                                onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))}
                            />
                        </Field>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label={m.sprint.startDate} required htmlFor="sprint-start">
                                <Input
                                    id="sprint-start"
                                    type="date"
                                    value={form.startDate}
                                    onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                                />
                            </Field>
                            <Field label={m.sprint.endDate} required htmlFor="sprint-end">
                                <Input
                                    id="sprint-end"
                                    type="date"
                                    value={form.endDate}
                                    onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                                />
                            </Field>
                        </div>
                        <p className="text-xs text-gray-500">{m.sprint.tenantHint}</p>
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

            <ConfirmDialog
                open={pendingDelete !== null}
                title={m.sprint.deleteSprint}
                prompt={m.sprint.deletePrompt.replace('{name}', pendingDelete?.name ?? '')}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                danger
                onConfirm={confirmDelete}
                onCancel={() => setPendingDelete(null)}
            />
        </PageShell>
    );
}
