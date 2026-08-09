/**
 * Weighted-average cost pool.
 *
 * One running average per product per tenant, maintained by every stock
 * movement in the system. `applyInventoryMovement` calls into here, so there is
 * exactly one place a movement can change what a unit of stock is held at.
 *
 * The pool answers a single question: what did the goods leaving today
 * actually cost us. Before it existed a sale snapshotted the newest
 * `ProductPrice.cost` — a standard cost someone typed in, which drifted from
 * real buying prices the moment a supplier changed a rate.
 */

/** How a movement type is allowed to touch the average. */
export type CostBehaviour =
    /** Brings goods in at a cost of its own, so it moves the average. */
    | 'REVALUE'
    /** Undoes a receipt: leaves at the cost it came in at, pulling that value back out. */
    | 'REVERSE_RECEIPT'
    /** Changes quantity only. Issues leave at the current average; receipts join it unchanged. */
    | 'QUANTITY_ONLY';

/**
 * Movement types that carry their own cost.
 *
 * Everything absent from this map is QUANTITY_ONLY, which is the safe default:
 * a movement type nobody classified can shift stock around but can never
 * silently revalue the pool. A new movement type therefore has to be
 * *deliberately* added here to affect costing.
 */
const COST_BEHAVIOUR: Record<string, CostBehaviour> = {
    // Goods arriving from a supplier, from the factory floor, or as opening
    // stock — each with a real cost attached to the document that created it.
    PURCHASE_RECEIPT: 'REVALUE',
    INITIAL_STOCK: 'REVALUE',
    MANUFACTURING_OUTPUT: 'REVALUE',
    // Undoing a purchase return puts back goods that left at the return's own
    // cost, so they rejoin at that same cost rather than at today's average.
    // Kept symmetric with PURCHASE_RETURN below on purpose: if the two sides
    // used different costs, editing or deleting a purchase return would leave
    // the pool permanently richer or poorer than before the return existed.
    PURCHASE_RETURN_REVERSAL: 'REVALUE',
    PURCHASE_RETURN_DELETE: 'REVALUE',

    // Goods going back to a supplier. Not a sale — nothing was consumed, so
    // the value leaves at what was paid for it.
    PURCHASE_RETURN: 'REVERSE_RECEIPT',
    PURCHASE_RETURN_EDIT: 'REVERSE_RECEIPT',
};

export function costBehaviourFor(movementType: string): CostBehaviour {
    return COST_BEHAVIOUR[movementType] ?? 'QUANTITY_ONLY';
}

/** The pool as it stands before a movement. `avgCost: null` means no basis yet. */
export type CostPool = {
    avgCost: number | null;
    qtyOnHand: number;
};

export type CostOutcome = {
    /**
     * The cost to stamp on this movement's `InventoryMovement.unit_cost`. For
     * an issue this is the COGS of the goods leaving. Null when the pool has no
     * basis — the movement is real, but nobody can say what it cost.
     */
    movementUnitCost: number | null;
    pool: CostPool;
};

/**
 * Four decimal places throughout. An average divides, and rounding to paisa at
 * every receipt compounds: a product received a few hundred times drifts far
 * enough to be visible in a margin report. Callers round for display.
 */
function round4(value: number): number {
    return Math.round(value * 10000) / 10000;
}

/**
 * Apply one movement to a pool. Pure — all the cost rules live here, and the
 * database wrapper below is only plumbing.
 *
 * `unitCost` is what the *document* says the goods cost (a bill line, a job's
 * computed cost per unit). It is ignored for QUANTITY_ONLY movements, which is
 * what keeps a shrinkage write-off stamped with a selling price from poisoning
 * the average.
 */
