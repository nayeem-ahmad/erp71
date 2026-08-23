/**
 * Wall-clock spans on an hour log.
 *
 * The whole file exists because two different clocks meet here. A manual entry
 * states a *wall clock on a calendar day* ("13:45 to 18:08 on the 18th"), which
 * has no meaning until a timezone is named. A running timer produces a real
 * *instant*, which has no calendar day until one is named. Storing the instant
 * and deriving everything else from Asia/Dhaka is what keeps them from
 * disagreeing — the alternative, storing the wall clock as though it were UTC,
 * reads back correctly only for as long as nobody ever compares a span to a
 * timer, and the timer is the whole point of the column.
 *
 * `period.util.ts` already fixed the offset for exactly this reason and
 * `DHAKA_UTC_OFFSET_MINUTES` is imported rather than restated, so a per-tenant
 * timezone lands in one place when it lands.
 */

import { DHAKA_UTC_OFFSET_MINUTES } from '../common/period.util';

export const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const OFFSET_MS = DHAKA_UTC_OFFSET_MINUTES * MINUTE_MS;

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Minutes since midnight for an `HH:mm`, or null if it is not one. */
export function parseTimeOfDay(value: string | null | undefined): number | null {
    if (!value) return null;
    const match = TIME_OF_DAY.exec(value.trim());
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * The instant Dhaka midnight begins on a `YYYY-MM-DD`. Rejects a date whose
 * parts do not survive the round trip, so `2026-02-31` is a null rather than a
 * silent 3 March.
 */
export function dhakaDayStart(value: string | null | undefined): Date | null {
    if (!value) return null;
    const match = DATE_ONLY.exec(value.trim().slice(0, 10));
    if (!match) return null;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const utcMidnight = Date.UTC(year, month - 1, day);
    const check = new Date(utcMidnight);
    if (
        check.getUTCFullYear() !== year
        || check.getUTCMonth() !== month - 1
        || check.getUTCDate() !== day
    ) {
        return null;
    }
    return new Date(utcMidnight - OFFSET_MS);
}

/** The Dhaka calendar day an instant falls on, as `YYYY-MM-DD`. */
export function dhakaDateKey(instant: Date): string {
    return new Date(instant.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** The Dhaka wall clock an instant reads as, as `HH:mm`. */
export function dhakaTimeOfDay(instant: Date): string {
    return new Date(instant.getTime() + OFFSET_MS).toISOString().slice(11, 16);
}

/**
 * The value to store in a `@db.Date` `work_date` for an instant.
 *
 * **UTC midnight of the Dhaka calendar day, not the instant that day began.**
 * Prisma serialises a `@db.Date` by reading the Date's *UTC* parts, so handing
 * it the true start of a Dhaka day (18:00Z the evening before) files the row
 * under the previous date — the exact off-by-one this whole file exists to
 * avoid, arriving from the other direction. `ProjectTimeService.isoDate` reads
 * the column back the same way.
 */
export function workDateFor(instant: Date): Date {
    return new Date(`${dhakaDateKey(instant)}T00:00:00.000Z`);
}

/** Hours between two instants, at the two decimals a timesheet is read in. */
export function hoursBetween(startedAt: Date, endedAt: Date): number {
    return Math.round(((endedAt.getTime() - startedAt.getTime()) / 3_600_000) * 100) / 100;
}

export interface TimeSpan {
    startedAt: Date;
    endedAt: Date;
    hours: number;
}

export type SpanError = 'HALF_SPAN' | 'BAD_DATE' | 'BAD_TIME' | 'ZERO_LENGTH';

/**
 * Exactly one side is ever set: `error` names why the pair was rejected, or
 * `span` holds the resolved instants — `null` there being the legitimate "this
 * entry has no span" answer rather than a failure.
 *
 * Deliberately two nullable fields rather than a discriminated union on a
 * boolean: `strictNullChecks` is off in this project, so a `{ ok: true } | {
 * ok: false }` union does not narrow and every caller ends up casting.
 */
export interface SpanResult {
    error: SpanError | null;
    span: TimeSpan | null;
}

/**
 * A `HH:mm`–`HH:mm` pair on a work date, resolved to instants.
 *
 * Both ends or neither: half a span cannot be drawn on a row, cannot be checked
 * for overlap, and is not worth a column that can hold it. A null `span` beside
 * a null `error` is the "neither" case and is not a failure — most entries are
 * still typed as a bare number of hours.
 *
 * **An end *before* the start is read as crossing midnight**, not as a mistake:
 * a sitting from 22:00 to 02:00 is the ordinary way a late evening gets logged,
 * and refusing it would push people into splitting one stretch into two entries.
 * The price is that a reversed typo (18:00–08:00 for 08:00–18:00) becomes a
 * 14-hour entry rather than an error, which is why the row shows the span and
 * not only the total — the span is the thing somebody can look at and see is
 * wrong.
 *
 * **An end *equal* to the start is refused.** It is the one case with no
 * defensible reading: zero minutes and a full twenty-four hours are equally
 * consistent with what was typed, and both are almost certainly wrong. Picking
 * either silently would be worse than asking.
 *
 * Note this bounds a span at 23h59m by construction, so there is deliberately
 * no separate "too long" check — one would be unreachable code standing in for
 * a limit the shape of the input already imposes.
 */
export function buildSpan(
    workDate: string,
    startTime: string | null | undefined,
    endTime: string | null | undefined,
): SpanResult {
    const hasStart = Boolean(startTime);
    const hasEnd = Boolean(endTime);
    if (!hasStart && !hasEnd) return { error: null, span: null };
    if (hasStart !== hasEnd) return { error: 'HALF_SPAN', span: null };

    const dayStart = dhakaDayStart(workDate);
    if (!dayStart) return { error: 'BAD_DATE', span: null };

    const startMinutes = parseTimeOfDay(startTime);
    const endMinutes = parseTimeOfDay(endTime);
    if (startMinutes === null || endMinutes === null) return { error: 'BAD_TIME', span: null };

    if (startMinutes === endMinutes) return { error: 'ZERO_LENGTH', span: null };

    const startedAt = new Date(dayStart.getTime() + startMinutes * MINUTE_MS);
    const crossesMidnight = endMinutes < startMinutes;
    const endedAt = new Date(
        dayStart.getTime() + endMinutes * MINUTE_MS + (crossesMidnight ? DAY_MS : 0),
    );

    return { error: null, span: { startedAt, endedAt, hours: hoursBetween(startedAt, endedAt) } };
}

/**
 * Half-open on both sides, so a span ending exactly when the next begins is not
 * an overlap. Back-to-back entries are how a day is normally logged; treating
 * 14:00–16:00 and 16:00–18:00 as a clash would make the check useless.
 */
export function spansOverlap(
    aStart: Date,
    aEnd: Date,
    bStart: Date,
    bEnd: Date,
): boolean {
    return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/**
 * The two `HH:mm` strings a stored span reads back as, for a client that should
 * never have to do timezone arithmetic of its own. Null when the entry has no
 * span, which is most of them.
 */
export function spanTimes(
    startedAt: Date | null | undefined,
    endedAt: Date | null | undefined,
): { start_time: string | null; end_time: string | null } {
    return {
        start_time: startedAt ? dhakaTimeOfDay(startedAt) : null,
        end_time: endedAt ? dhakaTimeOfDay(endedAt) : null,
    };
}
