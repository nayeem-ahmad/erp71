import type { DashboardRange } from '@/components/dashboard/DashboardHeader';

export function rangeToWindow(range: DashboardRange, now: Date = new Date()): { from: string; to: string } {
    const to = now.toISOString();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    if (range === 'today') {
        return { from: start.toISOString(), to };
    }
    if (range === 'week') {
        start.setUTCDate(start.getUTCDate() - 6);
        return { from: start.toISOString(), to };
    }
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { from: monthStart.toISOString(), to };
}
