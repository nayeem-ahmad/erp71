/**
 * The shared parts of a day-grouped ledger: rows bucketed under the day they
 * belong to, a heading for that day, and a duration rendered the way a
 * timesheet is read.
 *
 * Lives here rather than beside the hour log because the same shape now serves
 * two modules that must not import from each other — the project hour log and
 * HR attendance — and because "what does a day heading say" is a decision worth
 * making once.
 */

/**
 * `4h 23m`, never `04:23:54`.
 *
 * Seconds are false precision on anything a person typed or a schedule
 * produced. A clock that is actually ticking is the one exception, and it has
 * its own formatter next to the timer that needs it.
 */
export function formatDuration(hours: number): string {
    return formatMinutes(Math.round(hours * 60));
}

/** The same rendering for a figure already counted in minutes. */
export function formatMinutes(totalMinutes: number): string {
    const minutes = Math.max(0, Math.round(totalMinutes));
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
}

/** `YYYY-MM-DD` for a Date, read in the viewer's own zone. */
export function localDayKey(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

export interface DayHeadingLabels {
    today: string;
    yesterday: string;
    locale?: string;
}

/**
 * `Today`, `Yesterday`, or the weekday and date.
 *
 * Both relative labels are passed in rather than derived: they are the strings
 * on this row that need translating, and this module has no locale of its own.
 */
export function dayHeading(
    key: string,
    labels: DayHeadingLabels,
    now: Date = new Date(),
): string {
    const todayKey = localDayKey(now);
    if (key === todayKey) return labels.today;

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (key === localDayKey(yesterday)) return labels.yesterday;

    // Parsed as UTC and formatted in UTC: the key is a calendar day, not an
    // instant, and letting it round-trip through the local zone is how a Dhaka
    // evening ends up labelled with the previous date.
    return new Date(`${key}T00:00:00.000Z`).toLocaleDateString(labels.locale, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
    });
}

/**
 * Rows bucketed under their day, **in the order the days first appear**.
 *
 * Deliberately not sorted here. The caller received these rows in whatever
 * order the server was asked for, and re-sorting would quietly override a sort
 * somebody chose — the grouping is a presentation of that order, not a
 * replacement for it.
 */
export function groupRowsByDay<T>(
    rows: T[],
    dayKeyOf: (row: T) => string,
): { key: string; rows: T[] }[] {
    const days = new Map<string, T[]>();
    for (const row of rows) {
        const key = dayKeyOf(row);
        const bucket = days.get(key);
        if (bucket) bucket.push(row);
        else days.set(key, [row]);
    }
    return [...days.entries()].map(([key, dayRows]) => ({ key, rows: dayRows }));
}

/** `YYYY-MM-DD` from either a date-only string or a full timestamp. */
export const dayKeyOfDate = (value: string): string => value.slice(0, 10);
