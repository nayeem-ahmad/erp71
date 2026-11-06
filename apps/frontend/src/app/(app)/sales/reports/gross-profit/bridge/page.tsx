'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Boxes, Layers, PiggyBank, Tag, TrendingUp, Truck } from 'lucide-react';
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
import { ProfitCell } from '@/components/gross-profit';
import { REPORT_PERIOD_PRESETS, closedRange, defaultReportPeriod, precedingRange } from '../../report-period';

interface Bridge {
    previousGrossProfit: number;
    currentGrossProfit: number;
    totalChange: number;
    volumeEffect: number;
    priceEffect: number;
    costEffect: number;
    mixEffect: number;
}

interface Row extends Bridge {
    productId: string;
    productName: string;
}

type Effect = 'volumeEffect' | 'priceEffect' | 'costEffect' | 'mixEffect';

const EFFECTS: Effect[] = ['volumeEffect', 'priceEffect', 'costEffect', 'mixEffect'];
const FIGURES: (keyof Bridge)[] = ['previousGrossProfit', 'currentGrossProfit', 'totalChange', ...EFFECTS];

const columnHelper = createColumnHelper<Row>();

/** The effect that moved a product's profit the most, either way. */
function mainDriver(row: Bridge): Effect {
    return EFFECTS.reduce((best, effect) => (Math.abs(row[effect]) > Math.abs(row[best]) ? effect : best), EFFECTS[0]);
}

