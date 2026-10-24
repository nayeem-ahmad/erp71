import { DEFAULT_TIMEZONE } from '@/lib/timezones';
import { getActiveTimeZone } from '@/lib/format';

/**
 * Each bound is `YYYY-MM-DD` (the whole day) or, from a chip with times,
 * `YYYY-MM-DDTHH:mm` — both on the workspace's own wall clock.
 */
export type CreatedRange = { from?: string; to?: string };
export type CreatedRangePreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth';

/**
 * Today, as the workspace's own calendar reads it.
 *
 * These presets are sent to the server as `YYYY-MM-DD` and read there against
 * `Tenant.timezone`, so the day the client names has to be the day the server
 * would name. A fixed Dhaka shift was right only while every tenant was
 * Bangladeshi. `en-CA` because it formats as `YYYY-MM-DD`.
 */
export function tenantDateOnly(at: Date = new Date()): string {
    const zone = getActiveTimeZone() ?? DEFAULT_TIMEZONE;
    try {
        return at.toLocaleDateString('en-CA', { timeZone: zone });
    } catch {
        return at.toLocaleDateString('en-CA', { timeZone: DEFAULT_TIMEZONE });
    }
}

function addCalendarDays(ymd: string, days: number): string {
    const [year, month, day] = ymd.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function createdRangeFromPreset(
    preset: CreatedRangePreset,
    now: Date = new Date(),
): CreatedRange {
    const today = tenantDateOnly(now);
    if (preset === 'today') return { from: today, to: today };
    if (preset === 'yesterday') {
        const yesterday = addCalendarDays(today, -1);
        return { from: yesterday, to: yesterday };
    }
    if (preset === 'last7') return { from: addCalendarDays(today, -6), to: today };
    if (preset === 'last30') return { from: addCalendarDays(today, -29), to: today };
    return { from: `${today.slice(0, 8)}01`, to: today };
}

export function isCreatedRangeEmpty(range: CreatedRange | null | undefined): boolean {
    return !range?.from && !range?.to;
}

function formatDayMonth(ymd: string): string {
    const [year, month, day] = ymd.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
    });
}

/** Splits a bound into its day and its `HH:mm`, which is empty for a whole-day bound. */
export function splitRangeBound(bound: string | undefined): { date: string; time: string } {
    if (!bound) return { date: '', time: '' };
    return { date: bound.slice(0, 10), time: bound.length > 10 ? bound.slice(11, 16) : '' };
}

/** The inverse of `splitRangeBound`. A time without its day is dropped, not sent bare. */
export function joinRangeBound(date: string, time: string): string | undefined {
    if (!date) return undefined;
    return time ? `${date}T${time}` : date;
}

function formatBound(bound: string): string {
    const { date, time } = splitRangeBound(bound);
    return time ? `${formatDayMonth(date)} ${time}` : formatDayMonth(date);
}

export function formatCreatedRangeLabel(
    range: CreatedRange | null | undefined,
    anyTime: string,
): string {
    if (isCreatedRangeEmpty(range)) return anyTime;
    const from = range?.from;
    const to = range?.to;
    if (from && to && from === to) return formatBound(from);
    if (from && to) {
        const start = splitRangeBound(from);
        const end = splitRangeBound(to);
        // "12 Oct 09:00 – 13:00" rather than naming the same day twice.
        if (start.date === end.date && start.time && end.time) return `${formatBound(from)} – ${end.time}`;
        return `${formatBound(from)} – ${formatBound(to)}`;
    }
    if (from) return `${formatBound(from)} –`;
    return `– ${formatBound(to!)}`;
}

export function applyCreatedRangeQuery(
    range: CreatedRange | null | undefined,
): { createdFrom?: string; createdTo?: string } {
    if (isCreatedRangeEmpty(range)) return {};
    return {
        ...(range?.from ? { createdFrom: range.from } : {}),
        ...(range?.to ? { createdTo: range.to } : {}),
    };
}

/**
 * The same range as `applyCreatedRangeQuery`, aimed at `due_at` instead. The
 * activities list carries both, so the two cannot share one pair of param names.
 */
export function applyDueRangeQuery(
    range: CreatedRange | null | undefined,
): { dueFrom?: string; dueTo?: string } {
    if (isCreatedRangeEmpty(range)) return {};
    return {
        ...(range?.from ? { dueFrom: range.from } : {}),
        ...(range?.to ? { dueTo: range.to } : {}),
    };
}

/**
 * The same range aimed at a list's own transaction date (a sale's `sale_date`,
 * a loan's `start_date`) rather than at `created_at`. Lists carry both, so the
 * two need their own param names.
 */
export function applyDateRangeQuery(
    range: CreatedRange | null | undefined,
): { dateFrom?: string; dateTo?: string } {
    if (isCreatedRangeEmpty(range)) return {};
    return {
        ...(range?.from ? { dateFrom: range.from } : {}),
        ...(range?.to ? { dateTo: range.to } : {}),
    };
}
