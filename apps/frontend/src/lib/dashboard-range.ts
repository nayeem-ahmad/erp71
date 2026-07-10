import type { DashboardRange } from '@/components/dashboard/DashboardHeader';

// ERP71 serves Bangladeshi retailers; day boundaries are Asia/Dhaka (UTC+6).
const DHAKA_OFFSET_MINUTES = 360;

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