export function applyToPool(
    pool: CostPool,
    movement: { quantityDelta: number; movementType: string; unitCost?: number | null },
): CostOutcome {
    const { quantityDelta, movementType } = movement;
    const unitCost = movement.unitCost ?? null;
    const behaviour = costBehaviourFor(movementType);
    const priorAvg = pool.avgCost;
    const priorQty = pool.qtyOnHand;
    const nextQty = priorQty + quantityDelta;

    if (behaviour === 'REVALUE' && quantityDelta > 0 && unitCost !== null) {
        // A pool with nothing (or less than nothing) in it has no value to
        // blend against: a negative balance is an artefact of a movement
        // recorded out of order, and treating its notional value as real would
        // drag the incoming cost toward a number that was never paid. The
        // arriving cost simply becomes the average.
        if (priorAvg === null || priorQty <= 0) {
            return {
                movementUnitCost: round4(unitCost),
                pool: { avgCost: round4(unitCost), qtyOnHand: nextQty },
            };
        }

        const blended = (priorQty * priorAvg + quantityDelta * unitCost) / nextQty;
        return {
            movementUnitCost: round4(unitCost),
            pool: { avgCost: round4(blended), qtyOnHand: nextQty },
        };
    }

    if (behaviour === 'REVERSE_RECEIPT' && quantityDelta < 0 && unitCost !== null) {
        // Nothing left to hold a value against, so there is no average to
        // restate — keep the last one as the basis for the next receipt.
        if (priorAvg === null || nextQty <= 0) {
            return {
                movementUnitCost: round4(unitCost),
                pool: { avgCost: priorAvg, qtyOnHand: nextQty },
            };
        }

        const remainingValue = priorQty * priorAvg - Math.abs(quantityDelta) * unitCost;
        // Returning goods at more than the pool holds would leave a negative
        // value behind — which happens when the return is priced off a later,
        // dearer bill than the stock on hand came from. Keep the existing
        // average rather than invent a negative cost.
        if (remainingValue < 0) {
            return {
                movementUnitCost: round4(unitCost),
                pool: { avgCost: priorAvg, qtyOnHand: nextQty },
            };
        }

        return {
            movementUnitCost: round4(unitCost),
            pool: { avgCost: round4(remainingValue / nextQty), qtyOnHand: nextQty },
        };
    }

    // Everything else moves quantity without disturbing the average: stock
    // transfers, count adjustments, shrinkage, sales and their returns. An
    // issue is stamped with the average, and that stamp is the COGS every
    // gross-profit report is built on.
    return {
        movementUnitCost: priorAvg === null ? null : round4(priorAvg),
        pool: { avgCost: priorAvg, qtyOnHand: nextQty },
    };
}

type DbLike = any;

/**
 * Read the pool, apply the movement, write it back.
 *
 * Runs inside the caller's transaction — `applyInventoryMovement` is never
 * called outside one. The quantity is updated atomically so it cannot drift
 * from the movement ledger under concurrent sales; the average is computed from
 * the quantity as read, so two receipts of the same product landing at the same
 * instant can blend against a slightly stale basis. That is a rounding-scale
 * error on a rare event, and the alternative — locking the row on every sale
 * line — would serialise the till.
 */
export async function applyCostMovement(
    tx: DbLike,
    params: {
        tenantId: string;
        productId: string;
        quantityDelta: number;
        movementType: string;
        unitCost?: number | null;
    },
): Promise<CostOutcome> {
    const { tenantId, productId, quantityDelta, movementType, unitCost } = params;

    const existing = await tx.productCost.findUnique({
        where: { tenant_id_product_id: { tenant_id: tenantId, product_id: productId } },
        select: { avg_cost: true, qty_on_hand: true },
    });

    const pool: CostPool = existing
        ? { avgCost: Number(existing.avg_cost), qtyOnHand: existing.qty_on_hand }
        : { avgCost: null, qtyOnHand: 0 };

    const outcome = applyToPool(pool, { quantityDelta, movementType, unitCost });

    // No basis before and none after: there is nothing worth a row. Writing one
    // with a zero average would claim the goods were free, which reads very
    // differently from "we do not know what these cost".
    if (outcome.pool.avgCost === null) {
        return outcome;
    }

    await tx.productCost.upsert({
        where: { tenant_id_product_id: { tenant_id: tenantId, product_id: productId } },
        update: {
            avg_cost: outcome.pool.avgCost,
            qty_on_hand: { increment: quantityDelta },
        },
        create: {
            tenant_id: tenantId,
            product_id: productId,
            avg_cost: outcome.pool.avgCost,
            qty_on_hand: outcome.pool.qtyOnHand,
        },
    });

    return outcome;
}

