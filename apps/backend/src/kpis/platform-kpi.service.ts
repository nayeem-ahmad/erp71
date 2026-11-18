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
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { PlatformWorkspaceService } from '../platform-workspace/platform-workspace.service';
import { addDays, resolveComparisonRange, type DateRange } from '../common/period.util';
import { resolveDateWindow } from '../common/dashboard-window';
import { DEFAULT_TENANT_TIMEZONE } from '../common/tenant-time.util';
import { average, cashRunway, daysBetween, growthPct, monthsIn, ratioPct, round1, subscriptionLifetimeValue } from './kpi-math';
import { MrrSnapshotService } from './mrr/mrr-snapshot.service';
import { mrrMovements, type MrrMovements } from './mrr/mrr.util';
import {
    acquisitionKpis,
    ebitdaResult,
    loadStaffTurnover,
    result,
    runwayResult,
    RUNWAY_TRAILING_DAYS,
    type KpiLedgerBreakdown,
} from './kpi-results';

/** A customer workspace: not deleted, and not the platform's own. */
const LIVE_TENANT = { deleted_at: null, platform_workspace_key: null } as const;

/**
 * The KPI scorecard for ERP71 itself.
 *
 * The money KPIs read the platform's own books (`platform-accounting`), kept
 * in the platform workspace like any tenant's ledger, so they go through the
 * same `AccountingService` code. Sales cycle reads tenant signups and
 * activations; staff turnover reads the platform workspace's HR records.
 *
 * The subscription KPIs (churn, retention, ARPA, burn multiple, quick ratio)
 * read the MRR history (`TenantMrrSnapshot`, see `mrr/`): each tenant's MRR on
 * the day before the period and on its last day, classified into new,
 * expansion, contraction, churn and reactivation.
 */
