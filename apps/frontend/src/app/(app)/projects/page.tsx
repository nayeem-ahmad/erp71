'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageShell, PageHeader, Button, Input, Select, StatusBadge, ConfirmDialog } from '@/components/ui';
import DataTable from '@/components/data-table/DataTable';
import { useServerList } from '@/hooks/useServerList';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { useRememberedFilters } from '@/lib/use-remembered-filters';
import { formatBDT, formatDate } from '@/lib/format';

interface ProjectRow {
    id: string;
    code: string;
    name: string;
    status: string;
    priority: string;
    visibility?: string;
    start_date?: string | null;
    target_end_date?: string | null;
    budget_amount?: string | null;
    customer?: { id: string; name: string } | null;
    projectType?: { id: string; name: string } | null;
    manager?: { id: string; name?: string | null; email: string } | null;
    _count?: { tasks: number };
}

const STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
    DRAFT: 'neutral',
    ACTIVE: 'info',
    ON_HOLD: 'warning',
    COMPLETED: 'success',
    CANCELLED: 'danger',
};

export default function ProjectsPage() {
    const { t } = useI18n();
    const m = t.projects;

    /**
     * Remembered for the tab, so opening a project and coming back returns to
     * the slice it was opened from rather than to the whole workspace.
     */
    const [filters, setFilter, filtersReady] = useRememberedFilters('projects', {
        search: '',
        status: '',
        typeId: '',
        visibility: '',
    });
    const { search, status, typeId, visibility } = filters;

    const [types, setTypes] = useState<{ id: string; name: string }[]>([]);
    const [debouncedSearch, setDebouncedSearch] = useState('');
    // A search restored from the last visit is not typing: it is already the
    // term to query, so it applies with the first request rather than 300ms
    // later, which would fetch the unsearched list first and flash it.
    const [typing, setTyping] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<ProjectRow | null>(null);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        if (!typing) {
            setDebouncedSearch(search.trim());
            return;
        }
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search, typing]);

    const effectiveSearch = typing ? debouncedSearch : search.trim();

    useEffect(() => {
        api.getProjectTypes()
            .then((list: unknown) => setTypes(Array.isArray(list) ? list : []))
            .catch(() => setTypes([]));
    }, []);

    const { items, loading, serverPagination, reload } = useServerList<ProjectRow>({
        tableId: 'projects',
        // Nothing is fetched until the remembered filters are in, so a return
        // visit does not request the whole list and then replace it.
        enabled: filtersReady,
        initialSort: { id: 'created_at', desc: true },
        deps: [effectiveSearch, status, typeId, visibility],
        fetch: (params) =>
            api.getProjects({
                ...params,
                search: effectiveSearch || undefined,
                status: status || undefined,
                projectTypeId: typeId || undefined,
                visibility: visibility || undefined,
            }),
    });

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        setDeleting(true);
        try {
            await api.deleteProject(pendingDelete.id);
            toast.success(m.deleted);
            setPendingDelete(null);
            // Re-query rather than splicing the row out locally: the row's
            // absence changes the server's total and page count too.
            await reload();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.deleteFailed);
        } finally {
            setDeleting(false);
        }
    };

    const columns = useMemo(
        () => [
            {
                id: 'code',
                header: m.fields.code,
                accessorKey: 'code',
                cell: ({ row }: { row: { original: ProjectRow } }) => (
                    <Link
                        href={routes.projects.detail(row.original.id)}
                        className="font-medium text-blue-600 hover:underline"
                    >
                        {row.original.code}
                    </Link>
                ),
            },
            {
                id: 'name',
                header: m.fields.name,
                accessorKey: 'name',
                cell: ({ row }: { row: { original: ProjectRow } }) => (
                    <span className="inline-flex items-center gap-1.5">
                        {row.original.name}
                        {row.original.visibility === 'PRIVATE' && (
                            <Lock
                                className="h-3.5 w-3.5 shrink-0 text-gray-400"
                                aria-label={m.visibility.PRIVATE}
                            />
                        )}
                    </span>
                ),
            },
            {
                id: 'customer',
                header: m.fields.customer,
                hideOnMobile: true,
                cell: ({ row }: { row: { original: ProjectRow } }) =>
                    row.original.customer?.name ?? '—',
            },
            {
                id: 'type',
                header: m.fields.type,
                hideOnMobile: true,
                cell: ({ row }: { row: { original: ProjectRow } }) =>
                    row.original.projectType?.name ?? '—',
            },
            {
                id: 'status',
                header: m.fields.status,
                accessorKey: 'status',
                cell: ({ row }: { row: { original: ProjectRow } }) => (
                    <StatusBadge tone={STATUS_TONE[row.original.status] ?? 'neutral'}>
                        {m.status[row.original.status as keyof typeof m.status] ?? row.original.status}
                    </StatusBadge>
                ),
            },
            {
                id: 'tasks',
                header: m.fields.tasks,
                hideOnMobile: true,
                cell: ({ row }: { row: { original: ProjectRow } }) => row.original._count?.tasks ?? 0,
            },
            {
                id: 'target_end_date',
                header: m.fields.targetEndDate,
                accessorKey: 'target_end_date',
                hideOnMobile: true,
                cell: ({ row }: { row: { original: ProjectRow } }) =>
                    formatDate(row.original.target_end_date),
            },
            {
                id: 'budget',
                header: m.fields.budget,
                hideOnMobile: true,
                cell: ({ row }: { row: { original: ProjectRow } }) =>
                    row.original.budget_amount ? formatBDT(Number(row.original.budget_amount)) : '—',
            },
            {
                id: 'actions',
                header: m.fields.actions,
                cell: ({ row }: { row: { original: ProjectRow } }) => (
                    <div className="flex items-center justify-end gap-1">
                        <Link
                            href={routes.projects.edit(row.original.id)}
                            className="rounded-lg p-1.5 text-blue-600 transition-colors hover:bg-blue-50"
                            title={m.editProject}
                        >
                            <Pencil className="h-4 w-4" />
                        </Link>
                        <button
                            type="button"
                            onClick={() => setPendingDelete(row.original)}
                            className="rounded-lg p-1.5 text-red-600 transition-colors hover:bg-red-50"
                            title={m.deleteProject}
                        >
                            <Trash2 className="h-4 w-4" />
                        </button>
                    </div>
                ),
            },
        ],
        [m],
    );

    return (
        <PageShell>
            <PageHeader
                title={m.title}
                subtitle={m.subtitle}
                actions={
                    <Link href={routes.projects.new}>
                        <Button className="min-h-touch">
                            <Plus className="h-4 w-4" />
                            {m.newProject}
                        </Button>
                    </Link>
                }
            />

            <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <Input
                    value={search}
                    onChange={(e) => {
                        setTyping(true);
                        setFilter('search', e.target.value);
                    }}
                    placeholder={m.searchPlaceholder}
                    className="md:max-w-xs"
                />
                <Select value={status} onChange={(e) => setFilter('status', e.target.value)} className="md:w-44">
                    <option value="">{m.fields.status}</option>
                    {Object.entries(m.status).map(([key, label]) => (
                        <option key={key} value={key}>
                            {label}
                        </option>
                    ))}
                </Select>
                <Select value={typeId} onChange={(e) => setFilter('typeId', e.target.value)} className="md:w-44">
                    <option value="">{m.fields.type}</option>
                    {types.map((type) => (
                        <option key={type.id} value={type.id}>
                            {type.name}
                        </option>
                    ))}
                </Select>
                <Select
                    value={visibility}
                    onChange={(e) => setFilter('visibility', e.target.value)}
                    className="md:w-40"
                >
                    <option value="">{m.fields.visibility}</option>
                    {Object.entries(m.visibility).map(([key, label]) => (
                        <option key={key} value={key}>
                            {label}
                        </option>
                    ))}
                </Select>
            </div>

            <DataTable
                title={m.title}
                tableId="projects"
                columns={columns as never}
                data={items}
                isLoading={loading || !filtersReady}
                serverPagination={serverPagination}
                emptyMessage={
                    effectiveSearch || status || typeId || visibility ? m.emptyFiltered : m.empty
                }
            />

            <ConfirmDialog
                open={pendingDelete !== null}
                title={m.deleteProject}
                // Says what survives: this is a soft delete, so the tasks and the
                // hours already logged against them stay in the database.
                prompt={m.deletePrompt.replace(
                    '{name}',
                    pendingDelete ? `${pendingDelete.code} · ${pendingDelete.name}` : '',
                )}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                loading={deleting}
                danger
                onConfirm={confirmDelete}
                onCancel={() => setPendingDelete(null)}
            />
        </PageShell>
    );
}
