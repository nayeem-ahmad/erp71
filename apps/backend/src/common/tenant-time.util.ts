/**
 * Calendar arithmetic in a tenant's own timezone.
 *
 * Every "today", "this week" and date-range filter in the platform used to be
 * one of two things: fixed Dhaka offset arithmetic (correct, but only for
 * Bangladesh) or `setHours(0, 0, 0, 0)` (correct only if the *server process*
 * happens to run in the tenant's zone — and the backend container sets no `TZ`,
 * so it runs in UTC). The second kind put "due today" six hours out for every
 * Dhaka shop: the window ran 6am-to-6am local rather than midnight-to-midnight.
 *
 * This file replaces both with one rule: a calendar day belongs to a named IANA
 * zone, and the instant it starts is resolved for that zone *at that date*.
 *
 * IANA names rather than a stored offset integer. A fixed shift is exact for
 * Bangladesh — which is why the old `DHAKA_UTC_OFFSET_MINUTES` was fine — but it
 * silently breaks for any tenant whose zone observes DST, and a stored `+360`
 * cannot tell you when that changes. `Intl` already ships the zone database, so
 * this costs a dependency of zero.
 */

/** What a tenant gets until it picks otherwise. The platform's home market. */
export const DEFAULT_TENANT_TIMEZONE = 'Asia/Dhaka';

const MINUTE_MS = 60 * 1000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** `YYYY-MM-DDTHH:MM[:SS[.mmm]]` with no `Z` and no `±HH:MM` — a local wall clock. */
const NAKED_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/;

/**
 * `Intl.DateTimeFormat` construction is expensive relative to the formatting
 * itself, and these are hit once per row on some report paths. The set of
 * distinct tenant zones is tiny and bounded, so an unbounded cache is fine.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
    const cached = formatters.get(timeZone);
    if (cached) return cached;
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
    formatters.set(timeZone, formatter);
    return formatter;
}

/**
 * IANA-shaped: `UTC`, `Asia/Dhaka`, `America/Argentina/Buenos_Aires`, `Etc/GMT+6`.
 * Deliberately excludes the bare offsets (`+06:00`) that ICU also accepts —
 * storing one would reintroduce exactly the DST blindness this file exists to
 * avoid, and it would do so invisibly.
 */
const IANA_SHAPED = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/;

export function isValidTimeZone(value: string | null | undefined): boolean {
    if (!value || typeof value !== 'string' || !IANA_SHAPED.test(value)) return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
    } catch {
        return false;
    }
}

/**
 * The zone to actually compute in.
 *
 * Falls back rather than throwing: a tenant row carrying a zone name that this
 * Node build's ICU does not know should degrade to slightly-wrong day bounds,
 * not a 500 on every list endpoint the workspace opens.
 */
export function resolveZone(timeZone?: string | null): string {
    return isValidTimeZone(timeZone) ? (timeZone as string) : DEFAULT_TENANT_TIMEZONE;
}

/** The wall-clock reading in `timeZone` for an instant, as if those parts were UTC. */
function wallClockUtcMs(instant: Date, timeZone: string): number {
    const parts = formatterFor(timeZone).formatToParts(instant);
    const read = (type: Intl.DateTimeFormatPartTypes): number => {
        const found = parts.find((part) => part.type === type);
        return found ? Number(found.value) : 0;
    };
    // `hour12: false` emits hour 24 for midnight in some ICU versions.
    const hour = read('hour') % 24;
    return Date.UTC(read('year'), read('month') - 1, read('day'), hour, read('minute'), read('second'));
}

/** Minutes east of UTC in `timeZone` at `instant` — DST-aware, unlike a stored offset. */
export function zoneOffsetMinutes(timeZone: string, instant: Date): number {
    // The wall clock is second-granular while the instant carries milliseconds,
    // so the raw difference is the offset minus a sub-second remainder. Every
    // modern zone is a whole number of minutes from UTC, so rounding recovers it.
    return Math.round((wallClockUtcMs(instant, timeZone) - instant.getTime()) / MINUTE_MS);
}

