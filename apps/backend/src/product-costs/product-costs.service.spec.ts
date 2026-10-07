import { BadRequestException } from '@nestjs/common';
import { ProductCostsService } from './product-costs.service';

function product(overrides: Record<string, any> = {}) {
    return {
        id: 'p1',
        name: 'Rice 5kg',
        sku: 'RICE-5',
        unit_type: 'none',
        price: 600,
        group: null,
        cost: null,
        stocks: [{ quantity: 4 }, { quantity: 6 }],
        ...overrides,
    };
}

function makeDb(opts: {
    products?: any[];
    costingMethod?: string | null;
    prices?: any[];
    purchaseLines?: any[];
    counts?: number[];
} = {}) {
    const counts = [...(opts.counts ?? [1, 12, 5, 3])];
    const tx = {
        product: {
            findFirst: jest.fn().mockResolvedValue({ id: 'p1', name: 'Rice 5kg', type: 'GOODS' }),
        },
        productCost: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({}),
        },
        productStock: {
            aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 10 } }),
        },
        productCostAdjustment: {
            create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: `adj-${data.product_id}`, ...data })),
        },
    };
    const db: any = {
        product: {
            findMany: jest.fn().mockResolvedValue(opts.products ?? [product()]),
            count: jest.fn().mockImplementation(() => Promise.resolve(counts.shift() ?? 0)),
        },
        inventorySettings: {
            findUnique: jest.fn().mockResolvedValue(
                opts.costingMethod === undefined ? null : { costing_method: opts.costingMethod },
            ),
        },
        productPrice: { findMany: jest.fn().mockResolvedValue(opts.prices ?? []) },
        purchaseItem: { findMany: jest.fn().mockResolvedValue(opts.purchaseLines ?? []) },
        productCostAdjustment: {
            findMany: jest.fn().mockResolvedValue([]),
            count: jest.fn().mockResolvedValue(0),
        },
        $transaction: jest.fn().mockImplementation((cb) => cb(tx)),
    };
    return { db, tx };
}

describe('ProductCostsService.list', () => {
    it('reports an uncosted product with its stock and no value, and suggests the last bill', async () => {
        const { db } = makeDb({
            purchaseLines: [{ product_id: 'p1', unit_cost: 455, purchase: { created_at: new Date('2026-09-01') } }],
        });
        const service = new ProductCostsService(db);

        const result = await service.list('t1', { page: 1, limit: 50 } as any);

        expect(result.items[0]).toMatchObject({
            onHand: 10,
            averageCost: null,
            priceListCost: null,
            effectiveCost: null,
            costBasis: 'UNCOSTED',
            // Null, not zero: "we do not know" is not "worth nothing".
            stockValue: null,
            lastPurchaseCost: 455,
        });
        expect(result.costingMethod).toBe('WEIGHTED_AVERAGE');
    });

    it('prefers the pool under weighted average and the price list under latest cost', async () => {
        const rows = [product({ cost: { avg_cost: 80, updated_at: new Date() } })];
        const prices = [{ product_id: 'p1', cost: 95 }];

        const weighted = await new ProductCostsService(makeDb({ products: rows, prices }).db).list('t1', {} as any);
        expect(weighted.items[0]).toMatchObject({ effectiveCost: 80, costBasis: 'WEIGHTED_AVERAGE', stockValue: 800 });

        const latest = await new ProductCostsService(
            makeDb({ products: rows, prices, costingMethod: 'LATEST_COST' }).db,
        ).list('t1', {} as any);
        expect(latest.items[0]).toMatchObject({ effectiveCost: 95, costBasis: 'LATEST_COST', stockValue: 950 });
    });

    it('falls back to the other source when the method\'s own has nothing', async () => {
        const { db } = makeDb({ products: [product()], prices: [{ product_id: 'p1', cost: 70 }] });

        const result = await new ProductCostsService(db).list('t1', {} as any);

        expect(result.items[0]).toMatchObject({ effectiveCost: 70, costBasis: 'LATEST_COST' });
    });

    it('filters to products with no basis anywhere, never services or deleted rows', async () => {
        const { db } = makeDb();

        await new ProductCostsService(db).list('t1', { status: 'UNCOSTED', inStockOnly: true, search: ' rice ' } as any);

        const where = db.product.findMany.mock.calls[0][0].where;
        expect(where).toMatchObject({ tenant_id: 't1', deleted_at: null, type: { not: 'SERVICE' } });
        expect(where.AND).toEqual(
            expect.arrayContaining([
                { cost: { is: null } },
                { prices: { none: { cost: { not: null } } } },
                { stocks: { some: { quantity: { not: 0 } } } },
                { OR: [
                    { name: { contains: 'rice', mode: 'insensitive' } },
                    { sku: { contains: 'rice', mode: 'insensitive' } },
                ] },
            ]),
        );
    });

    it('returns tenant-wide counts alongside the page', async () => {
        const { db } = makeDb({ counts: [1, 12, 5, 3] });

        const result = await new ProductCostsService(db).list('t1', {} as any);

        expect(result.summary).toEqual({ productCount: 12, uncostedCount: 5, uncostedInStockCount: 3 });
        // Nested, so the response interceptor does not mistake it for a bare
        // paginated list and drop the summary.
        expect(result).not.toHaveProperty('total');
        expect(result.pagination).toEqual({ total: 1, page: 1, limit: 50, pages: 1 });
    });

    it('caps the page size at 100', async () => {
        const { db } = makeDb();

        await new ProductCostsService(db).list('t1', { limit: 500 } as any);

        expect(db.product.findMany.mock.calls[0][0].take).toBe(100);
    });
});

