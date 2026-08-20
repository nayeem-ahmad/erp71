'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageShell, PageHeader, Select, Alert } from '@/components/ui';
import DataTable from '@/components/data-table/DataTable';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import ReportTile from '@/components/hr/ReportTile';

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
    const { t } = useI18n();
    const r = t.hr.reports;
    const c = r.common;
    const lb = r.leaveBalance;

    const [year, setYear] = useState(() => new Date().getFullYear());
    const [departmentId, setDepartmentId] = useState('');
    const [leaveTypeId, setLeaveTypeId] = useState('');
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
                        <span className="font-medium">{row.original.employeeName}</span>
                        <span className="block truncate text-xs text-gray-500">
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
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{row.original.entitledDays}</span>
                ),
            },
            {
                id: 'usedDays',
                header: lb.columns.used,
                accessorKey: 'usedDays',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{row.original.usedDays}</span>
                ),
            },
            {
                id: 'remainingDays',
                header: lb.columns.remaining,
                accessorKey: 'remainingDays',
                cell: ({ row }: { row: { original: Row } }) => (
                    <span
                        className={`font-semibold tabular-nums ${
                            row.original.remainingDays < 0 ? 'text-red-600' : 'text-blue-600'
                        }`}
                    >
                        {row.original.remainingDays}
                    </span>
                ),
            },
            {
                id: 'carryForward',
                header: lb.columns.carryForward,
                accessorKey: 'carryForwardMaxDays',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums text-gray-600">
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
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <div className="min-w-0">
                        <span className="tabular-nums">
                            {row.original.dailyRate == null ? '—' : formatBDT(row.original.dailyRate)}
                        </span>
                        {row.original.dailyRateSource ? (
                            <span className="block truncate text-xs text-gray-400">
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
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="font-semibold tabular-nums">
                        {row.original.liability == null ? '—' : formatBDT(row.original.liability)}
                    </span>
                ),
            },
        ];
    }, [lb, canViewPayroll]);

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

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <ReportTile label={lb.kpi.employees} value={String(summary?.employees ?? 0)} />
                <ReportTile label={lb.kpi.entitled} value={String(summary?.entitledDays ?? 0)} />
                <ReportTile label={lb.kpi.used} value={String(summary?.usedDays ?? 0)} />
                <ReportTile label={lb.kpi.remaining} value={String(summary?.remainingDays ?? 0)} />
                <ReportTile label={lb.kpi.encashable} value={String(summary?.encashableDays ?? 0)} />
                {canViewPayroll ? (
                    <ReportTile
                        label={lb.kpi.liability}
                        value={formatBDT(summary?.liability ?? 0)}
                        accent
                    />
                ) : null}
            </div>

            <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
                <Select
                    value={year}
                    onChange={(event) => setYear(Number(event.target.value))}
                    className="md:w-32"
                    aria-label={c.year}
                >
                    {yearOptions().map((option) => (
                        <option key={option} value={option}>{option}</option>
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
                        <option key={department.id} value={department.id}>{department.name}</option>
                    ))}
                </Select>
                <Select
                    value={leaveTypeId}
                    onChange={(event) => setLeaveTypeId(event.target.value)}
                    className="md:w-48"
                    aria-label={c.leaveType}
                >
                    <option value="">{c.allLeaveTypes}</option>
                    {leaveTypes.map((leaveType) => (
                        <option key={leaveType.id} value={leaveType.id}>{leaveType.name}</option>
                    ))}
                </Select>
            </div>

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
            />
        </PageShell>
    );
}
