'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { Package, Percent, PiggyBank, TrendingDown, Truck, Wallet } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import type { NumberCondition } from '@/lib/number-condition';
import { toast } from '@/lib/toast';
import type { CreatedRange } from '@/lib/created-range';
import { routes } from '@/lib/routes';
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
import { defaultReportPeriod, reportPeriodFilter, reportPeriodQuery } from '../report-period';

interface Row {
    productId: string;
    productName: string;
    unitsSold: number;
    revenue: number;
    cogs: number;
    grossProfit: number | null;
    grossMarginPct: number | null;
    coverage: Coverage;
}

interface Summary {
    coverage: Coverage;
}

const columnHelper = createColumnHelper<Row>();

export default function GrossProfitByProductPage() {
    const { t, locale } = useI18n();
    const branch = useBranchScope();
    const gp = t.salesReports.grossProfit;
    const ui = t.salesReports.listUi;
    const [rows, setRows] = useState<Row[]>([]);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [period, setPeriod] = useState<CreatedRange>(defaultReportPeriod);
    const [search, setSearch] = useState('');
    const [bands, setBands] = useState<string[]>([]);
    const [profitFilter, setProfitFilter] = useState<NumberCondition | null>(null);
    const [revenueFilter, setRevenueFilter] = useState<NumberCondition | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!branch.ready) return;
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branch.ready, branch.apiStoreId, period]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getGrossProfitByProduct({ storeId: branch.apiStoreId, ...reportPeriodQuery(period) });
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

    // Every product sold in the period is in hand: the margin and figure chips
    // narrow them here, and the strip and totals add up what is left.
    const visible = useMemo(
        () =>
            rows.filter((row) => {
                if (!matchesAnyOf(bands, marginBand(row.grossMarginPct))) return false;
                if (profitFilter && (row.grossProfit === null || !matchesNumberCondition(row.grossProfit, profitFilter))) return false;
                if (!matchesNumberCondition(row.revenue, revenueFilter)) return false;
                return matchesSearch(search, row.productName);
            }),
        [rows, bands, profitFilter, revenueFilter, search],
    );

    const totals = useMemo(() => ({ ...sumMarginRows(visible), units: visible.reduce((sum, row) => sum + row.unitsSold, 0) }), [visible]);

    const columns: ColumnDef<Row, any>[] = useMemo(
        () => [
            columnHelper.accessor('productName', { header: gp.product, footer: () => t.salesReports.common.total, size: 240 }),
            columnHelper.accessor('unitsSold', {
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
                meta: { align: 'end' },
            }),
        ],
        [t, locale, gp, totals],
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
                id: 'grossProfit',
                type: 'number',
                label: gp.grossProfit,
                value: profitFilter,
                onChange: setProfitFilter,
                money: true,
            },
            {
                id: 'revenue',
                type: 'number',
                label: gp.revenue,
                value: revenueFilter,
                onChange: setRevenueFilter,
                money: true,
                more: true,
            },
        ],
        [gp, ui, period, bands, profitFilter, revenueFilter],
    );

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const atLoss = visible.filter((row) => (row.grossProfit ?? 0) < 0).length;
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
            {
                id: 'atLoss',
                icon: <TrendingDown aria-hidden />,
                label: ui.atLoss,
                value: atLoss.toLocaleString(locale),
                tone: atLoss > 0 ? 'danger' : 'default',
            },
        ];
        return { items, loading, label: ui.statsLabel };
    }, [visible, totals, loading, locale, gp, ui, t.shared.dash]);

    return (
        <PageShell>
            <PageHeader
                title={gp.byProductTitle}
                subtitle={gp.byProductSubtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    gp.byProductTitle,
                    'sales',
                )}
                actions={<BranchFilter scope={branch} />}
            />

            <div className="flex flex-wrap gap-2 text-xs">
                <Link href={routes.sales.reports.grossProfitSalespeople} className="text-blue-600 hover:underline">
                    {gp.bySalespersonTitle}
                </Link>
                <span className="text-gray-300">·</span>
                <Link href={routes.sales.reports.grossProfitExceptions} className="text-blue-600 hover:underline">
                    {gp.exceptionsTitle}
                </Link>
                <span className="text-gray-300">·</span>
                <Link href={routes.sales.reports.grossProfitBridge} className="text-blue-600 hover:underline">
                    {gp.bridgeTitle}
                </Link>
            </div>

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
                tableId="gross-profit-by-product"
                columns={columns}
                data={visible}
                title={gp.byProductTitle}
                isLoading={loading}
                emptyMessage={gp.empty}
                emptyIcon={<Package className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={gp.searchProducts}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                getRowId={(row) => row.productId}
            />
        </PageShell>
    );
}
