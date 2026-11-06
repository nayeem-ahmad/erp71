'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, ListX, TrendingDown, Wallet } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import type { NumberCondition } from '@/lib/number-condition';
import { toast } from '@/lib/toast';
import type { CreatedRange } from '@/lib/created-range';
import { routes } from '@/lib/routes';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import { BranchFilter, PageShell } from '@/components/ui';
import { MarginCell, ProfitCell } from '@/components/gross-profit';
import { defaultReportPeriod, reportPeriodFilter, reportPeriodQuery } from '../../report-period';

interface Row {
    saleId: string;
    saleDate: string;
    productId: string;
    productName: string;
    quantity: number;
    revenue: number;
    cogs: number;
    grossProfit: number;
    grossMarginPct: number;
    soldBelowCost: boolean;
}

interface UserRow {
    userId: string | null;
    userName: string;
    lines: number;
    marginForgone: number;
}

interface Summary {
    marginFloorPct: number;
    exceptionCount: number;
    belowCostCount: number;
    exceptionRevenue: number;
    marginForgone: number;
    uncostedLines: number;
    truncated: boolean;
}

/** The floors the chip offers. Below zero asks for only the truly bad lines on a thin-margin catalogue. */
const FLOORS = [-20, -10, 0, 5, 10, 15, 20, 25, 30];
const DEFAULT_FLOOR = 0;

const columnHelper = createColumnHelper<Row>();

