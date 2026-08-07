import {
    applyToPool,
    applyCostMovement,
    costBehaviourFor,
    resolveProductCosts,
    type CostPool,
} from './product-cost.utils';

const EMPTY: CostPool = { avgCost: null, qtyOnHand: 0 };

describe('costBehaviourFor', () => {
    it('classifies a purchase receipt as revaluing', () => {
        expect(costBehaviourFor('PURCHASE_RECEIPT')).toBe('REVALUE');
    });

    it('defaults an unknown movement type to quantity-only', () => {
        // The safe default, and the reason it matters: a movement type added
        // later must not be able to move the average until someone classifies
        // it on purpose. Silently revaluing on an unclassified type is how a
        // stock-count adjustment would come to rewrite everyone's margins.
        expect(costBehaviourFor('SOME_FUTURE_MOVEMENT')).toBe('QUANTITY_ONLY');
    });

    it('treats sales and shrinkage as quantity-only', () => {
        expect(costBehaviourFor('SALE')).toBe('QUANTITY_ONLY');
        expect(costBehaviourFor('SHRINKAGE')).toBe('QUANTITY_ONLY');
        expect(costBehaviourFor('TRANSFER_IN')).toBe('QUANTITY_ONLY');
        expect(costBehaviourFor('STOCK_TAKE_ADJUSTMENT')).toBe('QUANTITY_ONLY');
    });
});

describe('applyToPool — receipts', () => {
    it('seeds the average from the first receipt', () => {
        const result = applyToPool(EMPTY, {
            quantityDelta: 10,
            movementType: 'PURCHASE_RECEIPT',
            unitCost: 80,
        });

        expect(result.pool).toEqual({ avgCost: 80, qtyOnHand: 10 });
        expect(result.movementUnitCost).toBe(80);
    });

    it('blends a second receipt at a different price', () => {
        // 10 @ 80 then 10 @ 100 → 1800 / 20 = 90.
        const pool = { avgCost: 80, qtyOnHand: 10 };
        const result = applyToPool(pool, {
            quantityDelta: 10,
            movementType: 'PURCHASE_RECEIPT',
            unitCost: 100,
        });

        expect(result.pool.avgCost).toBe(90);
        expect(result.pool.qtyOnHand).toBe(20);
        // The movement records what *this* delivery cost, not the new average —
        // the receipt document says 100, and the ledger should agree with it.
        expect(result.movementUnitCost).toBe(100);
    });

    it('weights the blend by quantity, not by number of receipts', () => {
        // 1 @ 100 then 99 @ 50 → 5050 / 100 = 50.50, not the 75 a naive
        // two-number mean would give.
        const result = applyToPool(
            { avgCost: 100, qtyOnHand: 1 },
            { quantityDelta: 99, movementType: 'PURCHASE_RECEIPT', unitCost: 50 },
        );

        expect(result.pool.avgCost).toBe(50.5);
    });

    it('takes the arriving cost when stock is negative', () => {
        // A replayed import can book a sale before the purchase that stocked
        // it. Blending against a negative quantity produces a cost nobody paid
        // — here it would come out at 20, well under the 80 actually spent.
        const result = applyToPool(
            { avgCost: 60, qtyOnHand: -5 },
            { quantityDelta: 10, movementType: 'PURCHASE_RECEIPT', unitCost: 80 },
        );

        expect(result.pool.avgCost).toBe(80);
        expect(result.pool.qtyOnHand).toBe(5);
    });

    it('takes the arriving cost when stock is exactly zero', () => {
        const result = applyToPool(
            { avgCost: 60, qtyOnHand: 0 },
            { quantityDelta: 4, movementType: 'PURCHASE_RECEIPT', unitCost: 90 },
        );

        expect(result.pool.avgCost).toBe(90);
    });

    it('leaves the average alone for a receipt with no cost on it', () => {
        const result = applyToPool(
            { avgCost: 75, qtyOnHand: 10 },
            { quantityDelta: 5, movementType: 'PURCHASE_RECEIPT', unitCost: null },
        );

        expect(result.pool).toEqual({ avgCost: 75, qtyOnHand: 15 });
    });

    it('ignores the cost on a quantity-only receipt', () => {
        // A transfer in carries no purchase of its own. Whatever cost a caller
        // passes, the goods rejoin at the average they left at.
        const result = applyToPool(
            { avgCost: 75, qtyOnHand: 10 },
            { quantityDelta: 5, movementType: 'TRANSFER_IN', unitCost: 999 },
        );

        expect(result.pool).toEqual({ avgCost: 75, qtyOnHand: 15 });
        expect(result.movementUnitCost).toBe(75);
    });
});

