'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Calculator, Repeat, ShoppingCart, TrendingUp, Users } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT, resolveLocaleForFormatting } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import { Alert, BranchFilter, PageHeader, PageShell } from '@/components/ui';
import { MONTH_RANGE_PRESETS } from '@/components/hr/month-range';
import { createdRangeFromPreset, type CreatedRange } from '@/lib/created-range';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import type { NumberCondition } from '@/lib/number-condition';

interface MonthlyRow {
    customer: { id: string | null; name: string; phone: string | null };
    total: number;
    monthly: Array<{ month: string; revenue: number; orderCount: number }>;
}

interface MonthlyData {
    months: string[];
    rows: MonthlyRow[];
}

/** The Customer chip's value for walk-in sales, which have no customer id. */
const WALK_IN = '__walkin__';

const customerKey = (row: MonthlyRow) => row.customer.id ?? WALK_IN;

function formatMonth(m: string, locale: string) {
    const [year, month] = m.split('-');
    const d = new Date(Number(year), Number(month) - 1, 1);
    const resolved = resolveLocaleForFormatting(locale);
    const config = resolved === 'bn' ? 'bn-BD' : resolved === 'ms' ? 'ms-MY' : 'en-US';
    return d.toLocaleDateString(config, { month: 'short', year: '2-digit' });
}

// Cleared, the period goes back to the last six months.
const defaultPeriod = () => createdRangeFromPreset('last6Months');

/**
 * Sales › Reports › Monthly Sales by Customer: one row per customer, one
 * column per month. The period and branch go to the server; the customer,
 * total and search chips narrow the rows already loaded, and the strip and
 * the total row add up exactly what is left.
 */
