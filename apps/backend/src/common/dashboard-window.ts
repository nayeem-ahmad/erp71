/**
 * The date window every module dashboard endpoint takes, resolved the same way
 * by all of them.
 *
 * The whole point of this file is that neither end goes through `toISOString()`.
 * ERP71 serves Dhaka (UTC+6): `new Date('2026-08-04')` is *UTC* midnight, which
 * is already 6am locally, and formatting a local evening back through
 * `toISOString()` moves it into the previous day. Either mistake silently
 * re-dates a figure by one day, which on a "today" window means it covers the
 * wrong day entirely.
 */
export type DateWindow = { from: string; to: string; fromDate: Date; toDate: Date };

export type DateWindowQuery = { from?: string; to?: string };

/** How far back a window reaches when the client sends no bounds. */
const DEFAULT_WINDOW_DAYS = 30;

export function startOfDay(value: Date): Date {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
}

/** Reads a `YYYY-MM-DD` bound as *local* midnight. */
export function parseDateOnly(value: string | undefined): Date | null {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
}

/** `YYYY-MM-DD` from local calendar parts. */
export function formatDate(value: Date): string {
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${month}-${day}`;
}

/** Defaults to the last 30 days when the client sends no window. */
export function resolveDateWindow(query: DateWindowQuery): DateWindow {
    const today = startOfDay(new Date());
    const defaultFrom = new Date(today);
    defaultFrom.setDate(defaultFrom.getDate() - (DEFAULT_WINDOW_DAYS - 1));

    const fromDate = parseDateOnly(query.from) ?? defaultFrom;
    const toDate = parseDateOnly(query.to) ?? new Date(today);
    toDate.setHours(23, 59, 59, 999);

    return { from: formatDate(fromDate), to: formatDate(toDate), fromDate, toDate };
}

/** One bucket per calendar day in the window, zero-filled. */
export function emptyDailyBuckets<T extends Record<string, number>>(
    window: DateWindow,
    zero: () => T,
): Map<string, T> {
    const buckets = new Map<string, T>();
    const cursor = startOfDay(window.fromDate);
    const last = startOfDay(window.toDate);
    while (cursor <= last) {
        buckets.set(formatDate(cursor), zero());
        cursor.setDate(cursor.getDate() + 1);
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
