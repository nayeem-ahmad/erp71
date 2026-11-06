'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, Calculator, MinusCircle, Timer, TrendingUp, Wallet } from 'lucide-react';
import { PageShell, PageHeader } from '@/components/ui';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
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
const defaultPeriod = () => createdRangeFromPreset('last6Months');

export default function HrPayrollCostReportPage() {
    const { t, locale } = useI18n();
    const r = t.hr.reports;
    const c = r.common;
    const pc = r.payrollCost;

    // Cleared, the period goes back to the last six months.
    const [period, setPeriod] = useState<CreatedRange>(defaultPeriod);
    const range = useMemo(() => monthRangeFromDates(period), [period]);
    const [groupBy, setGroupBy] = useState<GroupBy>('department');
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
                id: 'employees',
                header: pc.columns.employees,
                accessorKey: 'employees',
                meta: { hideOnMobile: true, align: 'end' },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{row.original.employees}</span>
                ),
            },
            {
                id: 'grossEarnings',
                header: pc.columns.gross,
                accessorKey: 'grossEarnings',
                meta: { hideOnMobile: true, align: 'end' },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{formatBDT(row.original.grossEarnings, { locale })}</span>
                ),
            },
            {
                id: 'overtimeAmount',
                header: pc.columns.overtime,
                accessorKey: 'overtimeAmount',
                meta: { hideOnMobile: true, align: 'end' },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{formatBDT(row.original.overtimeAmount, { locale })}</span>
                ),
            },
            {
                id: 'totalDeductions',
                header: pc.columns.deductions,
                accessorKey: 'totalDeductions',
                meta: { hideOnMobile: true, align: 'end' },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{formatBDT(row.original.totalDeductions, { locale })}</span>
                ),
            },
            {
                id: 'netPay',
                header: pc.columns.net,
                accessorKey: 'netPay',
                meta: { align: 'end' },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{formatBDT(row.original.netPay, { locale })}</span>
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
                        <span className="w-12 text-end tabular-nums text-gray-600">
                            {row.original.share.toFixed(1)}%
                        </span>
                    </div>
                ),
            },
        ],
        [c, pc, groupBy, locale],
    );

    const movement = summary?.monthOverMonth ?? null;

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'period',
            type: 'date-range',
            label: t.hr.listUi.period,
            value: period,
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
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const items: ListStat[] = [
            { id: 'net', icon: <Wallet aria-hidden />, label: pc.kpi.net, value: money(summary?.netPay ?? 0) },
            { id: 'gross', icon: <Banknote aria-hidden />, label: pc.kpi.gross, value: money(summary?.grossEarnings ?? 0) },
            { id: 'deductions', icon: <MinusCircle aria-hidden />, label: pc.kpi.deductions, value: money(summary?.totalDeductions ?? 0) },
            { id: 'overtime', icon: <Timer aria-hidden />, label: pc.kpi.overtime, value: money(summary?.overtimeAmount ?? 0) },
            {
                id: 'average',
                icon: <Calculator aria-hidden />,
                label: pc.kpi.average,
                value: summary?.averagePerEmployee == null ? '—' : money(summary.averagePerEmployee),
            },
            {
                id: 'movement',
                icon: <TrendingUp aria-hidden />,
                label: pc.kpi.movement,
                value: movement == null ? '—' : `${movement > 0 ? '+' : ''}${movement.toFixed(1)}%`,
                hint: summary?.latestMonth && summary.previousMonthNet != null
                    ? pc.movementHint.replace('{month}', summary.latestMonth)
                    : undefined,
            },
        ];
        return { items, loading: loading && !summary, label: t.hr.listUi.reportStats };
    }, [summary, movement, loading, locale, pc, t]);

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

            <p className="text-xs text-gray-500">{pc.hint}</p>

            <DataTable
                title={pc.title}
                tableId="hr-payroll-cost"
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