/** The `YYYY-MM-DD` a UTC instant falls on in `timeZone`. */
export function zonedDateString(instant: Date, timeZone: string): string {
    return new Date(wallClockUtcMs(instant, resolveZone(timeZone))).toISOString().slice(0, 10);
}

/**
 * The UTC instant at which a local wall-clock reading occurs in `timeZone`.
 *
 * Two candidates, because the offset needed to convert the reading depends on
 * the instant the conversion produces. The first uses the offset near the
 * reading, the second the offset that first one lands on; away from a DST
 * transition they agree. Each is then checked by reading its wall clock back,
 * because near a transition an arithmetically-derived candidate can name an
 * instant that does not actually carry the requested local time.
 *
 * The two ways that check can fail are the two DST edge cases, and they want
 * opposite answers:
 *
 *  - **Ambiguous** (clocks went back; the reading happens twice) — both
 *    candidates verify, and the earlier instant is the conventional choice.
 *  - **Gap** (clocks sprang forward; the reading never happens) — neither
 *    verifies, and the answer is the instant the clocks jump to, which is the
 *    later candidate. For a day whose local midnight is skipped this makes the
 *    day start at 1am, which is what "when does this day begin" means there.
 *
 * This is the same disambiguation `Temporal`'s `compatible` mode settles on.
 */
function wallClockToInstant(
    parts: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number; ms?: number },
    timeZone: string,
): Date {
    const readingMs = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour ?? 0,
        parts.minute ?? 0,
        parts.second ?? 0,
        parts.ms ?? 0,
    );
    const subSecondMs = readingMs % 1000;

    const first = readingMs - zoneOffsetMinutes(timeZone, new Date(readingMs)) * MINUTE_MS;
    const second = readingMs - zoneOffsetMinutes(timeZone, new Date(first)) * MINUTE_MS;

    // The wall clock reads back at second granularity, so compare without the
    // milliseconds the caller asked for — they survive into the result untouched.
    const verifies = (ms: number) => wallClockUtcMs(new Date(ms), timeZone) === readingMs - subSecondMs;

    const valid = [first, second].filter(verifies);
    return new Date(valid.length > 0 ? Math.min(...valid) : Math.max(first, second));
}

