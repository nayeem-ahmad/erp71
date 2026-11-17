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
import { average, cashRunway, daysBetween, growthPct, monthsIn } from './kpi-math';
import { loadStaffTurnover, result, runwayResult, RUNWAY_TRAILING_DAYS } from './kpi-results';

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
 * need a history of MRR changes the platform does not keep yet, and are
 * returned as planned.
 */
@Injectable()
export class PlatformKpiService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accounting: AccountingService,
        private readonly platformSettings: PlatformSettingsService,
        private readonly workspace: PlatformWorkspaceService,
    ) {}

    async getScorecard(query: { from?: string; to?: string }): Promise<KpiScorecard> {
        const timezone = DEFAULT_TENANT_TIMEZONE;
        const window = resolveDateWindow(query, timezone);
        const period: DateRange = { from: window.from, to: window.to };
        const previousPeriod = resolveComparisonRange(period, 'previous_period') as DateRange;

        const workspace = await this.workspace.find();
        const booksOn = workspace !== null && (await this.platformSettings.isFeatureEnabled('platformAccounting'));

        const [books, salesCycle, turnover] = await Promise.all([
            booksOn ? this.bookFigures(workspace.id, period, previousPeriod) : Promise.resolve(null),
            this.salesCycle(period, previousPeriod, timezone),
            workspace
                ? loadStaffTurnover(this.db, { tenantId: workspace.id }, [period, previousPeriod], timezone)
                : Promise.resolve(null),
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

    private async bookFigures(booksTenantId: string, period: DateRange, previous: DateRange) {
        const trailing = { from: addDays(period.to, -(RUNWAY_TRAILING_DAYS - 1)), to: period.to };
        const ratios = (range: DateRange) => this.accounting
            .getFinancialRatios(booksTenantId, { from: range.from, to: range.to, asOfDate: range.to })
            .then((r) => r.ratios);

        const [currentRatios, previousRatios, currentCash, previousCash, recentCash, pending] = await Promise.all([
            ratios(period),
            ratios(previous),
            this.accounting.getCashMovements(booksTenantId, period),
            this.accounting.getCashMovements(booksTenantId, previous),
            this.accounting.getCashMovements(booksTenantId, trailing),
            this.accounting.getPendingVoucherCount(booksTenantId),
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

function noBooks(id: KpiId): KpiResult {
    const notes: KpiNote[] = ['books_unavailable'];
    return { id, status: 'no_data', value: null, previous: null, basis: {}, notes };
}
