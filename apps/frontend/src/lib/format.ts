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
