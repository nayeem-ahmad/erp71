'use client';

import Link from 'next/link';
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
import { RankedListPanel, type RankedItem } from '@/components/dashboard/RankedListPanel';
import { SalesByCategoryDonut, type CategoryRow } from '@/components/dashboard/SalesByCategoryDonut';
import type { DashboardIdentity } from './dashboard-identity';

type OverviewResponse = {
    filters: { from: string; to: string };
    sales: {
        gross: number;
        returns: number;
        net: number;
        count: number;
        returns_count: number;
        avg_ticket: number | null;
    };
    margin: {
        gross_profit: number | null;
        margin_pct: number | null;
        costed_items: number;
        uncosted_items: number;
        units: number;
    };
    receivables: { outstanding: number; customers_owing: number };
    fulfilment: {
        open_orders: number;
        overdue_orders: number;
        pending_deliveries: number;
        open_quotes: number;
        expiring_quotes: number;
    };
    products: Array<{ id: string; name: string; units: number; revenue: number }>;
    categories: Array<{ id: string | null; name: string; units: number; revenue: number }>;
    customers: Array<{ id: string | null; name: string; revenue: number; orders: number; owed: number }>;
    recent: Array<{
        id: string;
        serial_number: string;
        customer_name: string | null;
        total: number;
        due: number;
        sale_date: string;
    }>;
};

type TrendPoint = { date: string; net_sales: number; orders: number; returns: number };

/**
 * Sales > Overview: what sold, what it earned, and what is still owed or
 * undelivered.
 */
