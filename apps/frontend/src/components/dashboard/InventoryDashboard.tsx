'use client';

import { useMemo } from 'react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { useModuleDashboard } from '@/lib/use-module-dashboard';
import { routes } from '@/lib/routes';
import ModuleDashboard, {
    AttentionSection,
    DashboardSection,
    KpiTileGrid,
    type DashboardMount,
    type KpiTileSpec,
} from '@/components/dashboard/ModuleDashboard';
import { type AttentionItem } from '@/components/dashboard/AttentionStrip';
import { OrdinalBars, type OrdinalBar } from '@/components/dashboard/OrdinalBars';
import { RankedListPanel, type RankedItem } from '@/components/dashboard/RankedListPanel';
import type { DashboardIdentity } from './dashboard-identity';

type AgingBucket = { key: string; units: number; value: number };

type OverviewResponse = {
    filters: { from: string; to: string };
    stock: {
        total_value: number | null;
        total_units: number;
        active_skus: number;
        out_of_stock: number;
        below_reorder: number;
        negative_stock: number;
        unconfigured_policy: number;
    };
    movement: { in_units: number; out_units: number; movements_logged: number; products_touched: number };
    shrinkage: { events: number; units: number; value: number };
    stock_takes: { open: number; posted_in_period: number };
    transfers: { in_transit_units: number };
    aging: AgingBucket[] | null;
    low_stock: Array<{
        id: string;
        name: string;
        sku: string | null;
        on_hand: number;
        reorder_level: number;
        shortfall: number;
    }>;
    top_value: Array<{ id: string; name: string; sku: string | null; units: number; value: number }>;
    categories: Array<{ id: string | null; name: string; units: number; value: number }>;
    can_value: boolean;
};

type TrendPoint = { date: string; units_in: number; units_out: number; movements: number };

/**
 * Inventory > Overview: what is on the shelf, what is about to run out, and what
 * moved this period.
 *
 * Renders for every plan. A tenant without `premiumInventoryReports` gets the
 * counts and the reorder list but no valuation — the server sends nulls rather
 * than refusing, so the shorter dashboard is a real page, not an error.
 */
