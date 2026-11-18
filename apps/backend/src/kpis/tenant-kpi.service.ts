import { Injectable } from '@nestjs/common';
import {
    KPI_DEFINITIONS,
    KpiAudience,
    unavailableKpiResult,
    type KpiId,
    type KpiNote,
    type KpiResult,
    type KpiScorecard,
} from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { AccountingService } from '../accounting/accounting.service';
import { addDays, resolveComparisonRange, type DateRange } from '../common/period.util';
import { resolveDateWindow } from '../common/dashboard-window';
import { buildSaleDateWindow, loadMarginSource } from '../sales-reports/sales-reports.service';
import { groupMargin, returnLines, saleLines, summariseMargin } from '../sales-reports/gross-profit.utils';
import { acquisitionKpis, ebitdaResult, loadStaffTurnover, result, runwayResult, RUNWAY_TRAILING_DAYS } from './kpi-results';
import {
    average,
    cashRunway,
    churnRate,
    customerLifetimeValue,
    daysBetween,
    growthPct,
    monthsIn,
    observedLifespanMonths,
    revenueRetention,
    round1,
    round2,
} from './kpi-math';

/** A named customer with no purchase for this long counts as lost. */
export const CUSTOMER_LAPSE_DAYS = 90;

const WALK_IN = '__walk_in__';

type Windowed<T> = { current: T; previous: T };

/**
 * The KPI scorecard for one shop: the CEO KPIs that mean something for a
 * retailer, computed from the tenant's own sales, books, CRM and HR records.
 *
 * Nothing here is a new source of truth. Gross margin comes from the same
 * margin lines as the sales gross-profit reports, net margin and DSO from the
 * financial-ratios report, cash from the ledger's cash and bank accounts. The
 * scorecard reads across them so an owner can see the whole business at once.
 */
