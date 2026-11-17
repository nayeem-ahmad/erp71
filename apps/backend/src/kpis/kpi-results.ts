import type { KpiId, KpiNote, KpiResult } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { resolveDateWindow } from '../common/dashboard-window';
import type { DateRange } from '../common/period.util';
import { employeeTurnover } from './kpi-math';

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
