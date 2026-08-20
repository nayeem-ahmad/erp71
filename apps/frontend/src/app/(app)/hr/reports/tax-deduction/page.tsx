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
    employee: { name: string; employee_code: string; designation?: { name: string } | null };
    gross_earnings: number;
    tax_deducted: number;
    months: number;
}

/**
 * The Bangladeshi income year opens in July, so "2026" means 2026-27. The
 * current one is the July that has already passed — selecting the year by
 * calendar year would put every filing a year out for six months of it.
 */
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

export default function TaxDeductionPage() {
    const { t } = useI18n();
    const r = t.hr.reports;
    const c = r.common;
    const td = r.taxDeduction;

    const [startYear, setStartYear] = useState(currentStartYear);
    const [rows, setRows] = useState<Row[]>([]);
    const [totals, setTotals] = useState<{ gross_earnings: number; tax_deducted: number } | null>(null);
    const [notes, setNotes] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getTaxDeductionStatement({ startYear });
            setRows((data?.rows ?? []) as Row[]);
            setTotals((data?.totals ?? null) as { gross_earnings: number; tax_deducted: number } | null);
            setNotes((data?.notes ?? []) as string[]);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : c.loadFailed);
            setRows([]);
            setTotals(null);
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
                header: td.columns.name,
                accessorKey: 'employee',
                cell: ({ row }: { row: { original: Row } }) => (
                    <div className="min-w-0">
                        <span className="font-medium">{row.original.employee?.name}</span>
                        <span className="block truncate text-xs text-gray-500">
                            {row.original.employee?.employee_code}
                            {row.original.employee?.designation?.name
                                ? ` · ${row.original.employee.designation.name}`
                                : ''}
                        </span>
                    </div>
                ),
            },
            {
                id: 'months',
                header: td.columns.months,
                accessorKey: 'months',
                meta: { hideOnMobile: true },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{row.original.months}</span>
                ),
            },
            {
                id: 'gross_earnings',
                header: td.columns.gross,
                accessorKey: 'gross_earnings',
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{formatBDT(row.original.gross_earnings)}</span>
                ),
            },
            {
                id: 'tax_deducted',
                header: td.columns.tax,
                accessorKey: 'tax_deducted',
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="font-semibold tabular-nums text-blue-600">
                        {formatBDT(row.original.tax_deducted)}
                    </span>
                ),
            },
        ],
        [td],
    );

    return (
        <PageShell>
            <PageHeader
                title={td.title}
                subtitle={td.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.hr,
                    td.title,
                    'hr',
                )}
            />

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <ReportTile label={td.incomeYear} value={fiscalLabel(startYear)} />
                <ReportTile label={td.columns.name} value={String(rows.length)} />
                <ReportTile label={td.columns.gross} value={formatBDT(totals?.gross_earnings ?? 0)} />
                <ReportTile
                    label={td.columns.tax}
                    value={formatBDT(totals?.tax_deducted ?? 0)}
                    accent
                />
            </div>

            <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <Select
                    value={startYear}
                    onChange={(event) => setStartYear(Number(event.target.value))}
                    className="md:w-44"
                    aria-label={td.incomeYear}
                >
                    {startYearOptions().map((year) => (
                        <option key={year} value={year}>{fiscalLabel(year)}</option>
                    ))}
                </Select>
                <span className="text-xs text-gray-500">{td.incomeYearHint}</span>
            </div>

            <ReportNotes notes={notes} />

            <DataTable
                title={td.title}
                tableId="hr-tax-deduction"
                columns={columns as never}
                data={rows}
                isLoading={loading}
                emptyMessage={c.empty}
            />
        </PageShell>
    );
}
