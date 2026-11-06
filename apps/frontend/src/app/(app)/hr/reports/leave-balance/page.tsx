'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, CalendarCheck, CalendarClock, CalendarMinus, Coins, Users } from 'lucide-react';
import { PageShell, PageHeader, Alert } from '@/components/ui';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

interface Row {
    key: string;
    employeeId: string;
    employeeName: string;
    employeeCode: string;
    departmentName: string | null;
    leaveTypeName: string;
    entitledDays: number;
    usedDays: number;
    remainingDays: number;
    carryForwardMaxDays: number | null;
    allowsEncashment: boolean;
    dailyRate: number | null;
    dailyRateSource: string | null;
    liability: number | null;
}

interface Summary {
    employees: number;
    entitledDays: number;
    usedDays: number;
    remainingDays: number;
    encashableDays: number;
    liability: number | null;
    unpricedRows: number | null;
}

function yearOptions(): number[] {
    const thisYear = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, index) => thisYear + 1 - index);
}

export default function HrLeaveBalanceReportPage() {
    const { t, locale } = useI18n();
    const r = t.hr.reports;
    const c = r.common;
    const lb = r.leaveBalance;

    const [year, setYear] = useState(() => new Date().getFullYear());
    const [departmentId, setDepartmentId] = useState<string | null>(null);
    const [leaveTypeId, setLeaveTypeId] = useState<string | null>(null);
    const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
    const [leaveTypes, setLeaveTypes] = useState<{ id: string; name: string }[]>([]);
    const [rows, setRows] = useState<Row[]>([]);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [canViewPayroll, setCanViewPayroll] = useState(true);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.getDepartments()
            .then((data: unknown) => setDepartments(Array.isArray(data) ? data : []))
            .catch(() => setDepartments([]));
        api.getLeaveTypes()
            .then((data: unknown) => setLeaveTypes(Array.isArray(data) ? data : []))
            .catch(() => setLeaveTypes([]));
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getHrLeaveBalanceReport({
                year,
                departmentId: departmentId || undefined,
                leaveTypeId: leaveTypeId || undefined,
            });
            setRows((data?.rows ?? []) as Row[]);
            setSummary((data?.summary ?? null) as Summary | null);
            setCanViewPayroll(Boolean(data?.can_view_payroll));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : c.loadFailed);
            setRows([]);
            setSummary(null);
        } finally {
            setLoading(false);
        }
    }, [year, departmentId, leaveTypeId, c.loadFailed]);

    useEffect(() => {
        void load();
    }, [load]);

    const columns = useMemo(() => {
        // Inside the memo rather than beside it: it closes over `lb`, and a
        // helper declared outside would be a new function every render, which
        // the exhaustive-deps rule rightly flags.
        const rateSourceLabel = (source: string | null) => {
            if (!source) return null;
            const labels = lb.rateSource as Record<string, string | undefined>;
            return labels[source] ?? source;
        };

        const base = [
            {
                id: 'employee',
                header: lb.columns.employee,
                accessorKey: 'employeeName',
                cell: ({ row }: { row: { original: Row } }) => (
                    <div className="min-w-0">
                        <span>{row.original.employeeName}</span>
                        <span className="block truncate text-gray-500">
                            {row.original.employeeCode}
                            {row.original.departmentName ? ` · ${row.original.departmentName}` : ''}
                        </span>
                    </div>
                ),
            },
            {
                id: 'leaveType',
                header: lb.columns.leaveType,
                accessorKey: 'leaveTypeName',
                cell: ({ row }: { row: { original: Row } }) => (
                    <span>{row.original.leaveTypeName}</span>
                ),
            },
            {
                id: 'entitledDays',
                header: lb.columns.entitled,
                accessorKey: 'entitledDays',
                meta: { hideOnMobile: true, align: 'end' },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{row.original.entitledDays}</span>
                ),
            },
            {
                id: 'usedDays',
                header: lb.columns.used,
                accessorKey: 'usedDays',
                meta: { hideOnMobile: true, align: 'end' },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{row.original.usedDays}</span>
                ),
            },
            {
                id: 'remainingDays',
                header: lb.columns.remaining,
                accessorKey: 'remainingDays',
                meta: { align: 'end' },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className={`tabular-nums ${row.original.remainingDays < 0 ? 'text-red-600' : ''}`}>
                        {row.original.remainingDays}
                    </span>
                ),
            },
            {
                id: 'carryForward',
                header: lb.columns.carryForward,
                accessorKey: 'carryForwardMaxDays',
                meta: { hideOnMobile: true, align: 'end' },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">
                        {row.original.carryForwardMaxDays ?? lb.noCarryForward}
                    </span>
                ),
            },
        ];

        // The money columns are dropped entirely rather than rendered empty:
        // the server sends nulls for a caller without VIEW_PAYROLL, and two
        // blank columns read as missing data instead of withheld data.
        if (!canViewPayroll) return base;

        return [
            ...base,
            {
                id: 'dailyRate',
                header: lb.columns.rate,
                accessorKey: 'dailyRate',
                meta: { hideOnMobile: true, align: 'end' },
                cell: ({ row }: { row: { original: Row } }) => (
                    <div className="min-w-0">
                        <span className="tabular-nums">
                            {row.original.dailyRate == null ? '—' : formatBDT(row.original.dailyRate, { locale })}
                        </span>
                        {row.original.dailyRateSource ? (
                            <span className="block truncate text-gray-500">
                                {rateSourceLabel(row.original.dailyRateSource)}
                            </span>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'liability',
                header: lb.columns.liability,
                accessorKey: 'liability',
                meta: { align: 'end' },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">
                        {row.original.liability == null ? '—' : formatBDT(row.original.liability, { locale })}
                    </span>
                ),
            },
        ];
    }, [lb, canViewPayroll, locale]);

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'year',
            type: 'select',
            label: c.year,
            value: String(year),
            // A balance is always for some year; Clear all goes back to this one.
            required: true,
            defaultValue: String(new Date().getFullYear()),
            onChange: (next) => setYear(next ? Number(next) : new Date().getFullYear()),
            options: yearOptions().map((option) => ({ value: String(option), label: String(option) })),
        },
        {
            id: 'department',
            type: 'select',
            label: c.department,
            value: departmentId,
            onChange: setDepartmentId,
            options: departments.map((department) => ({ value: department.id, label: department.name })),
        },
        {
            id: 'leaveType',
            type: 'select',
            label: c.leaveType,
            value: leaveTypeId,
            onChange: setLeaveTypeId,
            options: leaveTypes.map((leaveType) => ({ value: leaveType.id, label: leaveType.name })),
        },
    ], [c, year, departmentId, departments, leaveTypeId, leaveTypes]);

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const items: ListStat[] = [
            { id: 'employees', icon: <Users aria-hidden />, label: lb.kpi.employees, value: n(summary?.employees ?? 0) },
            { id: 'entitled', icon: <CalendarCheck aria-hidden />, label: lb.kpi.entitled, value: n(summary?.entitledDays ?? 0) },
            { id: 'used', icon: <CalendarMinus aria-hidden />, label: lb.kpi.used, value: n(summary?.usedDays ?? 0) },
            { id: 'remaining', icon: <CalendarClock aria-hidden />, label: lb.kpi.remaining, value: n(summary?.remainingDays ?? 0) },
            { id: 'encashable', icon: <Coins aria-hidden />, label: lb.kpi.encashable, value: n(summary?.encashableDays ?? 0) },
        ];
        if (canViewPayroll) {
            items.push({
                id: 'liability',
                icon: <Banknote aria-hidden />,
                label: lb.kpi.liability,
                value: formatBDT(summary?.liability ?? 0, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 }),
                tone: (summary?.liability ?? 0) > 0 ? 'warning' : 'default',
            });
        }
        return { items, loading: loading && !summary, label: t.hr.listUi.reportStats };
    }, [summary, canViewPayroll, loading, locale, lb, t]);

    return (
        <PageShell>
            <PageHeader
                title={lb.title}
                subtitle={lb.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.hr,
                    lb.title,
                    'hr',
                )}
            />

            {!canViewPayroll ? <Alert tone="info">{lb.noMoney}</Alert> : null}
            {canViewPayroll && (summary?.unpricedRows ?? 0) > 0 ? (
                <Alert tone="warning">
                    {lb.unpriced.replace('{count}', String(summary?.unpricedRows ?? 0))}
                </Alert>
            ) : null}

            <p className="text-xs text-gray-500">{lb.hint}</p>

            <DataTable
                title={lb.title}
                tableId="hr-leave-balance"
                columns={columns as never}
                data={rows}
                isLoading={loading}
                emptyMessage={c.empty}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
            />
        </PageShell>
    );
}
