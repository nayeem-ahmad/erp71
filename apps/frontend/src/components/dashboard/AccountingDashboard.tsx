'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { previousWindow, rangeToWindow } from '@/lib/dashboard-range';
import { periodDelta } from '@/lib/dashboard-delta';
import { routes } from '@/lib/routes';
import FrequentQuickLinks from '@/components/dashboard/FrequentQuickLinks';
import { DashboardHeader, type DashboardRange } from '@/components/dashboard/DashboardHeader';
import { HealthKpiTile } from '@/components/dashboard/HealthKpiTile';
import { AttentionStrip, type AttentionItem } from '@/components/dashboard/AttentionStrip';
import { AgingPanel, type AgingRow } from '@/components/dashboard/AgingPanel';
import { SalesByCategoryDonut, type CategoryRow } from '@/components/dashboard/SalesByCategoryDonut';
import { CashFlowChart } from '@/components/dashboard/CashFlowChart';
import { RankedListPanel, type RankedItem } from '@/components/dashboard/RankedListPanel';
import PageShell from '@/components/ui/compact/PageShell';
import type { DashboardIdentity } from './dashboard-identity';

type Buckets = {
    current: number;
    overdue_31_60: number;
    overdue_61_90: number;
    overdue_90_plus: number;
};

type OverviewResponse = {
    filters: { from: string; to: string };
    as_of: string;
    position: {
        cash_and_bank: number;
        accounts_receivable: number | null;
        accounts_payable: number | null;
        total_assets: number;
        total_liabilities: number;
        net_worth: number;
    };
    performance: {
        revenue: number;
        expenses: number;
        net_profit: number;
        net_margin_pct: number | null;
    };
    aging: {
        receivable: Buckets | null;
        payable: Buckets | null;
        note: string;
    };
    books_health: {
        trial_balance: { debit: number; credit: number; difference: number; is_balanced: boolean };
        pending_vouchers: number;
        voucher_approval_enabled: boolean;
        failed_postings: number;
        recurring_due: number;
        unlocked_closed_periods: number;
    };
    expense_mix: Array<{ id: string; name: string; code: string | null; amount: number }>;
    expense_mix_other: number;
    recent_vouchers: Array<{
        id: string;
        voucher_number: string;
        voucher_type: string;
        date: string;
        description: string | null;
        approval_status: string;
        amount: number;
    }>;
};

type TrendPoint = {
    date: string;
    cash_inflow: number;
    cash_outflow: number;
    net_cash_movement: number;
    gross_revenue: number;
    operating_expense: number;
    net_profit: number;
};

type TrendResponse = { points: TrendPoint[] };

