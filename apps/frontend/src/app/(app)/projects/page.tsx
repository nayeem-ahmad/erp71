'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
    CheckCircle2,
    CircleDashed,
    FolderKanban,
    Lock,
    PauseCircle,
    Pencil,
    Plus,
    Trash2,
} from 'lucide-react';
import { PageShell, PageHeader, Button, StatusBadge, ConfirmDialog } from '@/components/ui';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import { useServerList } from '@/hooks/useServerList';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { useRememberedFilters } from '@/lib/use-remembered-filters';
import { formatBDT, formatDate } from '@/lib/format';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

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

const TABLE_ID = 'projects';

export default function ProjectsPage() {
    const { t, locale } = useI18n();
    const m = t.projects;
    const listUi = m.listUi;

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
        tableId: TABLE_ID,
        // Nothing is fetched until the remembered filters are in, so a return
        // visit does not request the whole list and then replace it.
        enabled: filtersReady,
        initialSort: { id: 'created_at', desc: true },
        deps: [effectiveSearch, status, typeId, visibility],
        columnFilters: true,
        fetch: (params) =>
            api.getProjects({
                ...params,
                search: effectiveSearch || undefined,
                status: status || undefined,
                projectTypeId: typeId || undefined,
                visibility: visibility || undefined,
            }),
    });

    const typeSearch = (next: string) => {
        setTyping(true);
        setFilter('search', next);
    };

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

    const listFilters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'status',
                type: 'select',
                label: m.fields.status,
                value: status || null,
                onChange: (next) => setFilter('status', next ?? ''),
                options: Object.entries(m.status).map(([key, label]) => ({ value: key, label })),
            },
            {
                id: 'type',
                type: 'select',
                label: m.fields.type,
                value: typeId || null,
                onChange: (next) => setFilter('typeId', next ?? ''),
                options: types.map((type) => ({ value: type.id, label: type.name })),
            },
            {
                id: 'visibility',
                type: 'select',
                label: m.fields.visibility,
                value: visibility || null,
                onChange: (next) => setFilter('visibility', next ?? ''),
                options: Object.entries(m.visibility).map(([key, label]) => ({ value: key, label })),
            },
        ],
        [m, status, typeId, visibility, types, setFilter],
    );

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const total = serverPagination.total;
        const items_stat: ListStat[] = [
            {
                id: 'count',
                icon: <FolderKanban aria-hidden />,
                label: listUi.stats.projects,
                value: n(total),
            },
            {
                id: 'active',
                icon: <CircleDashed aria-hidden />,
                label: listUi.stats.active,
                value: n(items.filter((row) => row.status === 'ACTIVE').length),
            },
            {
                id: 'onHold',
                icon: <PauseCircle aria-hidden />,
                label: listUi.stats.onHold,
                value: n(items.filter((row) => row.status === 'ON_HOLD').length),
            },
            {
                id: 'completed',
                icon: <CheckCircle2 aria-hidden />,
                label: listUi.stats.completed,
                value: n(items.filter((row) => row.status === 'COMPLETED').length),
            },
        ];
        return { items: items_stat, loading: loading || !filtersReady, label: listUi.statsLabel };
    }, [items, loading, filtersReady, locale, listUi, serverPagination.total]);

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
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: ProjectRow } }) =>
                    row.original.customer?.name ?? '—',
            },
            {
                id: 'type',
                header: m.fields.type,
                meta: { hideOnMobile: true },
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
                meta: { hideOnMobile: true, align: 'end' as const },
                cell: ({ row }: { row: { original: ProjectRow } }) => (
                    <span className="tabular-nums">{row.original._count?.tasks ?? 0}</span>
                ),
            },
            {
                id: 'target_end_date',
                header: m.fields.targetEndDate,
                accessorKey: 'target_end_date',
                enableColumnFilter: false,
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: ProjectRow } }) =>
                    formatDate(row.original.target_end_date),
            },
            {
                id: 'budget',
                header: m.fields.budget,
                meta: { hideOnMobile: true, align: 'end' as const },
                cell: ({ row }: { row: { original: ProjectRow } }) =>
                    row.original.budget_amount ? formatBDT(Number(row.original.budget_amount)) : '—',
            },
            {
                id: 'actions',
                header: m.fields.actions,
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                cell: ({ row }: { row: { original: ProjectRow } }) => (
                    <RowActions>
                        <RowActionButton
                            icon={<Pencil />}
                            label={m.editProject}
                            href={routes.projects.edit(row.original.id)}
                        />
                        <RowActionButton
                            icon={<Trash2 />}
                            label={m.deleteProject}
                            intent="danger"
                            onClick={() => setPendingDelete(row.original)}
                        />
                    </RowActions>
                ),
            },
        ],
        [m],
    );

    const anyFilter = Boolean(effectiveSearch || status || typeId || visibility);

    return (
        <PageShell>
            <PageHeader
                title={m.title}
                subtitle={m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.projects,
                    m.title,
                    'projects',
                )}
                actions={
                    <Link href={routes.projects.new}>
                        <Button className="min-h-touch">
                            <Plus className="h-4 w-4" />
                            {m.newProject}
                        </Button>
                    </Link>
                }
            />

            <DataTable
                title={m.title}
                tableId={TABLE_ID}
                columns={columns as never}
                data={items}
                isLoading={loading || !filtersReady}
                serverPagination={serverPagination}
                emptyMessage={anyFilter ? m.emptyFiltered : m.empty}
                emptyIcon={<FolderKanban className="h-16 w-16 text-gray-200" />}
                searchPlaceholder={m.searchPlaceholder}
                searchValue={search}
                onSearchChange={typeSearch}
                filters={listFilters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
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
