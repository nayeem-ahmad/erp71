'use client';

import {
    Package,
    TrendingUp,
    Clock,
    MoreVertical,
    Landmark,
    Wallet,
    ReceiptText,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import DashboardBreadcrumb from '@/components/dashboard/DashboardBreadcrumb';
import FrequentQuickLinks from '@/components/dashboard/FrequentQuickLinks';
import { FinancialKpiTile, StatKpiTile } from '@/components/dashboard/KpiTile';
import PageShell from '@/components/ui/compact/PageShell';
import { compactDensity } from '@/lib/ui/compact-density';

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
    filters: {
        from: string;
        to: string;
    };
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
    filters: {
        from: string;
        to: string;
    };
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

export default function DashboardPage() {
    const { t, locale } = useI18n();
    const copy = t.dashboardHome;
    const [user, setUser] = useState<any>(null);
    const [sales, setSales] = useState<any[]>([]);
    const [products, setProducts] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [financialSnapshot, setFinancialSnapshot] = useState<FinancialKpiResponse | null>(null);
    const [financialTrendSnapshot, setFinancialTrendSnapshot] = useState<FinancialTrendResponse | null>(null);
    const [isFinancialLoading, setIsFinancialLoading] = useState(true);
    const [financialError, setFinancialError] = useState('');
    const [financialTrendError, setFinancialTrendError] = useState('');
    const [lowStockCount, setLowStockCount] = useState<number | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            const [meRes, productsRes, salesRes, financialRes, trendRes] = await Promise.allSettled([
                api.getMe(),
                api.getProducts(),
                api.getSales(),
                api.getFinancialKpis(),
                api.getFinancialTrends(),
            ]);

            if (meRes.status === 'fulfilled') {
                setUser(meRes.value);
            }

            if (productsRes.status === 'fulfilled') {
                const fetchedProducts = productsRes.value;
                setProducts(fetchedProducts);
                const lowStock = (Array.isArray(fetchedProducts) ? fetchedProducts : fetchedProducts?.data ?? [])
                    .filter((p: any) => p.reorder_level != null && p.stock_quantity <= p.reorder_level).length;
                setLowStockCount(lowStock);
            }

            if (salesRes.status === 'fulfilled') {
                setSales(salesRes.value);
            }

            if (financialRes.status === 'fulfilled') {
                setFinancialSnapshot(financialRes.value);
            } else {
                setFinancialError(financialRes.reason instanceof Error ? financialRes.reason.message : copy.financialKpisUnavailable);
            }

            if (trendRes.status === 'fulfilled') {
                setFinancialTrendSnapshot(trendRes.value);
            } else {
                setFinancialTrendError(trendRes.reason instanceof Error ? trendRes.reason.message : copy.financialTrendsUnavailable);
            }

            if (meRes.status === 'rejected' || productsRes.status === 'rejected' || salesRes.status === 'rejected') {
                console.error('Failed to fetch dashboard data:', {
                    me: meRes.status === 'rejected' ? meRes.reason : null,
                    products: productsRes.status === 'rejected' ? productsRes.reason : null,
                    sales: salesRes.status === 'rejected' ? salesRes.reason : null,
                });
            }

            setIsLoading(false);
            setIsFinancialLoading(false);
        };

        void fetchData();
    }, [copy.financialKpisUnavailable, copy.financialTrendsUnavailable]);

    const totalSalesAmount = sales.reduce((acc, sale) => acc + Number(sale.total_amount), 0);
    const activeOrdersCount = sales.length;
    const displayedProducts = products.slice(0, 4);
    const financialKpis = financialSnapshot?.kpis ?? EMPTY_KPIS;
    const financialTrends = financialTrendSnapshot?.points ?? [];
    const financialComparison = financialTrendSnapshot?.comparison ?? {
        net_profit: financialKpis.gross_revenue - financialKpis.operating_expense,
        gross_margin: null,
        gross_margin_status: 'unavailable' as const,
        gross_margin_reason: copy.grossMarginReasonDefault,
    };
    const financialDateRange = financialSnapshot?.filters
        ? `${formatDate(financialSnapshot.filters.from, locale)} - ${formatDate(financialSnapshot.filters.to, locale)}`
        : copy.currentMonth;
    const lowStockTrend = lowStockCount === null
        ? copy.loadingTrend
        : lowStockCount === 0
            ? copy.allSufficientlyStocked
            : formatMessage(
                lowStockCount === 1 ? copy.lowStockItemSingular : copy.lowStockItemsPlural,
                { count: lowStockCount },
            );
    const tenantName = user?.tenants?.[0]?.name || copy.yourBusiness;

    const financialTiles = useMemo(() => [
        {
            title: copy.netCashMovement,
            value: formatCurrency(financialKpis.net_cash_movement),
            helper: formatMessage(copy.cashFlowHelper, {
                inflow: formatCurrency(financialKpis.cash_inflow),
                outflow: formatCurrency(financialKpis.cash_outflow),
            }),
            tone: financialKpis.net_cash_movement >= 0 ? 'positive' : 'negative',
            icon: Wallet,
        },
        {
            title: copy.grossRevenue,
            value: formatCurrency(financialKpis.gross_revenue),
            helper: copy.postedRevenueAccounts,
            tone: 'positive',
            icon: TrendingUp,
        },
        {
            title: copy.operatingExpense,
            value: formatCurrency(financialKpis.operating_expense),
            helper: copy.postedExpenseAccounts,
            tone: 'neutral',
            icon: ReceiptText,
        },
        {
            title: copy.receivables,
            value: formatOptionalCurrency(financialKpis.accounts_receivable, copy.notConfigured),
            helper: financialKpis.accounts_receivable === null ? copy.noReceivableConfigured : copy.openReceivableBalance,
            tone: 'neutral',
            icon: Landmark,
        },
        {
            title: copy.payables,
            value: formatOptionalCurrency(financialKpis.accounts_payable, copy.notConfigured),
            helper: financialKpis.accounts_payable === null ? copy.noPayableConfigured : copy.outstandingSupplierObligations,
            tone: 'neutral',
            icon: Package,
        },
        {
            title: copy.netProfit,
            value: formatCurrency(financialComparison.net_profit),
            helper: copy.netProfitHelper,
            tone: financialComparison.net_profit >= 0 ? 'positive' : 'negative',
            icon: TrendingUp,
        },
    ] as const, [copy, financialKpis, financialComparison]);

    return (
        <PageShell maxWidth="wide">
            <div className="space-y-3">
                <DashboardBreadcrumb />
                <div>
                    <h1 className={compactDensity.pageTitle}>{copy.businessMonitor}</h1>
                    <p className={`${compactDensity.pageSubtitle} mt-0.5`}>
                        {formatMessage(copy.tenantSubtitle, { tenant: tenantName })}
                    </p>
                </div>
                <FrequentQuickLinks />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                <StatKpiTile
                    title={copy.totalSales}
                    value={`${totalSalesAmount.toLocaleString()}`}
                    trend={copy.trendFromLastMonth}
                    isPositive={true}
                    tone="blue"
                />
                <StatKpiTile
                    title={copy.activeOrders}
                    value={activeOrdersCount.toString()}
                    trend={copy.realTimeData}
                    isPositive={true}
                    tone="green"
                />
                <StatKpiTile
                    title={copy.products}
                    value={products.length.toString()}
                    trend={copy.inInventory}
                    isPositive={true}
                    tone="purple"
                />
                <StatKpiTile
                    title={copy.lowStockItems}
                    value={lowStockCount === null ? '—' : lowStockCount.toString()}
                    trend={lowStockTrend}
                    isPositive={lowStockCount !== null && lowStockCount === 0}
                    tone={lowStockCount !== null && lowStockCount > 0 ? 'peach' : 'green'}
                />
            </div>

            <section className={`${compactDensity.card}`}>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-3 mb-3">
                    <div>
                        <p className={compactDensity.sectionLabel}>{copy.financialSnapshot}</p>
                        <h2 className="mt-0.5 text-base font-bold tracking-tight text-gray-900">{copy.accountingKpis}</h2>
                        <p className={`${compactDensity.pageSubtitle} mt-0.5`}>{financialDateRange}</p>
                    </div>
                    {financialError ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                            {financialError}
                        </div>
                    ) : null}
                </div>

                {isFinancialLoading ? (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {Array.from({ length: 6 }).map((_, index) => (
                                <div key={index} className="rounded-lg border border-gray-100 bg-gray-50 p-3 animate-pulse">
                                    <div className="h-3 w-24 rounded bg-gray-200" />
                                    <div className="mt-3 h-6 w-28 rounded bg-gray-200" />
                                    <div className="mt-2 h-3 w-36 rounded bg-gray-200" />
                                </div>
                            ))}
                        </div>
                        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 animate-pulse">
                            <div className="h-3 w-32 rounded bg-gray-200" />
                            <div className="mt-4 h-36 rounded-lg bg-gray-200" />
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {financialTiles.map((tile) => (
                                <FinancialKpiTile
                                    key={tile.title}
                                    title={tile.title}
                                    value={tile.value}
                                    helper={tile.helper}
                                    tone={tile.tone}
                                    Icon={tile.icon}
                                />
                            ))}
                        </div>

                        <section className={`${compactDensity.cardFlat} space-y-3`}>
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                    <p className={compactDensity.sectionLabel}>{copy.cashFlowMovement}</p>
                                    <h3 className="mt-0.5 text-base font-bold tracking-tight text-gray-950">{copy.inflowVsOutflow}</h3>
                                </div>
                                {financialTrendError ? (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                                        {financialTrendError}
                                    </div>
                                ) : null}
                            </div>
                            <CashFlowChart points={financialTrends} locale={locale} />
                        </section>
                    </div>
                )}
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className={`${compactDensity.card} overflow-hidden !p-0`}>
                    <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between">
                        <h2 className="text-sm font-bold text-gray-900 tracking-tight">{copy.recentActivity}</h2>
                        <button className="text-gray-400 hover:text-gray-600 font-medium text-xs">
                            {copy.viewAll}
                        </button>
                    </div>
                    <div>
                        {sales.length > 0 ? (
                            sales.slice(0, 5).map((sale) => (
                                <ActivityItem
                                    key={sale.id}
                                    title={formatMessage(copy.saleTitle, { serial: sale.serial_number })}
                                    description={formatMessage(copy.amountLabel, { amount: formatBDT(Number(sale.total_amount), { locale }) })}
                                    time={new Date(sale.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                                />
                            ))
                        ) : (
                            <div className="p-6 text-center text-gray-400 text-xs">{isLoading ? copy.loadingRecentActivity : copy.noRecentActivity}</div>
                        )}
                    </div>
                </div>

                <div className={compactDensity.card}>
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-bold text-gray-900 tracking-tight">{copy.inventoryOverview}</h2>
                        <MoreVertical className="w-4 h-4 text-gray-400 cursor-pointer" />
                    </div>
                    <div className="space-y-2">
                        {displayedProducts.length > 0 ? (
                            displayedProducts.map((product) => (
                                <ProductRow
                                    key={product.id}
                                    name={product.name}
                                    price={formatBDT(Number(product.price), { locale })}
                                    sales={product.stocks?.[0]?.quantity?.toString() || '0'}
                                    salesLabel={copy.stock}
                                />
                            ))
                        ) : (
                            <div className="text-center text-gray-400 text-xs py-3">{isLoading ? copy.loadingProducts : copy.noProductsFound}</div>
                        )}
                    </div>
                </div>
            </div>
        </PageShell>
    );
}

