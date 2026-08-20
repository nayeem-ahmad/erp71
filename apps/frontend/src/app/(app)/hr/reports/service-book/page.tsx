'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { PageShell, PageHeader, Select, CompactSection } from '@/components/ui';
import DataTable from '@/components/data-table/DataTable';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import ReportTile from '@/components/hr/ReportTile';
import ReportNotes from '@/components/hr/ReportNotes';

interface Revision {
    effective_from: string;
    note: string | null;
    line_count: number;
}

interface LeaveTaken {
    leave_type: string | null;
    start_date: string;
    end_date: string;
    days: number;
}

interface ServiceBook {
    employee: {
        id: string;
        employee_code: string;
        name: string;
        phone: string;
        date_of_joining: string | null;
        status: string;
        last_working_day: string | null;
        exit_reason: string | null;
        department?: { name: string } | null;
        designation?: { name: string } | null;
    };
    salary_revisions: Revision[];
    leave_taken: LeaveTaken[];
    total_leave_days: number;
    months_paid: number;
    notes?: string[];
}

interface EmployeeOption {
    id: string;
    name: string;
    employee_code: string;
}

export default function ServiceBookPage() {
    const { t, locale } = useI18n();
    const r = t.hr.reports;
    const c = r.common;
    const sb = r.serviceBook;

    const [employees, setEmployees] = useState<EmployeeOption[]>([]);
    const [employeeId, setEmployeeId] = useState('');
    const [book, setBook] = useState<ServiceBook | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        api.getEmployees()
            .then((data: unknown) => {
                const list = Array.isArray(data)
                    ? (data as EmployeeOption[])
                    : ((data as { items?: EmployeeOption[] })?.items ?? []);
                setEmployees(list);
            })
            .catch(() => setEmployees([]));
    }, []);

    const load = useCallback(async () => {
        if (!employeeId) {
            setBook(null);
            return;
        }
        setLoading(true);
        try {
            const data = await api.getServiceBook(employeeId);
            setBook((data ?? null) as ServiceBook | null);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : c.loadFailed);
            setBook(null);
        } finally {
            setLoading(false);
        }
    }, [employeeId, c.loadFailed]);

    useEffect(() => {
        void load();
    }, [load]);

    const revisionColumns = useMemo(
        () => [
            {
                id: 'effective_from',
                header: sb.fields.effectiveFrom,
                accessorKey: 'effective_from',
                cell: ({ row }: { row: { original: Revision } }) => (
                    <span className="tabular-nums">
                        {formatDate(row.original.effective_from, locale)}
                    </span>
                ),
            },
            {
                id: 'line_count',
                header: sb.fields.lines,
                accessorKey: 'line_count',
                cell: ({ row }: { row: { original: Revision } }) => (
                    <span className="tabular-nums">{row.original.line_count}</span>
                ),
            },
            {
                id: 'note',
                header: sb.fields.note,
                accessorKey: 'note',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Revision } }) => (
                    <span className="text-gray-600">{row.original.note ?? '—'}</span>
                ),
            },
        ],
        [sb, locale],
    );

    const leaveColumns = useMemo(
        () => [
            {
                id: 'leave_type',
                header: sb.fields.leaveType,
                accessorKey: 'leave_type',
                cell: ({ row }: { row: { original: LeaveTaken } }) => (
                    <span className="font-medium">{row.original.leave_type ?? '—'}</span>
                ),
            },
            {
                id: 'start_date',
                header: sb.fields.start,
                accessorKey: 'start_date',
                cell: ({ row }: { row: { original: LeaveTaken } }) => (
                    <span className="tabular-nums">{formatDate(row.original.start_date, locale)}</span>
                ),
            },
            {
                id: 'end_date',
                header: sb.fields.end,
                accessorKey: 'end_date',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: LeaveTaken } }) => (
                    <span className="tabular-nums">{formatDate(row.original.end_date, locale)}</span>
                ),
            },
            {
                id: 'days',
                header: sb.fields.days,
                accessorKey: 'days',
                cell: ({ row }: { row: { original: LeaveTaken } }) => (
                    <span className="font-semibold tabular-nums text-blue-600">
                        {row.original.days}
                    </span>
                ),
            },
        ],
        [sb, locale],
    );

    const employee = book?.employee;

    return (
        <PageShell>
            <PageHeader
                title={sb.title}
                subtitle={sb.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.hr,
                    sb.title,
                    'hr',
                )}
            />

            <Select
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value)}
                className="md:w-72"
                aria-label={c.employee}
            >
                <option value="">{sb.pickEmployee}</option>
                {employees.map((option) => (
                    <option key={option.id} value={option.id}>
                        {option.employee_code} · {option.name}
                    </option>
                ))}
            </Select>

            {!employeeId ? (
                <p className="text-sm text-gray-500">{sb.pickEmployee}</p>
            ) : loading ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                </div>
            ) : !book || !employee ? (
                <p className="text-sm text-gray-500">{sb.notFound}</p>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                        <ReportTile label={sb.kpi.totalLeave} value={String(book.total_leave_days)} />
                        <ReportTile label={sb.kpi.monthsPaid} value={String(book.months_paid)} />
                        <ReportTile
                            label={sb.kpi.revisions}
                            value={String(book.salary_revisions.length)}
                        />
                    </div>

                    <CompactSection title={sb.profile}>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
                            <Detail label={sb.fields.code} value={employee.employee_code} />
                            <Detail label={sb.fields.phone} value={employee.phone} />
                            <Detail
                                label={sb.fields.designation}
                                value={employee.designation?.name ?? c.unassigned}
                            />
                            <Detail
                                label={sb.fields.department}
                                value={employee.department?.name ?? c.unassigned}
                            />
                            <Detail
                                label={sb.fields.joined}
                                value={formatDate(employee.date_of_joining, locale)}
                            />
                            <Detail label={sb.fields.status} value={employee.status} />
                            <Detail
                                label={sb.fields.lastDay}
                                value={
                                    employee.last_working_day
                                        ? formatDate(employee.last_working_day, locale)
                                        : '—'
                                }
                            />
                            <Detail label={sb.fields.exitReason} value={employee.exit_reason ?? '—'} />
                        </dl>
                    </CompactSection>

                    <DataTable
                        title={sb.salaryRevisions}
                        tableId="hr-service-book-revisions"
                        columns={revisionColumns as never}
                        data={book.salary_revisions}
                        emptyMessage={sb.noRevisions}
                    />

                    <DataTable
                        title={sb.leaveTaken}
                        tableId="hr-service-book-leave"
                        columns={leaveColumns as never}
                        data={book.leave_taken}
                        emptyMessage={sb.noLeave}
                    />

                    <ReportNotes notes={book.notes} />
                </>
            )}
        </PageShell>
    );
}

function Detail({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0">
            <dt className="text-xs text-gray-500">{label}</dt>
            <dd className="truncate font-medium text-gray-900">{value}</dd>
        </div>
    );
}
