'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarRange, PiggyBank, Users } from 'lucide-react';
import { PageShell, PageHeader } from '@/components/ui';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import type { NumberCondition } from '@/lib/number-condition';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
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

/** The department chip's value for an employee without one. */
const NONE = '__none__';

export default function ProvidentFundPage() {
    const { t, locale } = useI18n();
    const r = t.hr.reports;
    const c = r.common;
    const pf = r.providentFund;

    const [startYear, setStartYear] = useState(currentStartYear);
    const [rows, setRows] = useState<Row[]>([]);
    const [search, setSearch] = useState('');
    const [departments, setDepartments] = useState<string[]>([]);
    const [contributionFilter, setContributionFilter] = useState<NumberCondition | null>(null);
    const [notes, setNotes] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getProvidentFundRegister({ startYear });
            setRows((data?.rows ?? []) as Row[]);
            setNotes((data?.notes ?? []) as string[]);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : c.loadFailed);
            setRows([]);
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
                        <span>{row.original.employee?.name}</span>
                        <span className="block truncate text-gray-500">
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
                meta: { hideOnMobile: true, align: 'end' },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{row.original.months?.length ?? 0}</span>
                ),
            },
            {
                id: 'total_employee_contribution',
                header: pf.columns.contribution,
                accessorKey: 'total_employee_contribution',
                meta: { align: 'end' },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{formatBDT(row.original.total_employee_contribution, { locale })}</span>
                ),
            },
        ],
        [pf, locale],
    );

    const filtered = useMemo(
        () => rows.filter((row) => {
            if (!matchesAnyOf(departments, row.employee?.department?.name ?? NONE)) return false;
            if (!matchesNumberCondition(row.total_employee_contribution, contributionFilter)) return false;
            return matchesSearch(search, row.employee?.name, row.employee?.employee_code, row.employee?.department?.name);
        }),
        [rows, departments, contributionFilter, search],
    );

    const departmentOptions = useMemo(
        () => [...new Set(rows.map((row) => row.employee?.department?.name).filter((v): v is string => Boolean(v)))]
            .sort((a, b) => a.localeCompare(b))
            .map((value) => ({ value, label: value })),
        [rows],
    );

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'incomeYear',
            type: 'select',
            label: r.taxDeduction.incomeYear,
            value: String(startYear),
            // A register is always for some income year: All goes back to the current one.
            onChange: (next) => setStartYear(next ? Number(next) : currentStartYear()),
            options: startYearOptions().map((year) => ({ value: String(year), label: fiscalLabel(year) })),
        },
        {
            id: 'department',
            type: 'multi-select',
            label: c.department,
            value: departments,
            onChange: setDepartments,
            options: [{ value: NONE, label: c.unassigned }, ...departmentOptions],
        },
        {
            id: 'contribution',
            type: 'number',
            label: pf.columns.contribution,
            value: contributionFilter,
            onChange: setContributionFilter,
            money: true,
        },
    ], [r, c, pf, startYear, departments, departmentOptions, contributionFilter]);

    const stats = useMemo(() => {
        const total = filtered.reduce((sum, row) => sum + row.total_employee_contribution, 0);
        const items: ListStat[] = [
            { id: 'year', icon: <CalendarRange aria-hidden />, label: r.taxDeduction.incomeYear, value: fiscalLabel(startYear) },
            { id: 'employees', icon: <Users aria-hidden />, label: t.hr.listUi.employees.employees, value: filtered.length.toLocaleString(locale) },
            {
                id: 'total',
                icon: <PiggyBank aria-hidden />,
                label: pf.grandTotal,
                value: formatBDT(total, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 }),
            },
        ];
        return { items, loading, label: t.hr.listUi.reportStats };
    }, [filtered, startYear, loading, locale, r, pf, t]);

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

            <p className="text-xs text-gray-500">{r.taxDeduction.incomeYearHint}</p>

            <ReportNotes notes={notes} />

            <DataTable
                title={pf.title}
                tableId="hr-provident-fund"
                columns={columns as never}
                data={filtered}
                isLoading={loading}
                emptyMessage={c.empty}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
            />
        </PageShell>
    );
}
