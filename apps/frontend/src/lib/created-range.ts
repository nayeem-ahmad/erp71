import { DEFAULT_TIMEZONE } from '@/lib/timezones';
import { getActiveTimeZone } from '@/lib/format';

export type CreatedRange = { from?: string; to?: string };
export type CreatedRangePreset = 'today' | 'yesterday' | 'last7' | 'thisMonth';

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

export function formatCreatedRangeLabel(
    range: CreatedRange | null | undefined,
    anyTime: string,
): string {
    if (isCreatedRangeEmpty(range)) return anyTime;
    const from = range?.from;
    const to = range?.to;
    if (from && to && from === to) return formatDayMonth(from);
    if (from && to) return `${formatDayMonth(from)} – ${formatDayMonth(to)}`;
    if (from) return `${formatDayMonth(from)} –`;
    return `– ${formatDayMonth(to!)}`;
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
