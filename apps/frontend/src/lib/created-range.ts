/** Bangladesh has a single DST-free offset, so a fixed shift is exact. */
const DHAKA_OFFSET_MINUTES = 6 * 60;

export type CreatedRange = { from?: string; to?: string };
export type CreatedRangePreset = 'today' | 'yesterday' | 'last7' | 'thisMonth';

export function dhakaDateOnly(at: Date = new Date()): string {
    return new Date(at.getTime() + DHAKA_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

function addCalendarDays(ymd: string, days: number): string {
    const [year, month, day] = ymd.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function createdRangeFromPreset(
    preset: CreatedRangePreset,
    now: Date = new Date(),
): CreatedRange {
    const today = dhakaDateOnly(now);
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