export default function AccountingDashboard({ greeting, tenantName, renewalEnd }: DashboardIdentity) {
    const { t, locale } = useI18n();
    const copy = t.dashboardHome;
    const acc = copy.accounting;

    const [range, setRange] = useState<DashboardRange>('month');
    const [overview, setOverview] = useState<OverviewResponse | null>(null);
    const [previousOverview, setPreviousOverview] = useState<OverviewResponse | null>(null);
    const [trends, setTrends] = useState<TrendPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setLoading(true);
            setError('');

            const win = rangeToWindow(range);
            const prevWin = previousWindow(win);

            const [overviewRes, prevRes, trendRes] = await Promise.allSettled([
                api.getAccountingDashboardOverview(win),
                api.getAccountingDashboardOverview(prevWin),
                api.getFinancialTrends(win),
            ]);

            if (cancelled) return;

            if (overviewRes.status === 'fulfilled') {
                setOverview(overviewRes.value);
            } else {
                setOverview(null);
                setError(overviewRes.reason instanceof Error ? overviewRes.reason.message : acc.overviewUnavailable);
            }

            // The comparison window only feeds the deltas; losing it costs a "—",
            // not the dashboard.
            setPreviousOverview(prevRes.status === 'fulfilled' ? prevRes.value : null);
            setTrends(trendRes.status === 'fulfilled' ? ((trendRes.value as TrendResponse)?.points ?? []) : []);
            setLoading(false);
        };

        void load();

        return () => {
            cancelled = true;
        };
    }, [range, acc.overviewUnavailable]);

    const money = (value: number) => formatBDT(value, { locale });
    const position = overview?.position;
    const performance = overview?.performance;
    const health = overview?.books_health;

    const deltaContext = range === 'today'
        ? copy.vsPreviousToday
        : range === 'week' ? copy.vsPreviousWeek : copy.vsPreviousMonth;

    const compare = (current: number | null | undefined, previous: number | null | undefined) =>
        current == null || previous == null ? { label: '—', positive: true } : periodDelta(current, previous);

    // Balances, not flows — no sparkline and no period delta, because comparing a
    // closing balance against a prior window reads as a trend it is not.
    const positionTiles = [
        {
            key: 'cash',
            title: acc.kpiCashAndBank,
            value: money(position?.cash_and_bank ?? 0),
            note: undefined as string | undefined,
        },
        {
            key: 'receivable',
            title: acc.kpiReceivable,
            value: position?.accounts_receivable == null
                ? acc.noAccountConfigured
                : money(position.accounts_receivable),
            note: overview?.aging.receivable && overview.aging.receivable.overdue_90_plus > 0
                ? formatMessage(acc.overdueOver90, { amount: money(overview.aging.receivable.overdue_90_plus) })
                : undefined,
        },
        {
            key: 'payable',
            title: acc.kpiPayable,
            value: position?.accounts_payable == null
                ? acc.noAccountConfigured
                : money(position.accounts_payable),
            note: overview?.aging.payable && overview.aging.payable.overdue_90_plus > 0
                ? formatMessage(acc.overdueOver90, { amount: money(overview.aging.payable.overdue_90_plus) })
                : undefined,
        },
        {
            key: 'net-worth',
            title: acc.kpiNetWorth,
            value: money(position?.net_worth ?? 0),
            note: acc.assetsMinusLiabilities,
        },
    ];

    const revenueSeries = trends.map((point) => point.gross_revenue);
    const expenseSeries = trends.map((point) => point.operating_expense);
    const profitSeries = trends.map((point) => point.net_profit);
    const prev = previousOverview?.performance ?? null;

    const performanceTiles = [
        {
            key: 'revenue',
            title: acc.kpiRevenue,
            value: money(performance?.revenue ?? 0),
            series: revenueSeries,
            delta: compare(performance?.revenue, prev?.revenue),
        },
        {
            key: 'expenses',
            title: acc.kpiExpenses,
            value: money(performance?.expenses ?? 0),
            series: expenseSeries,
            // Spending more is not an improvement, so the delta's sign is inverted
            // against every other tile on the row.
            delta: (() => {
                const raw = compare(performance?.expenses, prev?.expenses);
                return raw.label === '—' ? raw : { label: raw.label, positive: !raw.positive };
            })(),
        },
        {
            key: 'net-profit',
            title: acc.kpiNetProfit,
            value: money(performance?.net_profit ?? 0),
            series: profitSeries,
            delta: compare(performance?.net_profit, prev?.net_profit),
        },
        {
            key: 'net-margin',
            title: acc.kpiNetMargin,
            value: performance?.net_margin_pct == null
                ? '—'
                : `${performance.net_margin_pct.toFixed(1)}%`,
            series: [] as number[],
            delta: compare(performance?.net_margin_pct, prev?.net_margin_pct),
        },
    ];

    const attentionItems: AttentionItem[] = [];
    if (health && !health.trial_balance.is_balanced) {
        attentionItems.push({
            id: 'trial-balance',
            tone: 'red',
            value: money(health.trial_balance.difference),
            label: formatMessage(acc.healthTrialBalanceOff, { amount: money(health.trial_balance.difference) }),
            href: routes.accounting.reports.trialBalance,
            cta: copy.viewAll,
        });
    }
    if (health && health.pending_vouchers > 0) {
        attentionItems.push({
            id: 'pending-vouchers',
            tone: 'amber',
            value: String(health.pending_vouchers),
            label: formatMessage(acc.healthPendingVouchers, { count: health.pending_vouchers }),
            href: routes.accounting.approvalQueue,
            cta: copy.viewAll,
        });
    }
    if (health && health.failed_postings > 0) {
        attentionItems.push({
            id: 'failed-postings',
            tone: 'red',
            value: String(health.failed_postings),
            label: formatMessage(acc.healthFailedPostings, { count: health.failed_postings }),
            href: routes.accounting.reconciliation,
            cta: copy.viewAll,
        });
    }
    if (health && health.recurring_due > 0) {
        attentionItems.push({
            id: 'recurring-due',
            tone: 'blue',
            value: String(health.recurring_due),
            label: formatMessage(acc.healthRecurringDue, { count: health.recurring_due }),
            href: routes.accounting.recurringVouchers,
            cta: copy.viewAll,
        });
    }
    if (health && health.unlocked_closed_periods > 0) {
        attentionItems.push({
            id: 'unlocked-periods',
            tone: 'amber',
            value: String(health.unlocked_closed_periods),
            label: formatMessage(acc.healthUnlockedPeriods, { count: health.unlocked_closed_periods }),
            href: routes.accounting.fiscalPeriods,
            cta: copy.viewAll,
        });
    }
    // Retained from the retail dashboard: an accounting-only workspace still has a
    // subscription, and this was the one item it never used to be shown.
    const renewalDays = renewalEnd ? Math.ceil((new Date(renewalEnd).getTime() - Date.now()) / 86_400_000) : null;
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

    const expenseTotal = (overview?.expense_mix ?? []).reduce((sum, row) => sum + row.amount, 0)
        + (overview?.expense_mix_other ?? 0);
    const expenseRows: CategoryRow[] = [
        ...(overview?.expense_mix ?? []).map((row) => ({
            categoryId: row.id,
            categoryName: row.name,
            revenue: row.amount,
            share: expenseTotal > 0 ? (row.amount / expenseTotal) * 100 : 0,
        })),
        ...(overview && overview.expense_mix_other > 0
            ? [{
                categoryId: 'other',
                categoryName: copy.otherCategory,
                revenue: overview.expense_mix_other,
                share: expenseTotal > 0 ? (overview.expense_mix_other / expenseTotal) * 100 : 0,
            }]
            : []),
    ];

    const agingRows: AgingRow[] = [
        ...(overview?.aging.receivable ? [{ id: 'ar', label: acc.agingReceivable, buckets: overview.aging.receivable }] : []),
        ...(overview?.aging.payable ? [{ id: 'ap', label: acc.agingPayable, buckets: overview.aging.payable }] : []),
    ];

    const topExpenses: RankedItem[] = (overview?.expense_mix ?? []).slice(0, 4).map((row) => ({
        id: row.id,
        name: row.name,
        meta: row.code ?? '',
        amount: money(row.amount),
    }));

    return (
        <PageShell maxWidth="full">
            <div className="space-y-4">
                <DashboardHeader
                    greeting={greeting}
                    tenantName={tenantName}
                    subtitle={acc.subtitle}
                    range={range}
                    onRangeChange={setRange}
                    labels={{ today: copy.rangeToday, week: copy.rangeWeek, month: copy.rangeMonth }}
                />

                <FrequentQuickLinks accountingOnlyMode />

                {error ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                        {error}
                    </div>
                ) : null}

                <section>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">{acc.sectionPosition}</p>
                    {loading ? (
                        <TileSkeletons />
                    ) : (
                        <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
                            {positionTiles.map((tile) => (
                                <HealthKpiTile
                                    key={tile.key}
                                    title={tile.title}
                                    value={tile.value}
                                    delta="—"
                                    deltaPositive
                                    points={[]}
                                    note={tile.note}
                                />
                            ))}
                        </div>
                    )}
                </section>

                <section>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">{acc.sectionPerformance}</p>
                    {loading ? (
                        <TileSkeletons />
                    ) : (
                        <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
                            {performanceTiles.map((tile) => (
                                <HealthKpiTile
                                    key={tile.key}
                                    title={tile.title}
                                    value={tile.value}
                                    delta={tile.delta.label}
                                    deltaPositive={tile.delta.positive}
                                    deltaContext={tile.delta.label === '—' ? undefined : deltaContext}
                                    points={tile.series}
                                />
                            ))}
                        </div>
                    )}
                </section>

                <section>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">{acc.sectionBooks}</p>
                    {loading ? (
                        <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
                            {Array.from({ length: 4 }).map((_, index) => (
                                <div key={index} className="h-16 animate-pulse rounded-xl border border-gray-100 bg-white p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                                    <div className="h-5 w-12 rounded bg-gray-200" />
                                    <div className="mt-2 h-3 w-20 rounded bg-gray-100" />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <AttentionStrip items={attentionItems} allClearLabel={acc.healthAllClear} />
                    )}
                </section>

                <section>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">{acc.sectionMovement}</p>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[3fr_2fr]">
                        <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                            <h3 className="mb-2 text-xs font-bold text-gray-900">{copy.cashFlowMovement}</h3>
                            {loading ? (
                                <div className="h-40 animate-pulse rounded-lg bg-gray-100" />
                            ) : (
                                <CashFlowChart
                                    points={trends}
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

                        <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                            <h3 className="mb-2 text-xs font-bold text-gray-900">{acc.expenseMix}</h3>
                            {loading ? (
                                <div className="h-24 animate-pulse rounded-lg bg-gray-100" />
                            ) : (
                                <SalesByCategoryDonut
                                    rows={expenseRows}
                                    totalLabel={formatBDT(expenseTotal, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                    totalTitle={money(expenseTotal)}
                                    emptyLabel={acc.expenseMixEmpty}
                                    ariaLabel={`${acc.expenseMix} — ${money(expenseTotal)}`}
                                />
                            )}
                        </div>
                    </div>
                </section>

                <section>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">{acc.sectionLedger}</p>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                        <AgingPanel
                            title={acc.agingTitle}
                            rows={agingRows}
                            columnLabels={{
                                current: acc.agingCurrent,
                                d3160: acc.aging3160,
                                d6190: acc.aging6190,
                                d90plus: acc.aging90Plus,
                            }}
                            formatAmount={money}
                            emptyLabel={acc.agingEmpty}
                        />
                        <RankedListPanel title={acc.topExpenses} items={topExpenses} emptyLabel={acc.expenseMixEmpty} />
                        <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                            <h3 className="mb-2 text-xs font-bold text-gray-900">{acc.recentVouchers}</h3>
                            {(overview?.recent_vouchers ?? []).length === 0 ? (
                                <p className="py-4 text-center text-[11px] text-gray-400">{acc.noVouchers}</p>
                            ) : (
                                <ul>
                                    {overview!.recent_vouchers.map((voucher) => (
                                        <li key={voucher.id} className="border-b border-gray-50 py-1.5 last:border-0">
                                            <Link
                                                href={routes.accounting.voucherDetail(voucher.id)}
                                                className="flex items-center gap-2 text-[11px]"
                                            >
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate font-semibold text-gray-900">
                                                        {voucher.voucher_number}
                                                    </span>
                                                    <span className="block truncate text-[10px] text-gray-500">
                                                        {new Date(voucher.date).toLocaleDateString(locale)}
                                                        {voucher.description ? ` · ${voucher.description}` : ''}
                                                    </span>
                                                </span>
                                                {voucher.approval_status === 'PENDING' ? (
                                                    <span className="shrink-0 rounded-full bg-warning-light px-1.5 py-0.5 text-[10px] font-bold text-warning-text">
                                                        {acc.voucherPending}
                                                    </span>
                                                ) : voucher.approval_status === 'REJECTED' ? (
                                                    <span className="shrink-0 rounded-full bg-danger-light px-1.5 py-0.5 text-[10px] font-bold text-danger-text">
                                                        {acc.voucherRejected}
                                                    </span>
                                                ) : null}
                                                <span className="shrink-0 font-bold tabular-nums text-gray-900">
                                                    {money(voucher.amount)}
                                                </span>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </section>
            </div>
        </PageShell>
    );
}

function TileSkeletons() {
    return (
        <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="animate-pulse rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                    <div className="h-3 w-16 rounded bg-gray-200" />
                    <div className="mt-2 h-6 w-24 rounded bg-gray-200" />
                    <div className="mt-2 h-3 w-12 rounded bg-gray-200" />
                    <div className="mt-3 h-5 w-full rounded bg-gray-100" />
                </div>
            ))}
        </div>
    );
}