@Injectable()
export class TenantKpiService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accounting: AccountingService,
    ) {}

    async getScorecard(
        tenantId: string,
        query: { from?: string; to?: string },
        storeId: string | undefined,
        timezone: string,
    ): Promise<KpiScorecard> {
        const window = resolveDateWindow(query, timezone);
        const period: DateRange = { from: window.from, to: window.to };
        const previousPeriod = resolveComparisonRange(period, 'previous_period') as DateRange;
        const scope = { tenantId, storeId };

        const [sales, ratios, cash, customers, salesCycle, turnover, pending, ledger] = await Promise.all([
            this.salesFigures(scope, period, previousPeriod),
            this.ratios(scope, period, previousPeriod),
            this.cashFigures(scope, period, previousPeriod),
            this.customerFigures(scope, period, previousPeriod),
            this.salesCycle(scope, period, previousPeriod, timezone),
            loadStaffTurnover(this.db, scope, [period, previousPeriod], timezone),
            this.accounting.getPendingVoucherCount(tenantId),
            Promise.all([
                this.accounting.getKpiLedgerBreakdown(tenantId, period, storeId),
                this.accounting.getKpiLedgerBreakdown(tenantId, previousPeriod, storeId),
            ]),
        ]);

        const ltv = customerLifetimeValue({
            grossProfit: sales.current.namedGrossProfit,
            customers: customers.activeCustomers,
            periodMonths: monthsIn(period),
            lifespanMonths: customers.lifespanMonths,
        });
        const partlyCosted: KpiNote[] = sales.current.costedRevenuePct !== null && sales.current.costedRevenuePct < 99.5
            ? ['partly_costed']
            : [];

        const computed: Partial<Record<KpiId, KpiResult>> = {
            revenue_growth: result('revenue_growth', growthPct(sales.current.netRevenue, sales.previous.netRevenue), null, {
                revenue: sales.current.netRevenue,
                previousRevenue: sales.previous.netRevenue,
            }),
            gross_margin: result('gross_margin', sales.current.grossMarginPct, sales.previous.grossMarginPct, {
                grossProfit: sales.current.grossProfit,
                costedRevenue: sales.current.costedRevenue,
                costedRevenuePct: sales.current.costedRevenuePct,
            }, partlyCosted),
            net_profit_margin: result('net_profit_margin', ratios.current.net_profit_margin_pct, ratios.previous.net_profit_margin_pct, {
                netProfit: ratios.current.net_profit,
                revenue: ratios.current.revenue,
            }, ['ledger_based']),
            operating_cash_flow: result('operating_cash_flow', cash.current.operating, cash.previous.operating, {
                investing: cash.current.investing,
                financing: cash.current.financing,
                netChange: cash.current.net,
            }, ['ledger_based']),
            cash_runway: runwayResult(cash.runway),
            customer_lifetime_value: result('customer_lifetime_value', ltv.value, null, {
                monthlyGrossProfitPerCustomer: ltv.monthlyGrossProfitPerCustomer,
                lifespanMonths: customers.lifespanMonths,
                customers: customers.activeCustomers,
            }, ['named_customers_only', ...partlyCosted]),
            net_revenue_retention: result('net_revenue_retention', customers.retention.rate, null, {
                retainedRevenue: customers.retention.retained,
                startingRevenue: customers.retention.starting,
            }, ['named_customers_only']),
            churn_rate: result('churn_rate', customers.churn.current.rate, customers.churn.previous.rate, {
                lostCustomers: customers.churn.current.lost,
                startingCustomers: customers.churn.current.base,
            }, ['named_customers_only', 'lapse_after_90_days']),
            avg_revenue_per_account: result('avg_revenue_per_account', customers.arpa.current, customers.arpa.previous, {
                namedRevenue: customers.namedRevenue,
                activeCustomers: customers.activeCustomers,
                averageBasket: sales.current.averageBasket,
            }, ['named_customers_only']),
            sales_cycle_length: result('sales_cycle_length', salesCycle.current.days, salesCycle.previous.days, {
                convertedLeads: salesCycle.current.count,
            }),
            employee_turnover: result('employee_turnover', turnover[0].rate, turnover[1].rate, {
                departures: turnover[0].departures,
                averageHeadcount: turnover[0].averageHeadcount,
            }),
            days_sales_outstanding: result('days_sales_outstanding', ratios.current.dso_days, ratios.previous.dso_days, {
                creditSales: ratios.current.credit_sales,
                periodDays: ratios.current.period_days,
            }, ['ledger_based']),
            ...acquisitionKpis({
                ledger,
                newCustomers: customers.newCustomers,
                ltv: ltv.value,
                customerNotes: ['named_customers_only'],
            }),
            ebitda: ebitdaResult(ledger),
        };

        return {
            audience: KpiAudience.TENANT,
            period,
            previousPeriod,
            storeId: storeId ?? null,
            kpis: KPI_DEFINITIONS.map((definition) =>
                computed[definition.id] ?? unavailableKpiResult(definition.id, KpiAudience.TENANT)),
            unpostedVouchers: pending.count,
            generatedAt: new Date().toISOString(),
        };
    }

    // ── Sales ────────────────────────────────────────────────────────────────

    private async salesFigures(scope: Scope, period: DateRange, previous: DateRange): Promise<Windowed<SalesFigures>> {
        const [current, before] = await Promise.all([
            this.salesFor(scope, period),
            this.salesFor(scope, previous),
        ]);
        return { current, previous: before };
    }

    private async salesFor(scope: Scope, range: DateRange): Promise<SalesFigures> {
        const source = await loadMarginSource(this.db, scope.tenantId, { ...range, storeId: scope.storeId });
        const one = () => ({ key: 'all', label: 'all' });
        const totals = summariseMargin([...saleLines(source.sales, one), ...returnLines(source.returns, one)]);
        const gross = source.rawSales.reduce((sum: number, s: any) => sum + Number(s.total_amount), 0);
        const refunds = source.rawReturns.reduce((sum: number, r: any) => sum + Number(r.total_refund), 0);
        const transactions = source.rawSales.filter((s: any) => !s.is_exchange).length;

        // Gross profit by customer, for lifetime value. A return reaches its
        // customer through the original sale, as the per-customer margin
        // report does it.
        const customerOfSale = new Map<string, string>(
            source.rawSales.map((s: any) => [s.id, s.customer_id ?? WALK_IN]),
        );
        const customerOfReturn = new Map<string, string>(
            source.rawReturns.map((r: any) => [r.id, r.sale?.customer_id ?? WALK_IN]),
        );
        const byCustomer = groupMargin([
            ...saleLines(source.sales, (_item, sale) => keyed(customerOfSale.get(sale.id))),
            ...source.returns.flatMap((ret) => returnLines([ret], () => keyed(customerOfReturn.get(ret.id)))),
        ]);
        const namedGrossProfit = byCustomer
            .filter((g) => g.key !== WALK_IN)
            .reduce((sum, g) => sum + (g.grossProfit ?? 0), 0);

        return {
            netRevenue: round2(gross - refunds),
            grossProfit: totals.grossProfit === null ? null : round2(totals.grossProfit),
            grossMarginPct: totals.grossMarginPct === null ? null : round1(totals.grossMarginPct),
            costedRevenue: round2(totals.coverage.costedRevenue),
            costedRevenuePct: totals.coverage.costedRevenuePct === null ? null : round1(totals.coverage.costedRevenuePct),
            averageBasket: transactions > 0 ? round2(gross / transactions) : null,
            namedGrossProfit: round2(namedGrossProfit),
        };
    }

    // ── Books ────────────────────────────────────────────────────────────────

    private async ratios(scope: Scope, period: DateRange, previous: DateRange) {
        const read = (range: DateRange) => this.accounting
            .getFinancialRatios(scope.tenantId, { from: range.from, to: range.to, asOfDate: range.to }, scope.storeId)
            .then((r) => r.ratios);
        const [current, before] = await Promise.all([read(period), read(previous)]);
        return { current, previous: before };
    }

    private async cashFigures(scope: Scope, period: DateRange, previous: DateRange) {
        const trailing = { from: addDays(period.to, -(RUNWAY_TRAILING_DAYS - 1)), to: period.to };
        const [current, before, recent] = await Promise.all([
            this.accounting.getCashMovements(scope.tenantId, period, scope.storeId),
            this.accounting.getCashMovements(scope.tenantId, previous, scope.storeId),
            this.accounting.getCashMovements(scope.tenantId, trailing, scope.storeId),
        ]);
        return {
            current,
            previous: before,
            runway: {
                ...cashRunway(recent.closing_cash_balance, recent.net, monthsIn(trailing)),
                cashOnHand: recent.closing_cash_balance,
            },
        };
    }

    // ── Customers ────────────────────────────────────────────────────────────

    private async customerFigures(scope: Scope, period: DateRange, previous: DateRange) {
        const named = {
            tenant_id: scope.tenantId,
            status: 'COMPLETED',
            customer_id: { not: null },
            ...(scope.storeId ? { store_id: scope.storeId } : {}),
        };
        const revenueByCustomer = (range: DateRange) => this.db.sale.groupBy({
            by: ['customer_id'],
            where: { ...named, ...buildSaleDateWindow(range.from, range.to) },
            _sum: { total_amount: true },
        });
        const buyersIn = (range: DateRange) => this.db.sale.groupBy({
            by: ['customer_id'],
            where: { ...named, ...buildSaleDateWindow(range.from, range.to) },
        });
        // A customer was active going into a period if they bought in the
        // lapse window just before it, and is lost if they have not bought in
        // the lapse window that ends with it.
        const lapseBefore = (start: string): DateRange => ({ from: addDays(start, -CUSTOMER_LAPSE_DAYS), to: addDays(start, -1) });
        const lapseEnding = (end: string): DateRange => ({ from: addDays(end, -(CUSTOMER_LAPSE_DAYS - 1)), to: end });

        const [current, before, baseNow, activeNow, basePrev, activePrev, lifetime] = await Promise.all([
            revenueByCustomer(period),
            revenueByCustomer(previous),
            buyersIn(lapseBefore(period.from)),
            buyersIn(lapseEnding(period.to)),
            buyersIn(lapseBefore(previous.from)),
            buyersIn(lapseEnding(previous.to)),
            this.db.sale.groupBy({
                by: ['customer_id'],
                where: { ...named, ...buildSaleDateWindow(undefined, period.to) },
                _min: { sale_date: true },
                _max: { sale_date: true },
            }),
        ]);

        const toMap = (rows: Array<{ customer_id: string | null; _sum: { total_amount: unknown } }>) =>
            new Map(rows.filter((r) => r.customer_id).map((r) => [r.customer_id as string, Number(r._sum.total_amount ?? 0)]));
        const toSet = (rows: Array<{ customer_id: string | null }>) =>
            new Set(rows.map((r) => r.customer_id).filter((id): id is string => Boolean(id)));

        const currentRevenue = toMap(current);
        const previousRevenue = toMap(before);
        const namedRevenue = round2([...currentRevenue.values()].reduce((s, v) => s + v, 0));
        const previousNamedRevenue = [...previousRevenue.values()].reduce((s, v) => s + v, 0);
        const lifespanMonths = observedLifespanMonths(
            lifetime
                .filter((row) => row._min.sale_date && row._max.sale_date)
                .map((row) => ({ first: row._min.sale_date as Date, last: row._max.sale_date as Date })),
        );

        // A customer is new in a window when their first purchase ever falls in it.
        const firstDays = lifetime
            .map((row) => row._min.sale_date?.toISOString().slice(0, 10))
            .filter((day): day is string => Boolean(day));
        const newIn = (range: DateRange) => firstDays.filter((day) => day >= range.from && day <= range.to).length;

        return {
            activeCustomers: currentRevenue.size,
            newCustomers: { current: newIn(period), previous: newIn(previous) },
            namedRevenue,
            lifespanMonths,
            arpa: {
                current: currentRevenue.size > 0 ? round2(namedRevenue / currentRevenue.size) : null,
                previous: previousRevenue.size > 0 ? round2(previousNamedRevenue / previousRevenue.size) : null,
            },
            retention: revenueRetention(previousRevenue, currentRevenue),
            churn: {
                current: churnRate(toSet(baseNow), toSet(activeNow)),
                previous: churnRate(toSet(basePrev), toSet(activePrev)),
            },
        };
    }

    // ── CRM and HR ───────────────────────────────────────────────────────────

    /** Average days from a lead being created to it converting, for leads converted in the window. */
    private async salesCycle(scope: Scope, period: DateRange, previous: DateRange, timezone: string) {
        const read = async (range: DateRange) => {
            const window = resolveDateWindow(range, timezone);
            const leads = await this.db.lead.findMany({
                where: {
                    tenant_id: scope.tenantId,
                    status: 'CONVERTED',
                    closed_at: { gte: window.fromDate, lte: window.toDate },
                    ...(scope.storeId ? { store_id: scope.storeId } : {}),
                },
                select: { created_at: true, closed_at: true },
            });
            const spans = leads
                .filter((lead) => lead.closed_at)
                .map((lead) => Math.max(0, daysBetween(lead.created_at, lead.closed_at as Date)));
            return { days: average(spans), count: spans.length };
        };
        const [current, before] = await Promise.all([read(period), read(previous)]);
        return { current, previous: before };
    }

}

export type Scope = { tenantId: string; storeId?: string };

interface SalesFigures {
    netRevenue: number;
    grossProfit: number | null;
    grossMarginPct: number | null;
    costedRevenue: number;
    costedRevenuePct: number | null;
    averageBasket: number | null;
    namedGrossProfit: number;
}

function keyed(customerId: string | undefined) {
    const key = customerId ?? WALK_IN;
    return { key, label: key };
}
