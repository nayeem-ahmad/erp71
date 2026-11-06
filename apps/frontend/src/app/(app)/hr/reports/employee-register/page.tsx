'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, LogOut, UserCheck, Users } from 'lucide-react';
import { PageShell, PageHeader, StatusBadge, statusToneFor } from '@/components/ui';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import type { CreatedRange } from '@/lib/created-range';
import { inDateRange, matchesAnyOf, matchesSearch } from '@/lib/list-filter';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import ReportNotes from '@/components/hr/ReportNotes';

interface Row {
    employee_code: string;
    name: string;
    phone: string;
    designation: string | null;
    department: string | null;
    date_of_joining: string | null;
    status: string;
    last_working_day: string | null;
    exit_reason: string | null;
}

const STATUSES = ['ACTIVE', 'PROBATION', 'INACTIVE', 'RESIGNED', 'TERMINATED', 'CONTRACT_ENDED'] as const;
/** Still on staff; anyone else on the register has left or been switched off. */
const ON_STAFF = new Set(['ACTIVE', 'PROBATION']);
/** The department chip's value for an employee without one. */
const NONE = '__none__';

export default function EmployeeRegisterPage() {
    const { t, locale } = useI18n();
    const r = t.hr.reports;
    const c = r.common;
    const er = r.employeeRegister;

    const [rows, setRows] = useState<Row[]>([]);
    const [notes, setNotes] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statuses, setStatuses] = useState<string[]>([]);
    const [statusExclude, setStatusExclude] = useState(false);
    const [departments, setDepartments] = useState<string[]>([]);
    const [joinedRange, setJoinedRange] = useState<CreatedRange | null>(null);
    const [leftRange, setLeftRange] = useState<CreatedRange | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getEmployeeRegister();
            setRows((data?.rows ?? []) as Row[]);
            setNotes((data?.notes ?? []) as string[]);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : c.loadFailed);
            setRows([]);
            setNotes([]);
        } finally {
            setLoading(false);
        }
    }, [c.loadFailed]);

    useEffect(() => {
        void load();
    }, [load]);

    const statusLabel = useCallback(
        (status: string) => (t.employees.statuses as Record<string, string>)[status] ?? status,
        [t],
    );

    const columns = useMemo(
        () => [
            {
                id: 'name',
                header: er.columns.name,
                accessorKey: 'name',
                cell: ({ row }: { row: { original: Row } }) => (
                    <div className="min-w-0">
                        <span>{row.original.name}</span>
                        <span className="block truncate text-gray-500">
                            {row.original.employee_code}
                            {row.original.designation ? ` · ${row.original.designation}` : ''}
                        </span>
                    </div>
                ),
            },
            {
                id: 'department',
                header: er.columns.department,
                accessorKey: 'department',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span>{row.original.department ?? c.unassigned}</span>
                ),
            },
            {
                id: 'phone',
                header: er.columns.phone,
                accessorKey: 'phone',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{row.original.phone}</span>
                ),
            },
            {
                id: 'date_of_joining',
                header: er.columns.joined,
                accessorKey: 'date_of_joining',
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">
                        {formatDate(row.original.date_of_joining, locale)}
                    </span>
                ),
            },
            {
                id: 'status',
                header: er.columns.status,
                accessorKey: 'status',
                cell: ({ row }: { row: { original: Row } }) => (
                    <StatusBadge tone={statusToneFor(row.original.status)}>
                        {statusLabel(row.original.status)}
                    </StatusBadge>
                ),
            },
            {
                id: 'last_working_day',
                header: er.columns.lastDay,
                accessorKey: 'last_working_day',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">
                        {row.original.last_working_day
                            ? formatDate(row.original.last_working_day, locale)
                            : '—'}
                    </span>
                ),
            },
            {
                id: 'exit_reason',
                header: er.columns.exitReason,
                accessorKey: 'exit_reason',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span>{row.original.exit_reason ?? '—'}</span>
                ),
            },
        ],
        [er, c.unassigned, locale, statusLabel],
    );

    const filtered = useMemo(
        () => rows.filter((row) => {
            if (!matchesAnyOf(statuses, row.status, statusExclude)) return false;
            if (!matchesAnyOf(departments, row.department ?? NONE)) return false;
            if (!inDateRange(row.date_of_joining, joinedRange)) return false;
            if (!inDateRange(row.last_working_day, leftRange)) return false;
            return matchesSearch(search, row.name, row.employee_code, row.phone, row.designation, row.department, row.exit_reason);
        }),
        [rows, statuses, statusExclude, departments, joinedRange, leftRange, search],
    );

    const departmentOptions = useMemo(
        () => [...new Set(rows.map((row) => row.department).filter((v): v is string => Boolean(v)))]
            .sort((a, b) => a.localeCompare(b))
            .map((value) => ({ value, label: value })),
        [rows],
    );

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'status',
            type: 'multi-select',
            label: er.columns.status,
            value: statuses,
            onChange: setStatuses,
            exclude: { value: statusExclude, onChange: setStatusExclude },
            options: STATUSES.map((value) => ({ value, label: statusLabel(value) })),
        },
        {
            id: 'department',
            type: 'multi-select',
            label: er.columns.department,
            value: departments,
            onChange: setDepartments,
            options: [{ value: NONE, label: c.unassigned }, ...departmentOptions],
        },
        {
            id: 'joined',
            type: 'date-range',
            label: er.columns.joined,
            value: joinedRange,
            onChange: setJoinedRange,
            operators: true,
        },
        {
            id: 'lastDay',
            type: 'date-range',
            label: er.columns.lastDay,
            value: leftRange,
            onChange: setLeftRange,
            operators: true,
            more: true,
        },
    ], [er, c, statuses, statusExclude, statusLabel, departments, departmentOptions, joinedRange, leftRange]);

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const left = filtered.filter((row) => !ON_STAFF.has(row.status)).length;
        const items: ListStat[] = [
            { id: 'total', icon: <Users aria-hidden />, label: er.kpi.total, value: n(filtered.length) },
            { id: 'active', icon: <UserCheck aria-hidden />, label: er.kpi.active, value: n(filtered.filter((row) => row.status === 'ACTIVE').length) },
            {
                id: 'probation',
                icon: <Clock aria-hidden />,
                label: t.hr.listUi.employees.probation,
                value: n(filtered.filter((row) => row.status === 'PROBATION').length),
            },
            { id: 'left', icon: <LogOut aria-hidden />, label: t.hr.listUi.employees.left, value: n(left) },
        ];
        return { items, loading, label: t.hr.listUi.reportStats };
    }, [filtered, loading, locale, er, t]);

    return (
        <PageShell>
            <PageHeader
                title={er.title}
                subtitle={er.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.hr,
                    er.title,
                    'hr',
                )}
            />

            <ReportNotes notes={notes} />

            <DataTable
                title={er.title}
                tableId="hr-employee-register"
                columns={columns as never}
                data={filtered}
                isLoading={loading}
                emptyMessage={c.empty}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
            />
        </PageShell>
    );
}