export default function MarginBridgePage() {
    const { t, locale } = useI18n();
    const branch = useBranchScope();
    const gp = t.salesReports.grossProfit;
    const ui = t.salesReports.listUi;
    const [rows, setRows] = useState<Row[]>([]);
    const [bridge, setBridge] = useState<Bridge | null>(null);
    const [period, setPeriod] = useState<CreatedRange>(defaultReportPeriod);
    // Unset, the comparison is the span of the same length just before the
    // period — and follows the period when it moves.
    const [compare, setCompare] = useState<CreatedRange | null>(null);
    const [search, setSearch] = useState('');
    const [drivers, setDrivers] = useState<string[]>([]);
    const [changeFilter, setChangeFilter] = useState<NumberCondition | null>(null);
    const [loading, setLoading] = useState(true);

    const current = useMemo(() => closedRange(period), [period]);
    const previous = useMemo(() => (compare ? closedRange(compare) : precedingRange(period)), [compare, period]);

    useEffect(() => {
        if (!branch.ready) return;
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branch.ready, branch.apiStoreId, current.from, current.to, previous.from, previous.to]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getMarginBridge({
                storeId: branch.apiStoreId,
                from: current.from,
                to: current.to,
                compareFrom: previous.from,
                compareTo: previous.to,
            });
            setBridge(data?.summary?.bridge ?? null);
            setRows(Array.isArray(data?.rows) ? data.rows : []);
        } catch (error) {
            setRows([]);
            setBridge(null);
            if (handleBranchForbidden(error, branch, t.dashboardLayout.branchFilterForbidden)) return;
            toast.error(error instanceof Error ? error.message : t.common.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const narrowed = drivers.length > 0 || changeFilter !== null || search.trim() !== '';

    const visible = useMemo(
        () =>
            rows.filter((row) => {
                if (!matchesAnyOf(drivers, mainDriver(row))) return false;
                if (!matchesNumberCondition(row.totalChange, changeFilter)) return false;
                return matchesSearch(search, row.productName);
            }),
        [rows, drivers, changeFilter, search],
    );

    // Each product's own effects add up to its own change, so the rows a chip
    // leaves add up to theirs. With nothing narrowed the strip reads the
    // overall bridge, whose mix effect is between products as well as within.
    const totals = useMemo<Bridge>(() => {
        const sums = Object.fromEntries(
            FIGURES.map((figure) => [figure, visible.reduce((sum, row) => sum + row[figure], 0)]),
        ) as unknown as Bridge;
        return !narrowed && bridge ? bridge : sums;
    }, [visible, narrowed, bridge]);

    const effectLabel = useMemo<Record<Effect, string>>(
        () => ({
            volumeEffect: gp.volumeEffect,
            priceEffect: gp.priceEffect,
            costEffect: gp.costEffect,
            mixEffect: gp.mixEffect,
        }),
        [gp],
    );

    const columns: ColumnDef<Row, any>[] = useMemo(() => {
        const sum = (figure: keyof Bridge) => visible.reduce((total, row) => total + row[figure], 0);
        const effect = (id: keyof Bridge, header: string, hideOnMobile = false) =>
            columnHelper.accessor((row) => row[id], {
                id,
                header,
                cell: (info) => <ProfitCell value={info.getValue() as number} locale={locale} dash={t.shared.dash} />,
                footer: () => <ProfitCell value={sum(id)} locale={locale} dash={t.shared.dash} />,
                size: 120,
                meta: { align: 'end' as const, ...(hideOnMobile ? { hideOnMobile: true } : {}) },
            });

        return [
            columnHelper.accessor('productName', { header: gp.product, footer: () => t.salesReports.common.total, size: 220 }),
            effect('totalChange', gp.totalChange),
            effect('volumeEffect', gp.volumeEffect, true),
            effect('priceEffect', gp.priceEffect, true),
            effect('costEffect', gp.costEffect, true),
            effect('mixEffect', gp.mixEffect, true),
        ];
    }, [t, locale, gp, visible]);

    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'period',
                type: 'date-range',
                label: gp.currentPeriod,
                value: period,
                onChange: (next) => setPeriod(next && (next.from || next.to) ? next : defaultReportPeriod()),
                presets: REPORT_PERIOD_PRESETS,
            },
            {
                id: 'compare',
                type: 'date-range',
                label: gp.comparedWith,
                value: previous,
                // Cleared, it goes back to following the period.
                onChange: (next) => setCompare(next && (next.from || next.to) ? next : null),
                presets: REPORT_PERIOD_PRESETS,
            },
            {
                id: 'driver',
                type: 'multi-select',
                label: ui.mainDriver,
                value: drivers,
                onChange: setDrivers,
                options: EFFECTS.map((value) => ({ value, label: effectLabel[value] })),
            },
            {
                id: 'change',
                type: 'number',
                label: gp.totalChange,
                value: changeFilter,
                onChange: setChangeFilter,
                money: true,
            },
        ],
        [gp, ui, effectLabel, period, previous, drivers, changeFilter],
    );

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const tone = (value: number): ListStat['tone'] => (value < 0 ? 'danger' : 'default');
        const items: ListStat[] = [
            {
                id: 'current',
                icon: <PiggyBank aria-hidden />,
                label: gp.currentPeriod,
                value: money(totals.currentGrossProfit),
                hint: formatMessage(ui.wasAmount, { amount: money(totals.previousGrossProfit) }),
            },
            {
                id: 'change',
                icon: <TrendingUp aria-hidden />,
                label: gp.totalChange,
                value: money(totals.totalChange),
                tone: tone(totals.totalChange),
            },
            { id: 'volume', icon: <Boxes aria-hidden />, label: gp.volumeEffect, value: money(totals.volumeEffect), tone: tone(totals.volumeEffect) },
            { id: 'price', icon: <Tag aria-hidden />, label: gp.priceEffect, value: money(totals.priceEffect), tone: tone(totals.priceEffect) },
            { id: 'cost', icon: <Truck aria-hidden />, label: gp.costEffect, value: money(totals.costEffect), tone: tone(totals.costEffect) },
            { id: 'mix', icon: <Layers aria-hidden />, label: gp.mixEffect, value: money(totals.mixEffect), tone: tone(totals.mixEffect) },
        ];
        return { items, loading, label: ui.statsLabel };
    }, [totals, loading, locale, gp, ui]);

    return (
        <PageShell>
            <PageHeader
                title={gp.bridgeTitle}
                subtitle={gp.bridgeSubtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    gp.bridgeTitle,
                    'sales',
                )}
                actions={<BranchFilter scope={branch} />}
            />

            <div className="space-y-1 text-xs text-gray-500">
                <p>{gp.bridgeExplainer}</p>
                <dl className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                    {(
                        [
                            [gp.volumeEffect, gp.volumeHelp],
                            [gp.priceEffect, gp.priceHelp],
                            [gp.costEffect, gp.costHelp],
                            [gp.mixEffect, gp.mixHelp],
                        ] as const
                    ).map(([label, help]) => (
                        <div key={label} className="flex gap-1">
                            <dt className="font-medium text-gray-700">{label}:</dt>
                            <dd>{help}</dd>
                        </div>
                    ))}
                </dl>
            </div>

            <DataTable<Row>
                tableId="margin-bridge"
                columns={columns}
                data={visible}
                title={gp.bridgeTitle}
                isLoading={loading}
                emptyMessage={gp.empty}
                emptyIcon={<TrendingUp className="w-16 h-16 text-gray-200" />}
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
