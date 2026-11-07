'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Calculator, Receipt, Truck, Users, Wallet } from 'lucide-react';
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
import { NO_SUPPLIER } from '../../components/supplier-list-filter';
import { defaultReportPeriod, reportPeriodFilter, reportPeriodQuery } from '../report-period';

interface SupplierRow {
    supplier: {
        id: string | null;
        name: string;
        phone: string | null;
    };
    orderCount: number;
    spend: number;
    avgOrderValue: number;
    spendShare: number;
}

const columnHelper = createColumnHelper<SupplierRow>();

export default function PurchasesBySupplierPage() {
    const { t, locale } = useI18n();
    const copy = t.purchaseReports.bySupplier;
    const cols = copy.columns;
    const ui = t.purchaseReports.listUi;
    const lineCopy = t.purchaseReports.lineItems;
    const branch = useBranchScope();
    const [rows, setRows] = useState<SupplierRow[]>([]);
    const [period, setPeriod] = useState<CreatedRange>(defaultReportPeriod);
    const [search, setSearch] = useState('');
    const [supplierIds, setSupplierIds] = useState<string[]>([]);
    const [supplierExclude, setSupplierExclude] = useState(false);
    const [spendFilter, setSpendFilter] = useState<NumberCondition | null>(null);
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
            const data = await api.getPurchasesBySupplier({ storeId: branch.apiStoreId, ...reportPeriodQuery(period) });
            setRows(Array.isArray(data?.rows) ? data.rows : []);
        } catch (err) {
            setRows([]);
            if (handleBranchForbidden(err, branch, t.dashboardLayout.branchFilterForbidden)) return;
            toast.error(err instanceof Error ? err.message : t.common.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const nameOf = useCallback(
        (row: SupplierRow) => (row.supplier.id ? row.supplier.name : lineCopy.noSupplier),
        [lineCopy.noSupplier],
    );

    const visible = useMemo(
        () =>
            rows.filter((row) => {
                if (!matchesAnyOf(supplierIds, row.supplier.id ?? NO_SUPPLIER, supplierExclude)) return false;
                if (!matchesNumberCondition(row.spend, spendFilter)) return false;
                if (!matchesNumberCondition(row.orderCount, ordersFilter)) return false;
                if (!matchesNumberCondition(row.avgOrderValue, averageFilter)) return false;
                return matchesSearch(search, nameOf(row), row.supplier.phone);
            }),
        [rows, supplierIds, supplierExclude, spendFilter, ordersFilter, averageFilter, search, nameOf],
    );

    const totals = useMemo(() => {
        const spend = visible.reduce((sum, row) => sum + row.spend, 0);
        const orders = visible.reduce((sum, row) => sum + row.orderCount, 0);
        const named = visible.filter((row) => row.supplier.id);
        return {
            spend,
            orders,
            average: orders > 0 ? spend / orders : 0,
            suppliers: named.length,
            share: visible.reduce((sum, row) => sum + row.spendShare, 0),
        };
    }, [visible]);

    const columns: ColumnDef<SupplierRow, any>[] = useMemo(
        () => [
            columnHelper.accessor((row) => nameOf(row), {
                id: 'supplier',
                header: cols.supplier,
                footer: () => ui.total,
                size: 220,
            }),
            columnHelper.accessor((row) => row.supplier.phone ?? t.shared.dash, {
                id: 'phone',
                header: cols.phone,
                size: 140,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('orderCount', {
                header: cols.orders,
                cell: (info) => Number(info.getValue()).toLocaleString(locale),
                footer: () => totals.orders.toLocaleString(locale),
                size: 90,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('spend', {
                header: cols.spend,
                cell: (info) => formatBDT(Number(info.getValue()), { locale }),
                footer: () => formatBDT(totals.spend, { locale }),
                size: 140,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('avgOrderValue', {
                header: cols.avgOrder,
                cell: (info) => formatBDT(Number(info.getValue()), { locale }),
                footer: () => formatBDT(totals.average, { locale }),
                size: 130,
                meta: { align: 'end', hideOnMobile: true },
            }),
            columnHelper.accessor('spendShare', {
                header: cols.share,
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
        [cols, ui.total, t.shared.dash, nameOf, locale, totals],
    );

    const filters = useMemo<ListFilter[]>(
        () => [
            reportPeriodFilter({ label: ui.period, value: period, onChange: setPeriod }),
            {
                id: 'supplier',
                type: 'multi-select',
                label: cols.supplier,
                value: supplierIds,
                onChange: setSupplierIds,
                exclude: { value: supplierExclude, onChange: setSupplierExclude },
                options: [
                    { value: NO_SUPPLIER, label: lineCopy.noSupplier },
                    ...rows
                        .filter((row) => row.supplier.id)
                        .map((row) => ({ value: row.supplier.id as string, label: row.supplier.name }))
                        .sort((a, b) => a.label.localeCompare(b.label)),
                ],
            },
            {
                id: 'spend',
                type: 'number',
                label: cols.spend,
                value: spendFilter,
                onChange: setSpendFilter,
                money: true,
            },
            {
                id: 'orders',
                type: 'number',
                label: cols.orders,
                value: ordersFilter,
                onChange: setOrdersFilter,
            },
            {
                id: 'average',
                type: 'number',
                label: cols.avgOrder,
                value: averageFilter,
                onChange: setAverageFilter,
                money: true,
                more: true,
            },
        ],
        [cols, ui, lineCopy.noSupplier, period, rows, supplierIds, supplierExclude, spendFilter, ordersFilter, averageFilter],
    );

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const items: ListStat[] = [
            { id: 'spend', icon: <Wallet aria-hidden />, label: copy.totalSpend, value: money(totals.spend) },
            { id: 'orders', icon: <Receipt aria-hidden />, label: copy.totalOrders, value: totals.orders.toLocaleString(locale) },
            { id: 'suppliers', icon: <Users aria-hidden />, label: copy.suppliers, value: totals.suppliers.toLocaleString(locale) },
            { id: 'average', icon: <Calculator aria-hidden />, label: copy.avgOrder, value: money(totals.average) },
        ];
        return { items, loading, label: ui.statsLabel };
    }, [totals, loading, locale, copy, ui]);

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.purchase,
                    copy.title,
                    'purchases',
                )}
                actions={<BranchFilter scope={branch} />}
            />

            <DataTable<SupplierRow>
                tableId="purchases-by-supplier"
                columns={columns}
                data={visible}
                title={copy.tableTitle}
                isLoading={loading}
                emptyMessage={copy.emptyMessage}
                emptyIcon={<Truck className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={copy.searchPlaceholder}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                getRowId={(row) => row.supplier.id ?? NO_SUPPLIER}
            />
        </PageShell>
    );
}
