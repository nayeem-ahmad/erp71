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
