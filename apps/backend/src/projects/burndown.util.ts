/**
 * Burndown maths. Pure functions — no Prisma, no dates from the clock — so the
 * awkward parts (weekends, scope changes, empty sprints) are testable directly.
 */

/**
 * Days treated as non-working, as JS `getUTCDay()` indices (0 = Sunday).
 * Bangladesh works Sunday–Thursday, so Friday (5) and Saturday (6) are off.
 * Without this the ideal line falls every day and every sprint reads as behind
 * for two days a week.
 */
export const DEFAULT_WEEKEND_DAYS = [5, 6];

/** `YYYY-MM-DD` for a date, in UTC — the form snapshot rows and the API use. */
export function toDateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/** Midnight UTC for a `YYYY-MM-DD` key. */
export function fromDateKey(key: string): Date {
    return new Date(`${key}T00:00:00.000Z`);
}

/** Every calendar date from start to end inclusive, as date keys. */
export function eachDate(start: Date, end: Date): string[] {
    const days: string[] = [];
    const cursor = fromDateKey(toDateKey(start));
    const last = fromDateKey(toDateKey(end));
    while (cursor.getTime() <= last.getTime()) {
        days.push(toDateKey(cursor));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
}

export function isWorkingDay(dateKey: string, weekendDays: number[] = DEFAULT_WEEKEND_DAYS): boolean {
    return !weekendDays.includes(fromDateKey(dateKey).getUTCDay());
}

/** Working days only, in order. May be empty if a sprint spans just a weekend. */
export function workingDays(
    start: Date,
    end: Date,
    weekendDays: number[] = DEFAULT_WEEKEND_DAYS,
): string[] {
    return eachDate(start, end).filter((d) => isWorkingDay(d, weekendDays));
}

export interface BurndownPoint {
    date: string;
    /** Straight line from the committed total to zero across working days. */
    ideal: number | null;
    /** Remaining hours as at end of that day; null for days not yet reached. */
    actual: number | null;
    /** Total committed hours as at that day — rises when scope is added. */
    committed: number | null;
    isWorkingDay: boolean;
}

export interface BurndownInput {
    startDate: Date;
    endDate: Date;
    /** One entry per day that has a snapshot, keyed `YYYY-MM-DD`. */
    snapshots: Map<string, { remaining: number; committed: number }>;
    weekendDays?: number[];
}

/**
 * Builds the three series the chart draws.
 *
 * The ideal line descends only on working days, so it is flat across a weekend
 * rather than continuing to fall through days nobody worked. It is anchored to
 * the committed total on the first day: re-anchoring it to current scope would
 * hide exactly the overrun the chart exists to show.
 */
export function buildBurndownSeries(input: BurndownInput): BurndownPoint[] {
    const { startDate, endDate, snapshots } = input;
    const weekendDays = input.weekendDays ?? DEFAULT_WEEKEND_DAYS;
    const days = eachDate(startDate, endDate);
    if (days.length === 0) return [];

    const working = days.filter((d) => isWorkingDay(d, weekendDays));
    const firstSnapshot = snapshots.get(days[0]);
    // Fall back to the earliest snapshot we have, so a sprint whose first day
    // was missed still gets an ideal line rather than a flat zero.
    const anchor =
        firstSnapshot?.committed ??
        [...snapshots.values()][0]?.committed ??
        0;

    // One step per working-day *interval*, so the line hits zero on the last
    // working day rather than one day early.
    const steps = Math.max(working.length - 1, 1);
    const stepSize = anchor / steps;

    let workingSeen = -1;
    return days.map((date) => {
        const isWorking = isWorkingDay(date, weekendDays);
        if (isWorking) workingSeen += 1;

        const ideal =
            working.length === 0
                ? null
                : round2(Math.max(anchor - stepSize * Math.max(workingSeen, 0), 0));

        // No snapshot means no line: a future day is not yet known, and a
        // missed past day is a gap to be rebuilt, not a flat carry-forward.
        const snap = snapshots.get(date);
        return {
            date,
            ideal,
            actual: snap ? round2(snap.remaining) : null,
            committed: snap ? round2(snap.committed) : null,
            isWorkingDay: isWorking,
        };
    });
}

export function round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}
