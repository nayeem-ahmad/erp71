/**
 * Money as the web's `formatBDT` shows it — `৳ 1,234.50` — for text the
 * server writes for people to read: notification bodies, push messages.
 */
export function formatTaka(amount: number | string | null | undefined): string {
    const value = Number(amount ?? 0);
    const formatted = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `৳ ${value < 0 ? '-' : ''}${formatted}`;
}
