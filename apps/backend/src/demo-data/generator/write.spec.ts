import { DemoWriter } from './write';

/**
 * A random source with every choice scripted, so a basket can be built that
 * the real generator only reaches by chance: the same product picked twice.
 */
function scriptedRng(script: { itemCount: number; quantity: number }) {
    return {
        weighted<T>(items: readonly T[]): T {
            if (items.length === 5 && items[0] === (1 as unknown as T) && items[4] === (5 as unknown as T)) {
                return script.itemCount as unknown as T;
            }
            if (items.length === 5 && items[4] === (10 as unknown as T)) return script.quantity as unknown as T;
            return items[0];
        },
        chance: () => false,
        int: (min: number) => min,
        range: (min: number) => min,
        pick: <T>(items: readonly T[]) => items[0],
        noise: () => 1,
    };
}

describe('DemoWriter.writeSale', () => {
    it('never sells more of a product than is on the shelf when one basket picks it twice', async () => {
        const store = { storeId: 'store-1', warehouseId: 'wh-1' };
        const bundle = {
            id: 'bundle',
            sku: 'D1-BUNDLE-01',
            name: 'Family Combo Pack',
            sellPrice: 100,
            cost: 70,
            reorderLevel: 1,
            popularityWeight: 4,
            supplierIndex: 0,
            warranty: false,
            stock: new Map([['wh-1', 4]]),
        };
        const world = {
            tenantId: 't-1',
            userId: 'u-1',
            rng: scriptedRng({ itemCount: 2, quantity: 3 }),
            products: [bundle],
            customers: [],
            ref: () => 'S-1',
        };

        // Stop at the sale itself and look at what it would have sold.
        const sold = new Error('captured');
        let lines: Array<{ product_id: string; quantity: number }> = [];
        const tx = {
            sale: {
                create: jest.fn(async (args: { data: { items: { create: typeof lines } } }) => {
                    lines = args.data.items.create;
                    throw sold;
                }),
            },
        };

        const writer = new DemoWriter(world as never);
        await expect(writer.writeSale(tx as never, new Date('2026-11-01T10:00:00Z'), store as never, 1)).rejects.toBe(sold);

        // Two picks of three against a shelf of four: four sold, not six.
        expect(lines).toEqual([expect.objectContaining({ product_id: 'bundle', quantity: 4 })]);
    });
});
