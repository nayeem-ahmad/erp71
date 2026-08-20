'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageShell, PageHeader, StatusBadge, statusToneFor } from '@/components/ui';
import DataTable from '@/components/data-table/DataTable';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import ReportTile from '@/components/hr/ReportTile';
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

export default function EmployeeRegisterPage() {
    const { t, locale } = useI18n();
    const r = t.hr.reports;
    const c = r.common;
    const er = r.employeeRegister;

    const [rows, setRows] = useState<Row[]>([]);
    const [notes, setNotes] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

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

    const columns = useMemo(
        () => [
            {
                id: 'name',
                header: er.columns.name,
                accessorKey: 'name',
                cell: ({ row }: { row: { original: Row } }) => (
                    <div className="min-w-0">
                        <span className="font-medium">{row.original.name}</span>
                        <span className="block truncate text-xs text-gray-500">
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
                        {row.original.status}
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
                    <span className="text-gray-600">{row.original.exit_reason ?? '—'}</span>
                ),
            },
        ],
        [er, c.unassigned, locale],
    );

    const active = rows.filter((row) => row.status === 'ACTIVE').length;

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

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <ReportTile label={er.kpi.total} value={String(rows.length)} accent />
                <ReportTile label={er.kpi.active} value={String(active)} />
            </div>

            <ReportNotes notes={notes} />

            <DataTable
                title={er.title}
                tableId="hr-employee-register"
                columns={columns as never}
                data={rows}
                isLoading={loading}
                emptyMessage={c.empty}
            />
        </PageShell>
    );
}