describe('applyToPool — issues', () => {
    it('stamps an issue with the average and leaves the average unchanged', () => {
        const result = applyToPool(
            { avgCost: 90, qtyOnHand: 20 },
            { quantityDelta: -3, movementType: 'SALE' },
        );

        // This stamp is the COGS every gross-profit report reads.
        expect(result.movementUnitCost).toBe(90);
        expect(result.pool).toEqual({ avgCost: 90, qtyOnHand: 17 });
    });

    it('reports no cost for an issue from a pool with no basis', () => {
        // Null, never zero. A line nobody has priced is not a line that cost
        // nothing, and reporting it as free is what made uncosted stock show
        // 100% margin.
        const result = applyToPool(EMPTY, { quantityDelta: -2, movementType: 'SALE' });

        expect(result.movementUnitCost).toBeNull();
        expect(result.pool.avgCost).toBeNull();
    });

    it('does not revalue when a sale drives stock negative', () => {
        const result = applyToPool(
            { avgCost: 50, qtyOnHand: 1 },
            { quantityDelta: -4, movementType: 'SALE' },
        );

        expect(result.pool).toEqual({ avgCost: 50, qtyOnHand: -3 });
        expect(result.movementUnitCost).toBe(50);
    });

    it('stamps shrinkage at cost, not at the selling price', () => {
        // The bug this replaces: inventory-shrinkage passed the product's
        // price, so a write-off was recorded at retail and overstated the loss
        // by the whole margin.
        const result = applyToPool(
            { avgCost: 40, qtyOnHand: 10 },
            { quantityDelta: -2, movementType: 'SHRINKAGE', unitCost: 120 },
        );

        expect(result.movementUnitCost).toBe(40);
        expect(result.pool.avgCost).toBe(40);
    });
});

describe('applyToPool — purchase returns', () => {
    it('pulls value out at the cost the goods came in at', () => {
        // 20 @ 90 = 1800. Return 10 of a batch bought at 100 → 800 over 10 = 80.
        const result = applyToPool(
            { avgCost: 90, qtyOnHand: 20 },
            { quantityDelta: -10, movementType: 'PURCHASE_RETURN', unitCost: 100 },
        );

        expect(result.pool.avgCost).toBe(80);
        expect(result.pool.qtyOnHand).toBe(10);
        expect(result.movementUnitCost).toBe(100);
    });

    it('nets to nothing when a return is reversed at the same cost', () => {
        const start = { avgCost: 90, qtyOnHand: 20 };
        const afterReturn = applyToPool(start, {
            quantityDelta: -10,
            movementType: 'PURCHASE_RETURN',
            unitCost: 100,
        });
        const afterReversal = applyToPool(afterReturn.pool, {
            quantityDelta: 10,
            movementType: 'PURCHASE_RETURN_REVERSAL',
            unitCost: 100,
        });

        // Undoing a purchase return has to leave the pool exactly where it
        // started, or editing one would ratchet the average every time.
        expect(afterReversal.pool).toEqual(start);
    });

    it('keeps the existing average when a return would empty the pool', () => {
        const result = applyToPool(
            { avgCost: 90, qtyOnHand: 10 },
            { quantityDelta: -10, movementType: 'PURCHASE_RETURN', unitCost: 100 },
        );

        expect(result.pool.avgCost).toBe(90);
        expect(result.pool.qtyOnHand).toBe(0);
    });

    it('keeps the existing average when a return costs more than the pool holds', () => {
        // 5 @ 40 = 200 in the pool; returning 2 priced off a later, dearer bill
        // at 150 would take out 300 and leave a negative value behind.
        const result = applyToPool(
            { avgCost: 40, qtyOnHand: 5 },
            { quantityDelta: -2, movementType: 'PURCHASE_RETURN', unitCost: 150 },
        );

        expect(result.pool.avgCost).toBe(40);
        expect(result.pool.qtyOnHand).toBe(3);
    });
});

describe('applyToPool — precision', () => {
    it('holds four decimals rather than rounding to paisa', () => {
        // 3 @ 10 then 3 @ 10.01 → 30.015 / 6 = 10.005.
        const result = applyToPool(
            { avgCost: 10, qtyOnHand: 3 },
            { quantityDelta: 3, movementType: 'PURCHASE_RECEIPT', unitCost: 10.01 },
        );

        expect(result.pool.avgCost).toBe(10.005);
    });

    it('does not drift over a long run of receipts', () => {
        // Rounding to 2dp at every step is the failure mode this guards: 300
        // alternating receipts compound the error far enough to show up in a
        // margin report. Every receipt here is 10 or 20 in equal quantity, so
        // the true average is exactly 15.
        let pool: CostPool = EMPTY;
        for (let i = 0; i < 300; i += 1) {
            pool = applyToPool(pool, {
                quantityDelta: 7,
                movementType: 'PURCHASE_RECEIPT',
                unitCost: i % 2 === 0 ? 10 : 20,
            }).pool;
        }

        expect(pool.avgCost).toBeCloseTo(15, 3);
        expect(pool.qtyOnHand).toBe(2100);
    });
});