export const COSTING_METHODS = ['WEIGHTED_AVERAGE', 'LATEST_COST'] as const;
export type CostingMethod = (typeof COSTING_METHODS)[number];

export function isCostingMethod(value: unknown): value is CostingMethod {
    return typeof value === 'string' && (COSTING_METHODS as readonly string[]).includes(value);
}

/**
 * What each product currently costs, under the tenant's configured costing
 * method. The single answer to "what did these goods cost us" — used by sales
 * to snapshot `SaleItem.unit_cost_at_sale` and by manufacturing to value the
 * materials a job consumes.
 *
 * Called before the caller's stock movements run, so the average it returns is
 * the one the goods leave at: issues do not move the average, so resolving up
 * front and decrementing afterwards agree.
 *
 * `storeId` narrows the price-list fallback to a store's own cost where one
 * exists. Omit it for tenant-wide callers; the pool itself is tenant-wide
 * either way.
 *
 * A product missing from the returned map has no cost basis at all. Callers
 * must store null rather than substituting zero: a line with no known cost is
 * not a line with no cost, and reports that conflate the two show 100% margin
 * on stock nobody has priced.
 */
export async function resolveProductCosts(
    tx: DbLike,
    params: { tenantId: string; storeId?: string; productIds: string[] },
): Promise<Map<string, number>> {
    const { tenantId, storeId, productIds } = params;
    const costs = new Map<string, number>();

    if (productIds.length === 0) {
        return costs;
    }

    const settings = await tx.inventorySettings.findUnique({
        where: { tenant_id: tenantId },
        select: { costing_method: true },
    });
    // No settings row means the tenant never opened inventory settings, which
    // is most of them. The column default applies.
    const method: CostingMethod = isCostingMethod(settings?.costing_method)
        ? settings.costing_method
        : 'WEIGHTED_AVERAGE';

    // The standard cost someone typed into the price list. Under LATEST_COST it
    // is the answer; under WEIGHTED_AVERAGE it is the fallback for products the
    // pool has never seen — goods bought before this system, or stocked only by
    // transfer from a warehouse whose receipts predate the pool.
    const priceListCosts = new Map<string, number>();
    const productPrices = await tx.productPrice.findMany({
        where: {
            tenant_id: tenantId,
            product_id: { in: productIds },
            cost: { not: null },
            // Spelled out rather than passing `store_id: storeId` straight
            // through: an undefined value is "no filter" to Prisma, which would
            // silently let one store's cost answer for another.
            ...(storeId ? { OR: [{ store_id: storeId }, { store_id: null }] } : {}),
        },
        orderBy: { effective_from: 'desc' },
        select: { product_id: true, store_id: true, cost: true },
    });
    for (const pp of productPrices) {
        // findMany returns newest first, so the first row for a product wins —
        // unless a store-specific row turns up later, which overrides the
        // tenant-wide one for this store.
        if (!priceListCosts.has(pp.product_id) || pp.store_id === storeId) {
            priceListCosts.set(pp.product_id, Number(pp.cost));
        }
    }

    if (method === 'LATEST_COST') {
        return priceListCosts;
    }

    const pools = await tx.productCost.findMany({
        where: { tenant_id: tenantId, product_id: { in: productIds } },
        select: { product_id: true, avg_cost: true },
    });
    for (const pool of pools) {
        costs.set(pool.product_id, Number(pool.avg_cost));
    }

    for (const [productId, cost] of priceListCosts) {
        if (!costs.has(productId)) {
            costs.set(productId, cost);
        }
    }

    return costs;
}