export default function MonthlySalesPage() {
    const { t, locale, fmt } = useI18n();
    const copy = t.salesReports.monthly;
    const common = t.salesReports.common;
    const branch = useBranchScope();
    const [data, setData] = useState<MonthlyData | null>(null);
    const [period, setPeriod] = useState<CreatedRange>(defaultPeriod);
    const [customers, setCustomers] = useState<string[]>([]);
    const [customersExclude, setCustomersExclude] = useState(false);
    const [totalFilter, setTotalFilter] = useState<NumberCondition | null>(null);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await api.getMonthlySalesByCustomer({
                storeId: branch.apiStoreId,
                from: period.from || undefined,
                to: period.to || undefined,
            });
            setData(result);
        } catch (err: any) {
            if (handleBranchForbidden(err, branch, t.dashboardLayout.branchFilterForbidden)) return;
            setError(err?.message ?? t.shared.errors.loadReport);
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branch.apiStoreId, period]);

    useEffect(() => {
        if (!branch.ready) return;
        void load();
    }, [branch.ready, load]);

    const nameOf = useCallback(
        (row: MonthlyRow) => (row.customer.id ? row.customer.name : t.shared.walkInCustomer),
        [t],
    );

    const rows = useMemo(
        () => (data?.rows ?? []).filter((row) => {
            if (!matchesAnyOf(customers, customerKey(row), customersExclude)) return false;
            if (!matchesNumberCondition(row.total, totalFilter)) return false;
            return matchesSearch(search, nameOf(row), row.customer.phone);
        }),
        [data, customers, customersExclude, totalFilter, search, nameOf],
    );

    const customerOptions = useMemo(
        () => (data?.rows ?? [])
            .map((row) => ({ value: customerKey(row), label: nameOf(row) }))
            .sort((a, b) => (a.value === WALK_IN ? -1 : b.value === WALK_IN ? 1 : a.label.localeCompare(b.label))),
        [data, nameOf],
    );

    const columns = useMemo(() => {
        const months = data?.months ?? [];
        const money = (value: number) => <span className="tabular-nums">{formatBDT(value, { locale })}</span>;
        const monthTotal = (month: string) => rows.reduce(
            (total, row) => total + (row.monthly.find((entry) => entry.month === month)?.revenue ?? 0),
            0,
        );
        return [
            {
                id: 'customer',
                header: common.customer,
                accessorFn: (row: MonthlyRow) => nameOf(row),
                cell: ({ row }: { row: { original: MonthlyRow } }) => (
                    <div className="min-w-0">
                        <span>{nameOf(row.original)}</span>
                        {row.original.customer.phone ? (
                            <span className="block truncate text-gray-500">{row.original.customer.phone}</span>
                        ) : null}
                    </div>
                ),
                footer: () => common.total,
                size: 200,
            },
            ...months.map((month) => ({
                id: `month-${month}`,
                header: formatMonth(month, locale),
                accessorFn: (row: MonthlyRow) => row.monthly.find((entry) => entry.month === month)?.revenue ?? 0,
                meta: { align: 'end' },
                cell: ({ row }: { row: { original: MonthlyRow } }) => {
                    const entry = row.original.monthly.find((item) => item.month === month);
                    if (!entry || entry.revenue <= 0) return <span className="text-gray-300">{t.shared.dash}</span>;
                    return (
                        <div>
                            {money(entry.revenue)}
                            <span className="block text-gray-500">{fmt(t.shared.orderCount, { count: entry.orderCount })}</span>
                        </div>
                    );
                },
                footer: () => money(monthTotal(month)),
                size: 120,
            })),
            {
                id: 'total',
                header: common.total,
                accessorKey: 'total',
                meta: { align: 'end' },
                cell: ({ row }: { row: { original: MonthlyRow } }) => money(row.original.total),
                footer: () => money(rows.reduce((total, row) => total + row.total, 0)),
                size: 130,
            },
        ];
    }, [data, rows, locale, common, t, fmt, nameOf]);

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'period',
            type: 'date-range',
            label: copy.period,
            value: period,
            onChange: (next) => setPeriod(next ?? defaultPeriod()),
            presets: MONTH_RANGE_PRESETS,
            operators: true,
        },
        {
            id: 'customer',
            type: 'multi-select',
            label: common.customer,
            value: customers,
            onChange: setCustomers,
            exclude: { value: customersExclude, onChange: setCustomersExclude },
            options: customerOptions,
            searchable: true,
        },
        {
            id: 'total',
            type: 'number',
            label: common.total,
            value: totalFilter,
            onChange: setTotalFilter,
            money: true,
        },
    ], [copy, common, period, customers, customersExclude, customerOptions, totalFilter]);

    const stats = useMemo(() => {
        const revenue = rows.reduce((total, row) => total + row.total, 0);
        const orders = rows.reduce(
            (total, row) => total + row.monthly.reduce((count, entry) => count + entry.orderCount, 0),
            0,
        );
        // Named customers who came back in a second month — walk-ins are many
        // people under one name, so they never count.
        const repeat = rows.filter(
            (row) => row.customer.id && row.monthly.filter((entry) => entry.orderCount > 0).length >= 2,
        ).length;
        const money = (value: number) => formatBDT(value, { locale });
        const items: ListStat[] = [
            { id: 'customers', icon: <Users aria-hidden />, label: common.customers, value: rows.length.toLocaleString() },
            { id: 'revenue', icon: <TrendingUp aria-hidden />, label: common.totalRevenue, value: money(revenue) },
            { id: 'orders', icon: <ShoppingCart aria-hidden />, label: common.totalOrders, value: orders.toLocaleString() },
            {
                id: 'average',
                icon: <Calculator aria-hidden />,
                label: common.avgOrderValue,
                value: orders > 0 ? money(revenue / orders) : '—',
            },
            { id: 'repeat', icon: <Repeat aria-hidden />, label: copy.repeatCustomers, value: repeat.toLocaleString() },
        ];
        return { items, loading: loading && !data, label: copy.statsLabel };
    }, [rows, loading, data, locale, common, copy]);

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    copy.title,
                    'sales',
                )}
                actions={<BranchFilter scope={branch} />}
            />

            {error ? <Alert tone="danger">{error}</Alert> : null}

            <DataTable
                title={copy.title}
                tableId="sales-monthly-by-customer"
                columns={columns as never}
                data={rows}
                isLoading={loading}
                emptyMessage={common.noSalesInPeriod}
                emptyIcon={<BarChart3 className="h-16 w-16 text-gray-200" />}
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