describe('ProductCostsService.adjust', () => {
    it('records every line in one transaction with the caller as author', async () => {
        const { db, tx } = makeDb();

        const result = await new ProductCostsService(db).adjust('t1', 'u1', {
            items: [
                { productId: 'p1', unitCost: 40 },
                { productId: 'p2', unitCost: 55 },
            ],
            note: 'opening count, Sept',
        });

        expect(db.$transaction).toHaveBeenCalledTimes(1);
        expect(result.adjusted).toBe(2);
        expect(tx.productCostAdjustment.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ product_id: 'p2', new_cost: 55, created_by: 'u1', reason: 'OPENING_COST', note: 'opening count, Sept' }),
        });
    });

    it('refuses the same product twice in one batch', async () => {
        const { db } = makeDb();

        await expect(
            new ProductCostsService(db).adjust('t1', 'u1', {
                items: [
                    { productId: 'p1', unitCost: 40 },
                    { productId: 'p1', unitCost: 45 },
                ],
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('fails the whole batch when one line is refused', async () => {
        const { db, tx } = makeDb();
        // p2 already has a cost and no reason was given.
        tx.productCost.findUnique.mockImplementation(({ where }: any) =>
            Promise.resolve(where.tenant_id_product_id.product_id === 'p2' ? { avg_cost: 50 } : null),
        );

        await expect(
            new ProductCostsService(db).adjust('t1', 'u1', {
                items: [
                    { productId: 'p1', unitCost: 40 },
                    { productId: 'p2', unitCost: 45 },
                ],
            }),
        ).rejects.toThrow(/correction or a write-down/);
    });
});

describe('ProductCostsService.history', () => {
    it('reports the value each adjustment moved, and none for an opening cost', async () => {
        const { db } = makeDb();
        db.productCostAdjustment.findMany.mockResolvedValue([
            {
                id: 'a2', reason: 'WRITE_DOWN', previous_cost: 80, new_cost: 50, qty_on_hand: 12, note: 'water damage',
                product: { id: 'p1', name: 'Rice 5kg', sku: 'RICE-5' },
                creator: { id: 'u1', name: null, email: 'owner@shop.bd' },
                created_at: new Date('2026-10-02'),
            },
            {
                id: 'a1', reason: 'OPENING_COST', previous_cost: null, new_cost: 80, qty_on_hand: 12, note: null,
                product: { id: 'p1', name: 'Rice 5kg', sku: 'RICE-5' },
                creator: null,
                created_at: new Date('2026-10-01'),
            },
        ]);
        db.productCostAdjustment.count.mockResolvedValue(2);

        const result = await new ProductCostsService(db).history('t1', { productId: 'p1' } as any);

        expect(db.productCostAdjustment.findMany.mock.calls[0][0].where).toEqual({ tenant_id: 't1', product_id: 'p1' });
        expect(result.items[0]).toMatchObject({ valueChange: -360, createdBy: { id: 'u1', name: 'owner@shop.bd' } });
        expect(result.items[1]).toMatchObject({ valueChange: null, previousCost: null, createdBy: null });
        expect(result.total).toBe(2);
    });
});
