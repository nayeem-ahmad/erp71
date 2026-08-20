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
import { currentMonthKey } from '@/components/hr/MonthRangeFilter';

interface Row {
    employee_code: string;
    employee_name: string;
    designation: string | null;
    department: string | null;
    scheduled_days: number;
    present_days: number;
    overtime_minutes: number;
    gross_earnings: number;
    total_deductions: number;
    net_pay: number;
}

interface Totals {
    gross_earnings: number;
    total_deductions: number;
    net_pay: number;
}

function yearOptions(): number[] {
    const thisYear = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, index) => thisYear + 1 - index);
}

export default function WagesRegisterPage() {
    const { t } = useI18n();
    const r = t.hr.reports;
    const c = r.common;
    const wr = r.wagesRegister;

    const [period, setPeriod] = useState(currentMonthKey);
    const [rows, setRows] = useState<Row[]>([]);
    const [totals, setTotals] = useState<Totals | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getWagesRegister({ year: period.year, month: period.month });
            setRows((data?.rows ?? []) as Row[]);
            setTotals((data?.totals ?? null) as Totals | null);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : c.loadFailed);
            setRows([]);
            setTotals(null);
        } finally {
            setLoading(false);
        }
    }, [period, c.loadFailed]);

    useEffect(() => {
        void load();
    }, [load]);

    const columns = useMemo(
        () => [
            {
                id: 'employee',
                header: wr.columns.name,
                accessorKey: 'employee_name',
                cell: ({ row }: { row: { original: Row } }) => (
                    <div className="min-w-0">
                        <span className="font-medium">{row.original.employee_name}</span>
                        <span className="block truncate text-xs text-gray-500">
                            {row.original.employee_code}
                            {row.original.designation ? ` · ${row.original.designation}` : ''}
                        </span>
                    </div>
                ),
            },
            {
                id: 'department',
                header: wr.columns.department,
                accessorKey: 'department',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span>{row.original.department ?? c.unassigned}</span>
                ),
            },
            {
                id: 'present_days',
                header: wr.columns.present,
                accessorKey: 'present_days',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">
                        {row.original.present_days}/{row.original.scheduled_days}
                    </span>
                ),
            },
            {
                id: 'overtime',
                header: wr.columns.overtime,
                accessorKey: 'overtime_minutes',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">
                        {(row.original.overtime_minutes / 60).toFixed(1)}
                    </span>
                ),
            },
            {
                id: 'gross_earnings',
                header: wr.columns.gross,
                accessorKey: 'gross_earnings',
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{formatBDT(row.original.gross_earnings)}</span>
                ),
            },
            {
                id: 'total_deductions',
                header: wr.columns.deductions,
                accessorKey: 'total_deductions',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums text-gray-600">
                        {formatBDT(row.original.total_deductions)}
                    </span>
                ),
            },
            {
                id: 'net_pay',
                header: wr.columns.net,
                accessorKey: 'net_pay',
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="font-semibold tabular-nums text-blue-600">
                        {formatBDT(row.original.net_pay)}
                    </span>
                ),
            },
        ],
        [wr, c.unassigned],
    );

    return (
        <PageShell>
            <PageHeader
                title={wr.title}
                subtitle={wr.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.hr,
                    wr.title,
                    'hr',
                )}
            />

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <ReportTile label={wr.columns.name} value={String(rows.length)} />
                <ReportTile label={wr.columns.gross} value={formatBDT(totals?.gross_earnings ?? 0)} />
                <ReportTile
                    label={wr.columns.deductions}
                    value={formatBDT(totals?.total_deductions ?? 0)}
                />
                <ReportTile label={wr.columns.net} value={formatBDT(totals?.net_pay ?? 0)} accent />
            </div>

            <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
                <Select
                    value={period.month}
                    onChange={(event) =>
                        setPeriod((current) => ({ ...current, month: Number(event.target.value) }))
                    }
                    className="md:w-40"
                    aria-label={wr.month}
                >
                    {c.months.map((month, index) => (
                        <option key={month} value={index + 1}>{month}</option>
                    ))}
                </Select>
                <Select
                    value={period.year}
                    onChange={(event) =>
                        setPeriod((current) => ({ ...current, year: Number(event.target.value) }))
                    }
                    className="md:w-32"
                    aria-label={c.year}
                >
                    {yearOptions().map((year) => (
                        <option key={year} value={year}>{year}</option>
                    ))}
                </Select>
            </div>

            <DataTable
                title={wr.title}
                tableId="hr-wages-register"
                columns={columns as never}
                data={rows}
                isLoading={loading}
                emptyMessage={wr.empty}
            />
        </PageShell>
    );
}
