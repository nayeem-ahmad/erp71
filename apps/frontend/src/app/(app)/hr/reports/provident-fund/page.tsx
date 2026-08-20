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
import ReportNotes from '@/components/hr/ReportNotes';

interface Row {
    employee: { name: string; employee_code: string; department?: { name: string } | null };
    months: { year: number; month: number; amount: number }[];
    total_employee_contribution: number;
}

/** July opens the Bangladeshi income year — see the tax statement page. */
function currentStartYear(): number {
    const now = new Date();
    return now.getMonth() + 1 >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

function startYearOptions(): number[] {
    const current = currentStartYear();
    return Array.from({ length: 6 }, (_, index) => current - index);
}

function fiscalLabel(startYear: number): string {
    return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export default function ProvidentFundPage() {
    const { t } = useI18n();
    const r = t.hr.reports;
    const c = r.common;
    const pf = r.providentFund;

    const [startYear, setStartYear] = useState(currentStartYear);
    const [rows, setRows] = useState<Row[]>([]);
    const [grandTotal, setGrandTotal] = useState(0);
    const [notes, setNotes] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getProvidentFundRegister({ startYear });
            setRows((data?.rows ?? []) as Row[]);
            setGrandTotal(Number(data?.grand_total ?? 0));
            setNotes((data?.notes ?? []) as string[]);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : c.loadFailed);
            setRows([]);
            setGrandTotal(0);
            setNotes([]);
        } finally {
            setLoading(false);
        }
    }, [startYear, c.loadFailed]);

    useEffect(() => {
        void load();
    }, [load]);

    const columns = useMemo(
        () => [
            {
                id: 'employee',
                header: pf.columns.name,
                accessorKey: 'employee',
                cell: ({ row }: { row: { original: Row } }) => (
                    <div className="min-w-0">
                        <span className="font-medium">{row.original.employee?.name}</span>
                        <span className="block truncate text-xs text-gray-500">
                            {row.original.employee?.employee_code}
                            {row.original.employee?.department?.name
                                ? ` · ${row.original.employee.department.name}`
                                : ''}
                        </span>
                    </div>
                ),
            },
            {
                id: 'months',
                header: pf.columns.months,
                accessorKey: 'months',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{row.original.months?.length ?? 0}</span>
                ),
            },
            {
                id: 'total_employee_contribution',
                header: pf.columns.contribution,
                accessorKey: 'total_employee_contribution',
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="font-semibold tabular-nums text-blue-600">
                        {formatBDT(row.original.total_employee_contribution)}
                    </span>
                ),
            },
        ],
        [pf],
    );

    return (
        <PageShell>
            <PageHeader
                title={pf.title}
                subtitle={pf.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.hr,
                    pf.title,
                    'hr',
                )}
            />

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <ReportTile label={r.taxDeduction.incomeYear} value={fiscalLabel(startYear)} />
                <ReportTile label={pf.columns.name} value={String(rows.length)} />
                <ReportTile label={pf.grandTotal} value={formatBDT(grandTotal)} accent />
            </div>

            <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <Select
                    value={startYear}
                    onChange={(event) => setStartYear(Number(event.target.value))}
                    className="md:w-44"
                    aria-label={r.taxDeduction.incomeYear}
                >
                    {startYearOptions().map((year) => (
                        <option key={year} value={year}>{fiscalLabel(year)}</option>
                    ))}
                </Select>
                <span className="text-xs text-gray-500">{r.taxDeduction.incomeYearHint}</span>
            </div>

            <ReportNotes notes={notes} />

            <DataTable
                title={pf.title}
                tableId="hr-provident-fund"
                columns={columns as never}
                data={rows}
                isLoading={loading}
                emptyMessage={c.empty}
            />
        </PageShell>
    );
}
