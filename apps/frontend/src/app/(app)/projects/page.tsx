'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { PageShell, PageHeader, Button, Input, Select, StatusBadge } from '@/components/ui';
import DataTable from '@/components/data-table/DataTable';
import { useServerList } from '@/hooks/useServerList';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { formatBDT } from '@/lib/format';

interface ProjectRow {
    id: string;
    code: string;
    name: string;
    status: string;
    priority: string;
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

    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('');
    const [typeId, setTypeId] = useState('');
    const [types, setTypes] = useState<{ id: string; name: string }[]>([]);
    const [debouncedSearch, setDebouncedSearch] = useState('');

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        api.getProjectTypes()
            .then((list: unknown) => setTypes(Array.isArray(list) ? list : []))
            .catch(() => setTypes([]));
    }, []);

    const { items, loading, serverPagination } = useServerList<ProjectRow>({
        tableId: 'projects',
        initialSort: { id: 'created_at', desc: true },
        deps: [debouncedSearch, status, typeId],
        fetch: (params) =>
            api.getProjects({
                ...params,
                search: debouncedSearch || undefined,
                status: status || undefined,
                projectTypeId: typeId || undefined,
            }),
    });

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
            { id: 'name', header: m.fields.name, accessorKey: 'name' },
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
                    row.original.target_end_date
                        ? new Date(row.original.target_end_date).toLocaleDateString()
                        : '—',
            },
            {
                id: 'budget',
                header: m.fields.budget,
                hideOnMobile: true,
                cell: ({ row }: { row: { original: ProjectRow } }) =>
                    row.original.budget_amount ? formatBDT(Number(row.original.budget_amount)) : '—',
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
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={m.searchPlaceholder}
                    className="md:max-w-xs"
                />
                <Select value={status} onChange={(e) => setStatus(e.target.value)} className="md:w-44">
                    <option value="">{m.fields.status}</option>
                    {Object.entries(m.status).map(([key, label]) => (
                        <option key={key} value={key}>
                            {label}
                        </option>
                    ))}
                </Select>
                <Select value={typeId} onChange={(e) => setTypeId(e.target.value)} className="md:w-44">
                    <option value="">{m.fields.type}</option>
                    {types.map((type) => (
                        <option key={type.id} value={type.id}>
                            {type.name}
                        </option>
                    ))}
                </Select>
            </div>

            <DataTable
                title={m.title}
                tableId="projects"
                columns={columns as never}
                data={items}
                isLoading={loading}
                serverPagination={serverPagination}
                emptyMessage={debouncedSearch || status || typeId ? m.emptyFiltered : m.empty}
            />
        </PageShell>
    );
}
