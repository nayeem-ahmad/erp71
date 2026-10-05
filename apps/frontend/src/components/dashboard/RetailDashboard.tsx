'use client';

import { Clock } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { previousWindow, rangeToWindow } from '@/lib/dashboard-range';
import { periodDelta } from '@/lib/dashboard-delta';
import FrequentQuickLinks from '@/components/dashboard/FrequentQuickLinks';
import { DashboardHeader, type DashboardRange } from '@/components/dashboard/DashboardHeader';
import { routes } from '@/lib/routes';
import { AttentionStrip, type AttentionItem } from '@/components/dashboard/AttentionStrip';
import { SalesByCategoryDonut, type CategoryRow } from '@/components/dashboard/SalesByCategoryDonut';
import { CashFlowChart } from '@/components/dashboard/CashFlowChart';
import { RankedListPanel, type RankedItem } from '@/components/dashboard/RankedListPanel';
import PageShell from '@/components/ui/compact/PageShell';
import { BranchFilter } from '@/components/ui';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import type { DashboardIdentity } from './dashboard-identity';
import { dashboardQueryKey } from './dashboard-query';
import { KpiTileGrid, type KpiTileSpec } from './ModuleDashboard';

type FinancialKpis = {
    cash_inflow: number;
    cash_outflow: number;
    net_cash_movement: number;
    gross_revenue: number;
    operating_expense: number;
    accounts_receivable: number | null;
    accounts_payable: number | null;
    tax_liability: number | null;
};

type FinancialKpiResponse = {
    filters: { from: string; to: string };
    kpis: FinancialKpis;
};

type FinancialTrendPoint = {
    date: string;
    cash_inflow: number;
    cash_outflow: number;
    net_cash_movement: number;
    gross_revenue: number;
    operating_expense: number;
    net_profit: number;
};

type FinancialTrendResponse = {
    filters: { from: string; to: string };
    granularity: 'day';
    has_activity: boolean;
    points: FinancialTrendPoint[];
    comparison: {
        net_profit: number;
        gross_margin: number | null;
        gross_margin_status: 'unavailable';
        gross_margin_reason: string;
    };
};

type CategoryResponse = {
    summary: { totalRevenue: number; categoryCount: number };
    rows: CategoryRow[];
};

type ProductReportRow = {
    product: { id: string; name: string };
    unitsSold: number;
    revenue: number;
    revenueShare: number;
};

type CustomerReportRow = {
    customer: { id: string | null; name: string };
    orderCount: number;
    revenue: number;
    avgOrderValue: number;
};

type ReportRows<T> = { rows?: T[] } | null;

type SaleRow = {
    id: string;
    serial_number: string;
    total_amount: number | string;
    amount_paid?: number | string;
    status?: string;
    created_at: string;
};

const EMPTY_KPIS: FinancialKpis = {
    cash_inflow: 0,
    cash_outflow: 0,
    net_cash_movement: 0,
    gross_revenue: 0,
    operating_expense: 0,
    accounts_receivable: null,
    accounts_payable: null,
    tax_liability: null,
};

// Sale statuses that indicate an order still awaiting delivery. The current sales
// pipeline only emits COMPLETED, so this degrades to a count of 0 (item omitted).
const DELIVERY_PENDING_STATUSES = new Set(['DELIVERY_PENDING', 'AWAITING_DELIVERY', 'PENDING_DELIVERY']);

/** The branch filter's answer every panel asks with: `storeId`, and whether it is settled. */
type PanelBranch = { storeId: string | undefined; ready: boolean };

/**
 * One panel's question over the selected range.
 *
 * Keeps the previous range's answer on screen while a new one loads
 * (`keepPreviousData`), so switching tabs dims the figures instead of blanking
 * them to skeletons. The window is worked out when the request is made, not put
 * in the key — see `dashboardQueryKey`. The branch filter's `storeId` is in the
 * key, so another branch is a fresh question rather than a cache hit.
 */
