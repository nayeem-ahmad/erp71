/** Today as `YYYY-MM-DD` in the browser's own zone — what a date input expects. */
export function todayLocal(now: Date = new Date()): string {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** Whole calendar days from today to a `YYYY-MM-DD`; negative once it has passed. */
export function daysFromToday(day: string, now: Date = new Date()): number {
    const [y, m, d] = day.split('-').map(Number);
    const target = Date.UTC(y, (m ?? 1) - 1, d ?? 1);
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((target - today) / 86_400_000);
}
