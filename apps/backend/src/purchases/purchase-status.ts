/**
 * `Purchase.status` and the where-fragment every money query spreads in.
 *
 * The sales side has never needed this: `Sale.status` predates the module and
 * every report already filters `status: 'COMPLETED'`, so a cancelled sale falls
 * out on its own. A purchase had no lifecycle column at all until entry
 * cancellation added one, which means every existing query counted every row —
 * so each one has to opt in here rather than inherit the exclusion.
 *
 * One exported fragment rather than an inline `{ status: { not: 'CANCELLED' } }`
 * per call site, so `grep ACTIVE_PURCHASE` answers "which figures exclude a
 * cancelled bill?" and a new report is one import away from being right.
 */
export const PurchaseStatus = {
    RECORDED: 'RECORDED',
    CANCELLED: 'CANCELLED',
} as const;
export type PurchaseStatus = (typeof PurchaseStatus)[keyof typeof PurchaseStatus];

/**
 * Spread into a `Purchase` where-clause — or into the nested `purchase` filter
 * of a `PurchaseItem` query — to leave cancelled bills out.
 *
 * `not: 'CANCELLED'` rather than `equals: 'RECORDED'` on purpose: a future
 * status (DRAFT, say) should stay in the figures unless somebody decides
 * otherwise, and an equality check would silently drop it.
 */
export const ACTIVE_PURCHASE = { status: { not: PurchaseStatus.CANCELLED } } as const;

/**
 * `Purchase.payment_status` for an amount paid against a bill total.
 *
 * Two callers write this column — supplier payments allocated to a bill after
 * the fact, and a purchase entry that settles at the counter — and a bill that
 * one of them calls PAID and the other PARTIAL is a reconciliation bug waiting
 * to happen, so the thresholds live here rather than in either service.
 *
 * The 0.005 tolerances are the same ones the rest of the money code uses: these
 * are Decimal(12,2) columns, so anything under half a poisha is rounding, not a
 * balance.
 */
export function purchasePaymentStatus(paidAmount: number, totalAmount: number): string {
    if (paidAmount <= 0.005) return 'UNPAID';
    if (paidAmount >= totalAmount - 0.005) return 'PAID';
    return 'PARTIAL';
}
