import type { DashboardRange } from '@/components/dashboard/DashboardHeader';

// ERP71 serves Bangladeshi retailers; day boundaries are Asia/Dhaka (UTC+6).
const DHAKA_OFFSET_MINUTES = 360;

/**
 * The equally long window immediately before `window`, so a KPI can be compared
 * against the same span of time rather than against its own first data point.
 */
export function previousWindow(window: { from: string; to: string }): { from: string; to: string } {
    const from = Date.parse(window.from);
    const to = Date.parse(window.to);
    const span = to - from;
    return { from: new Date(from - span).toISOString(), to: window.from };
}

/** The Dhaka calendar day `at` falls on, as `YYYY-MM-DD`. */
function dhakaDate(at: Date): string {
    return new Date(at.getTime() + DHAKA_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/**
 * Same windows as `rangeToWindow`, but as date-only bounds.
 *
 * The CRM dashboard's endpoints take `YYYY-MM-DD` and read it as a whole local
 * day. Handing them the ISO instants above would send a Dhaka midnight as the
 * *previous* day in UTC, and "today" would silently cover two days.
 */
export function rangeToDateWindow(range: DashboardRange, now: Date = new Date()): { from: string; to: string } {
    const window = rangeToWindow(range, now);
    return { from: dhakaDate(new Date(window.from)), to: dhakaDate(new Date(window.to)) };
}

/** The equally long date-only window immediately before `window`. */
export function previousDateWindow(window: { from: string; to: string }): { from: string; to: string } {
    const from = Date.parse(`${window.from}T00:00:00Z`);
    const to = Date.parse(`${window.to}T00:00:00Z`);
    const spanDays = Math.max(Math.round((to - from) / 86_400_000), 0);
    const previousTo = new Date(from - 86_400_000);
    const previousFrom = new Date(previousTo.getTime() - spanDays * 86_400_000);
    return { from: previousFrom.toISOString().slice(0, 10), to: previousTo.toISOString().slice(0, 10) };
}

export function rangeToWindow(range: DashboardRange, now: Date = new Date()): { from: string; to: string } {
    const to = now.toISOString();
    // Shift into Dhaka local time to read the local calendar day...
    const local = new Date(now.getTime() + DHAKA_OFFSET_MINUTES * 60_000);
    const y = local.getUTCFullYear();
    const m = local.getUTCMonth();
    const d = local.getUTCDate();
    // ...then map a local midnight back to the UTC instant it occurs at.
    const localMidnightUtc = (yy: number, mm: number, dd: number) =>
        new Date(Date.UTC(yy, mm, dd) - DHAKA_OFFSET_MINUTES * 60_000).toISOString();

    if (range === 'today') return { from: localMidnightUtc(y, m, d), to };
    if (range === 'week') return { from: localMidnightUtc(y, m, d - 6), to };
    return { from: localMidnightUtc(y, m, 1), to };
}
