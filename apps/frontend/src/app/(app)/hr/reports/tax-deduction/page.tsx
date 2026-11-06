'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, CalendarRange, Landmark, Users } from 'lucide-react';
import { PageShell, PageHeader } from '@/components/ui';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import type { NumberCondition } from '@/lib/number-condition';
import { matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
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
    const { t, locale } = useI18n();
    const r = t.hr.reports;
    const c = r.common;
    const td = r.taxDeduction;

    const [startYear, setStartYear] = useState(currentStartYear);
    const [rows, setRows] = useState<Row[]>([]);
    const [search, setSearch] = useState('');
    const [taxFilter, setTaxFilter] = useState<NumberCondition | null>(null);
    const [notes, setNotes] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getTaxDeductionStatement({ startYear });
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
                header: td.columns.name,
                accessorKey: 'employee',
                cell: ({ row }: { row: { original: Row } }) => (
                    <div className="min-w-0">
                        <span>{row.original.employee?.name}</span>
                        <span className="block truncate text-gray-500">
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
                meta: { hideOnMobile: true, align: 'end' },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{row.original.months}</span>
                ),
            },
            {
                id: 'gross_earnings',
                header: td.columns.gross,
                accessorKey: 'gross_earnings',
                meta: { align: 'end' },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{formatBDT(row.original.gross_earnings, { locale })}</span>
                ),
            },
            {
                id: 'tax_deducted',
                header: td.columns.tax,
                accessorKey: 'tax_deducted',
                meta: { align: 'end' },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{formatBDT(row.original.tax_deducted, { locale })}</span>
                ),
            },
        ],
        [td, locale],
    );

    const filtered = useMemo(
        () => rows.filter((row) => matchesNumberCondition(row.tax_deducted, taxFilter)
            && matchesSearch(search, row.employee?.name, row.employee?.employee_code, row.employee?.designation?.name)),
        [rows, taxFilter, search],
    );

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'incomeYear',
            type: 'select',
            label: td.incomeYear,
            value: String(startYear),
            // A statement is always for some income year: All goes back to the current one.
            onChange: (next) => setStartYear(next ? Number(next) : currentStartYear()),
            options: startYearOptions().map((year) => ({ value: String(year), label: fiscalLabel(year) })),
        },
        {
            id: 'tax',
            type: 'number',
            label: td.columns.tax,
            value: taxFilter,
            onChange: setTaxFilter,
            money: true,
        },
    ], [td, startYear, taxFilter]);

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const items: ListStat[] = [
            { id: 'year', icon: <CalendarRange aria-hidden />, label: td.incomeYear, value: fiscalLabel(startYear) },
            { id: 'employees', icon: <Users aria-hidden />, label: t.hr.listUi.employees.employees, value: filtered.length.toLocaleString(locale) },
            { id: 'gross', icon: <Banknote aria-hidden />, label: td.columns.gross, value: money(filtered.reduce((sum, row) => sum + row.gross_earnings, 0)) },
            { id: 'tax', icon: <Landmark aria-hidden />, label: td.columns.tax, value: money(filtered.reduce((sum, row) => sum + row.tax_deducted, 0)) },
        ];
        return { items, loading, label: t.hr.listUi.reportStats };
    }, [filtered, startYear, loading, locale, td, t]);

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

            <p className="text-xs text-gray-500">{td.incomeYearHint}</p>

            <ReportNotes notes={notes} />

            <DataTable
                title={td.title}
                tableId="hr-tax-deduction"
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