@Injectable()
export class PlatformKpiService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accounting: AccountingService,
        private readonly platformSettings: PlatformSettingsService,
        private readonly workspace: PlatformWorkspaceService,
        private readonly mrr: MrrSnapshotService,
    ) {}

    async getScorecard(query: { from?: string; to?: string }): Promise<KpiScorecard> {
        const timezone = DEFAULT_TENANT_TIMEZONE;
        const window = resolveDateWindow(query, timezone);
        const period: DateRange = { from: window.from, to: window.to };
        const previousPeriod = resolveComparisonRange(period, 'previous_period') as DateRange;

        const workspace = await this.workspace.find();
        const booksOn = workspace !== null && (await this.platformSettings.isFeatureEnabled('platformAccounting'));

        const [books, salesCycle, turnover, subscriptions] = await Promise.all([
            booksOn ? this.bookFigures(workspace.id, period, previousPeriod) : Promise.resolve(null),
            this.salesCycle(period, previousPeriod, timezone),
            workspace
                ? loadStaffTurnover(this.db, { tenantId: workspace.id }, [period, previousPeriod], timezone)
                : Promise.resolve(null),
            this.subscriptionFigures(period, previousPeriod),
        ]);

        const computed: Partial<Record<KpiId, KpiResult>> = {
            sales_cycle_length: result('sales_cycle_length', salesCycle.current.days, salesCycle.previous.days, {
                activatedTenants: salesCycle.current.count,
            }, ['signup_to_activation']),
            employee_turnover: turnover
                ? result('employee_turnover', turnover[0].rate, turnover[1].rate, {
                    departures: turnover[0].departures,
                    averageHeadcount: turnover[0].averageHeadcount,
                }, ['platform_workspace_staff'])
                : noBooks('employee_turnover'),
        };

        if (books) {
            Object.assign(computed, {
                revenue_growth: result('revenue_growth', growthPct(books.ratios.current.revenue, books.ratios.previous.revenue), null, {
                    revenue: books.ratios.current.revenue,
                    previousRevenue: books.ratios.previous.revenue,
                }, ['ledger_based']),
                net_profit_margin: result('net_profit_margin', books.ratios.current.net_profit_margin_pct, books.ratios.previous.net_profit_margin_pct, {
                    netProfit: books.ratios.current.net_profit,
                    revenue: books.ratios.current.revenue,
                }, ['ledger_based']),
                operating_cash_flow: result('operating_cash_flow', books.cash.current.operating, books.cash.previous.operating, {
                    investing: books.cash.current.investing,
                    financing: books.cash.current.financing,
                    netChange: books.cash.current.net,
                }, ['ledger_based']),
                cash_runway: runwayResult(books.cash.runway),
                days_sales_outstanding: result('days_sales_outstanding', books.ratios.current.dso_days, books.ratios.previous.dso_days, {
                    creditSales: books.ratios.current.credit_sales,
                    periodDays: books.ratios.current.period_days,
                }, ['ledger_based']),
            } satisfies Partial<Record<KpiId, KpiResult>>);
        } else {
            for (const id of ['revenue_growth', 'net_profit_margin', 'operating_cash_flow', 'cash_runway', 'days_sales_outstanding'] as const) {
                computed[id] = noBooks(id);
            }
        }

        Object.assign(computed, subscriptionKpis(subscriptions, books?.cash ?? null));
        if (books) {
            Object.assign(computed, unitEconomicsKpis(books.ledger, subscriptions, period));
        } else {
            for (const id of ['gross_margin', 'customer_acquisition_cost', 'customer_lifetime_value', 'ltv_to_cac', 'ebitda'] as const) {
                computed[id] = noBooks(id);
            }
        }

        return {
            audience: KpiAudience.PLATFORM,
            period,
            previousPeriod,
            storeId: null,
            kpis: KPI_DEFINITIONS.map((definition) =>
                computed[definition.id] ?? unavailableKpiResult(definition.id, KpiAudience.PLATFORM)),
            unpostedVouchers: books?.pending ?? 0,
            generatedAt: new Date().toISOString(),
        };
    }

    /**
     * MRR movements for the period and the one before it, from three days of
     * MRR: the day before the previous period, the day before this one, and
     * the last day of this one. Null for a period the history does not reach.
     */
    private async subscriptionFigures(period: DateRange, previous: DateRange): Promise<SubscriptionFigures> {
        const beforePrevious = addDays(previous.from, -1);
        const beforeCurrent = addDays(period.from, -1);
        const [a, b, c, paidByA, paidByB] = await Promise.all([
            this.mrr.mrrOn(beforePrevious),
            this.mrr.mrrOn(beforeCurrent),
            this.mrr.mrrOn(period.to),
            this.mrr.paidOnOrBefore(beforePrevious),
            this.mrr.paidOnOrBefore(beforeCurrent),
        ]);
        return {
            current: b.covered && c.covered ? mrrMovements(b.byTenant, c.byTenant, paidByB) : null,
            previous: a.covered && b.covered ? mrrMovements(a.byTenant, b.byTenant, paidByA) : null,
        };
    }

    private async bookFigures(booksTenantId: string, period: DateRange, previous: DateRange) {
        const trailing = { from: addDays(period.to, -(RUNWAY_TRAILING_DAYS - 1)), to: period.to };
        const ratios = (range: DateRange) => this.accounting
            .getFinancialRatios(booksTenantId, { from: range.from, to: range.to, asOfDate: range.to })
            .then((r) => r.ratios);

        const [currentRatios, previousRatios, currentCash, previousCash, recentCash, pending, ledger] = await Promise.all([
            ratios(period),
            ratios(previous),
            this.accounting.getCashMovements(booksTenantId, period),
            this.accounting.getCashMovements(booksTenantId, previous),
            this.accounting.getCashMovements(booksTenantId, trailing),
            this.accounting.getPendingVoucherCount(booksTenantId),
            Promise.all([
                this.accounting.getKpiLedgerBreakdown(booksTenantId, period),
                this.accounting.getKpiLedgerBreakdown(booksTenantId, previous),
            ]),
        ]);

        return {
            ratios: { current: currentRatios, previous: previousRatios },
            cash: {
                current: currentCash,
                previous: previousCash,
                runway: {
                    ...cashRunway(recentCash.closing_cash_balance, recentCash.net, monthsIn(trailing)),
                    cashOnHand: recentCash.closing_cash_balance,
                },
            },
            pending: pending.count,
            ledger,
        };
    }

    /** Average days from a workspace signing up to its first paid activation, for activations in the window. */
    private async salesCycle(period: DateRange, previous: DateRange, timezone: string) {
        const read = async (range: DateRange) => {
            const window = resolveDateWindow(range, timezone);
            const subscriptions = await this.db.tenantSubscription.findMany({
                where: {
                    tenant: LIVE_TENANT,
                    activated_at: { gte: window.fromDate, lte: window.toDate },
                },
                select: { activated_at: true, tenant: { select: { created_at: true } } },
            });
            const spans = subscriptions
                .filter((s) => s.activated_at)
                .map((s) => Math.max(0, daysBetween(s.tenant.created_at, s.activated_at as Date)));
            return { days: average(spans), count: spans.length };
        };
        const [current, before] = await Promise.all([read(period), read(previous)]);
        return { current, previous: before };
    }

}

