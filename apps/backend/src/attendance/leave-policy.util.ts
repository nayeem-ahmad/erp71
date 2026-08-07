/**
 * Leave policy arithmetic — HRIS Phase 11.
 *
 * Pure, because every rule below is a policy someone will want to argue about,
 * and an argument is much shorter when the rule is one readable function.
 */

export type AccrualMode = 'ANNUAL_GRANT' | 'MONTHLY_ACCRUAL';

export interface LeaveTypePolicy {
    days_per_year: number;
    accrual_mode: AccrualMode;
    carry_forward_max_days: number | null;
    allows_half_day: boolean;
    requires_attachment: boolean;
    approval_levels: number;
}

/**
 * How much of the year's entitlement is available by a given month.
 *
 * `ANNUAL_GRANT` gives everything on 1 January — the common small-shop
 * arrangement, and the current behaviour.
 *
 * `MONTHLY_ACCRUAL` gives a twelfth per completed month, which is what stops a
 * January joiner taking a full year's leave in February. `asOfMonth` is
 * 1-indexed and inclusive: by the end of January one month has accrued.
 */
export function accruedDays(
    policy: Pick<LeaveTypePolicy, 'days_per_year' | 'accrual_mode'>,
    asOfMonth: number,
    /** For someone who joined mid-year, the month they started. */
    joinedMonth = 1,
): number {
    if (policy.accrual_mode === 'ANNUAL_GRANT') return policy.days_per_year;

    const months = Math.max(0, Math.min(12, asOfMonth) - Math.max(1, joinedMonth) + 1);
    return round(( policy.days_per_year / 12) * months);
}

/** Leave days round to halves; nothing finer is expressible on a form. */
export function round(days: number): number {
    return Math.round(days * 2) / 2;
}

/**
 * What carries into next year.
 *
 * Capped, never unlimited: "carry everything forever" is how a tenant ends up
 * owing somebody ninety days they cannot schedule. A null cap means nothing
 * carries, which is the safe default rather than the generous one.
 */
export function carryForwardDays(
    policy: Pick<LeaveTypePolicy, 'carry_forward_max_days'>,
    totalDays: number,
    usedDays: number,
): number {
    const cap = policy.carry_forward_max_days;
    if (cap == null || cap <= 0) return 0;
    return round(Math.min(Math.max(0, totalDays - usedDays), cap));
}

export interface LeaveValidationInput {
    days: number;
    remainingDays: number;
    hasAttachment: boolean;
}

export type LeaveValidationError =
    | 'NOT_POSITIVE'
    | 'HALF_DAY_NOT_ALLOWED'
    | 'INSUFFICIENT_BALANCE'
    | 'ATTACHMENT_REQUIRED';

/**
 * Whether a request can be submitted.
 *
 * Returns every reason rather than the first, so a form can show all of them at
 * once instead of making the employee resubmit to discover the next one.
 */
export function validateLeaveRequest(
    policy: LeaveTypePolicy,
    input: LeaveValidationInput,
): LeaveValidationError[] {
    const errors: LeaveValidationError[] = [];

    if (input.days <= 0) errors.push('NOT_POSITIVE');

    // A fractional day that is not a clean half is treated as a half-day
    // request too — 0.25 days is not a thing any of these tenants schedule.
    if (!policy.allows_half_day && input.days % 1 !== 0) {
        errors.push('HALF_DAY_NOT_ALLOWED');
    }

    if (input.days > input.remainingDays) errors.push('INSUFFICIENT_BALANCE');

    if (policy.requires_attachment && !input.hasAttachment) {
        errors.push('ATTACHMENT_REQUIRED');
    }

    return errors;
}

/**
 * Whether one more signature is needed after this approval.
 *
 * `approvalsGiven` is the count *including* the one just given.
 */
export function needsFurtherApproval(
    policy: Pick<LeaveTypePolicy, 'approval_levels'>,
    approvalsGiven: number,
): boolean {
    return approvalsGiven < Math.max(1, policy.approval_levels);
}

export interface CalendarEntry {
    employeeId: string;
    employeeName: string;
    startDate: Date;
    endDate: Date;
    status: string;
    leaveType: string | null;
}

/**
 * Expand approved leave into a per-day map, for a team calendar.
 *
 * Keyed by `YYYY-MM-DD` so a UI can ask "who is off on the 14th" in O(1)
 * instead of scanning every request for an overlap.
 */
export function buildLeaveCalendar(
    entries: CalendarEntry[],
    from: Date,
    to: Date,
): Record<string, { employeeId: string; employeeName: string; leaveType: string | null; status: string }[]> {
    const calendar: Record<string, any[]> = {};

    for (const entry of entries) {
        const start = entry.startDate < from ? from : entry.startDate;
        const end = entry.endDate > to ? to : entry.endDate;

        for (
            let cursor = new Date(start);
            cursor <= end;
            cursor = new Date(cursor.getTime() + 86_400_000)
        ) {
            const key = cursor.toISOString().slice(0, 10);
            (calendar[key] ??= []).push({
                employeeId: entry.employeeId,
                employeeName: entry.employeeName,
                leaveType: entry.leaveType,
                status: entry.status,
            });
        }
    }

    return calendar;
}
