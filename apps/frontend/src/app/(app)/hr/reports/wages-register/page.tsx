'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, MinusCircle, Timer, Users, Wallet } from 'lucide-react';
import { PageShell, PageHeader } from '@/components/ui';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import type { NumberCondition } from '@/lib/number-condition';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { currentMonthKey } from '@/components/hr/month-range';

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

/** The department chip's value for an employee without one. */
const NONE = '__none__';

/** The months the period chip offers: this one and the 35 before it, newest first. */
function monthOptions(): { year: number; month: number }[] {
    const now = currentMonthKey();
    const ordinal = now.year * 12 + now.month - 1;
    return Array.from({ length: 36 }, (_, index) => {
        const at = ordinal - index;
        return { year: Math.floor(at / 12), month: (at % 12) + 1 };
    });
}

const monthKey = (period: { year: number; month: number }) => `${period.year}-${String(period.month).padStart(2, '0')}`;

export default function WagesRegisterPage() {
    const { t, locale } = useI18n();
    const r = t.hr.reports;
    const c = r.common;
    const wr = r.wagesRegister;

    const [period, setPeriod] = useState(currentMonthKey);
    const [search, setSearch] = useState('');
    const [departments, setDepartments] = useState<string[]>([]);
    const [netFilter, setNetFilter] = useState<NumberCondition | null>(null);
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getWagesRegister({ year: period.year, month: period.month });
            setRows((data?.rows ?? []) as Row[]);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : c.loadFailed);
            setRows([]);
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
                        <span>{row.original.employee_name}</span>
                        <span className="block truncate text-gray-500">
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
                meta: { hideOnMobile: true, align: 'end' },
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
                meta: { hideOnMobile: true, align: 'end' },
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
                meta: { align: 'end' },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{formatBDT(row.original.gross_earnings, { locale })}</span>
                ),
            },
            {
                id: 'total_deductions',
                header: wr.columns.deductions,
                accessorKey: 'total_deductions',
                meta: { hideOnMobile: true, align: 'end' },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{formatBDT(row.original.total_deductions, { locale })}</span>
                ),
            },
            {
                id: 'net_pay',
                header: wr.columns.net,
                accessorKey: 'net_pay',
                meta: { align: 'end' },
                cell: ({ row }: { row: { original: Row } }) => (
                    <span className="tabular-nums">{formatBDT(row.original.net_pay, { locale })}</span>
                ),
            },
        ],
        [wr, c.unassigned, locale],
    );

    // One month's sheet is a short list: the chips other than the month
    // narrow it here, and the strip adds up what is left.
    const filtered = useMemo(
        () => rows.filter((row) => {
            if (!matchesAnyOf(departments, row.department ?? NONE)) return false;
            if (!matchesNumberCondition(row.net_pay, netFilter)) return false;
            return matchesSearch(search, row.employee_name, row.employee_code, row.designation, row.department);
        }),
        [rows, departments, netFilter, search],
    );

    const departmentOptions = useMemo(
        () => [...new Set(rows.map((row) => row.department).filter((v): v is string => Boolean(v)))]
            .sort((a, b) => a.localeCompare(b))
            .map((value) => ({ value, label: value })),
        [rows],
    );

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'month',
            type: 'select',
            label: wr.month,
            value: monthKey(period),
            // A register is always for some month: All goes back to this one.
            onChange: (next) => {
                if (!next) return setPeriod(currentMonthKey());
                const [year, month] = next.split('-').map(Number);
                setPeriod({ year, month });
            },
            options: monthOptions().map((option) => ({
                value: monthKey(option),
                label: `${c.months[option.month - 1]} ${option.year}`,
            })),
        },
        {
            id: 'department',
            type: 'multi-select',
            label: wr.columns.department,
            value: departments,
            onChange: setDepartments,
            options: [{ value: NONE, label: c.unassigned }, ...departmentOptions],
        },
        {
            id: 'net',
            type: 'number',
            label: wr.columns.net,
            value: netFilter,
            onChange: setNetFilter,
            money: true,
        },
    ], [wr, c, period, departments, departmentOptions, netFilter]);

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const sum = (pick: (row: Row) => number) => filtered.reduce((total, row) => total + pick(row), 0);
        const items: ListStat[] = [
            { id: 'employees', icon: <Users aria-hidden />, label: t.hr.listUi.employees.employees, value: filtered.length.toLocaleString(locale) },
            { id: 'gross', icon: <Banknote aria-hidden />, label: wr.columns.gross, value: money(sum((row) => row.gross_earnings)) },
            { id: 'deductions', icon: <MinusCircle aria-hidden />, label: wr.columns.deductions, value: money(sum((row) => row.total_deductions)) },
            { id: 'net', icon: <Wallet aria-hidden />, label: wr.columns.net, value: money(sum((row) => row.net_pay)) },
            {
                id: 'overtime',
                icon: <Timer aria-hidden />,
                label: wr.columns.overtime,
                value: (sum((row) => row.overtime_minutes) / 60).toFixed(1),
            },
        ];
        return { items, loading, label: t.hr.listUi.reportStats };
    }, [filtered, loading, locale, wr, t]);

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

            <DataTable
                title={wr.title}
                tableId="hr-wages-register"
                columns={columns as never}
                data={filtered}
                isLoading={loading}
                emptyMessage={wr.empty}
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
