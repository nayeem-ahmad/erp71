import { addCalendarDays, resolveZone } from '../common/tenant-time.util';

/** Shop-local time the summary for the day that just ended goes out. */
export const DAILY_SUMMARY_SEND_MINUTE = 20;

export type ZonedClock = { hour: number; minute: number; date: string };

/**
 * Wall clock in `timeZone`. Hour 24, which some ICU builds emit for midnight,
 * is folded back to 0 so 00:20 is not read as 24:20.
 */
export function zonedClock(instant: Date, timeZone: string): ZonedClock {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: resolveZone(timeZone),
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).formatToParts(instant);
    const read = (type: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find((part) => part.type === type)?.value ?? '0');
    const month = String(read('month')).padStart(2, '0');
    const day = String(read('day')).padStart(2, '0');
    return {
        hour: read('hour') % 24,
        minute: read('minute'),
        date: `${read('year')}-${month}-${day}`,
    };
}

/**
 * The shop day to summarise at `now`, or null while the local clock is still
 * before 00:20. A later run the same day still returns that same day, so a
 * missed 00:20 is caught up. Older missed days are not backfilled.
 */
export function dailySummaryReportDate(now: Date, timeZone: string): string | null {
    const clock = zonedClock(now, timeZone);
    if (clock.hour * 60 + clock.minute < DAILY_SUMMARY_SEND_MINUTE) return null;
    return addCalendarDays(clock.date, -1);
}