function useRangeQuery<T>(
    panel: string,
    range: DashboardRange,
    branch: PanelBranch,
    fetchFor: (window: { from: string; to: string; storeId?: string }) => Promise<T>,
) {
    return useQuery({
        queryKey: dashboardQueryKey('retail', panel, range, branch.storeId ?? null),
        queryFn: () => fetchFor({ ...rangeToWindow(range), storeId: branch.storeId }),
        enabled: branch.ready,
        placeholderData: keepPreviousData,
    });
}

/** Dims a panel that is still showing the previous range's answer. */
function dimWhile(refreshing: boolean): string {
    return refreshing ? 'opacity-60 transition-opacity' : 'transition-opacity';
}

/**
 * The retail home dashboard.
 *
 * Every panel owns its request and shows its answer the moment that one lands.
 * These nine calls used to sit in one `Promise.allSettled`, so the page showed
 * nothing until the slowest — the category and product reports, usually — had
 * come back; now the health tiles paint as soon as the KPI call answers and the
 * slow reports fill in behind them. Each answer is cached per workspace, range
 * and day, so coming back to the dashboard paints from memory and refreshes
 * behind the figures.
 */
export default function RetailDashboard({ greeting, tenantName, renewalEnd }: DashboardIdentity) {
    const { t, locale } = useI18n();
    const copy = t.dashboardHome;

    const [range, setRange] = useState<DashboardRange>('week');
    // Every panel answers for the branch filter's choice: the header branch to
    // start with, another branch or "All branches" when picked.
    const branch = useBranchScope();
    const storeId = branch.apiStoreId;
    const panelBranch: PanelBranch = { storeId, ready: branch.ready };

    const kpisQuery = useRangeQuery<FinancialKpiResponse>('kpis', range, panelBranch, (win) => api.getFinancialKpis(win));
    // The window before this one feeds the delta arrows and nothing else, so it
    // is a request of its own: the headline figures never wait for it.
    const previousQuery = useRangeQuery<FinancialKpiResponse>(
        'kpis-previous',
        range,
        panelBranch,
        ({ storeId: branchId, ...win }) => api.getFinancialKpis({ ...previousWindow(win), storeId: branchId }),
    );
    const trendQuery = useRangeQuery<FinancialTrendResponse>('trends', range, panelBranch, (win) => api.getFinancialTrends(win));
    const categoryQuery = useRangeQuery<CategoryResponse | null>('category', range, panelBranch, (win) => api.getSalesByCategory(win));
    const productQuery = useRangeQuery<ReportRows<ProductReportRow>>('products', range, panelBranch, (win) => api.getSalesByProduct(win));
    const customerQuery = useRangeQuery<ReportRows<CustomerReportRow>>('customers', range, panelBranch, (win) => api.getSalesByCustomer(win));

    // These three ignore the range tabs, so switching tabs never re-asks them.
    const lowStockQuery = useQuery({
        queryKey: dashboardQueryKey('retail', 'low-stock', storeId ?? null),
        queryFn: () => api.getLowStockCount({ storeId }) as Promise<{ count?: number } | null>,
        enabled: branch.ready,
    });
    // Two bounded calls instead of the whole history: five rows for the activity
    // panel, and a count-only probe for the delivery tile.
    const recentSalesQuery = useQuery({
        queryKey: dashboardQueryKey('retail', 'recent-sales', storeId ?? null),
        queryFn: () => api.getSalesList({ limit: 5, storeId }) as Promise<{ items?: SaleRow[] } | null>,
        enabled: branch.ready,
    });
    // Counted by the server across every sale, not just the five loaded above.
    const deliveryQuery = useQuery({
        queryKey: dashboardQueryKey('retail', 'deliveries-pending', storeId ?? null),
        queryFn: () => api.getSalesList({ status: [...DELIVERY_PENDING_STATUSES].join(','), limit: 1, storeId }) as Promise<{ total?: number } | null>,
        enabled: branch.ready,
    });

    // The server refusing the filter's branch: back to the header branch, with
    // a toast. The KPI call is the one every panel shares a fate with.
    const kpisError = kpisQuery.error;
    useEffect(() => {
        if (kpisError) handleBranchForbidden(kpisError, branch, t.dashboardLayout.branchFilterForbidden);
        // `branch` is a fresh object every render; the error is what changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kpisError]);

    const financialSnapshot = kpisQuery.data ?? null;
    const financialError = kpisQuery.isError
        ? (kpisQuery.error instanceof Error ? kpisQuery.error.message : copy.financialKpisUnavailable)
        : '';
    const financialTrendSnapshot = trendQuery.data ?? null;
    const financialTrendError = trendQuery.isError
        ? (trendQuery.error instanceof Error ? trendQuery.error.message : copy.financialTrendsUnavailable)
        : '';
    // A failed comparison window is not an error worth surfacing — the tiles
    // simply fall back to showing no delta. Nor is one from the other range: while
    // a tab switch is in flight the comparison is used only when it belongs to the
    // same range as the figures on screen, so an arrow never compares this week
    // against last month.
    const previousSnapshot = previousQuery.data !== undefined
        && previousQuery.isPlaceholderData === kpisQuery.isPlaceholderData
        ? previousQuery.data
        : null;
    const categoryData = categoryQuery.data ?? null;
    const productReport = productQuery.data?.rows ?? [];
    const customerReport = customerQuery.data?.rows ?? [];
    const sales = recentSalesQuery.data?.items ?? [];
    const lowStockCount = lowStockQuery.data?.count ?? 0;
    const deliveryPendingCount = deliveryQuery.data?.total ?? 0;

    // The attention strip reads three answers (low stock, deliveries, and the
    // receivable off the KPIs) and waits for all three rather than reshuffling
    // its items as each one lands.
    const isAttentionLoading = lowStockQuery.isPending || deliveryQuery.isPending || kpisQuery.isPending;

    const categoryError = categoryQuery.error;
    const productError = productQuery.error;
    const customerError = customerQuery.error;
    useEffect(() => {
        if (!categoryError && !productError && !customerError) return;
        console.error('Failed to fetch dashboard retail data:', {
            category: categoryError ?? null,
            products: productError ?? null,
            customers: customerError ?? null,
        });
    }, [categoryError, productError, customerError]);

    const financialKpis = financialSnapshot?.kpis ?? EMPTY_KPIS;
    const financialTrends = financialTrendSnapshot?.points ?? [];
    const netProfit = financialTrendSnapshot?.comparison?.net_profit
        ?? (financialKpis.gross_revenue - financialKpis.operating_expense);

    const salesSeries = financialTrends.map((point) => point.gross_revenue);
    const profitSeries = financialTrends.map((point) => point.net_profit);
    const cashSeries = financialTrends.map((point) => point.net_cash_movement);

    const receivable = financialKpis.accounts_receivable;
    const renewalDays = renewalEnd ? Math.ceil((new Date(renewalEnd).getTime() - Date.now()) / 86_400_000) : null;

    const attentionItems: AttentionItem[] = [];
    if (lowStockCount > 0) {
        attentionItems.push({
            id: 'low-stock',
            tone: 'amber',
            value: String(lowStockCount),
            label: formatMessage(copy.attnLowStock, { count: lowStockCount }),
            href: '/inventory',
            cta: copy.viewAll,
        });
    }
    if (receivable != null && receivable > 0) {
        attentionItems.push({
            id: 'receivables',
            tone: 'red',
            value: formatBDT(receivable, { locale }),
            label: copy.attnReceivablesOutstanding,
            href: '/sales',
            cta: copy.viewAll,
        });
    }
    if (deliveryPendingCount > 0) {
        attentionItems.push({
            id: 'deliveries',
            tone: 'blue',
            value: String(deliveryPendingCount),
            label: formatMessage(copy.attnDeliveries, { count: deliveryPendingCount }),
            href: '/sales',
            cta: copy.viewAll,
        });
    }
    if (renewalDays != null && renewalDays >= 0 && renewalDays <= 30) {
        attentionItems.push({
            id: 'renewal',
            tone: 'violet',
            value: String(renewalDays),
            label: formatMessage(copy.attnRenewal, { days: renewalDays }),
            href: '/billing',
            cta: copy.viewAll,
        });
    }

    const categoryRows: CategoryRow[] = (categoryData?.rows ?? []).map((row) => ({
        ...row,
        categoryName: row.categoryName === 'Other'
            ? copy.otherCategory
            : row.categoryName === 'Uncategorized'
                ? copy.uncategorized
                : row.categoryName,
    }));
    const categoryTotal = categoryData?.summary?.totalRevenue ?? 0;

    const topProducts: RankedItem[] = productReport.slice(0, 4).map((row) => ({
        id: row.product.id,
        name: row.product.name,
        meta: formatMessage(copy.unitsSold, { count: row.unitsSold }),
        amount: formatBDT(row.revenue, { locale }),
    }));

    const topCustomers: RankedItem[] = customerReport.slice(0, 4).map((row, index) => ({
        id: row.customer.id ?? `customer-${index}`,
        name: row.customer.name,
        meta: formatMessage(copy.ordersCount, { count: row.orderCount }),
        amount: formatBDT(row.revenue, { locale }),
        avatarInitials: initialsOf(row.customer.name),
    }));

    const previousKpis = previousSnapshot?.kpis ?? null;
    const previousNetProfit = previousKpis ? previousKpis.gross_revenue - previousKpis.operating_expense : null;
    const deltaContext = range === 'today'
        ? copy.vsPreviousToday
        : range === 'week' ? copy.vsPreviousWeek : copy.vsPreviousMonth;

    // Each flow KPI is compared against the same figure over the preceding window
    // of equal length. Without that window there is nothing honest to compare to.
    const compare = (current: number, previous: number | null | undefined) =>
        previous == null ? { label: '—', positive: true } : periodDelta(current, previous);

    const healthTiles: KpiTileSpec[] = [
        {
            key: 'sales',
            title: copy.kpiSales,
            value: formatBDT(financialKpis.gross_revenue, { locale }),
            points: salesSeries,
            delta: compare(financialKpis.gross_revenue, previousKpis?.gross_revenue),
        },
        {
            key: 'net-profit',
            title: copy.kpiNetProfit,
            value: formatBDT(netProfit, { locale }),
            points: profitSeries,
            delta: compare(netProfit, previousNetProfit),
        },
        {
            key: 'cash',
            title: copy.kpiCashInHand,
            value: formatBDT(financialKpis.net_cash_movement, { locale }),
            points: cashSeries,
            delta: compare(financialKpis.net_cash_movement, previousKpis?.net_cash_movement),
        },
        {
            key: 'receivables',
            title: copy.kpiReceivables,
            value: receivable == null ? copy.notConfigured : formatBDT(receivable, { locale }),
            points: [],
            // Receivables are a balance, not a flow: comparing it against the previous
            // window would read as a trend when it is just the amount currently owed.
            // A dash also drops the "vs last week" context (see `KpiTileGrid`).
            delta: { label: '—', positive: true },
        },
    ];

    return (
        <PageShell maxWidth="full">
            <div className="space-y-4">
                <DashboardHeader
                    greeting={greeting}
                    tenantName={tenantName}
                    subtitle={copy.dashboardSubtitle}
                    range={range}
                    onRangeChange={setRange}
                    labels={{ today: copy.rangeToday, week: copy.rangeWeek, month: copy.rangeMonth }}
                    toolbar={
                        <>
                            <BranchFilter scope={branch} />
                            <Link
                                href={routes.sales.dailyReport}
                                className="inline-flex min-h-touch items-center rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-bold text-blue-600 hover:bg-gray-50"
                            >
                                {copy.todaysReport}
                            </Link>
                        </>
                    }
                />

                <FrequentQuickLinks />

                <section>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">{copy.sectionHealth}</p>
                    <div aria-busy={kpisQuery.isPlaceholderData} className={`space-y-2 ${dimWhile(kpisQuery.isPlaceholderData)}`}>
                        {financialError ? (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                                {financialError}
                            </div>
                        ) : null}
                        <KpiTileGrid tiles={healthTiles} loading={kpisQuery.isPending} deltaContext={deltaContext} />
                    </div>
                </section>

                <section>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">{copy.sectionAttention}</p>
                    {isAttentionLoading ? (
                        <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
                            {Array.from({ length: 4 }).map((_, index) => (
                                <div key={index} className="h-16 rounded-xl border border-gray-100 bg-white p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] animate-pulse">
                                    <div className="h-5 w-12 rounded bg-gray-200" />
                                    <div className="mt-2 h-3 w-20 rounded bg-gray-100" />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <AttentionStrip items={attentionItems} allClearLabel={copy.attnAllClear} />
                    )}
                </section>

                <section>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">{copy.sectionMoney}</p>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[3fr_2fr]">
                        <div className={`rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${dimWhile(trendQuery.isPlaceholderData)}`}>
                            <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                                <h3 className="text-xs font-bold text-gray-900">{copy.cashFlowMovement}</h3>
                                {financialTrendError ? (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800">
                                        {financialTrendError}
                                    </div>
                                ) : null}
                            </div>
                            {trendQuery.isPending ? (
                                <div data-testid="cash-flow-skeleton" className="h-40 animate-pulse rounded-lg bg-gray-100" />
                            ) : (
                                <CashFlowChart
                                    points={financialTrends}
                                    locale={locale}
                                    labels={{
                                        inflow: copy.inflow,
                                        outflow: copy.outflow,
                                        net: copy.netFlow,
                                        empty: copy.noAccountingMovement,
                                        emptyHint: copy.noCashMovementPeriod,
                                    }}
                                />
                            )}
                        </div>

                        <div className={`rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${dimWhile(categoryQuery.isPlaceholderData)}`}>
                            <h3 className="mb-2 text-xs font-bold text-gray-900">{copy.salesByCategory}</h3>
                            {categoryQuery.isPending ? (
                                <div data-testid="category-skeleton" className="h-24 animate-pulse rounded-lg bg-gray-100" />
                            ) : (
                                <SalesByCategoryDonut
                                    rows={categoryRows}
                                    // Decimals on a six-figure taka total overflow the ring;
                                    // the exact figure stays available on hover.
                                    totalLabel={formatBDT(categoryTotal, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                    totalTitle={formatBDT(categoryTotal, { locale })}
                                    emptyLabel={copy.salesByCategoryEmpty}
                                />
                            )}
                        </div>
                    </div>
                </section>

                <section>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">{copy.sectionDrivers}</p>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                        <div className={dimWhile(productQuery.isPlaceholderData)}>
                            <RankedListPanel
                                title={copy.topProducts}
                                items={topProducts}
                                emptyLabel={copy.noProductsFound}
                                loading={productQuery.isPending}
                            />
                        </div>
                        <div className={dimWhile(customerQuery.isPlaceholderData)}>
                            <RankedListPanel
                                title={copy.topCustomers}
                                items={topCustomers}
                                emptyLabel={copy.noRecentActivity}
                                loading={customerQuery.isPending}
                            />
                        </div>
                        <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                            <h3 className="mb-2 text-xs font-bold text-gray-900">{copy.recentActivity}</h3>
                            {sales.length > 0 ? (
                                <div>
                                    {sales.slice(0, 5).map((sale) => (
                                        <ActivityItem
                                            key={sale.id}
                                            title={formatMessage(copy.saleTitle, { serial: sale.serial_number })}
                                            description={formatMessage(copy.amountLabel, { amount: formatBDT(Number(sale.total_amount), { locale }) })}
                                            time={new Date(sale.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <p className="py-4 text-center text-[11px] text-gray-400">
                                    {recentSalesQuery.isPending ? copy.loadingRecentActivity : copy.noRecentActivity}
                                </p>
                            )}
                        </div>
                    </div>
                </section>
            </div>
        </PageShell>
    );
}

function initialsOf(name: string): string {
    return name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join('') || '?';
}

function ActivityItem({ title, description, time }: { title: string; description: string; time: string }) {
    return (
        <div className="flex items-start space-x-3 rtl:space-x-reverse border-b border-gray-50 py-2 last:border-0">
            <div className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-blue-400" />
            <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold tracking-tight text-gray-900">{title}</p>
                <p className="mt-0.5 text-[11px] text-gray-500">{description}</p>
            </div>
            <div className="flex items-center space-x-1 rtl:space-x-reverse self-center whitespace-nowrap text-[10px] font-medium text-gray-400">
                <Clock className="h-3 w-3" />
                <span>{time}</span>
            </div>
        </div>
    );
}
