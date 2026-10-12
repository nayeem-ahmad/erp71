import { planStockRepairs } from '@erp71/database/prisma/fix-stock-from-movements.utils';

/**
 * The plan behind `npm run fix:stock-from-movements`, which repairs stock left
 * standing by a "Clear transactions" that deleted the movements under it.
 */
describe('fix-stock-from-movements plan', () => {
    it('sets a doubled stock back to what its movements add up to', () => {
        // Cleared, then the same documents imported again: 60 left over + 60 new.
        const plan = planStockRepairs(
            [{ productId: 'p1', warehouseId: 'w1', quantity: 120 }],
            [{ productId: 'p1', warehouseId: 'w1', sum: 60 }],
            [{ productId: 'p1', qtyOnHand: 120 }],
        );

        expect(plan.stock).toEqual([{ productId: 'p1', warehouseId: 'w1', from: 120, to: 60 }]);
        expect(plan.pools).toEqual([{ productId: 'p1', from: 120, to: 60 }]);
        expect(plan.unmoved).toEqual([]);
    });

    it('leaves stock that already agrees alone', () => {
        const plan = planStockRepairs(
            [{ productId: 'p1', warehouseId: 'w1', quantity: -8 }],
            [{ productId: 'p1', warehouseId: 'w1', sum: -8 }],
            [{ productId: 'p1', qtyOnHand: -8 }],
        );
        expect(plan).toEqual({ stock: [], pools: [], unmoved: [] });
    });

    it('creates the missing row for movements that have none', () => {
        const plan = planStockRepairs([], [{ productId: 'p1', warehouseId: 'w1', sum: 5 }], []);
        expect(plan.stock).toEqual([{ productId: 'p1', warehouseId: 'w1', from: null, to: 5 }]);
    });

    it('reports stock with no movement behind it, and clears it only when asked', () => {
        const stocks = [{ productId: 'p1', warehouseId: 'w1', quantity: 30 }];
        const pools = [{ productId: 'p1', qtyOnHand: 30 }];

        const kept = planStockRepairs(stocks, [], pools);
        expect(kept.stock).toEqual([]);
        expect(kept.unmoved).toEqual(stocks);
        // Kept stock stays in the pool's count.
        expect(kept.pools).toEqual([]);

        const cleared = planStockRepairs(stocks, [], pools, { includeUnmoved: true });
        expect(cleared.stock).toEqual([{ productId: 'p1', warehouseId: 'w1', from: 30, to: 0 }]);
        expect(cleared.pools).toEqual([{ productId: 'p1', from: 30, to: 0 }]);
    });

    it("counts a product's pool across all its warehouses", () => {
        const plan = planStockRepairs(
            [
                { productId: 'p1', warehouseId: 'w1', quantity: 10 },
                { productId: 'p1', warehouseId: 'w2', quantity: 4 },
            ],
            [
                { productId: 'p1', warehouseId: 'w1', sum: 10 },
                { productId: 'p1', warehouseId: 'w2', sum: 4 },
            ],
            [{ productId: 'p1', qtyOnHand: 28 }],
        );
        expect(plan.stock).toEqual([]);
        expect(plan.pools).toEqual([{ productId: 'p1', from: 28, to: 14 }]);
    });
});