interface SubscriptionFigures {
    current: MrrMovements | null;
    previous: MrrMovements | null;
}

type CashFigures = { current: { net: number }; previous: { net: number } };

const SUBSCRIPTION_NOTES: KpiNote[] = ['subscription_mrr'];
const round2 = (value: number) => Math.round(value * 100) / 100 + 0;

/**
 * Churn, revenue retention, ARPA, quick ratio and burn multiple from the MRR
 * movements. Exported for the spec: the formulas are the infographic's, read
 * off MRR rather than off a SaaS billing system.
 */
export function subscriptionKpis(
    figures: SubscriptionFigures,
    cash: CashFigures | null,
): Partial<Record<KpiId, KpiResult>> {
    const { current, previous } = figures;
    const short = (id: KpiId): KpiResult => ({
        id, status: 'no_data', value: null, previous: null, basis: {}, notes: ['mrr_history_short'],
    });
    if (!current) {
        return Object.fromEntries(
            (['churn_rate', 'net_revenue_retention', 'avg_revenue_per_account', 'quick_ratio', 'burn_multiple'] as const)
                .map((id) => [id, short(id)]),
        );
    }

    const churn = (m: MrrMovements | null) => (m ? ratioPct(m.lostCustomers, m.startCustomers) : null);
    const retention = (m: MrrMovements | null) => (m && m.startMrr > 0
        ? round1(((m.startMrr + m.expansionMrr - m.contractionMrr - m.churnedMrr) / m.startMrr) * 100)
        : null);
    const quick = (m: MrrMovements | null) => {
        if (!m) return null;
        const lost = m.churnedMrr + m.contractionMrr;
        return lost > 0 ? round2((m.newMrr + m.expansionMrr + m.reactivationMrr) / lost) : null;
    };
    const burnMultiple = (m: MrrMovements | null, netCashChange: number | undefined) => {
        if (!m || netCashChange === undefined) return { value: null, burn: null, arr: null, notBurning: false };
        const burn = round2(-netCashChange);
        const arr = round2((m.endMrr - m.startMrr) * 12);
        if (burn <= 0) return { value: null, burn, arr, notBurning: true };
        return { value: arr > 0 ? round2(burn / arr) : null, burn, arr, notBurning: false };
    };

    const burnNow = burnMultiple(current, cash?.current.net);
    const burnBefore = burnMultiple(previous, cash?.previous.net);

    return {
        churn_rate: result('churn_rate', churn(current), churn(previous), {
            lostCustomers: current.lostCustomers,
            startingCustomers: current.startCustomers,
            churnedMrr: current.churnedMrr,
        }, SUBSCRIPTION_NOTES),
        net_revenue_retention: result('net_revenue_retention', retention(current), retention(previous), {
            startingMrr: current.startMrr,
            expansionMrr: current.expansionMrr,
            contractionMrr: current.contractionMrr,
            churnedMrr: current.churnedMrr,
        }, SUBSCRIPTION_NOTES),
        avg_revenue_per_account: result(
            'avg_revenue_per_account',
            current.endCustomers > 0 ? round2(current.endMrr / current.endCustomers) : null,
            current.startCustomers > 0 ? round2(current.startMrr / current.startCustomers) : null,
            { endingMrr: current.endMrr, payingTenants: current.endCustomers },
            SUBSCRIPTION_NOTES,
        ),
        quick_ratio: result('quick_ratio', quick(current), quick(previous), {
            newMrr: current.newMrr,
            expansionMrr: current.expansionMrr,
            reactivationMrr: current.reactivationMrr,
            churnedMrr: current.churnedMrr,
            contractionMrr: current.contractionMrr,
        }, SUBSCRIPTION_NOTES),
        burn_multiple: !cash
            ? noBooks('burn_multiple')
            : {
                id: 'burn_multiple',
                // Not burning is an answer, not a gap.
                status: burnNow.value !== null || burnNow.notBurning ? 'ok' : 'no_data',
                value: burnNow.value,
                previous: burnBefore.value,
                basis: { netBurn: burnNow.burn, netNewArr: burnNow.arr },
                notes: ['ledger_based', ...SUBSCRIPTION_NOTES, ...(burnNow.notBurning ? ['not_burning' as const] : [])],
            },
    };
}

