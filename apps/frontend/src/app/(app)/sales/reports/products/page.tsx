'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Award, Boxes, Package, Wallet } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import type { NumberCondition } from '@/lib/number-condition';
import { toast } from '@/lib/toast';
import type { CreatedRange } from '@/lib/created-range';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import { BranchFilter, PageShell } from '@/components/ui';
import { defaultReportPeriod, reportPeriodFilter, reportPeriodQuery } from '../report-period';

interface ProductRow {
    product: {
        id: string;
        name: string;
        sku?: string | null;
        group?: { name: string } | null;
        subgroup?: { name: string } | null;
    };
    unitsSold: number;
    revenue: number;
    revenueShare: number;
}

/** The group and subgroup chips' value for a product filed under neither. */
const NONE = '__none__';

const columnHelper = createColumnHelper<ProductRow>();

/** The distinct names a column holds, A–Z, as chip options. */
function nameOptions(values: Array<string | null | undefined>) {
    return [...new Set(values.filter((value): value is string => Boolean(value)))]
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value }));
}

export default function SalesByProductPage() {
    const { t, locale } = useI18n();
    const c = t.salesReports.common;
    const ui = t.salesReports.listUi;
    const branch = useBranchScope();
    const [rows, setRows] = useState<ProductRow[]>([]);
    const [period, setPeriod] = useState<CreatedRange>(defaultReportPeriod);
    const [search, setSearch] = useState('');
    const [groups, setGroups] = useState<string[]>([]);
    const [subgroups, setSubgroups] = useState<string[]>([]);
    const [revenueFilter, setRevenueFilter] = useState<NumberCondition | null>(null);
    const [unitsFilter, setUnitsFilter] = useState<NumberCondition | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!branch.ready) return;
        void loadReport();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branch.ready, branch.apiStoreId, period]);

    const loadReport = async () => {
        setLoading(true);
        try {
            const data = await api.getSalesByProduct({ storeId: branch.apiStoreId, ...reportPeriodQuery(period) });
            setRows(Array.isArray(data?.rows) ? data.rows : []);
        } catch (error) {
            setRows([]);
            if (handleBranchForbidden(error, branch, t.dashboardLayout.branchFilterForbidden)) return;
            toast.error(error instanceof Error ? error.message : t.common.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    // The period's products are all in hand, so the group, subgroup and
    // figure chips narrow them here and the strip adds up what is left.
    // A row's share stays its share of the whole period's revenue.
    const visible = useMemo(
        () =>
            rows.filter((row) => {
                if (!matchesAnyOf(groups, row.product.group?.name ?? NONE)) return false;
                if (!matchesAnyOf(subgroups, row.product.subgroup?.name ?? NONE)) return false;
                if (!matchesNumberCondition(row.revenue, revenueFilter)) return false;
                if (!matchesNumberCondition(row.unitsSold, unitsFilter)) return false;
                return matchesSearch(search, row.product.name, row.product.sku, row.product.group?.name, row.product.subgroup?.name);
            }),
        [rows, groups, subgroups, revenueFilter, unitsFilter, search],
    );

    const totals = useMemo(
        () => ({
            revenue: visible.reduce((sum, row) => sum + row.revenue, 0),
            units: visible.reduce((sum, row) => sum + row.unitsSold, 0),
            share: visible.reduce((sum, row) => sum + row.revenueShare, 0),
        }),
        [visible],
    );

    const columns: ColumnDef<ProductRow, any>[] = useMemo(
        () => [
            columnHelper.accessor((row) => row.product.name, {
                id: 'product',
                header: c.product,
                footer: () => c.total,
                size: 240,
            }),
            columnHelper.accessor((row) => row.product.sku ?? t.shared.dash, {
                id: 'sku',
                header: c.sku,
                size: 120,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => row.product.group?.name ?? c.uncategorized, {
                id: 'group',
                header: c.group,
                size: 160,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('unitsSold', {
                header: c.unitsSoldCol,
                cell: (info) => Number(info.getValue()).toLocaleString(locale),
                footer: () => totals.units.toLocaleString(locale),
                size: 110,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('revenue', {
                header: c.revenue,
                cell: (info) => formatBDT(Number(info.getValue()), { locale }),
                footer: () => formatBDT(totals.revenue, { locale }),
                size: 130,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('revenueShare', {
                header: c.percentOfTotal,
                cell: (info) => (
                    <div className="flex items-center gap-2">
                        <div className="h-1.5 min-w-[48px] flex-1 rounded-full bg-gray-100">
                            <div
                                className="h-1.5 rounded-full bg-blue-600"
                                style={{ width: `${Math.min(Number(info.getValue()), 100)}%` }}
                            />
                        </div>
                        <span className="w-12 text-end tabular-nums text-gray-600">
                            {Number(info.getValue()).toFixed(1)}%
                        </span>
                    </div>
                ),
                footer: () => `${totals.share.toFixed(1)}%`,
                size: 180,
                meta: { hideOnMobile: true },
            }),
        ],
        [c, t.shared.dash, locale, totals],
    );

    const filters = useMemo<ListFilter[]>(
        () => [
            reportPeriodFilter({ label: ui.period, value: period, onChange: setPeriod }),
            {
                id: 'group',
                type: 'multi-select',
                label: c.group,
                value: groups,
                onChange: setGroups,
                options: [
                    { value: NONE, label: c.uncategorized },
                    ...nameOptions(rows.map((row) => row.product.group?.name)),
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
                id: 'subgroup',
                type: 'multi-select',
                label: ui.subgroup,
                value: subgroups,
                onChange: setSubgroups,
                options: [
                    { value: NONE, label: c.uncategorized },
                    ...nameOptions(
                        rows
                            .filter((row) => matchesAnyOf(groups, row.product.group?.name ?? NONE))
                            .map((row) => row.product.subgroup?.name),
                    ),
                ],
                more: true,
            },
            {
                id: 'units',
                type: 'number',
                label: c.unitsSoldCol,
                value: unitsFilter,
                onChange: setUnitsFilter,
                more: true,
            },
        ],
        [c, ui, period, rows, groups, subgroups, revenueFilter, unitsFilter],
    );

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const top = visible.reduce<ProductRow | null>((best, row) => (!best || row.revenue > best.revenue ? row : best), null);
        const items: ListStat[] = [
            { id: 'revenue', icon: <Wallet aria-hidden />, label: c.totalRevenue, value: money(totals.revenue) },
            { id: 'units', icon: <Boxes aria-hidden />, label: c.unitsSold, value: totals.units.toLocaleString(locale) },
            { id: 'products', icon: <Package aria-hidden />, label: c.productsSold, value: visible.length.toLocaleString(locale) },
            {
                id: 'top',
                icon: <Award aria-hidden />,
                label: ui.topSeller,
                value: top ? top.product.name : t.shared.dash,
                hint: top ? formatMessage(ui.shareOfRevenue, { pct: top.revenueShare.toFixed(1) }) : undefined,
            },
        ];
        return { items, loading, label: ui.statsLabel };
    }, [visible, totals, loading, locale, c, ui, t.shared.dash]);

    return (
        <PageShell>
            <PageHeader
                title={t.salesReports.products.title}
                subtitle={t.salesReports.products.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    t.salesReports.products.title,
                    'sales',
                )}
                actions={<BranchFilter scope={branch} />}
            />

            <DataTable<ProductRow>
                tableId="sales-by-product"
                columns={columns}
                data={visible}
                title={t.salesReports.products.productPerformance}
                isLoading={loading}
                emptyMessage={c.noSalesForFilter}
                emptyIcon={<Package className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={t.salesReports.products.searchPlaceholder}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                getRowId={(row) => row.product.id}
            />
        </PageShell>
    );
}