export default function InventoryDashboard({
    greeting,
    tenantName,
    variant = 'page',
}: Readonly<DashboardIdentity & { variant?: DashboardMount }>) {
    const { t, locale } = useI18n();
    const copy = t.dashboardHome;
    const inv = copy.inventory;

    const {
        range,
        setRange,
        overview,
        previous: prev,
        trends,
        loading,
        error,
        deltaContext,
        compare,
    } = useModuleDashboard<OverviewResponse, TrendPoint>({
        fetchOverview: (window) => api.getInventoryDashboardOverview(window),
        fetchTrends: (window) => api.getInventoryDashboardTrends(window),
        unavailableMessage: inv.overviewUnavailable,
    });

    const money = (value: number) => formatBDT(value, { locale });
    const stock = overview?.stock;
    const movement = overview?.movement;
    const shrinkage = overview?.shrinkage;

    const kpiTiles: KpiTileSpec[] = [
        {
            key: 'stock-value',
            title: inv.kpiStockValue,
            // A balance, not a flow — nothing to compare a closing stock against.
            value: stock?.total_value == null ? '—' : money(stock.total_value),
            delta: { label: '—', positive: true },
            note: stock?.total_value == null && overview
                ? inv.valuationLocked
                : formatMessage(inv.helperUnitsAndSkus, {
                    units: stock?.total_units ?? 0,
                    skus: stock?.active_skus ?? 0,
                }),
        },
        {
            key: 'units-in',
            title: inv.kpiUnitsIn,
            value: String(movement?.in_units ?? 0),
            points: trends.map((point) => point.units_in),
            delta: compare(movement?.in_units, prev?.movement.in_units),
            note: formatMessage(inv.helperMovements, { count: movement?.movements_logged ?? 0 }),
        },
        {
            key: 'units-out',
            title: inv.kpiUnitsOut,
            value: String(movement?.out_units ?? 0),
            points: trends.map((point) => point.units_out),
            delta: compare(movement?.out_units, prev?.movement.out_units),
            note: formatMessage(inv.helperProductsTouched, { count: movement?.products_touched ?? 0 }),
        },
        {
            key: 'shrinkage',
            title: inv.kpiShrinkage,
            value: money(shrinkage?.value ?? 0),
            // Losing more stock is not an improvement, so the sign is inverted.
            delta: (() => {
                const raw = compare(shrinkage?.value, prev?.shrinkage.value);
                return raw.label === '—' ? raw : { label: raw.label, positive: !raw.positive };
            })(),
            note: formatMessage(inv.helperShrinkageUnits, { count: shrinkage?.units ?? 0 }),
        },
    ];

    const attentionItems = useMemo<AttentionItem[]>(() => {
        const items: AttentionItem[] = [];
        if (!overview) return items;

        const { stock: position, stock_takes: stockTakes, transfers } = overview;

        if (position.out_of_stock > 0) {
            items.push({
                id: 'out-of-stock',
                tone: 'red',
                value: String(position.out_of_stock),
                label: formatMessage(inv.attnOutOfStock, { count: position.out_of_stock }),
                href: routes.inventory.reports.reorder,
                cta: inv.viewAll,
            });
        }
        if (position.negative_stock > 0) {
            items.push({
                id: 'negative-stock',
                tone: 'red',
                value: String(position.negative_stock),
                label: formatMessage(inv.attnNegativeStock, { count: position.negative_stock }),
                href: routes.inventory.ledger,
                cta: inv.viewAll,
            });
        }
        if (position.below_reorder > 0) {
            items.push({
                id: 'below-reorder',
                tone: 'amber',
                value: String(position.below_reorder),
                label: formatMessage(inv.attnBelowReorder, { count: position.below_reorder }),
                href: routes.inventory.reports.reorder,
                cta: inv.viewAll,
            });
        }
        if (stockTakes.open > 0) {
            items.push({
                id: 'stock-takes',
                tone: 'blue',
                value: String(stockTakes.open),
                label: formatMessage(inv.attnOpenStockTakes, { count: stockTakes.open }),
                href: routes.inventory.stockTakes,
                cta: inv.viewAll,
            });
        }
        if (transfers.in_transit_units > 0) {
            items.push({
                id: 'in-transit',
                tone: 'blue',
                value: String(transfers.in_transit_units),
                label: formatMessage(inv.attnInTransit, { count: transfers.in_transit_units }),
                href: routes.inventory.transfers,
                cta: inv.viewAll,
            });
        }
        if (position.unconfigured_policy > 0) {
            items.push({
                id: 'no-policy',
                tone: 'blue',
                value: String(position.unconfigured_policy),
                label: formatMessage(inv.attnNoPolicy, { count: position.unconfigured_policy }),
                href: routes.inventory.products,
                cta: inv.viewAll,
            });
        }
        return items;
    }, [overview, inv]);

    const agingBars = useMemo<OrdinalBar[]>(() => {
        const labels: Record<string, string> = {
            days_0_30: inv.aging0_30,
            days_31_60: inv.aging31_60,
            days_61_90: inv.aging61_90,
            days_91_180: inv.aging91_180,
            days_180_plus: inv.aging180Plus,
        };
        return (overview?.aging ?? []).map((bucket) => ({
            id: bucket.key,
            label: labels[bucket.key] ?? bucket.key,
            count: bucket.units,
            href: routes.inventory.reports.valuation,
        }));
    }, [overview?.aging, inv]);

    const lowStockItems = useMemo<RankedItem[]>(
        () => (overview?.low_stock ?? []).map((row) => ({
            id: row.id,
            name: row.name,
            meta: formatMessage(inv.lowStockMeta, { onHand: row.on_hand, level: row.reorder_level }),
            amount: String(row.shortfall),
        })),
        [overview?.low_stock, inv],
    );

    const topValueItems = useMemo<RankedItem[]>(
        () => (overview?.top_value ?? []).map((row) => ({
            id: row.id,
            name: row.name,
            meta: formatMessage(inv.topValueMeta, { units: row.units }),
            amount: money(row.value),
        })),
        // `money` closes over locale, which changes with it.
        [overview?.top_value, inv, locale],
    );

    const categoryItems = useMemo<RankedItem[]>(
        () => (overview?.categories ?? []).map((row) => ({
            id: row.id ?? 'ungrouped',
            name: row.name,
            meta: formatMessage(inv.topValueMeta, { units: row.units }),
            amount: money(row.value),
        })),
        [overview?.categories, inv, locale],
    );

    return (
        <ModuleDashboard
            mount={variant}
            greeting={greeting}
            tenantName={tenantName}
            subtitle={inv.subtitle}
            range={range}
            onRangeChange={setRange}
            error={error}
        >
            <AttentionSection
                items={attentionItems}
                loading={loading}
                label={copy.sectionAttention}
                allClearLabel={inv.attnAllClear}
            />

            <DashboardSection label={inv.sectionStock}>
                <KpiTileGrid tiles={kpiTiles} loading={loading} deltaContext={deltaContext} />
            </DashboardSection>

            {/* The whole band is premium: without valuation there is no aging and
                no category mix, and an empty two-panel row is worse than none. */}
            {overview?.can_value ? (
                <DashboardSection label={inv.sectionShelf}>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[3fr_2fr]">
                        <OrdinalBars
                            title={inv.agingTitle}
                            subtitle={inv.agingSubtitle}
                            bars={agingBars}
                            emptyLabel={inv.agingEmpty}
                            formatCount={(count, share) => (share == null
                                ? formatMessage(inv.agingCount, { count })
                                : formatMessage(inv.agingCountWithShare, { count, share }))}
                        />
                        <RankedListPanel
                            title={inv.categoriesTitle}
                            items={categoryItems}
                            emptyLabel={inv.categoriesEmpty}
                        />
                    </div>
                </DashboardSection>
            ) : null}

            <DashboardSection label={inv.sectionDrivers}>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <RankedListPanel
                        title={inv.lowStockTitle}
                        items={lowStockItems}
                        emptyLabel={inv.lowStockEmpty}
                    />
                    {overview?.can_value ? (
                        <RankedListPanel
                            title={inv.topValueTitle}
                            items={topValueItems}
                            emptyLabel={inv.topValueEmpty}
                        />
                    ) : null}
                </div>
            </DashboardSection>
        </ModuleDashboard>
    );
}
