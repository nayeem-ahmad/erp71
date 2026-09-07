/**
 * Billing-cycle arithmetic shared by checkout, the fee-posting cron and the
 * suspension sweep.
 *
 * The renewal job has to answer "which period comes after this one" repeatedly,
 * without drift: a subscription that started on the 31st must keep landing on
 * month ends, and a year of monthly renewals must not slide backwards the way
 * repeated +30-day arithmetic does. So periods advance by calendar month/year
 * here, clamped to the last valid day of the target month.
 */

export type BillingCycle = 'MONTHLY' | 'YEARLY';

export function normalizeBillingCycle(billingCycle?: string | null): BillingCycle {
    return billingCycle === 'YEARLY' ? 'YEARLY' : 'MONTHLY';
}

/**
 * Adds `count` calendar months to `from`, clamping the day to the last day of
 * the target month. Jan 31 + 1 month is Feb 28 (or 29), not Mar 3 — the latter
 * is what a naive `setMonth` produces, and it moves a subscription into a
 * different month than the one it is billing for.
 */
export function addMonths(from: Date, count: number): Date {
    const result = new Date(from);
    const targetDay = result.getUTCDate();

    // Move to the 1st before shifting the month so the overflow never happens,
    // then restore the day clamped to what the target month actually has.
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + count);

    const daysInTargetMonth = new Date(
        Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
    ).getUTCDate();

    result.setUTCDate(Math.min(targetDay, daysInTargetMonth));
    return result;
}

/** The end of the period that starts at `periodStart`, for the given cycle. */
export function calculatePeriodEnd(periodStart: Date, billingCycle: BillingCycle): Date {
    return addMonths(periodStart, billingCycle === 'YEARLY' ? 12 : 1);
}

/**
 * Walks a subscription's period forward until it ends in the future, returning
 * every period boundary crossed on the way.
 *
 * A subscription whose renewal was missed for months (the frozen-period bug, or
 * a cron that did not run) owes one fee per elapsed cycle, not one fee total —
 * so the fee job needs each boundary, not just the final one.
 *
 * `maxPeriods` bounds the walk so a badly corrupted date cannot spin forever or
 * post hundreds of charges; the caller decides what to do when it is hit.
 */
export function elapsedPeriods(
    currentPeriodEnd: Date,
    billingCycle: BillingCycle,
    now: Date,
    maxPeriods = 24,
): Array<{ periodStart: Date; periodEnd: Date }> {
    const periods: Array<{ periodStart: Date; periodEnd: Date }> = [];
    const step = billingCycle === 'YEARLY' ? 12 : 1;

    // Every boundary is computed as an offset from the *original* anchor rather
    // than by stepping off the previous result. Stepping compounds the
    // short-month clamp — Jan 31 → Feb 28 → Mar 28 — and permanently walks a
    // month-end subscription backwards; anchoring restores the 31st in March.
    let index = 0;
    while (index < maxPeriods) {
        const periodStart = addMonths(currentPeriodEnd, index * step);
        if (periodStart > now) break;

        periods.push({
            periodStart,
            periodEnd: addMonths(currentPeriodEnd, (index + 1) * step),
        });
        index += 1;
    }

    return periods;
}
