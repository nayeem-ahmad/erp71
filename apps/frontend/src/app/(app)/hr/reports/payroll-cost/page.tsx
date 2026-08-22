'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageShell, PageHeader, Select } from '@/components/ui';
import DataTable from '@/components/data-table/DataTable';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
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
    grossEarnings: number;
    overtimeAmount: number;
    absenceDeduction: number;
    totalDeductions: number;
    netPay: number;
    share: number;
}

interface Summary {
    employees: number;
    months: number;
    grossEarnings: number;
    overtimeAmount: number;
    totalDeductions: number;
    netPay: number;
    averagePerEmployee: number | null;
    latestMonth: string | null;
    previousMonthNet: number | null;
    monthOverMonth: number | null;
}

const GROUPS: GroupBy[] = ['department', 'designation', 'employee', 'month'];

export default function HrPayrollCostReportPage() {
    const { t } = useI18n();
    const r = t.hr.reports;
    const c = r.common;
    const pc = r.payrollCost;

    const [preset, setPreset] = useState<MonthRangePreset>('6');
    const [range, setRange] = useState<MonthRange>(() => monthRangePreset('6'));
    const [groupBy, setGroupBy] = useState<GroupBy>('department');
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
            const data = await api.getHrPayrollCost({
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
                id: 'employees',
                header: pc.columns.employees,
                accessorKey: 'employees',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{row.original.employees}</span>
                ),
            },
            {
                id: 'grossEarnings',
                header: pc.columns.gross,
                accessorKey: 'grossEarnings',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{formatBDT(row.original.grossEarnings)}</span>
                ),
            },
            {
                id: 'overtimeAmount',
                header: pc.columns.overtime,
                accessorKey: 'overtimeAmount',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{formatBDT(row.original.overtimeAmount)}</span>
                ),
            },
            {
                id: 'totalDeductions',
                header: pc.columns.deductions,
                accessorKey: 'totalDeductions',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums text-gray-600">
                        {formatBDT(row.original.totalDeductions)}
                    </span>
                ),
            },
            {
                id: 'netPay',
                header: pc.columns.net,
                accessorKey: 'netPay',
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="font-semibold tabular-nums text-blue-600">
                        {formatBDT(row.original.netPay)}
                    </span>
                ),
            },
            {
                id: 'share',
                header: pc.columns.share,
                accessorKey: 'share',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <div className="flex items-center gap-2">
                        <div className="h-1.5 min-w-[48px] flex-1 rounded-full bg-gray-100">
                            <div
                                className="h-1.5 rounded-full bg-blue-600"
                                style={{ width: `${Math.min(row.original.share, 100)}%` }}
                            />
                        </div>
                        <span className="w-12 text-end text-xs tabular-nums text-gray-600">
                            {row.original.share.toFixed(1)}%
                        </span>
                    </div>
                ),
            },
        ],
        [c, pc, groupBy],
    );

    const movement = summary?.monthOverMonth ?? null;

    return (
        <PageShell>
            <PageHeader
                title={pc.title}
                subtitle={pc.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.hr,
                    pc.title,
                    'hr',
                )}
            />

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <ReportTile label={pc.kpi.net} value={formatBDT(summary?.netPay ?? 0)} accent />
                <ReportTile label={pc.kpi.gross} value={formatBDT(summary?.grossEarnings ?? 0)} />
                <ReportTile
                    label={pc.kpi.deductions}
                    value={formatBDT(summary?.totalDeductions ?? 0)}
                />
                <ReportTile label={pc.kpi.overtime} value={formatBDT(summary?.overtimeAmount ?? 0)} />
                <ReportTile
                    label={pc.kpi.average}
                    value={
                        summary?.averagePerEmployee == null
                            ? '—'
                            : formatBDT(summary.averagePerEmployee)
                    }
                />
                <ReportTile
                    label={pc.kpi.movement}
                    value={movement == null ? '—' : `${movement > 0 ? '+' : ''}${movement.toFixed(1)}%`}
                    hint={
                        summary?.latestMonth && summary.previousMonthNet != null
                            ? pc.movementHint.replace('{month}', summary.latestMonth)
                            : null
                    }
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
                        <option key={department.id} value={department.id}>{department.name}</option>
                    ))}
                </Select>
            </div>

            <p className="text-xs text-gray-500">{pc.hint}</p>

            <DataTable
                title={pc.title}
                tableId="hr-payroll-cost"
                columns={columns as never}
                data={rows}
                isLoading={loading}
                emptyMessage={c.empty}
            />
        </PageShell>
    );
}