/** Rejects `2026-02-31` and friends, which `Date.UTC` would silently roll forward. */
function parseCalendarDate(value: string): { year: number; month: number; day: number } | null {
    const match = DATE_ONLY.exec(value.trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (
        check.getUTCFullYear() !== year ||
        check.getUTCMonth() !== month - 1 ||
        check.getUTCDate() !== day
    ) {
        return null;
    }
    return { year, month, day };
}

/** Whether a string is a real `YYYY-MM-DD` — `2026-02-31` is not. */
export function isCalendarDate(value: string | undefined | null): boolean {
    return !!value && parseCalendarDate(value) !== null;
}

/** Midnight starting the `YYYY-MM-DD` calendar day in `timeZone`, as a UTC Date. */
export function zonedDayStart(value: string | undefined | null, timeZone: string): Date | null {
    if (!value) return null;
    const parts = parseCalendarDate(value);
    if (!parts) return null;
    return wallClockToInstant(parts, resolveZone(timeZone));
}

/** Shifts a `YYYY-MM-DD` by whole calendar days. Pure string arithmetic — no zone involved. */
export function addCalendarDays(value: string, days: number): string {
    const parts = parseCalendarDate(value);
    if (!parts) return value;
    const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
    return shifted.toISOString().slice(0, 10);
}

/** Midnight starting the calendar day that `instant` falls on in `timeZone`. */
export function startOfZonedDay(instant: Date, timeZone: string): Date {
    const zone = resolveZone(timeZone);
    return zonedDayStart(zonedDateString(instant, zone), zone) as Date;
}

/** Midnight that began the tenant's current day. The replacement for `setHours(0,0,0,0)`. */
export function startOfZonedToday(timeZone: string, now: Date = new Date()): Date {
    return startOfZonedDay(now, timeZone);
}

/** Midnight starting the day after the one `instant` falls on — the exclusive end of "today". */
export function startOfNextZonedDay(instant: Date, timeZone: string): Date {
    const zone = resolveZone(timeZone);
    return zonedDayStart(addCalendarDays(zonedDateString(instant, zone), 1), zone) as Date;
}

/** A half-open `[gte, lt)` window covering the tenant's whole current day. */
export function zonedTodayWindow(
    timeZone: string,
    now: Date = new Date(),
): { gte: Date; lt: Date } {
    return { gte: startOfZonedToday(timeZone, now), lt: startOfNextZonedDay(now, timeZone) };
}

export type ZonedDayFilter = { gte?: Date; lte?: Date };

/**
 * Inclusive Prisma filter for a pair of shopkeeper-picked calendar days.
 *
 * `to` covers the whole last day. The end is computed as "midnight of the next
 * day, less a millisecond" rather than "start plus 24 hours" so a day that DST
 * makes 23 or 25 hours long is still exactly one day.
 */
export function zonedDayRange(
    from: string | undefined,
    to: string | undefined,
    // Typed as possibly-undefined but NOT optional: callers threading a zone
    // down through an optional options bag can pass `opts?.timezone` without a
    // dance, while omitting the argument entirely stays a compile error. That is
    // what makes adding a new filtered list endpoint fail loudly rather than
    // quietly measuring someone's day in Dhaka.
    timeZone: string | undefined,
): ZonedDayFilter | undefined {
    const zone = resolveZone(timeZone);
    const filter: ZonedDayFilter = {};

    const start = zonedDayStart(from, zone);
    if (start) filter.gte = start;

    if (to && parseCalendarDate(to)) {
        const dayAfter = zonedDayStart(addCalendarDays(to.trim(), 1), zone);
        if (dayAfter) filter.lte = new Date(dayAfter.getTime() - 1);
    }

    return Object.keys(filter).length > 0 ? filter : undefined;
}

/**
 * The wall-clock hour (0-23), weekday and date in `timeZone` for a UTC instant.
 * Used by the hour-of-day and day-of-week report breakdowns, where reporting a
 * 1am sale as a 7pm one would move it to the previous day entirely.
 */
export function zonedParts(
    instant: Date,
    timeZone: string,
): { hour: number; weekday: number; date: string } {
    const shifted = new Date(wallClockUtcMs(instant, resolveZone(timeZone)));
    return {
        hour: shifted.getUTCHours(),
        weekday: shifted.getUTCDay(),
        date: shifted.toISOString().slice(0, 10),
    };
}

/**
 * Reads a client-supplied datetime as the tenant meant it.
 *
 * An `<input type="datetime-local">` posts `2026-09-01T20:00` with no zone. Fed
 * to `new Date()` that is *process* local — UTC in the container — so a shop
 * owner scheduling an 8pm follow-up got one stored at 2am the next day in Dhaka,
 * on the wrong calendar day before any filter ran.
 *
 * Only offsetless readings are reinterpreted. A string that already carries `Z`
 * or `±HH:MM` names an unambiguous instant and is passed through untouched, so
 * well-behaved API clients and imports keep working.
 */
export function parseTenantDateTime(
    value: string | Date | null | undefined,
    timeZone: string,
): Date | null {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

    const trimmed = value.trim();
    const zone = resolveZone(timeZone);

    if (DATE_ONLY.test(trimmed)) return zonedDayStart(trimmed, zone);

    const naked = NAKED_DATETIME.exec(trimmed);
    if (naked) {
        return wallClockToInstant(
            {
                year: Number(naked[1]),
                month: Number(naked[2]),
                day: Number(naked[3]),
                hour: Number(naked[4]),
                minute: Number(naked[5]),
                second: naked[6] ? Number(naked[6]) : 0,
                ms: naked[7] ? Number(naked[7].padEnd(3, '0')) : 0,
            },
            zone,
        );
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
