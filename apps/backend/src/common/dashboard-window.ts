import {
    addCalendarDays,
    isCalendarDate,
    startOfZonedToday,
    zonedDateString,
    zonedDayStart,
} from './tenant-time.util';

/**
 * The date window every module dashboard endpoint takes, resolved the same way
 * by all of them.
 *
 * Neither end goes through `toISOString()` and neither goes through `setHours`.
 * Both are wrong, in opposite directions: `new Date('2026-08-04')` is *UTC*
 * midnight, which is already 6am in Dhaka, while `setHours` measures the day in
 * whatever zone the server process happens to run in — UTC in the container,
 * which is nobody's working day. Either mistake silently re-dates a figure, and
 * on a "today" window it covers the wrong day entirely.
 *
 * The window carries its own zone so callers cannot bucket rows in one zone
 * after resolving bounds in another. Ask it for `dayOf(instant)` rather than
 * formatting a date yourself.
 */
export type DateWindow = {
    from: string;
    to: string;
    fromDate: Date;
    toDate: Date;
    /** The tenant zone every bound and bucket in this window is measured in. */
    timezone: string;
    /** The `YYYY-MM-DD` bucket an instant belongs to, in this window's zone. */
    dayOf: (instant: Date) => string;
};

export type DateWindowQuery = { from?: string; to?: string };

/** How far back a window reaches when the client sends no bounds. */
const DEFAULT_WINDOW_DAYS = 30;

/** Defaults to the last 30 days when the client sends no window. */
export function resolveDateWindow(query: DateWindowQuery, timezone: string): DateWindow {
    const todayStart = startOfZonedToday(timezone);
    const today = zonedDateString(todayStart, timezone);

    const from = normaliseBound(query.from) ?? addCalendarDays(today, -(DEFAULT_WINDOW_DAYS - 1));
    const to = normaliseBound(query.to) ?? today;

    const fromDate = zonedDayStart(from, timezone) as Date;
    // The last millisecond of `to`, reached from the start of the following day
    // so that a DST-shortened or -lengthened day is still exactly one day.
    const toDate = new Date((zonedDayStart(addCalendarDays(to, 1), timezone) as Date).getTime() - 1);

    return {
        from,
        to,
        fromDate,
        toDate,
        timezone,
        dayOf: (instant: Date) => zonedDateString(instant, timezone),
    };
}

/** Keeps only a well-formed `YYYY-MM-DD`, so a junk bound falls back to the default. */
function normaliseBound(value: string | undefined): string | null {
    if (!value) return null;
    // Tolerates a full ISO timestamp by taking its date part, as the old
    // `parseDateOnly` regex did — some clients send one.
    const trimmed = value.trim().slice(0, 10);
    return isCalendarDate(trimmed) ? trimmed : null;
}

/** One bucket per calendar day in the window, zero-filled, in the window's zone. */
export function emptyDailyBuckets<T extends Record<string, number>>(
    window: DateWindow,
    zero: () => T,
): Map<string, T> {
    const buckets = new Map<string, T>();
    let cursor = window.from;
    while (cursor <= window.to) {
        buckets.set(cursor, zero());
        cursor = addCalendarDays(cursor, 1);
    }
    return buckets;
}

/** A percentage to one decimal place, or null when the base is zero. */
export function percent(part: number, whole: number): number | null {
    if (whole <= 0) return null;
    return Math.round((part / whole) * 1000) / 10;
}

/** Rounds money to two places without dragging in a Decimal instance. */
export function money(value: number): number {
    return Math.round(value * 100) / 100;
}
