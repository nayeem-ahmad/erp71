/**
 * Formats a percentage rate (0–100) with up to one decimal place, or returns
 * `dash` when the rate has no base (null/undefined).
 */
export function formatRate(
    value: number | null | undefined,
    locale: string = 'en',
    dash: string = '—',
): string {
    if (value === null || value === undefined) {
        return dash;
    }
    const formatted = new Intl.NumberFormat(locale, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
    }).format(value);
    return `${formatted}%`;
}
