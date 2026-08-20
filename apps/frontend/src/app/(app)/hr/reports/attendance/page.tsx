'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageShell, PageHeader, Select } from '@/components/ui';
import DataTable from '@/components/data-table/DataTable';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import ReportTile from '@/components/hr/ReportTile';
import MonthRangeFilter, {
    monthRangePreset,
    type MonthRange,
    type MonthRangePreset,
} from '@/components/hr/MonthRangeFilter';

type GroupBy = 'employee' | 'department' | 'designation' | 'month';

interface Row {
    key: string;
    label: string;
    sublabel: string | null;
    employees: number;
    months: number;
    scheduledDays: number;
    presentDays: number;
    absentDays: number;
    leaveDays: number;
    lateDays: number;
    workedHours: number;
    overtimeHours: number;
    attendanceRate: number | null;
}

interface Summary {
    employees: number;
    employeeMonths: number;
    frozenMonths: number;
    presentDays: number;
    absentDays: number;
    leaveDays: number;
    workedHours: number;
    overtimeHours: number;
    attendanceRate: number | null;
}

const GROUPS: GroupBy[] = ['employee', 'department', 'designation', 'month'];

export default function HrAttendanceReportPage() {
    const { t } = useI18n();
    const r = t.hr.reports;
    const c = r.common;

    const [preset, setPreset] = useState<MonthRangePreset>('3');
    const [range, setRange] = useState<MonthRange>(() => monthRangePreset('3'));
    const [groupBy, setGroupBy] = useState<GroupBy>('employee');
    const [departmentId, setDepartmentId] = useState('');
    const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
    const [rows, setRows] = useState<Row[]>([]);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.getDepartments()
            .then((data: unknown) => setDepartments(Array.isArray(data) ? data : []))
            .catch(() => setDepartments([]));
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getHrAttendanceSummary({
                ...range,
                groupBy,
                departmentId: departmentId || undefined,
            });
            setRows((data?.rows ?? []) as Row[]);
            setSummary((data?.summary ?? null) as Summary | null);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : c.loadFailed);
            setRows([]);
            setSummary(null);
        } finally {
            setLoading(false);
        }
    }, [range, groupBy, departmentId, c.loadFailed]);

    useEffect(() => {
        void load();
    }, [load]);

    const columns = useMemo(
        () => [
            {
                id: 'label',
                header: c.group[groupBy],
                accessorKey: 'label',
                cell: ({ row }: { row: { original: Row } }) => (
                    <div className="min-w-0">
                        <span className="font-medium">{row.original.label}</span>
                        {row.original.sublabel ? (
                            <span className="block truncate text-xs text-gray-500">
                                {row.original.sublabel}
                            </span>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'scheduledDays',
                header: r.attendance.columns.scheduled,
                accessorKey: 'scheduledDays',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{row.original.scheduledDays}</span>
                ),
            },
            {
                id: 'presentDays',
                header: r.attendance.columns.present,
                accessorKey: 'presentDays',
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="font-semibold tabular-nums text-blue-600">
                        {row.original.presentDays}
                    </span>
                ),
            },
            {
                id: 'absentDays',
                header: r.attendance.columns.absent,
                accessorKey: 'absentDays',
                cell: ({ row }: { row: { original: Row } }) => (
                    <span
                        className={`tabular-nums ${row.original.absentDays > 0 ? 'text-red-600' : ''}`}
                    >
                        {row.original.absentDays}
                    </span>
                ),
            },
            {
                id: 'leaveDays',
                header: r.attendance.columns.leave,
                accessorKey: 'leaveDays',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{row.original.leaveDays}</span>
                ),
            },
            {
                id: 'lateDays',
                header: r.attendance.columns.late,
                accessorKey: 'lateDays',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span
                        className={`tabular-nums ${row.original.lateDays > 0 ? 'text-amber-600' : ''}`}
                    >
                        {row.original.lateDays}
                    </span>
                ),
            },
            {
                id: 'workedHours',
                header: r.attendance.columns.worked,
                accessorKey: 'workedHours',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{row.original.workedHours.toFixed(1)}</span>
                ),
            },
            {
                id: 'overtimeHours',
                header: r.attendance.columns.overtime,
                accessorKey: 'overtimeHours',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{row.original.overtimeHours.toFixed(1)}</span>
                ),
            },
            {
                id: 'attendanceRate',
                header: r.attendance.columns.rate,
                accessorKey: 'attendanceRate',
                cell: ({ row }: { row: { original: Row } }) => (
                    <div className="flex items-center gap-2">
                        <div className="h-1.5 min-w-[48px] flex-1 rounded-full bg-gray-100">
                            <div
                                className="h-1.5 rounded-full bg-blue-600"
                                style={{ width: `${Math.min(row.original.attendanceRate ?? 0, 100)}%` }}
                            />
                        </div>
                        <span className="w-12 text-right text-xs tabular-nums text-gray-600">
                            {row.original.attendanceRate == null
                                ? '—'
                                : `${row.original.attendanceRate.toFixed(1)}%`}
                        </span>
                    </div>
                ),
            },
        ],
        [c, r, groupBy],
    );

    return (
        <PageShell>
            <PageHeader
                title={r.attendance.title}
                subtitle={r.attendance.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.hr,
                    r.attendance.title,
                    'hr',
                )}
            />

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
                <ReportTile
                    label={r.attendance.kpi.rate}
                    value={summary?.attendanceRate == null ? '—' : `${summary.attendanceRate.toFixed(1)}%`}
                    accent
                />
                <ReportTile label={r.attendance.kpi.present} value={String(summary?.presentDays ?? 0)} />
                <ReportTile label={r.attendance.kpi.absent} value={String(summary?.absentDays ?? 0)} />
                <ReportTile label={r.attendance.kpi.leave} value={String(summary?.leaveDays ?? 0)} />
                <ReportTile
                    label={r.attendance.kpi.overtime}
                    value={(summary?.overtimeHours ?? 0).toFixed(1)}
                />
                <ReportTile
                    label={r.attendance.kpi.frozen}
                    value={`${summary?.frozenMonths ?? 0}/${summary?.employeeMonths ?? 0}`}
                    hint={r.attendance.frozenHint}
                />
            </div>

            <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
                <MonthRangeFilter
                    preset={preset}
                    range={range}
                    onPresetChange={setPreset}
                    onRangeChange={setRange}
                    labels={c}
                />
                <Select
                    value={groupBy}
                    onChange={(event) => setGroupBy(event.target.value as GroupBy)}
                    className="md:w-48"
                    aria-label={c.groupBy}
                >
                    {GROUPS.map((group) => (
                        <option key={group} value={group}>
                            {`${c.groupBy}: ${c.group[group]}`}
                        </option>
                    ))}
                </Select>
                <Select
                    value={departmentId}
                    onChange={(event) => setDepartmentId(event.target.value)}
                    className="md:w-48"
                    aria-label={c.department}
                >
                    <option value="">{c.allDepartments}</option>
                    {departments.map((department) => (
                        <option key={department.id} value={department.id}>
                            {department.name}
                        </option>
                    ))}
                </Select>
            </div>

            <p className="text-xs text-gray-500">{r.attendance.hint}</p>

            <DataTable
                title={r.attendance.title}
                tableId="hr-attendance-summary"
                columns={columns as never}
                data={rows}
                isLoading={loading}
                emptyMessage={c.empty}
            />
        </PageShell>
    );
}