describe('applyCostMovement', () => {
    const dbWith = (existing: { avg_cost: number; qty_on_hand: number } | null) => ({
        productCost: {
            findUnique: jest.fn().mockResolvedValue(existing),
            upsert: jest.fn().mockResolvedValue({}),
        },
    }) as any;

    it('increments quantity atomically rather than writing the computed total', async () => {
        // Two sales of one product can land at the same instant. The average is
        // computed from the quantity as read and may be a hair stale, but the
        // quantity itself must never be, or the pool drifts from the movement
        // ledger under any concurrency at the till.
        const tx = dbWith({ avg_cost: 90, qty_on_hand: 20 });

        await applyCostMovement(tx, {
            tenantId: 't1',
            productId: 'p1',
            quantityDelta: -3,
            movementType: 'SALE',
        });

        expect(tx.productCost.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                update: { avg_cost: 90, qty_on_hand: { increment: -3 } },
            }),
        );
    });

    it('writes no row when there is no cost basis to record', async () => {
        // A zero average would claim the goods were free, which reads very
        // differently from "we do not know what these cost".
        const tx = dbWith(null);

        const outcome = await applyCostMovement(tx, {
            tenantId: 't1',
            productId: 'p1',
            quantityDelta: -2,
            movementType: 'SALE',
        });

        expect(tx.productCost.upsert).not.toHaveBeenCalled();
        expect(outcome.movementUnitCost).toBeNull();
    });

    it('scopes the pool lookup to the tenant', async () => {
        const tx = dbWith(null);

        await applyCostMovement(tx, {
            tenantId: 't1',
            productId: 'p1',
            quantityDelta: 5,
            movementType: 'PURCHASE_RECEIPT',
            unitCost: 12,
        });

        expect(tx.productCost.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { tenant_id_product_id: { tenant_id: 't1', product_id: 'p1' } },
            }),
        );
    });
});

describe('resolveProductCosts', () => {
    const dbWith = (opts: {
        costingMethod?: string | null;
        pools?: Array<{ product_id: string; avg_cost: number }>;
        prices?: Array<{ product_id: string; store_id: string | null; cost: number }>;
    }) => ({
        inventorySettings: {
            findUnique: jest.fn().mockResolvedValue(
                opts.costingMethod === null ? null : { costing_method: opts.costingMethod ?? 'WEIGHTED_AVERAGE' },
            ),
        },
        productCost: { findMany: jest.fn().mockResolvedValue(opts.pools ?? []) },
        productPrice: { findMany: jest.fn().mockResolvedValue(opts.prices ?? []) },
    }) as any;

    const call = (tx: any, productIds = ['p1']) =>
        resolveProductCosts(tx, { tenantId: 't1', storeId: 's1', productIds });

    it('prefers the weighted average over the price-list cost', async () => {
        const tx = dbWith({
            pools: [{ product_id: 'p1', avg_cost: 82.5 }],
            prices: [{ product_id: 'p1', store_id: null, cost: 100 }],
        });

        expect((await call(tx)).get('p1')).toBe(82.5);
    });

    it('falls back to the price-list cost for a product the pool has never seen', async () => {
        // Goods bought before this system, or stocked only by transfer. A
        // stale standard cost beats no cost at all.
        const tx = dbWith({
            pools: [],
            prices: [{ product_id: 'p1', store_id: null, cost: 100 }],
        });

        expect((await call(tx)).get('p1')).toBe(100);
    });

    it('omits a product with no basis anywhere', async () => {
        const tx = dbWith({ pools: [], prices: [] });

        expect((await call(tx)).has('p1')).toBe(false);
    });

    it('ignores the pool entirely under LATEST_COST', async () => {
        const tx = dbWith({
            costingMethod: 'LATEST_COST',
            pools: [{ product_id: 'p1', avg_cost: 82.5 }],
            prices: [{ product_id: 'p1', store_id: null, cost: 100 }],
        });

        expect((await call(tx)).get('p1')).toBe(100);
        expect(tx.productCost.findMany).not.toHaveBeenCalled();
    });

    it('defaults to weighted average when the tenant has no settings row', async () => {
        // Most tenants never open inventory settings. They get the column
        // default, not a crash and not the old behaviour.
        const tx = dbWith({
            costingMethod: null,
            pools: [{ product_id: 'p1', avg_cost: 82.5 }],
        });

        expect((await call(tx)).get('p1')).toBe(82.5);
    });

    it('lets a store-specific price-list cost override the tenant-wide one', async () => {
        const tx = dbWith({
            costingMethod: 'LATEST_COST',
            prices: [
                { product_id: 'p1', store_id: null, cost: 100 },
                { product_id: 'p1', store_id: 's1', cost: 95 },
            ],
        });

        expect((await call(tx)).get('p1')).toBe(95);
    });

    it('does not query at all for an empty basket', async () => {
        const tx = dbWith({});

        expect((await call(tx, [])).size).toBe(0);
        expect(tx.inventorySettings.findUnique).not.toHaveBeenCalled();
    });
});
