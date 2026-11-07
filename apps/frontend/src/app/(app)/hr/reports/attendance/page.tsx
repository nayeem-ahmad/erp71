'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarX, Lock, Percent, Plane, Timer } from 'lucide-react';
import { PageShell, PageHeader } from '@/components/ui';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import GroupByChip from '@/components/hr/GroupByChip';
import { MONTH_RANGE_PRESETS, monthRangeFromDates } from '@/components/hr/month-range';
import { createdRangeFromPreset, type CreatedRange } from '@/lib/created-range';

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
const defaultPeriod = () => createdRangeFromPreset('last3Months');

export default function HrAttendanceReportPage() {
    const { t, locale } = useI18n();
    const r = t.hr.reports;
    const c = r.common;

    // A month-grained report always covers some months: cleared, the period
    // goes back to the last three.
    const [period, setPeriod] = useState<CreatedRange>(defaultPeriod);
    const range = useMemo(() => monthRangeFromDates(period), [period]);
    const [groupBy, setGroupBy] = useState<GroupBy>('employee');
    const [departmentId, setDepartmentId] = useState<string | null>(null);
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
                        <span>{row.original.label}</span>
                        {row.original.sublabel ? (
                            <span className="block truncate text-gray-500">
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
                meta: { hideOnMobile: true, align: 'end' },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{row.original.scheduledDays}</span>
                ),
            },
            {
                id: 'presentDays',
                header: r.attendance.columns.present,
                accessorKey: 'presentDays',
                meta: { align: 'end' },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{row.original.presentDays}</span>
                ),
            },
            {
                id: 'absentDays',
                header: r.attendance.columns.absent,
                accessorKey: 'absentDays',
                meta: { align: 'end' },
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
                meta: { hideOnMobile: true, align: 'end' },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{row.original.leaveDays}</span>
                ),
            },
            {
                id: 'lateDays',
                header: r.attendance.columns.late,
                accessorKey: 'lateDays',
                meta: { hideOnMobile: true, align: 'end' },
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
                meta: { hideOnMobile: true, align: 'end' },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{row.original.workedHours.toFixed(1)}</span>
                ),
            },
            {
                id: 'overtimeHours',
                header: r.attendance.columns.overtime,
                accessorKey: 'overtimeHours',
                meta: { hideOnMobile: true, align: 'end' },
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
                        <span className="w-12 text-end tabular-nums text-gray-600">
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

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'period',
            type: 'date-range',
            label: t.hr.listUi.period,
            value: period,
            required: true,
            defaultValue: defaultPeriod(),
            onChange: (next) => setPeriod(next ?? defaultPeriod()),
            presets: MONTH_RANGE_PRESETS,
        },
        {
            id: 'department',
            type: 'select',
            label: c.department,
            value: departmentId,
            onChange: setDepartmentId,
            options: departments.map((department) => ({ value: department.id, label: department.name })),
        },
    ], [t, c, period, departmentId, departments]);

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const items: ListStat[] = [
            {
                id: 'rate',
                icon: <Percent aria-hidden />,
                label: r.attendance.kpi.rate,
                value: summary?.attendanceRate == null ? '—' : `${summary.attendanceRate.toFixed(1)}%`,
            },
            { id: 'present', icon: <CalendarCheck aria-hidden />, label: r.attendance.kpi.present, value: n(summary?.presentDays ?? 0) },
            {
                id: 'absent',
                icon: <CalendarX aria-hidden />,
                label: r.attendance.kpi.absent,
                value: n(summary?.absentDays ?? 0),
                tone: (summary?.absentDays ?? 0) > 0 ? 'warning' : 'default',
            },
            { id: 'leave', icon: <Plane aria-hidden />, label: r.attendance.kpi.leave, value: n(summary?.leaveDays ?? 0) },
            { id: 'overtime', icon: <Timer aria-hidden />, label: r.attendance.kpi.overtime, value: (summary?.overtimeHours ?? 0).toFixed(1) },
            {
                id: 'frozen',
                icon: <Lock aria-hidden />,
                label: r.attendance.kpi.frozen,
                value: `${summary?.frozenMonths ?? 0}/${summary?.employeeMonths ?? 0}`,
            },
        ];
        return { items, loading: loading && !summary, label: t.hr.listUi.reportStats };
    }, [summary, loading, locale, r, t]);

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

            <p className="text-xs text-gray-500">{r.attendance.hint} {r.attendance.frozenHint}</p>

            <DataTable
                title={r.attendance.title}
                tableId="hr-attendance-summary"
                columns={columns as never}
                data={rows}
                isLoading={loading}
                emptyMessage={c.empty}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                toolbarActions={(
                    <GroupByChip<GroupBy>
                        label={c.groupBy}
                        value={groupBy}
                        onChange={setGroupBy}
                        options={GROUPS.map((group) => ({ value: group, label: c.group[group] }))}
                    />
                )}
            />
        </PageShell>
    );
}
