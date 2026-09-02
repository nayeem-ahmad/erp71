import type { DashboardRange } from '@/components/dashboard/DashboardHeader';
import { getActiveTimeZone } from '@/lib/format';
import { DEFAULT_TIMEZONE, startOfZonedDay } from '@/lib/timezones';

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

/**
 * The calendar day `at` falls on in the workspace's own zone, as `YYYY-MM-DD`.
 *
 * Must agree with the server, which measures every window and "today" filter in
 * `Tenant.timezone`. A fixed Dhaka offset here was right only while every tenant
 * was Bangladeshi: for anyone else it asked the dashboard for one day and then
 * drew a "today" ring on another. `en-CA` because it formats as `YYYY-MM-DD`.
 */
function activeZone(): string {
    const zone = getActiveTimeZone() ?? DEFAULT_TIMEZONE;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: zone });
        return zone;
    } catch {
        return DEFAULT_TIMEZONE;
    }
}

function tenantDate(at: Date): string {
    return at.toLocaleDateString('en-CA', { timeZone: activeZone() });
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
    return { from: tenantDate(new Date(window.from)), to: tenantDate(new Date(window.to)) };
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
    // Read the workspace's calendar day...
    const [y, m, d] = tenantDate(now).split('-').map(Number);
    // ...then map a local midnight back to the UTC instant it occurs at.
    const localMidnightUtc = (yy: number, mm: number, dd: number) =>
        startOfZonedDay(yy, mm, dd, activeZone()).toISOString();

    if (range === 'today') return { from: localMidnightUtc(y, m - 1, d), to };
    if (range === 'week') return { from: localMidnightUtc(y, m - 1, d - 6), to };
    return { from: localMidnightUtc(y, m - 1, 1), to };
}

/**
 * Weeks of history and of lookahead the CRM activity heatmap covers, either side
 * of the current week — 13 columns in all.
 */
export const HEATMAP_WEEKS_BACK = 10;
export const HEATMAP_WEEKS_AHEAD = 2;

const DAY_MS = 86_400_000;

/**
 * The activity heatmap's own window: whole Sunday-to-Saturday weeks, so every
 * column of the grid is a full week.
 *
 * It deliberately ignores the range switcher, twice over. A calendar of "today"
 * is one square; and the window has to run *past* today, because a PLANNED
 * activity is normally in the future and a window ending today would hide almost
 * every one of them.
 */
export function activityHeatmapWindow(now: Date = new Date()): { from: string; to: string } {
    const [year, month, day] = tenantDate(now).split('-').map(Number);
    const today = Date.UTC(year, month - 1, day);
    // Sunday-indexed, read off a UTC date so it matches the grid's row order.
    const weekday = new Date(today).getUTCDay();

    const from = today - (weekday + HEATMAP_WEEKS_BACK * 7) * DAY_MS;
    const to = today + (6 - weekday + HEATMAP_WEEKS_AHEAD * 7) * DAY_MS;

    return {
        from: new Date(from).toISOString().slice(0, 10),
        to: new Date(to).toISOString().slice(0, 10),
    };
}

/** The calendar day it is now in the workspace's zone, as `YYYY-MM-DD`. */
export function todayInTenantZone(now: Date = new Date()): string {
    return tenantDate(now);
}
