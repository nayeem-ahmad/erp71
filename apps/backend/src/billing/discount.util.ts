export type SubscriptionDiscountType = 'PERCENTAGE' | 'FIXED';

/**
 * Apply an admin-granted subscription discount to a base fee.
 * - PERCENTAGE: `value` is the percent off (e.g. 10 → 10% off)
 * - FIXED: `value` is a flat amount off in the same currency as `base`
 * Result is floored at 0 and rounded to 2 decimal places.
 * A null/unknown discount type returns `base` unchanged.
 */
export function applySubscriptionDiscount(
    base: number,
    type: string | null | undefined,
    value: number | null | undefined,
): number {
    const amount = value ?? 0;
    if (!type || amount <= 0) return base;

    let net = base;
    if (type === 'PERCENTAGE') {
        net = base * (100 - amount) / 100;
    } else if (type === 'FIXED') {
        net = base - amount;
    }

    return Math.max(0, Math.round(net * 100) / 100);
}
