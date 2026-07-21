'use client';

import { Clock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { isAccountingOnlyPlan } from '@/lib/plan-entitlements';
import { formatMessage, useI18n } from '@/lib/i18n';
import { previousWindow, rangeToWindow } from '@/lib/dashboard-range';
import { periodDelta } from '@/lib/dashboard-delta';
import FrequentQuickLinks from '@/components/dashboard/FrequentQuickLinks';
import { DashboardHeader, type DashboardRange } from '@/components/dashboard/DashboardHeader';
import { HealthKpiTile } from '@/components/dashboard/HealthKpiTile';
import { AttentionStrip, type AttentionItem } from '@/components/dashboard/AttentionStrip';
import { SalesByCategoryDonut, type CategoryRow } from '@/components/dashboard/SalesByCategoryDonut';
import { CashFlowChart } from '@/components/dashboard/CashFlowChart';
import { RankedListPanel, type RankedItem } from '@/components/dashboard/RankedListPanel';
import PageShell from '@/components/ui/compact/PageShell';

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

type SaleRow = {
    id: string;
    serial_number: string;
    total_amount: number | string;
    amount_paid?: number | string;
    status?: string;
    created_at: string;
};

type ProductRow = {
    reorder_level?: number | null;
    stock_quantity?: number;
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

export default function DashboardPage() {
    const { t, locale } = useI18n();
    const copy = t.dashboardHome;

    const [range, setRange] = useState<DashboardRange>('week');
    const [accountingOnlyMode, setAccountingOnlyMode] = useState(false);
    const [greetingName, setGreetingName] = useState('');
    const [tenantName, setTenantName] = useState('');
    const [renewalEnd, setRenewalEnd] = useState<string | null>(null);

    const [financialSnapshot, setFinancialSnapshot] = useState<FinancialKpiResponse | null>(null);
    const [previousSnapshot, setPreviousSnapshot] = useState<FinancialKpiResponse | null>(null);
    const [financialTrendSnapshot, setFinancialTrendSnapshot] = useState<FinancialTrendResponse | null>(null);
    const [categoryData, setCategoryData] = useState<CategoryResponse | null>(null);
    const [productReport, setProductReport] = useState<ProductReportRow[]>([]);
    const [customerReport, setCustomerReport] = useState<CustomerReportRow[]>([]);
    const [sales, setSales] = useState<SaleRow[]>([]);
    const [lowStockCount, setLowStockCount] = useState(0);

    const [isFinancialLoading, setIsFinancialLoading] = useState(true);
    const [isRetailLoading, setIsRetailLoading] = useState(true);
    const [financialError, setFinancialError] = useState('');
    const [financialTrendError, setFinancialTrendError] = useState('');

    useEffect(() => {
        let cancelled = false;

        const fetchData = async () => {
            setIsFinancialLoading(true);
            setIsRetailLoading(true);
            setFinancialError('');
            setFinancialTrendError('');

            let includeRetailPanels = true;

            try {
                const me = await api.getMe();
                if (cancelled) return;
                const tenantId = typeof window !== 'undefined' ? localStorage.getItem('tenant_id') : null;
                const tenant = me?.tenants?.find((entry: { id: string }) => entry.id === tenantId) || me?.tenants?.[0];
                const planCode = tenant?.subscription?.plan?.code || null;
                const features = (tenant?.subscription?.plan?.features_json || {}) as Record<string, unknown>;
                includeRetailPanels = !isAccountingOnlyPlan(planCode, features);
                setAccountingOnlyMode(!includeRetailPanels);
                setGreetingName(me?.name || '');
                setTenantName(tenant?.name || copy.yourBusiness);
                setRenewalEnd(tenant?.subscription?.current_period_end || null);
            } catch (reason) {
                console.error('Failed to fetch dashboard user context:', reason);
            }

            const win = rangeToWindow(range);
            const prevWin = previousWindow(win);

            const [kpisRes, prevKpisRes, trendRes, productsRes, salesRes, categoryRes, productRepRes, customerRepRes] = await Promise.allSettled([
                api.getFinancialKpis(win),
                api.getFinancialKpis(prevWin),
                api.getFinancialTrends(win),
                includeRetailPanels ? api.getProducts() : Promise.resolve([]),
                includeRetailPanels ? api.getSales() : Promise.resolve([]),
                includeRetailPanels ? api.getSalesByCategory(win) : Promise.resolve(null),
                includeRetailPanels ? api.getSalesByProduct(win) : Promise.resolve({ rows: [] }),
                includeRetailPanels ? api.getSalesByCustomer(win) : Promise.resolve({ rows: [] }),
            ]);

            if (cancelled) return;

            // A failed comparison window is not an error worth surfacing — the tiles
            // simply fall back to showing no delta.
            setPreviousSnapshot(prevKpisRes.status === 'fulfilled' ? prevKpisRes.value : null);

            if (kpisRes.status === 'fulfilled') {
                setFinancialSnapshot(kpisRes.value);
            } else {
                setFinancialSnapshot(null);
                setFinancialError(kpisRes.reason instanceof Error ? kpisRes.reason.message : copy.financialKpisUnavailable);
            }

            if (trendRes.status === 'fulfilled') {
                setFinancialTrendSnapshot(trendRes.value);
            } else {
                setFinancialTrendSnapshot(null);
                setFinancialTrendError(trendRes.reason instanceof Error ? trendRes.reason.message : copy.financialTrendsUnavailable);
            }

            if (productsRes.status === 'fulfilled') {
                const fetchedProducts = productsRes.value;
                const list: ProductRow[] = Array.isArray(fetchedProducts) ? fetchedProducts : fetchedProducts?.data ?? [];
                setLowStockCount(list.filter((p) => p.reorder_level != null && (p.stock_quantity ?? 0) <= p.reorder_level).length);
            } else {
                setLowStockCount(0);
            }

            setSales(salesRes.status === 'fulfilled' ? (salesRes.value ?? []) : []);
            setCategoryData(categoryRes.status === 'fulfilled' ? categoryRes.value : null);
            setProductReport(productRepRes.status === 'fulfilled' ? (productRepRes.value?.rows ?? []) : []);
            setCustomerReport(customerRepRes.status === 'fulfilled' ? (customerRepRes.value?.rows ?? []) : []);

            if (includeRetailPanels && (categoryRes.status === 'rejected' || productRepRes.status === 'rejected' || customerRepRes.status === 'rejected')) {
                console.error('Failed to fetch dashboard retail data:', {
                    category: categoryRes.status === 'rejected' ? categoryRes.reason : null,
                    products: productRepRes.status === 'rejected' ? productRepRes.reason : null,
                    customers: customerRepRes.status === 'rejected' ? customerRepRes.reason : null,
                });
            }

            setIsFinancialLoading(false);
            setIsRetailLoading(false);
        };

        void fetchData();

        return () => {
            cancelled = true;
        };
    }, [range, copy.yourBusiness, copy.financialKpisUnavailable, copy.financialTrendsUnavailable]);

    const greeting = useMemo(() => {
        const hour = new Date().getHours();
        const base = hour < 12 ? copy.greetingMorning : hour < 17 ? copy.greetingAfternoon : copy.greetingEvening;
        return greetingName ? `${base}, ${greetingName} 👋` : `${base} 👋`;
    }, [copy, greetingName]);

    const resolvedTenantName = tenantName || copy.yourBusiness;

    const financialKpis = financialSnapshot?.kpis ?? EMPTY_KPIS;
    const financialTrends = financialTrendSnapshot?.points ?? [];
    const netProfit = financialTrendSnapshot?.comparison?.net_profit
        ?? (financialKpis.gross_revenue - financialKpis.operating_expense);

    const salesSeries = financialTrends.map((point) => point.gross_revenue);
    const profitSeries = financialTrends.map((point) => point.net_profit);
    const cashSeries = financialTrends.map((point) => point.net_cash_movement);

    const receivable = financialKpis.accounts_receivable;
    const deliveryPendingCount = sales.filter((sale) => DELIVERY_PENDING_STATUSES.has(String(sale.status ?? '').toUpperCase())).length;
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

    const healthTiles = [
        {
            key: 'sales',
            title: copy.kpiSales,
            value: formatBDT(financialKpis.gross_revenue, { locale }),
            series: salesSeries,
            delta: compare(financialKpis.gross_revenue, previousKpis?.gross_revenue),
        },
        {
            key: 'net-profit',
            title: copy.kpiNetProfit,
            value: formatBDT(netProfit, { locale }),
            series: profitSeries,
            delta: compare(netProfit, previousNetProfit),
        },
        {
            key: 'cash',
            title: copy.kpiCashInHand,
            value: formatBDT(financialKpis.net_cash_movement, { locale }),
            series: cashSeries,
            delta: compare(financialKpis.net_cash_movement, previousKpis?.net_cash_movement),
        },
        {
            key: 'receivables',
            title: copy.kpiReceivables,
            value: receivable == null ? copy.notConfigured : formatBDT(receivable, { locale }),
            series: [] as number[],
            // Receivables are a balance, not a flow: comparing it against the previous
            // window would read as a trend when it is just the amount currently owed.
            delta: { label: '—', positive: true },
            noContext: true,
        },
    ];

    return (
        <PageShell maxWidth="full">
            <div className="space-y-4">
                <DashboardHeader
                    greeting={greeting}
                    tenantName={resolvedTenantName}
                    subtitle={copy.dashboardSubtitle}
                    range={range}
                    onRangeChange={setRange}
                    labels={{ today: copy.rangeToday, week: copy.rangeWeek, month: copy.rangeMonth }}
                />

                <FrequentQuickLinks accountingOnlyMode={accountingOnlyMode} />

                <section>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">{copy.sectionHealth}</p>
                    {isFinancialLoading ? (
                        <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
                            {Array.from({ length: 4 }).map((_, index) => (
                                <div key={index} className="rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] animate-pulse">
                                    <div className="h-3 w-16 rounded bg-gray-200" />
                                    <div className="mt-2 h-6 w-24 rounded bg-gray-200" />
                                    <div className="mt-2 h-3 w-12 rounded bg-gray-200" />
                                    <div className="mt-3 h-5 w-full rounded bg-gray-100" />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {financialError ? (
                                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                                    {financialError}
                                </div>
                            ) : null}
                            <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
                                {healthTiles.map((tile) => (
                                    <HealthKpiTile
                                        key={tile.key}
                                        title={tile.title}
                                        value={tile.value}
                                        delta={tile.delta.label}
                                        deltaPositive={tile.delta.positive}
                                        deltaContext={tile.noContext || tile.delta.label === '—' ? undefined : deltaContext}
                                        points={tile.series}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </section>

                {!accountingOnlyMode ? (
                    <section>
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">{copy.sectionAttention}</p>
                        {isRetailLoading ? (
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
                ) : null}

                <section>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">{copy.sectionMoney}</p>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[3fr_2fr]">
                        <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                            <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                                <h3 className="text-xs font-bold text-gray-900">{copy.cashFlowMovement}</h3>
                                {financialTrendError ? (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800">
                                        {financialTrendError}
                                    </div>
                                ) : null}
                            </div>
                            {isFinancialLoading ? (
                                <div className="h-40 animate-pulse rounded-lg bg-gray-100" />
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

                        {!accountingOnlyMode ? (
                            <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                                <h3 className="mb-2 text-xs font-bold text-gray-900">{copy.salesByCategory}</h3>
                                {isRetailLoading ? (
                                    <div className="h-24 animate-pulse rounded-lg bg-gray-100" />
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
                        ) : null}
                    </div>
                </section>

                {!accountingOnlyMode ? (
                    <section>
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">{copy.sectionDrivers}</p>
                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                            <RankedListPanel title={copy.topProducts} items={topProducts} emptyLabel={copy.noProductsFound} />
                            <RankedListPanel title={copy.topCustomers} items={topCustomers} emptyLabel={copy.noRecentActivity} />
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
                                        {isRetailLoading ? copy.loadingRecentActivity : copy.noRecentActivity}
                                    </p>
                                )}
                            </div>
                        </div>
                    </section>
                ) : null}
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
        <div className="flex items-start space-x-3 border-b border-gray-50 py-2 last:border-0">
            <div className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-blue-400" />
            <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold tracking-tight text-gray-900">{title}</p>
                <p className="mt-0.5 text-[11px] text-gray-500">{description}</p>
            </div>
            <div className="flex items-center space-x-1 self-center whitespace-nowrap text-[10px] font-medium text-gray-400">
                <Clock className="h-3 w-3" />
                <span>{time}</span>
            </div>
        </div>
    );
}
