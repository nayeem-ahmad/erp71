import type { KpiExpenseClass, KpiId, KpiNote, KpiResult } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { resolveDateWindow } from '../common/dashboard-window';
import type { DateRange } from '../common/period.util';
import { acquisitionCost, ebitda, employeeTurnover, ltvToCac } from './kpi-math';

/** Runway divides cash by the average burn over this many trailing days. */
export const RUNWAY_TRAILING_DAYS = 90;

/** Employee statuses that mean the person has left. */
const EXIT_STATUSES: readonly string[] = ['RESIGNED', 'TERMINATED', 'CONTRACT_ENDED', 'INACTIVE'];

/** A computed KPI: `ok` when it has a value, `no_data` when the period had nothing to divide by. */
export function result(
    id: KpiId,
    value: number | null,
    previous: number | null,
    basis: Record<string, number | null>,
    notes: KpiNote[] = [],
): KpiResult {
    return { id, status: value === null ? 'no_data' : 'ok', value, previous, basis, notes };
}

/** Runway has a word for "no burn", so a missing figure there is still a result. */
export function runwayResult(runway: { months: number | null; monthlyBurn: number; cashPositive: boolean; cashOnHand: number }): KpiResult {
    // No cash recorded and none moving: the books have no cash accounts in
    // use, which is not the same as being cash-positive.
    const empty = runway.cashOnHand === 0 && runway.monthlyBurn === 0;
    return {
        id: 'cash_runway',
        status: empty ? 'no_data' : 'ok',
        value: runway.months,
        previous: null,
        basis: { cashOnHand: runway.cashOnHand, monthlyBurn: runway.monthlyBurn },
        notes: ['ledger_based', 'trailing_three_months', ...(runway.cashPositive && !empty ? ['cash_positive' as const] : [])],
    };
}

/**
 * Staff turnover for each range, from one read of the workspace's employees.
 * Shared by the shop scorecard and the platform's (whose staff are the
 * platform workspace's employees).
 */
export async function loadStaffTurnover(
    db: DatabaseService,
    scope: { tenantId: string; storeId?: string },
    ranges: DateRange[],
    timezone: string,
) {
    const employees = await db.employee.findMany({
        where: {
            tenant_id: scope.tenantId,
            deleted_at: null,
            ...(scope.storeId ? { store_id: scope.storeId } : {}),
        },
        select: { date_of_joining: true, created_at: true, status: true, last_working_day: true, updated_at: true },
    });
    const staff = employees.map((e) => ({
        joined: e.date_of_joining ?? e.created_at,
        // Someone marked as gone without a last working day left when the
        // record last changed, the closest thing to an exit date it holds.
        left: e.last_working_day ?? (EXIT_STATUSES.includes(e.status) ? e.updated_at : null),
    }));
    return ranges.map((range) => {
        const window = resolveDateWindow(range, timezone);
        return employeeTurnover(staff, window.fromDate, window.toDate);
    });
}

/** What `AccountingService.getKpiLedgerBreakdown` returns, as far as the KPIs read it. */
export interface KpiLedgerBreakdown {
    revenue: number;
    net_profit: number;
    by_class: Record<KpiExpenseClass, number>;
    accounts_by_class: Record<KpiExpenseClass, number>;
}

type Pair<T> = [current: T, previous: T];

/** EBITDA for the period and the one before, from the ledger breakdown. */
export function ebitdaResult(ledger: Pair<KpiLedgerBreakdown>): KpiResult {
    const [current, previous] = ledger;
    const of = (b: KpiLedgerBreakdown) => ebitda(b.net_profit, b.by_class);
    return result('ebitda', of(current), of(previous), {
        netProfit: current.net_profit,
        interest: current.by_class.interest,
        tax: current.by_class.tax,
        depreciation: current.by_class.depreciation,
        amortization: current.by_class.amortization,
    }, ['ledger_based', 'classified_accounts']);
}

/**
 * CAC and LTV:CAC. Spend is the sales & marketing class from the ledger; the
 * caller says who counts as a new customer (a shop's first-time buyer, the
 * platform's newly paying workspace) and what a customer is worth.
 */
export function acquisitionKpis(input: {
    ledger: Pair<KpiLedgerBreakdown>;
    newCustomers: { current: number; previous: number | null };
    ltv: number | null;
    customerNotes: KpiNote[];
}): Record<'customer_acquisition_cost' | 'ltv_to_cac', KpiResult> {
    const [current, previous] = input.ledger;
    const notes: KpiNote[] = ['ledger_based', 'classified_accounts', ...input.customerNotes];
    if (current.accounts_by_class.sales_marketing === 0) {
        const none = (id: KpiId): KpiResult => ({
            id, status: 'no_data', value: null, previous: null, basis: {}, notes: [...notes, 'no_marketing_accounts'],
        });
        return { customer_acquisition_cost: none('customer_acquisition_cost'), ltv_to_cac: none('ltv_to_cac') };
    }
    const spend = current.by_class.sales_marketing;
    const cac = acquisitionCost(spend, input.newCustomers.current);
    const previousCac = input.newCustomers.previous === null
        ? null
        : acquisitionCost(previous.by_class.sales_marketing, input.newCustomers.previous);
    return {
        customer_acquisition_cost: result('customer_acquisition_cost', cac, previousCac, {
            salesMarketingSpend: spend,
            newCustomers: input.newCustomers.current,
        }, notes),
        ltv_to_cac: result('ltv_to_cac', ltvToCac(input.ltv, cac), null, {
            ltv: input.ltv,
            cac,
        }, notes),
    };
}

/** Below this many answers the score swings on a single customer; the tile says so. */
export const NPS_SMALL_SAMPLE = 10;

/** The NPS tile from this period's and last period's answers. */
export function npsResult(
    current: { score: number | null; responses: number; promoters: number; passives: number; detractors: number },
    previous: { score: number | null },
    sourceNote: KpiNote,
): KpiResult {
    return result('net_promoter_score', current.score, previous.score, {
        responses: current.responses,
        promoters: current.promoters,
        passives: current.passives,
        detractors: current.detractors,
    }, [sourceNote, ...(current.responses > 0 && current.responses < NPS_SMALL_SAMPLE ? ['small_sample' as const] : [])]);
}
