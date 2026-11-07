'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Percent, PiggyBank, Receipt, Truck, Users, Wallet } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import GroupByChip from '@/components/hr/GroupByChip';
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
import {
    CoverageNotice,
    MARGIN_BANDS,
    MarginCell,
    ProfitCell,
    marginBand,
    sumMarginRows,
    type Coverage,
} from '@/components/gross-profit';
import { defaultReportPeriod, reportPeriodFilter, reportPeriodQuery } from '../../report-period';

interface Row {
    id: string | null;
    name: string;
    orders: number;
    units: number;
    revenue: number;
    cogs: number;
    grossProfit: number | null;
    grossMarginPct: number | null;
    coverage: Coverage;
}

interface Summary {
    coverage: Coverage;
}

type GroupBy = 'salesRep' | 'user' | 'counter';

const GROUPS: GroupBy[] = ['salesRep', 'user', 'counter'];

const columnHelper = createColumnHelper<Row>();

export default function GrossProfitBySalespersonPage() {
    const { t, locale } = useI18n();
    const branch = useBranchScope();
    const gp = t.salesReports.grossProfit;
    const ui = t.salesReports.listUi;
    const [rows, setRows] = useState<Row[]>([]);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [period, setPeriod] = useState<CreatedRange>(defaultReportPeriod);
    // By the employee each sale is credited to, unless asked for who entered it
    // or the till it went through.
    const [groupBy, setGroupBy] = useState<GroupBy>('salesRep');
    const [search, setSearch] = useState('');
    const [bands, setBands] = useState<string[]>([]);
    const [revenueFilter, setRevenueFilter] = useState<NumberCondition | null>(null);
    const [ordersFilter, setOrdersFilter] = useState<NumberCondition | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!branch.ready) return;
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branch.ready, branch.apiStoreId, period, groupBy]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getGrossProfitBySalesperson({
                storeId: branch.apiStoreId,
                ...reportPeriodQuery(period),
                groupBy,
            });
            setSummary(data?.summary ?? null);
            setRows(Array.isArray(data?.rows) ? data.rows : []);
        } catch (error) {
            setRows([]);
            setSummary(null);
            if (handleBranchForbidden(error, branch, t.dashboardLayout.branchFilterForbidden)) return;
            toast.error(error instanceof Error ? error.message : t.common.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const visible = useMemo(
        () =>
            rows.filter((row) => {
                if (!matchesAnyOf(bands, marginBand(row.grossMarginPct))) return false;
                if (!matchesNumberCondition(row.revenue, revenueFilter)) return false;
                if (!matchesNumberCondition(row.orders, ordersFilter)) return false;
                return matchesSearch(search, row.name);
            }),
        [rows, bands, revenueFilter, ordersFilter, search],
    );

    const totals = useMemo(
        () => ({
            ...sumMarginRows(visible),
            orders: visible.reduce((sum, row) => sum + row.orders, 0),
            units: visible.reduce((sum, row) => sum + row.units, 0),
        }),
        [visible],
    );

    // The chip names each grouping as the first column is headed under it.
    const groupLabel = useMemo<Record<GroupBy, string>>(
        () => ({ salesRep: gp.salesperson, user: gp.enteredBy, counter: gp.counter }),
        [gp],
    );

    const columns: ColumnDef<Row, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: groupLabel[groupBy],
                footer: () => t.salesReports.common.total,
                size: 200,
            }),
            columnHelper.accessor('orders', {
                header: gp.orders,
                cell: (info) => Number(info.getValue()).toLocaleString(locale),
                footer: () => totals.orders.toLocaleString(locale),
                size: 90,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('units', {
                header: gp.units,
                cell: (info) => Number(info.getValue()).toLocaleString(locale),
                footer: () => totals.units.toLocaleString(locale),
                size: 90,
                meta: { align: 'end', hideOnMobile: true },
            }),
            columnHelper.accessor('revenue', {
                header: gp.revenue,
                cell: (info) => formatBDT(Number(info.getValue()), { locale }),
                footer: () => formatBDT(totals.revenue, { locale }),
                size: 130,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('cogs', {
                header: gp.cogs,
                cell: (info) => formatBDT(Number(info.getValue()), { locale }),
                footer: () => formatBDT(totals.cogs, { locale }),
                size: 130,
                meta: { align: 'end', hideOnMobile: true },
            }),
            columnHelper.accessor('grossProfit', {
                header: gp.grossProfit,
                cell: (info) => <ProfitCell value={info.getValue()} locale={locale} dash={t.shared.dash} />,
                footer: () => <ProfitCell value={totals.grossProfit} locale={locale} dash={t.shared.dash} />,
                size: 130,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('grossMarginPct', {
                header: gp.margin,
                cell: (info) => <MarginCell value={info.getValue()} dash={t.shared.dash} />,
                footer: () => <MarginCell value={totals.grossMarginPct} dash={t.shared.dash} />,
                size: 100,
                meta: { align: 'end', hideOnMobile: true },
            }),
        ],
        [t, locale, gp, groupBy, groupLabel, totals],
    );

    const filters = useMemo<ListFilter[]>(
        () => [
            reportPeriodFilter({ label: ui.period, value: period, onChange: setPeriod }),
            {
                id: 'margin',
                type: 'multi-select',
                label: gp.margin,
                value: bands,
                onChange: setBands,
                options: MARGIN_BANDS.map((band) => ({ value: band, label: ui.bands[band] })),
            },
            {
                id: 'revenue',
                type: 'number',
                label: gp.revenue,
                value: revenueFilter,
                onChange: setRevenueFilter,
                money: true,
            },
            {
                id: 'orders',
                type: 'number',
                label: gp.orders,
                value: ordersFilter,
                onChange: setOrdersFilter,
                more: true,
            },
        ],
        [gp, ui, period, bands, revenueFilter, ordersFilter],
    );

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const items: ListStat[] = [
            { id: 'revenue', icon: <Wallet aria-hidden />, label: gp.revenue, value: money(totals.revenue) },
            { id: 'cogs', icon: <Truck aria-hidden />, label: gp.cogs, value: money(totals.cogs) },
            {
                id: 'grossProfit',
                icon: <PiggyBank aria-hidden />,
                label: gp.grossProfit,
                value: totals.grossProfit === null ? t.shared.dash : money(totals.grossProfit),
                tone: (totals.grossProfit ?? 0) < 0 ? 'danger' : 'default',
            },
            {
                id: 'margin',
                icon: <Percent aria-hidden />,
                label: gp.margin,
                value: totals.grossMarginPct === null ? t.shared.dash : `${totals.grossMarginPct.toFixed(1)}%`,
                tone: totals.grossMarginPct !== null && totals.grossMarginPct < 0 ? 'danger' : 'default',
            },
            { id: 'orders', icon: <Receipt aria-hidden />, label: gp.orders, value: totals.orders.toLocaleString(locale) },
        ];
        return { items, loading, label: ui.statsLabel };
    }, [totals, loading, locale, gp, ui, t.shared.dash]);

    return (
        <PageShell>
            <PageHeader
                title={gp.bySalespersonTitle}
                subtitle={gp.bySalespersonSubtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    gp.bySalespersonTitle,
                    'sales',
                )}
                actions={<BranchFilter scope={branch} />}
            />

            <CoverageNotice
                coverage={summary?.coverage}
                locale={locale}
                labels={{
                    full: gp.coverageFull,
                    partial: gp.coveragePartial,
                    none: gp.coverageNone,
                    fixLink: gp.coverageFix,
                }}
            />

            <DataTable<Row>
                tableId="gross-profit-by-salesperson"
                columns={columns}
                data={visible}
                title={gp.bySalespersonTitle}
                isLoading={loading}
                emptyMessage={gp.empty}
                emptyIcon={<Users className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={ui.searchPeople}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                getRowId={(row) => row.id ?? 'unattributed'}
                toolbarActions={(
                    <GroupByChip<GroupBy>
                        label={ui.groupBy}
                        value={groupBy}
                        onChange={setGroupBy}
                        options={GROUPS.map((group) => ({ value: group, label: groupLabel[group] }))}
                    />
                )}
            />
        </PageShell>
    );
}
