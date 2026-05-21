'use client';

import {
    Package,
    TrendingUp,
    TrendingDown,
    Clock,
    MoreVertical,
    Landmark,
    Wallet,
    ReceiptText,
    CircleAlert,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { formatBDT } from '../../lib/format';

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
    const [user, setUser] = useState<any>(null);
    const [sales, setSales] = useState<any[]>([]);
    const [products, setProducts] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [financialSnapshot, setFinancialSnapshot] = useState<FinancialKpiResponse | null>(null);
    const [financialTrendSnapshot, setFinancialTrendSnapshot] = useState<FinancialTrendResponse | null>(null);
    const [isFinancialLoading, setIsFinancialLoading] = useState(true);
    const [financialError, setFinancialError] = useState('');
    const [financialTrendError, setFinancialTrendError] = useState('');

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
                setProducts(productsRes.value);
            }

            if (salesRes.status === 'fulfilled') {
                setSales(salesRes.value);
            }

            if (financialRes.status === 'fulfilled') {
                setFinancialSnapshot(financialRes.value);
            } else {
                setFinancialError(financialRes.reason instanceof Error ? financialRes.reason.message : 'Financial KPIs are unavailable right now.');
            }

            if (trendRes.status === 'fulfilled') {
                setFinancialTrendSnapshot(trendRes.value);
            } else {
                setFinancialTrendError(trendRes.reason instanceof Error ? trendRes.reason.message : 'Financial trends are unavailable right now.');
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
    }, []);

    const totalSalesAmount = sales.reduce((acc, sale) => acc + Number(sale.total_amount), 0);
    const activeOrdersCount = sales.length;
    const displayedProducts = products.slice(0, 4);
    const financialKpis = financialSnapshot?.kpis ?? EMPTY_KPIS;
    const financialTrends = financialTrendSnapshot?.points ?? [];
    const financialComparison = financialTrendSnapshot?.comparison ?? {
        net_profit: financialKpis.gross_revenue - financialKpis.operating_expense,
        gross_margin: null,
        gross_margin_status: 'unavailable' as const,
        gross_margin_reason: 'Sale-time cost basis is not tracked in the current data model.',
    };
    const financialDateRange = financialSnapshot?.filters
        ? `${new Date(financialSnapshot.filters.from).toLocaleDateString()} - ${new Date(financialSnapshot.filters.to).toLocaleDateString()}`
        : 'Current month';
    const financialTiles = [
        {
            title: 'Net Cash Movement',
            value: formatCurrency(financialKpis.net_cash_movement),
            helper: `${formatCurrency(financialKpis.cash_inflow)} in • ${formatCurrency(financialKpis.cash_outflow)} out`,
            tone: financialKpis.net_cash_movement >= 0 ? 'positive' : 'negative',
            icon: Wallet,
        },
        {
            title: 'Gross Revenue',
            value: formatCurrency(financialKpis.gross_revenue),
            helper: 'Posted revenue accounts',
            tone: 'positive',
            icon: TrendingUp,
        },
        {
            title: 'Operating Expense',
            value: formatCurrency(financialKpis.operating_expense),
            helper: 'Posted expense accounts',
            tone: 'neutral',
            icon: ReceiptText,
        },
        {
            title: 'Receivables',
            value: formatOptionalCurrency(financialKpis.accounts_receivable),
            helper: financialKpis.accounts_receivable === null ? 'No receivable account configured' : 'Open receivable balance',
            tone: 'neutral',
            icon: Landmark,
        },
        {
            title: 'Payables',
            value: formatOptionalCurrency(financialKpis.accounts_payable),
            helper: financialKpis.accounts_payable === null ? 'No payable account configured' : 'Outstanding supplier obligations',
            tone: 'neutral',
            icon: Package,
        },
        {
            title: 'Tax Liability',
            value: formatOptionalCurrency(financialKpis.tax_liability),
            helper: financialKpis.tax_liability === null ? 'No tax liability account configured' : 'Configured tax obligations',
            tone: 'neutral',
            icon: CircleAlert,
        },
    ] as const;

    return (
        <div className="overflow-y-auto h-full p-8">
            <div className="mb-8">
                <h1 className="text-2xl font-bold tracking-tight">Dashboard Overview</h1>
                <p className="text-gray-500 text-sm mt-1 uppercase font-medium tracking-wide">
                    {user?.tenants?.[0]?.name || 'Your Business'} • Last updated: Today
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <StatCard
                    title="Total Sales"
                    value={`${totalSalesAmount.toLocaleString()}`}
                    trend="+0% from last month"
                    isPositive={true}
                />
                <StatCard
                    title="Active Orders"
                    value={activeOrdersCount.toString()}
                    trend="Real-time data"
                    isPositive={true}
                />
                <StatCard
                    title="Products"
                    value={products.length.toString()}
                    trend="In inventory"
                    isPositive={true}
                />
            </div>

            <section className="mb-8 rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 pb-5">
                    <div>
                        <p className="text-xs font-black uppercase tracking-[0.24em] text-gray-400">Financial Snapshot</p>
                        <h2 className="mt-1 text-xl font-black tracking-tight text-gray-900">Accounting KPIs</h2>
                        <p className="mt-2 text-sm text-gray-500">{financialDateRange}</p>
                    </div>
                    {financialError ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                            {financialError}
                        </div>
                    ) : null}
                </div>

                {isFinancialLoading ? (
                    <div className="space-y-6 pt-6">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {Array.from({ length: 6 }).map((_, index) => (
                                <div key={index} className="rounded-2xl border border-gray-100 bg-gray-50 p-5 animate-pulse">
                                    <div className="h-3 w-24 rounded bg-gray-200" />
                                    <div className="mt-4 h-8 w-32 rounded bg-gray-200" />
                                    <div className="mt-4 h-3 w-40 rounded bg-gray-200" />
                                </div>
                            ))}
                        </div>
                        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(18rem,1fr)]">
                            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-5 animate-pulse">
                                <div className="h-4 w-40 rounded bg-gray-200" />
                                <div className="mt-6 h-48 rounded-2xl bg-gray-200" />
                            </div>
                            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-5 animate-pulse">
                                <div className="h-4 w-40 rounded bg-gray-200" />
                                <div className="mt-6 h-20 rounded-2xl bg-gray-200" />
                                <div className="mt-4 h-20 rounded-2xl bg-gray-200" />
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-6 pt-6">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {financialTiles.map((tile) => (
                                <FinancialTile
                                    key={tile.title}
                                    title={tile.title}
                                    value={tile.value}
                                    helper={tile.helper}
                                    tone={tile.tone}
                                    Icon={tile.icon}
                                />
                            ))}
                        </div>

                        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(18rem,1fr)]">
                            <section className="rounded-2xl border border-gray-100 bg-slate-950 p-5 text-white shadow-sm">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Cash Flow Movement</p>
                                        <h3 className="mt-2 text-xl font-black tracking-tight">Inflow vs Outflow</h3>
                                    </div>
                                    {financialTrendError ? (
                                        <div className="rounded-2xl border border-amber-300/40 bg-amber-200/10 px-3 py-2 text-sm font-bold text-amber-100">
                                            {financialTrendError}
                                        </div>
                                    ) : null}
                                </div>
                                <div className="mt-6">
                                    <CashFlowChart points={financialTrends} />
                                </div>
                            </section>

                            <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                                <p className="text-xs font-black uppercase tracking-[0.24em] text-gray-400">Net Profit vs Gross Margin</p>
                                <h3 className="mt-2 text-xl font-black tracking-tight text-gray-950">Period Comparison</h3>
                                <div className="mt-6 space-y-4">
                                    <ComparisonMetricCard
                                        title="Net Profit"
                                        value={formatCurrency(financialComparison.net_profit)}
                                        helper="Revenue minus operating expense for posted vouchers"
                                        tone={financialComparison.net_profit >= 0 ? 'positive' : 'negative'}
                                    />
                                    <ComparisonMetricCard
                                        title="Gross Margin"
                                        value="Unavailable"
                                        helper={financialComparison.gross_margin_reason}
                                        tone="neutral"
                                    />
                                </div>
                            </section>
                        </div>
                    </div>
                )}
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                        <h2 className="font-bold text-gray-900 tracking-tight">Recent Activity</h2>
                        <button className="text-gray-400 hover:text-gray-600 font-medium text-sm">
                            View all
                        </button>
                    </div>
                    <div className="p-0">
                        {sales.length > 0 ? (
                            sales.slice(0, 5).map((sale) => (
                                <ActivityItem
                                    key={sale.id}
                                    title={`Sale ${sale.serial_number}`}
                                    description={`Amount: ${formatBDT(Number(sale.total_amount))}`}
                                    time={new Date(sale.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                />
                            ))
                        ) : (
                            <div className="p-8 text-center text-gray-400 text-sm">{isLoading ? 'Loading recent activity...' : 'No recent activity'}</div>
                        )}
                    </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="font-bold text-gray-900 tracking-tight">Inventory Overview</h2>
                        <MoreVertical className="w-5 h-5 text-gray-400 cursor-pointer" />
                    </div>
                    <div className="space-y-6">
                        {displayedProducts.length > 0 ? (
                            displayedProducts.map((product) => (
                                <ProductRow
                                    key={product.id}
                                    name={product.name}
                                    price={formatBDT(Number(product.price))}
                                    sales={product.stocks?.[0]?.quantity?.toString() || '0'}
                                    salesLabel="Stock"
                                />
                            ))
                        ) : (
                            <div className="text-center text-gray-400 text-sm py-4">{isLoading ? 'Loading products...' : 'No products found'}</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function FinancialTile({
    title,
    value,
    helper,
    tone,
    Icon,
}: {
    title: string;
    value: string;
    helper: string;
    tone: 'positive' | 'negative' | 'neutral';
    Icon: React.ComponentType<{ className?: string }>;
}) {
    const toneClass = tone === 'positive'
        ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
        : tone === 'negative'
            ? 'border-rose-100 bg-rose-50 text-rose-700'
            : 'border-slate-100 bg-slate-50 text-slate-700';

    return (
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="text-xs font-black uppercase tracking-[0.24em] text-gray-400">{title}</p>
                    <h3 className="mt-3 text-3xl font-black tracking-tight text-gray-950">{value}</h3>
                </div>
                <div className={`rounded-2xl border px-3 py-3 ${toneClass}`}>
                    <Icon className="h-5 w-5" />
                </div>
            </div>
            <p className="mt-4 text-sm font-medium text-gray-500">{helper}</p>
        </div>
    );
}

function CashFlowChart({ points }: { points: FinancialTrendPoint[] }) {
    if (points.length === 0 || !points.some((point) => point.cash_inflow !== 0 || point.cash_outflow !== 0)) {
        return (
            <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 px-5 py-12 text-center">
                <p className="text-sm font-bold uppercase tracking-[0.2em] text-slate-300">No accounting movement</p>
                <p className="mt-2 text-sm text-slate-400">No posted cash inflow or outflow exists for the selected period.</p>
            </div>
        );
    }

    const peak = Math.max(...points.flatMap((point) => [point.cash_inflow, point.cash_outflow]), 1);

    return (
        <div>
            <div className="flex items-center gap-4 text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />Inflow</span>
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-rose-400" />Outflow</span>
            </div>
            <div className="mt-6 flex h-56 items-end gap-2 overflow-x-auto pb-2">
                {points.map((point, index) => (
                    <div key={point.date} className="flex min-w-8 flex-1 flex-col items-center justify-end gap-2">
                        <div className="flex h-44 items-end gap-1">
                            <div
                                aria-label={`Cash inflow ${point.date}`}
                                className="w-3 rounded-t-full bg-emerald-400 transition-all"
                                style={{ height: `${Math.max((point.cash_inflow / peak) * 100, point.cash_inflow > 0 ? 6 : 0)}%` }}
                            />
                            <div
                                aria-label={`Cash outflow ${point.date}`}
                                className="w-3 rounded-t-full bg-rose-400 transition-all"
                                style={{ height: `${Math.max((point.cash_outflow / peak) * 100, point.cash_outflow > 0 ? 6 : 0)}%` }}
                            />
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                            {index === 0 || index === points.length - 1 || point.cash_inflow !== 0 || point.cash_outflow !== 0
                                ? new Date(point.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                                : '·'}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ComparisonMetricCard({
    title,
    value,
    helper,
    tone,
}: {
    title: string;
    value: string;
    helper: string;
    tone: 'positive' | 'negative' | 'neutral';
}) {
    const toneClass = tone === 'positive'
        ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
        : tone === 'negative'
            ? 'border-rose-100 bg-rose-50 text-rose-700'
            : 'border-slate-100 bg-slate-50 text-slate-700';

    return (
        <div className={`rounded-2xl border p-4 ${toneClass}`}>
            <p className="text-xs font-black uppercase tracking-[0.24em]">{title}</p>
            <p className="mt-3 text-3xl font-black tracking-tight">{value}</p>
            <p className="mt-3 text-sm font-medium text-current/80">{helper}</p>
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

function formatOptionalCurrency(value: number | null) {
    if (value === null) {
        return 'Not configured';
    }

    return formatCurrency(value);
}

function StatCard({ title, value, trend, isPositive }: { title: string, value: string, trend: string, isPositive: boolean }) {
    return (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 transition-all hover:shadow-md hover:-translate-y-1">
            <p className="text-gray-500 font-semibold text-xs uppercase tracking-widest mb-1">{title}</p>
            <h3 className="text-3xl font-bold tracking-tight mb-4">{value}</h3>
            <div className={`flex items-center space-x-1 text-xs font-bold ${isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                <span className="uppercase tracking-tight">{trend}</span>
            </div>
        </div>
    );
}

function ActivityItem({ title, description, time }: { title: string, description: string, time: string }) {
    return (
        <div className="px-6 py-4 flex items-start space-x-4 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0 cursor-pointer group">
            <div className="mt-1 h-3 w-3 rounded-full flex-shrink-0 animate-pulse bg-blue-400" />
            <div className="flex-1">
                <p className="text-sm font-bold text-gray-900 tracking-tight">{title}</p>
                <p className="text-xs text-gray-500 font-medium mt-0.5">{description}</p>
            </div>
            <div className="flex items-center space-x-1 text-[10px] font-bold text-gray-400 uppercase tracking-tighter self-center whitespace-nowrap group-hover:text-gray-600 transition-colors">
                <Clock className="w-3 h-3" />
                <span>{time}</span>
            </div>
        </div>
    );
}

function ProductRow({ name, price, sales, salesLabel = 'Sales' }: { name: string, price: string, sales: string, salesLabel?: string }) {
    return (
        <div className="flex items-center justify-between group cursor-pointer hover:bg-gray-50 p-2 -mx-2 rounded-xl transition-colors">
            <div className="flex items-center space-x-4">
                <div className="w-10 h-10 bg-gray-100 rounded-lg group-hover:scale-110 transition-transform" />
                <div>
                    <p className="text-sm font-bold text-gray-900 tracking-tight">{name}</p>
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-tight">{price}</p>
                </div>
            </div>
            <div className="text-right">
                <p className="text-sm font-bold tracking-tight">{sales}</p>
                <p className="text-[10px] text-gray-400 uppercase font-black tracking-widest">{salesLabel}</p>
            </div>
        </div>
    );
}