export default function MarginExceptionsPage() {
    const { t, locale } = useI18n();
    const branch = useBranchScope();
    const gp = t.salesReports.grossProfit;
    const ui = t.salesReports.listUi;
    const [rows, setRows] = useState<Row[]>([]);
    const [byUser, setByUser] = useState<UserRow[]>([]);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [period, setPeriod] = useState<CreatedRange>(defaultReportPeriod);
    const [floor, setFloor] = useState(DEFAULT_FLOOR);
    const [search, setSearch] = useState('');
    const [productIds, setProductIds] = useState<string[]>([]);
    const [belowCostOnly, setBelowCostOnly] = useState(false);
    const [revenueFilter, setRevenueFilter] = useState<NumberCondition | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!branch.ready) return;
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branch.ready, branch.apiStoreId, period, floor]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getMarginExceptions({
                storeId: branch.apiStoreId,
                ...reportPeriodQuery(period),
                marginFloorPct: floor,
            });
            setSummary(data?.summary ?? null);
            setRows(Array.isArray(data?.rows) ? data.rows : []);
            setByUser(Array.isArray(data?.byUser) ? data.byUser : []);
        } catch (error) {
            setRows([]);
            setByUser([]);
            setSummary(null);
            if (handleBranchForbidden(error, branch, t.dashboardLayout.branchFilterForbidden)) return;
            toast.error(error instanceof Error ? error.message : t.common.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const narrowed = productIds.length > 0 || belowCostOnly || revenueFilter !== null || search.trim() !== '';

    const visible = useMemo(
        () =>
            rows.filter((row) => {
                if (!matchesAnyOf(productIds, row.productId)) return false;
                if (belowCostOnly && !row.soldBelowCost) return false;
                if (!matchesNumberCondition(row.revenue, revenueFilter)) return false;
                return matchesSearch(search, row.productName);
            }),
        [rows, productIds, belowCostOnly, revenueFilter, search],
    );

    const totals = useMemo(() => {
        const sum = (pick: (row: Row) => number) => visible.reduce((total, row) => total + pick(row), 0);
        const revenue = sum((row) => row.revenue);
        const grossProfit = sum((row) => row.grossProfit);
        return {
            quantity: sum((row) => row.quantity),
            revenue,
            cogs: sum((row) => row.cogs),
            grossProfit,
            grossMarginPct: revenue > 0 ? (grossProfit / revenue) * 100 : null,
        };
    }, [visible]);

    const columns: ColumnDef<Row, any>[] = useMemo(
        () => [
            columnHelper.accessor('productName', { header: gp.product, footer: () => t.salesReports.common.total, size: 220 }),
            columnHelper.accessor((row) => formatDate(row.saleDate, locale), {
                id: 'saleDate',
                header: gp.date,
                cell: (info) => (
                    <Link href={routes.sales.detail(info.row.original.saleId)} className="text-blue-600 hover:underline">
                        {info.getValue()}
                    </Link>
                ),
                sortingFn: (a, b) => a.original.saleDate.localeCompare(b.original.saleDate),
                size: 110,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('quantity', {
                header: gp.qty,
                cell: (info) => Number(info.getValue()).toLocaleString(locale),
                footer: () => totals.quantity.toLocaleString(locale),
                size: 70,
                meta: { align: 'end', hideOnMobile: true },
            }),
            columnHelper.accessor('revenue', {
                header: gp.revenue,
                cell: (info) => formatBDT(Number(info.getValue()), { locale }),
                footer: () => formatBDT(totals.revenue, { locale }),
                size: 120,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('cogs', {
                header: gp.cogs,
                cell: (info) => formatBDT(Number(info.getValue()), { locale }),
                footer: () => formatBDT(totals.cogs, { locale }),
                size: 120,
                meta: { align: 'end', hideOnMobile: true },
            }),
            columnHelper.accessor('grossProfit', {
                header: gp.grossProfit,
                cell: (info) => <ProfitCell value={info.getValue()} locale={locale} dash={t.shared.dash} />,
                footer: () => <ProfitCell value={totals.grossProfit} locale={locale} dash={t.shared.dash} />,
                size: 120,
                meta: { align: 'end', hideOnMobile: true },
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

    const productOptions = useMemo(
        () =>
            [...new Map(rows.map((row) => [row.productId, row.productName])).entries()]
                .map(([value, label]) => ({ value, label }))
                .sort((a, b) => a.label.localeCompare(b.label)),
        [rows],
    );

    const filters = useMemo<ListFilter[]>(
        () => [
            reportPeriodFilter({ label: ui.period, value: period, onChange: setPeriod }),
            {
                id: 'floor',
                type: 'select',
                label: gp.marginFloor,
                value: String(floor),
                // A floor is always set: cleared, it goes back to selling below cost.
                onChange: (next) => setFloor(next === null ? DEFAULT_FLOOR : Number(next)),
                options: FLOORS.map((pct) => ({ value: String(pct), label: formatMessage(ui.floorBelow, { pct }) })),
            },
            {
                id: 'product',
                type: 'multi-select',
                label: gp.product,
                value: productIds,
                onChange: setProductIds,
                options: productOptions,
            },
            {
                id: 'belowCost',
                type: 'toggle',
                label: gp.belowCostLines,
                pressed: belowCostOnly,
                onChange: setBelowCostOnly,
                control: 'button',
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
        [gp, ui, period, floor, productIds, productOptions, belowCostOnly, revenueFilter],
    );

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        // The server counts every line under the floor, past the worst it sends;
        // once a chip narrows the rows, the strip counts the rows it leaves.
        const figures = !narrowed && summary
            ? {
                  lines: summary.exceptionCount,
                  belowCost: summary.belowCostCount,
                  revenue: summary.exceptionRevenue,
                  forgone: summary.marginForgone,
              }
            : {
                  lines: visible.length,
                  belowCost: visible.filter((row) => row.soldBelowCost).length,
                  revenue: totals.revenue,
                  forgone: visible.reduce((sum, row) => sum + (floor / 100) * row.revenue - row.grossProfit, 0),
              };
        const items: ListStat[] = [
            { id: 'lines', icon: <ListX aria-hidden />, label: gp.exceptionLines, value: figures.lines.toLocaleString(locale) },
            {
                id: 'belowCost',
                icon: <TrendingDown aria-hidden />,
                label: gp.belowCostLines,
                value: figures.belowCost.toLocaleString(locale),
                tone: figures.belowCost > 0 ? 'danger' : 'default',
            },
            { id: 'revenue', icon: <Wallet aria-hidden />, label: gp.affectedRevenue, value: money(figures.revenue) },
            {
                id: 'forgone',
                icon: <AlertTriangle aria-hidden />,
                label: gp.marginForgone,
                value: money(figures.forgone),
                tone: figures.forgone > 0 ? 'danger' : 'default',
            },
        ];
        return { items, loading, label: ui.statsLabel };
    }, [narrowed, summary, visible, totals, floor, loading, locale, gp, ui]);

    return (
        <PageShell>
            <PageHeader
                title={gp.exceptionsTitle}
                subtitle={gp.exceptionsSubtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    gp.exceptionsTitle,
                    'sales',
                )}
                actions={<BranchFilter scope={branch} />}
            />

            {summary && summary.uncostedLines > 0 ? (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{gp.exceptionsUncosted.replace('{lines}', String(summary.uncostedLines))}</span>
                </div>
            ) : null}

            {summary?.truncated ? (
                <p className="text-xs text-gray-500">
                    {gp.exceptionsTruncated
                        .replace('{shown}', String(rows.length))
                        .replace('{total}', String(summary.exceptionCount))}
                </p>
            ) : null}

            {byUser.length > 0 ? (
                <section className="space-y-2 rounded-lg border border-gray-100 bg-white p-3 md:p-4">
                    <h2 className="text-sm font-semibold text-gray-700">{gp.byWhoRangItUp}</h2>
                    <ul className="divide-y divide-gray-100">
                        {byUser.map((user) => (
                            <li
                                key={user.userId ?? 'unattributed'}
                                className="flex items-center justify-between gap-3 py-1.5 text-sm"
                            >
                                <span className="min-w-0 truncate text-gray-700">{user.userName}</span>
                                <span className="shrink-0 text-xs text-gray-500">
                                    {gp.linesCount.replace('{count}', String(user.lines))} ·{' '}
                                    <span className="font-semibold tabular-nums text-red-600">
                                        {formatBDT(user.marginForgone, { locale })}
                                    </span>
                                </span>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}

            <DataTable<Row>
                tableId="margin-exceptions"
                columns={columns}
                data={visible}
                title={gp.exceptionsTitle}
                isLoading={loading}
                emptyMessage={gp.exceptionsEmpty}
                emptyIcon={<AlertTriangle className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={gp.searchProducts}
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
