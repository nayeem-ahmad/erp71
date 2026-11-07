'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Calculator, Receipt, ShoppingCart, TrendingUp, Undo2, Wallet } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import GroupByChip from '@/components/hr/GroupByChip';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import type { NumberCondition } from '@/lib/number-condition';
import { toast } from '@/lib/toast';
import type { CreatedRange } from '@/lib/created-range';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import { BranchFilter, PageShell } from '@/components/ui';
import { defaultReportPeriod, reportPeriodFilter, reportPeriodQuery } from '../report-period';

interface SummaryRow {
    date: string;
    orders: number;
    grossPurchases: number;
    returns: number;
    netPurchases: number;
}

type GroupBy = 'day' | 'month';

const columnHelper = createColumnHelper<SummaryRow>();

function byMonth(rows: SummaryRow[]): SummaryRow[] {
    const months = new Map<string, SummaryRow>();
    for (const row of rows) {
        const key = row.date.slice(0, 7);
        const month = months.get(key) ?? { date: key, orders: 0, grossPurchases: 0, returns: 0, netPurchases: 0 };
        month.orders += row.orders;
        month.grossPurchases += row.grossPurchases;
        month.returns += row.returns;
        month.netPurchases += row.netPurchases;
        months.set(key, month);
    }
    return [...months.values()];
}

function monthLabel(key: string, locale: string): string {
    const [year, month] = key.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(locale, {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
    });
}

export default function PurchaseSummaryPage() {
    const { t, locale } = useI18n();
    const copy = t.purchaseReports.summary;
    const cols = copy.columns;
    const ui = t.purchaseReports.listUi;
    const branch = useBranchScope();
    const [rows, setRows] = useState<SummaryRow[]>([]);
    const [period, setPeriod] = useState<CreatedRange>(defaultReportPeriod);
    const [groupBy, setGroupBy] = useState<GroupBy>('day');
    const [search, setSearch] = useState('');
    const [netFilter, setNetFilter] = useState<NumberCondition | null>(null);
    const [ordersFilter, setOrdersFilter] = useState<NumberCondition | null>(null);
    const [withReturns, setWithReturns] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!branch.ready) return;
        void loadReport();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branch.ready, branch.apiStoreId, period]);

    const loadReport = async () => {
        setLoading(true);
        try {
            const data = await api.getPurchaseSummary({ storeId: branch.apiStoreId, ...reportPeriodQuery(period) });
            setRows(Array.isArray(data?.rows) ? data.rows : []);
        } catch (error) {
            setRows([]);
            if (handleBranchForbidden(error, branch, t.dashboardLayout.branchFilterForbidden)) return;
            toast.error(error instanceof Error ? error.message : t.common.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const visible = useMemo(() => {
        const grouped = groupBy === 'month' ? byMonth(rows) : rows;
        return grouped.filter((row) => {
            if (withReturns && row.returns <= 0) return false;
            if (!matchesNumberCondition(row.netPurchases, netFilter)) return false;
            if (!matchesNumberCondition(row.orders, ordersFilter)) return false;
            const label = groupBy === 'month' ? monthLabel(row.date, locale) : row.date;
            return matchesSearch(search, row.date, label);
        });
    }, [rows, groupBy, withReturns, netFilter, ordersFilter, search, locale]);

    const totals = useMemo(() => {
        const sum = (pick: (row: SummaryRow) => number) => visible.reduce((total, row) => total + pick(row), 0);
        const orders = sum((row) => row.orders);
        const grossPurchases = sum((row) => row.grossPurchases);
        return {
            orders,
            grossPurchases,
            returns: sum((row) => row.returns),
            netPurchases: sum((row) => row.netPurchases),
            avgOrderValue: orders > 0 ? grossPurchases / orders : 0,
        };
    }, [visible]);

    const columns: ColumnDef<SummaryRow, any>[] = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale });
        return [
            columnHelper.accessor((row) => (groupBy === 'month' ? monthLabel(row.date, locale) : row.date), {
                id: 'date',
                header: groupBy === 'month' ? ui.groupMonth : cols.date,
                footer: () => ui.total,
                size: 130,
            }),
            columnHelper.accessor('orders', {
                header: cols.orders,
                footer: () => totals.orders.toLocaleString(locale),
                size: 120,
                meta: { align: 'end', hideOnMobile: true },
            }),
            columnHelper.accessor('grossPurchases', {
                header: cols.grossPurchases,
                cell: (info) => money(Number(info.getValue())),
                footer: () => money(totals.grossPurchases),
                size: 140,
                meta: { align: 'end', hideOnMobile: true },
            }),
            columnHelper.accessor('returns', {
                header: cols.returns,
                cell: (info) => money(Number(info.getValue())),
                footer: () => money(totals.returns),
                size: 120,
                meta: { align: 'end', hideOnMobile: true },
            }),
            columnHelper.accessor('netPurchases', {
                header: cols.netPurchases,
                cell: (info) => money(Number(info.getValue())),
                footer: () => money(totals.netPurchases),
                size: 140,
                meta: { align: 'end' },
            }),
        ];
    }, [cols, ui, locale, groupBy, totals]);

    const filters = useMemo<ListFilter[]>(
        () => [
            reportPeriodFilter({ label: ui.period, value: period, onChange: setPeriod }),
            {
                id: 'net',
                type: 'number',
                label: cols.netPurchases,
                value: netFilter,
                onChange: setNetFilter,
                money: true,
            },
            {
                id: 'withReturns',
                type: 'toggle',
                label: ui.withReturns,
                pressed: withReturns,
                onChange: setWithReturns,
                control: 'button',
            },
            {
                id: 'orders',
                type: 'number',
                label: cols.orders,
                value: ordersFilter,
                onChange: setOrdersFilter,
                more: true,
            },
        ],
        [cols, ui, period, netFilter, withReturns, ordersFilter],
    );

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const items: ListStat[] = [
            { id: 'net', icon: <Wallet aria-hidden />, label: copy.netPurchases, value: money(totals.netPurchases) },
            { id: 'gross', icon: <TrendingUp aria-hidden />, label: copy.grossPurchases, value: money(totals.grossPurchases) },
            {
                id: 'returns',
                icon: <Undo2 aria-hidden />,
                label: copy.returns,
                value: money(totals.returns),
                tone: totals.returns > 0 ? 'danger' : 'default',
            },
            {
                id: 'orders',
                icon: <Receipt aria-hidden />,
                label: copy.orders,
                value: totals.orders.toLocaleString(locale),
            },
            { id: 'average', icon: <Calculator aria-hidden />, label: copy.avgOrderValue, value: money(totals.avgOrderValue) },
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

            <DataTable<SummaryRow>
                tableId="purchase-summary"
                columns={columns}
                data={visible}
                title={copy.dailyBreakdown}
                isLoading={loading}
                emptyMessage={copy.emptyMessage}
                emptyIcon={<ShoppingCart className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={copy.searchPlaceholder}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                getRowId={(row) => row.date}
                toolbarActions={(
                    <GroupByChip<GroupBy>
                        label={ui.groupBy}
                        value={groupBy}
                        onChange={setGroupBy}
                        options={[
                            { value: 'day', label: ui.groupDay },
                            { value: 'month', label: ui.groupMonth },
                        ]}
                    />
                )}
            />
        </PageShell>
    );
}