function CashFlowChart({ points, locale }: { points: FinancialTrendPoint[]; locale: string }) {
    const { t } = useI18n();
    const copy = t.dashboardHome;

    if (points.length === 0 || !points.some((point) => point.cash_inflow !== 0 || point.cash_outflow !== 0)) {
        return (
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center">
                <p className="text-xs font-medium text-gray-400">{copy.noAccountingMovement}</p>
                <p className="mt-1 text-xs text-gray-500">{copy.noCashMovementPeriod}</p>
            </div>
        );
    }

    const peak = Math.max(...points.flatMap((point) => [point.cash_inflow, point.cash_outflow]), 1);
    const labelInterval = points.length > 14 ? Math.ceil(points.length / 7) : 1;

    return (
        <div>
            <div className="flex items-center gap-3 text-xs font-medium text-gray-500">
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />{copy.inflow}</span>
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" />{copy.outflow}</span>
            </div>
            <div className="w-full rounded-lg border border-gray-100 bg-gray-50/60 p-3">
                <div className="flex h-40 w-full items-end gap-px sm:gap-1">
                    {points.map((point, index) => {
                        const showLabel = index === 0
                            || index === points.length - 1
                            || index % labelInterval === 0
                            || point.cash_inflow !== 0
                            || point.cash_outflow !== 0;

                        return (
                            <div key={point.date} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
                                <div className="flex h-40 w-full max-w-8 items-end justify-center gap-px sm:gap-0.5">
                                    <div
                                        aria-label={formatMessage(copy.cashInflowAria, { date: point.date })}
                                        className="w-[42%] max-w-3 rounded-t-sm bg-emerald-500 transition-all"
                                        style={{ height: `${Math.max((point.cash_inflow / peak) * 100, point.cash_inflow > 0 ? 6 : 0)}%` }}
                                    />
                                    <div
                                        aria-label={formatMessage(copy.cashOutflowAria, { date: point.date })}
                                        className="w-[42%] max-w-3 rounded-t-sm bg-rose-500 transition-all"
                                        style={{ height: `${Math.max((point.cash_outflow / peak) * 100, point.cash_outflow > 0 ? 6 : 0)}%` }}
                                    />
                                </div>
                                <span className="w-full truncate text-center text-[9px] font-bold uppercase tracking-tight text-gray-400 sm:text-[10px]">
                                    {showLabel
                                        ? new Date(point.date).toLocaleDateString(locale, { month: 'short', day: 'numeric' })
                                        : ''}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function formatCurrency(value: number) {
    const absolute = Math.abs(Number(value || 0)).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });

    return `${value < 0 ? '-' : ''}${absolute}`;
}

function formatOptionalCurrency(value: number | null, notConfiguredLabel: string) {
    if (value === null) {
        return notConfiguredLabel;
    }

    return formatCurrency(value);
}

function ActivityItem({ title, description, time }: { title: string, description: string, time: string }) {
    return (
        <div className="px-3 py-2.5 flex items-start space-x-3 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0 cursor-pointer group">
            <div className="mt-1 h-2 w-2 rounded-full flex-shrink-0 bg-blue-400" />
            <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-900 tracking-tight truncate">{title}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{description}</p>
            </div>
            <div className="flex items-center space-x-1 text-[10px] font-medium text-gray-400 self-center whitespace-nowrap group-hover:text-gray-600 transition-colors">
                <Clock className="w-3 h-3" />
                <span>{time}</span>
            </div>
        </div>
    );
}

function ProductRow({ name, price, sales, salesLabel }: { name: string, price: string, sales: string, salesLabel: string }) {
    return (
        <div className="flex items-center justify-between group cursor-pointer hover:bg-gray-50 px-2 py-1.5 -mx-2 rounded-lg transition-colors">
            <div className="flex items-center space-x-2.5 min-w-0">
                <div className="w-8 h-8 bg-gray-100 rounded-md flex-shrink-0" />
                <div className="min-w-0">
                    <p className="text-xs font-semibold text-gray-900 tracking-tight truncate">{name}</p>
                    <p className="text-[11px] text-gray-500">{price}</p>
                </div>
            </div>
            <div className="text-right flex-shrink-0 ml-2">
                <p className="text-xs font-semibold tracking-tight">{sales}</p>
                <p className="text-[10px] text-gray-400">{salesLabel}</p>
            </div>
        </div>
    );
}