'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Calculator, Receipt, Repeat, Users, Wallet } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import type { NumberCondition } from '@/lib/number-condition';
import { toast } from '@/lib/toast';
import type { CreatedRange } from '@/lib/created-range';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import { BranchFilter, PageShell } from '@/components/ui';
import { NO_CUSTOMER } from '../../components/customer-list-filter';
import { defaultReportPeriod, reportPeriodFilter, reportPeriodQuery } from '../report-period';

interface CustomerRow {
    customer: {
        id: string | null;
        name: string;
        phone: string | null;
        customer_code: string | null;
    };
    orderCount: number;
    revenue: number;
    avgOrderValue: number;
}

const columnHelper = createColumnHelper<CustomerRow>();

export default function SalesByCustomerPage() {
    const { t, locale } = useI18n();
    const c = t.salesReports.common;
    const ui = t.salesReports.listUi;
    const branch = useBranchScope();
    const [rows, setRows] = useState<CustomerRow[]>([]);
    const [period, setPeriod] = useState<CreatedRange>(defaultReportPeriod);
    const [search, setSearch] = useState('');
    const [customerIds, setCustomerIds] = useState<string[]>([]);
    const [customerExclude, setCustomerExclude] = useState(false);
    const [revenueFilter, setRevenueFilter] = useState<NumberCondition | null>(null);
    const [ordersFilter, setOrdersFilter] = useState<NumberCondition | null>(null);
    const [averageFilter, setAverageFilter] = useState<NumberCondition | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!branch.ready) return;
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branch.ready, branch.apiStoreId, period]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getSalesByCustomer({ storeId: branch.apiStoreId, ...reportPeriodQuery(period) });
            setRows(Array.isArray(data?.rows) ? data.rows : []);
        } catch (err) {
            setRows([]);
            if (handleBranchForbidden(err, branch, t.dashboardLayout.branchFilterForbidden)) return;
            toast.error(err instanceof Error ? err.message : t.common.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    // Walk-in sales come back as one row with no customer id.
    const walkIn = t.shared.walkIn;
    const nameOf = useCallback((row: CustomerRow) => (row.customer.id ? row.customer.name : walkIn), [walkIn]);

    // Every customer who bought in the period is in hand, so the chips other
    // than the period narrow the rows here and the strip adds up the rest.
    const visible = useMemo(
        () =>
            rows.filter((row) => {
                if (!matchesAnyOf(customerIds, row.customer.id ?? NO_CUSTOMER, customerExclude)) return false;
                if (!matchesNumberCondition(row.revenue, revenueFilter)) return false;
                if (!matchesNumberCondition(row.orderCount, ordersFilter)) return false;
                if (!matchesNumberCondition(row.avgOrderValue, averageFilter)) return false;
                return matchesSearch(search, nameOf(row), row.customer.phone, row.customer.customer_code);
            }),
        [rows, customerIds, customerExclude, revenueFilter, ordersFilter, averageFilter, search, nameOf],
    );

    const totals = useMemo(() => {
        const revenue = visible.reduce((sum, row) => sum + row.revenue, 0);
        const orders = visible.reduce((sum, row) => sum + row.orderCount, 0);
        const named = visible.filter((row) => row.customer.id);
        return {
            revenue,
            orders,
            average: orders > 0 ? revenue / orders : 0,
            customers: named.length,
            repeat: named.filter((row) => row.orderCount > 1).length,
        };
    }, [visible]);

    const columns: ColumnDef<CustomerRow, any>[] = useMemo(() => [
        columnHelper.accessor((row) => nameOf(row), {
            id: 'customer',
            header: c.customer,
            footer: () => c.total,
            size: 220,
        }),
        columnHelper.accessor((row) => row.customer.phone ?? t.shared.dash, {
            id: 'phone',
            header: c.phone,
            size: 140,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor((row) => row.customer.customer_code ?? t.shared.dash, {
            id: 'code',
            header: c.code,
            size: 100,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor('orderCount', {
            header: c.orders,
            cell: (info) => Number(info.getValue()).toLocaleString(locale),
            footer: () => totals.orders.toLocaleString(locale),
            size: 90,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('revenue', {
            header: c.revenue,
            cell: (info) => formatBDT(Number(info.getValue()), { locale }),
            footer: () => formatBDT(totals.revenue, { locale }),
            size: 140,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('avgOrderValue', {
            header: c.avgOrder,
            cell: (info) => formatBDT(Number(info.getValue()), { locale }),
            footer: () => formatBDT(totals.average, { locale }),
            size: 130,
            meta: { align: 'end', hideOnMobile: true },
        }),
    ], [c, t.shared.dash, nameOf, locale, totals]);

    const filters = useMemo<ListFilter[]>(() => [
        reportPeriodFilter({ label: ui.period, value: period, onChange: setPeriod }),
        {
            id: 'customer',
            type: 'multi-select',
            label: c.customer,
            value: customerIds,
            onChange: setCustomerIds,
            exclude: { value: customerExclude, onChange: setCustomerExclude },
            // Walk-in first, then the period's customers A–Z.
            options: [
                { value: NO_CUSTOMER, label: walkIn },
                ...rows
                    .filter((row) => row.customer.id)
                    .map((row) => ({ value: row.customer.id as string, label: row.customer.name }))
                    .sort((a, b) => a.label.localeCompare(b.label)),
            ],
        },
        {
            id: 'revenue',
            type: 'number',
            label: c.revenue,
            value: revenueFilter,
            onChange: setRevenueFilter,
            money: true,
        },
        {
            id: 'orders',
            type: 'number',
            label: c.orders,
            value: ordersFilter,
            onChange: setOrdersFilter,
        },
        {
            id: 'average',
            type: 'number',
            label: c.avgOrder,
            value: averageFilter,
            onChange: setAverageFilter,
            money: true,
            more: true,
        },
    ], [c, ui, walkIn, period, rows, customerIds, customerExclude, revenueFilter, ordersFilter, averageFilter]);

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const items: ListStat[] = [
            { id: 'revenue', icon: <Wallet aria-hidden />, label: c.totalRevenue, value: money(totals.revenue) },
            { id: 'orders', icon: <Receipt aria-hidden />, label: c.totalOrders, value: totals.orders.toLocaleString(locale) },
            { id: 'customers', icon: <Users aria-hidden />, label: c.customers, value: totals.customers.toLocaleString(locale) },
            {
                id: 'repeat',
                icon: <Repeat aria-hidden />,
                label: ui.repeatCustomers,
                value: totals.repeat.toLocaleString(locale),
                hint: totals.customers > 0
                    ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(totals.repeat / totals.customers)
                    : undefined,
            },
            { id: 'average', icon: <Calculator aria-hidden />, label: c.avgOrderValue, value: money(totals.average) },
        ];
        return { items, loading, label: ui.statsLabel };
    }, [totals, loading, locale, c, ui]);

    return (
        <PageShell>
            <PageHeader
                title={t.salesReports.customers.title}
                subtitle={t.salesReports.customers.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    t.salesReports.customers.title,
                    'sales',
                )}
                actions={<BranchFilter scope={branch} />}
            />

            <DataTable<CustomerRow>
                tableId="sales-by-customer"
                columns={columns}
                data={visible}
                title={t.salesReports.customers.customerPerformance}
                isLoading={loading}
                emptyMessage={c.noSalesInPeriod}
                emptyIcon={<Users className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={t.salesReports.customers.searchPlaceholder}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                getRowId={(row) => row.customer.id ?? NO_CUSTOMER}
            />
        </PageShell>
    );
}
