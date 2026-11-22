/** Reason catalogues behind stock discrepancy (Product Lost / Product Found) and stock takes. */
export const INVENTORY_REASON_TYPE = {
    PRODUCT_LOST: 'SHRINKAGE',
    PRODUCT_FOUND: 'FOUND',
    STOCK_TAKE: 'DISCREPANCY',
} as const;

/**
 * A blank custom reason (code or label never required on create) would render
 * as an empty <option>. Prefer the stored label, then the code, then a
 * caller-supplied fallback so the picker always has something to read.
 */
export function displayInventoryReasonLabel(
    reason: { label?: string | null; code?: string | null },
    unspecified: string,
): string {
    const label = String(reason.label ?? '').trim();
    if (label) return label;
    const code = String(reason.code ?? '').trim();
    return code || unspecified;
}