export default function SalesDashboard({
    greeting,
    tenantName,
    variant = 'page',
}: Readonly<DashboardIdentity & { variant?: DashboardMount }>) {
    const { t, locale } = useI18n();
    const copy = t.dashboardHome;
    const sls = copy.sales;

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
        fetchOverview: (window) => api.getSalesDashboardOverview(window),
        fetchTrends: (window) => api.getSalesDashboardTrends(window),
        unavailableMessage: sls.overviewUnavailable,
    });

    const money = (value: number) => formatBDT(value, { locale });
    const sales = overview?.sales;
    const margin = overview?.margin;

    const kpiTiles: KpiTileSpec[] = [
        {
            key: 'net-sales',
            title: sls.kpiNetSales,
            value: money(sales?.net ?? 0),
            points: trends.map((point) => point.net_sales),
            delta: compare(sales?.net, prev?.sales.net),
            note: formatMessage(sls.helperReturns, {
                count: sales?.returns_count ?? 0,
                amount: money(sales?.returns ?? 0),
            }),
        },
        {
            key: 'orders',
            title: sls.kpiOrders,
            value: String(sales?.count ?? 0),
            points: trends.map((point) => point.orders),
            delta: compare(sales?.count, prev?.sales.count),
            note: formatMessage(sls.helperUnits, { count: margin?.units ?? 0 }),
        },
        {
            key: 'avg-ticket',
            title: sls.kpiAvgTicket,
            value: sales?.avg_ticket == null ? '—' : money(sales.avg_ticket),
            delta: compare(sales?.avg_ticket, prev?.sales.avg_ticket),
        },
        {
            key: 'margin',
            title: sls.kpiMargin,
            value: margin?.margin_pct == null ? '—' : `${margin.margin_pct}%`,
            delta: compare(margin?.margin_pct, prev?.margin.margin_pct),
            // Says what the figure is missing rather than quietly averaging over
            // the lines that happen to carry a cost.
            note: marginNote(),
        },
    ];

    function marginNote(): string | undefined {
        if (!margin) return undefined;
        if (margin.gross_profit == null) return sls.marginNoBasis;
        if (margin.uncosted_items > 0) {
            return formatMessage(sls.helperUncosted, { count: margin.uncosted_items });
        }
        return formatMessage(sls.helperGrossProfit, { amount: money(margin.gross_profit) });
    }

    const attentionItems = useMemo<AttentionItem[]>(() => {
        const items: AttentionItem[] = [];
        if (!overview) return items;

        const { receivables, fulfilment } = overview;

        if (receivables.outstanding > 0) {
            items.push({
                id: 'receivables',
                tone: 'red',
                value: money(receivables.outstanding),
                label: formatMessage(sls.attnReceivables, {
                    amount: money(receivables.outstanding),
                    count: receivables.customers_owing,
                }),
                href: routes.sales.customerDueAging,
                cta: sls.viewAll,
            });
        }
        if (fulfilment.overdue_orders > 0) {
            items.push({
                id: 'overdue-orders',
                tone: 'red',
                value: String(fulfilment.overdue_orders),
                label: formatMessage(sls.attnOverdueOrders, { count: fulfilment.overdue_orders }),
                href: routes.sales.orders,
                cta: sls.viewAll,
            });
        }
        if (fulfilment.pending_deliveries > 0) {
            items.push({
                id: 'deliveries',
                tone: 'amber',
                value: String(fulfilment.pending_deliveries),
                label: formatMessage(sls.attnPendingDeliveries, { count: fulfilment.pending_deliveries }),
                href: routes.sales.delivery,
                cta: sls.viewAll,
            });
        }
        if (fulfilment.expiring_quotes > 0) {
            items.push({
                id: 'expiring-quotes',
                tone: 'amber',
                value: String(fulfilment.expiring_quotes),
                label: formatMessage(sls.attnExpiringQuotes, { count: fulfilment.expiring_quotes }),
                href: routes.sales.quotes,
                cta: sls.viewAll,
            });
        }
        if (fulfilment.open_orders > 0) {
            items.push({
                id: 'open-orders',
                tone: 'blue',
                value: String(fulfilment.open_orders),
                label: formatMessage(sls.attnOpenOrders, { count: fulfilment.open_orders }),
                href: routes.sales.orders,
                cta: sls.viewAll,
            });
        }
        return items;
    }, [overview, sls, locale]);

    const productItems = useMemo<RankedItem[]>(
        () => (overview?.products ?? []).map((row) => ({
            id: row.id,
            name: row.name,
            meta: formatMessage(sls.productMeta, { units: row.units }),
            amount: money(row.revenue),
        })),
        [overview?.products, sls, locale],
    );

    const customerItems = useMemo<RankedItem[]>(
        () => (overview?.customers ?? []).map((row) => ({
            id: row.id ?? 'walk-in',
            name: row.name,
            meta: formatMessage(sls.customerMeta, { orders: row.orders, owed: money(row.owed) }),
            amount: money(row.revenue),
        })),
        [overview?.customers, sls, locale],
    );

    const categoryTotal = (overview?.categories ?? []).reduce((sum, row) => sum + row.revenue, 0);
    const categoryRows = useMemo<CategoryRow[]>(
        () => (overview?.categories ?? []).map((row) => ({
            categoryId: row.id,
            categoryName: row.name,
            revenue: row.revenue,
            share: categoryTotal > 0 ? row.revenue / categoryTotal : 0,
        })),
        [overview?.categories, categoryTotal],
    );

    return (
        <ModuleDashboard
            mount={variant}
            greeting={greeting}
            tenantName={tenantName}
            subtitle={sls.subtitle}
            range={range}
            onRangeChange={setRange}
            error={error}
        >
            <AttentionSection
                items={attentionItems}
                loading={loading}
                label={copy.sectionAttention}
                allClearLabel={sls.attnAllClear}
            />

            <DashboardSection label={sls.sectionSelling}>
                <KpiTileGrid tiles={kpiTiles} loading={loading} deltaContext={deltaContext} />
            </DashboardSection>

            <DashboardSection label={sls.sectionDrivers}>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-4">
                    <RankedListPanel
                        title={sls.productsTitle}
                        items={productItems}
                        emptyLabel={sls.productsEmpty}
                    />
                    <RankedListPanel
                        title={sls.customersTitle}
                        items={customerItems}
                        emptyLabel={sls.customersEmpty}
                    />

                    <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                        <h3 className="mb-2 text-xs font-bold text-gray-900">{sls.categoriesTitle}</h3>
                        {loading ? (
                            <div className="h-24 animate-pulse rounded-lg bg-gray-100" />
                        ) : (
                            <SalesByCategoryDonut
                                rows={categoryRows}
                                totalLabel={formatBDT(categoryTotal, {
                                    locale,
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: 0,
                                })}
                                totalTitle={money(categoryTotal)}
                                emptyLabel={sls.categoriesEmpty}
                                ariaLabel={`${sls.categoriesTitle} — ${money(categoryTotal)}`}
                            />
                        )}
                    </div>

                    <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <h3 className="text-xs font-bold text-gray-900">{sls.recentTitle}</h3>
                            <Link href={routes.sales.list} className="text-[10px] font-bold text-primary hover:underline">
                                {sls.viewAll}
                            </Link>
                        </div>
                        {(overview?.recent ?? []).length === 0 ? (
                            <p className="py-4 text-center text-[11px] text-gray-400">{sls.recentEmpty}</p>
                        ) : (
                            <ul>
                                {overview!.recent.map((row) => (
                                    <li key={row.id} className="border-b border-gray-50 py-1.5 last:border-0">
                                        <Link
                                            href={routes.sales.detail(row.id)}
                                            className="flex items-center gap-2 text-[11px]"
                                        >
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate font-semibold text-gray-900">
                                                    {row.customer_name ?? sls.recentWalkIn}
                                                </span>
                                                {row.due > 0 ? (
                                                    <span className="block text-[10px] text-danger-text">
                                                        {formatMessage(sls.recentDue, { amount: money(row.due) })}
                                                    </span>
                                                ) : null}
                                            </span>
                                            <span className="shrink-0 font-bold tabular-nums text-gray-900">
                                                {money(row.total)}
                                            </span>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </DashboardSection>
        </ModuleDashboard>
    );
}