/**
 * Gross margin, CAC, LTV, LTV:CAC and EBITDA from the platform books, with
 * customers from the MRR history. Cost of service is the `cost_of_sales`
 * class (the chart's "Infrastructure & Platform Costs" group by default),
 * acquisition spend the `sales_marketing` class (its "Sales & Marketing"
 * subgroup), and a new customer a workspace that started paying in the period.
 */
export function unitEconomicsKpis(
    ledger: [KpiLedgerBreakdown, KpiLedgerBreakdown],
    figures: SubscriptionFigures,
    period: DateRange,
): Partial<Record<KpiId, KpiResult>> {
    const margin = (b: KpiLedgerBreakdown) => (b.revenue > 0
        ? round1(((b.revenue - b.by_class.cost_of_sales) / b.revenue) * 100)
        : null);
    const [current] = ledger;
    const grossMargin = margin(current);
    const movements = figures.current;

    let ltv: KpiResult;
    if (!movements) {
        ltv = { id: 'customer_lifetime_value', status: 'no_data', value: null, previous: null, basis: {}, notes: ['mrr_history_short'] };
    } else if (grossMargin === null || movements.endCustomers === 0) {
        ltv = result('customer_lifetime_value', null, null, {}, ['subscription_mrr', 'ledger_based', 'classified_accounts']);
    } else {
        const arpa = movements.endMrr / movements.endCustomers;
        const lifetime = subscriptionLifetimeValue({
            arpa,
            grossMarginPct: grossMargin,
            churnRatePct: ratioPct(movements.lostCustomers, movements.startCustomers) ?? 0,
            periodMonths: monthsIn(period),
        });
        ltv = result('customer_lifetime_value', lifetime.value, null, {
            arpa: round2(arpa),
            grossMarginPct: grossMargin,
            lifespanMonths: lifetime.lifespanMonths,
        }, ['subscription_mrr', 'ledger_based', 'classified_accounts', ...(lifetime.capped ? ['lifespan_capped' as const] : [])]);
    }

    const acquisition = movements
        ? acquisitionKpis({
            ledger,
            newCustomers: { current: movements.newCustomers, previous: figures.previous?.newCustomers ?? null },
            ltv: ltv.value,
            customerNotes: ['subscription_mrr'],
        })
        : {
            customer_acquisition_cost: { id: 'customer_acquisition_cost' as const, status: 'no_data' as const, value: null, previous: null, basis: {}, notes: ['mrr_history_short' as const] },
            ltv_to_cac: { id: 'ltv_to_cac' as const, status: 'no_data' as const, value: null, previous: null, basis: {}, notes: ['mrr_history_short' as const] },
        };

    return {
        gross_margin: result('gross_margin', grossMargin, margin(ledger[1]), {
            revenue: current.revenue,
            costOfSales: current.by_class.cost_of_sales,
        }, ['ledger_based', 'classified_accounts']),
        customer_lifetime_value: ltv,
        ...acquisition,
        ebitda: ebitdaResult(ledger),
    };
}

function noBooks(id: KpiId): KpiResult {
    const notes: KpiNote[] = ['books_unavailable'];
    return { id, status: 'no_data', value: null, previous: null, basis: {}, notes };
}
