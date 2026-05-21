/**
 * Formats a numeric amount as Bangladeshi Taka (BDT).
 * Uses the ৳ symbol followed by comma-grouped decimal value.
 */
export function formatBDT(amount: number | null | undefined): string {
    if (amount == null) return '৳ 0.00';
    return '৳ ' + Number(amount).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

// formatDate: formats a date string/Date using BD convention by default (DD/MM/YYYY)
// Pass locale='en' for English, 'bn' for Bangla
export function formatDate(date: string | Date | null | undefined, locale: 'en' | 'bn' = 'en'): string {
    if (!date) return '—';
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '—';
    // BD convention: DD/MM/YYYY
    return d.toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    });
}

// formatNumber: formats a number with locale-appropriate digit grouping
export function formatNumber(n: number, locale: 'en' | 'bn' = 'en'): string {
    return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-US').format(n);
}
