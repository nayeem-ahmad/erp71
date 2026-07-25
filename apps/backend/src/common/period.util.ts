/**
 * Date-range arithmetic shared by every trend and period-comparison report.
 *
 * All of it operates on `YYYY-MM-DD` strings rather than `Date` objects on
 * purpose. The reports take and return plain date strings, and round-tripping
 * through a `Date` re-introduces the timezone bug this file exists to avoid: a
 * `new Date('2026-07-01')` is midnight *UTC*, which is still 30 June in Dhaka.
 * Everything here is calendar arithmetic on UTC-anchored days, so a day is
 * always the day the user typed.
 */

/** Bangladesh has a single, DST-free offset, so a fixed shift is exact. */
export const DHAKA_UTC_OFFSET_MINUTES = 6 * 60;

export type Granularity = 'day' | 'week' | 'month';
export type ComparisonMode = 'previous_period' | 'previous_year';

export interface DateRange {
    from: string;
    to: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parses `YYYY-MM-DD` into a UTC-midnight timestamp; NaN for anything else. */
function toUtcMs(date: string): number {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
    if (!match) return Number.NaN;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function isValidDate(date: string | undefined | null): boolean {
    return typeof date === 'string' && !Number.isNaN(toUtcMs(date));
}

function fromUtcMs(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, inclusive of both ends. */
export function daysInRange(range: DateRange): number {
    const span = toUtcMs(range.to) - toUtcMs(range.from);
    if (Number.isNaN(span)) return 0;
    return Math.floor(span / DAY_MS) + 1;
}

export function addDays(date: string, days: number): string {
    return fromUtcMs(toUtcMs(date) + days * DAY_MS);
}

/**
 * Shifts a date by whole calendar years, clamping 29 February back to the 28th
 * rather than silently rolling into March.
 */
export function addYears(date: string, years: number): string {
    const ms = toUtcMs(date);
    if (Number.isNaN(ms)) return date;
    const d = new Date(ms);
    const targetYear = d.getUTCFullYear() + years;
    const targetMonth = d.getUTCMonth();
    const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    return fromUtcMs(Date.UTC(targetYear, targetMonth, Math.min(d.getUTCDate(), lastDayOfTargetMonth)));
}

/**
 * The window a report compares against.
 *
 * `previous_period` is the block of days immediately before the range and the
 * same length, so a 7-day range compares against the 7 days before it.
 * `previous_year` is the same calendar dates one year earlier, which is what
 * seasonal businesses actually mean by "versus last year".
 */
export function resolveComparisonRange(range: DateRange, mode: ComparisonMode): DateRange | null {
    if (!isValidDate(range.from) || !isValidDate(range.to)) return null;

    if (mode === 'previous_year') {
        return { from: addYears(range.from, -1), to: addYears(range.to, -1) };
    }

    const length = daysInRange(range);
    if (length <= 0) return null;
    const to = addDays(range.from, -1);
    return { from: addDays(to, -(length - 1)), to };
}

/**
 * The bucket a date belongs to, as the bucket's own start date.
 *
 * Weeks start Monday (ISO 8601). Bangladesh's working week starts Saturday, but
 * every existing chart in this app already buckets by ISO week, and a report
 * that disagreed with the dashboard beside it would be worse than one that is
 * merely conventional. Responses label the granularity so the caller can say so.
 */
export function bucketStart(date: string, granularity: Granularity): string {
    const ms = toUtcMs(date);
    if (Number.isNaN(ms)) return date;
    if (granularity === 'day') return fromUtcMs(ms);
    if (granularity === 'month') return `${date.slice(0, 7)}-01`;

    const dayOfWeek = new Date(ms).getUTCDay(); // 0 = Sunday
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    return fromUtcMs(ms - daysSinceMonday * DAY_MS);
}

/** A short human label for a bucket, e.g. `2026-07` for a month. */
export function bucketLabel(start: string, granularity: Granularity): string {
    if (granularity === 'month') return start.slice(0, 7);
    return start;
}

/**
 * Percentage change from `previous` to `current`.
 *
 * Returns `null` rather than `Infinity` when the base is zero: "revenue grew by
 * Infinity percent" is not something any caller should render, and a null forces
 * the caller to phrase it as "up from nothing" instead.
 */
export function percentChange(current: number, previous: number): number | null {
    if (!previous) return null;
    return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * The wall-clock hour (0-23) and weekday in Dhaka for an instant stored in UTC.
 * Used by the hour-of-day and day-of-week breakdowns, where reporting a sale
 * made at 1am Dhaka as a 7pm sale would move it to the previous day entirely.
 */
export function toDhakaParts(instant: Date): { hour: number; weekday: number; date: string } {
    const shifted = new Date(instant.getTime() + DHAKA_UTC_OFFSET_MINUTES * 60 * 1000);
    return {
        hour: shifted.getUTCHours(),
        weekday: shifted.getUTCDay(),
        date: shifted.toISOString().slice(0, 10),
    };
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
