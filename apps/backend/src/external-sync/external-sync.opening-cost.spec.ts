import { ExternalSyncService } from './external-sync.service';

/**
 * Imported products carried a buying rate that was dropped, and imported
 * purchases never cost the pool — so stock brought over from another system
 * sold with no COGS at all. The product sync now seeds an opening cost from that
 * rate, but only where nothing better is on file.
 */
describe('product sync seeds an opening cost from the provider buying rate', () => {
    const connection = { id: 'conn-1', tenant_id: 'tenant-1' };
    const client = { fetchProducts: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]) } as never;
    const stats = () => ({ products: { created: 0, updated: 0, skipped: 0 } }) as never;

    function mappersFor(rows: Array<{ externalId: string; purchaseRate: number; isService?: boolean }>) {
        let call = 0;
        return {
            product: () => {
                const row = rows[call++];
                return {
                    externalId: row.externalId,
                    sku: `SKU-${row.externalId}`,
                    name: `Product ${row.externalId}`,
                    price: 100,
                    purchaseRate: row.purchaseRate,
                    vatRate: null,
                    reorderLevel: null,
                    isService: row.isService ?? false,
                    externalUpdatedAt: null,
                };
            },
        } as never;
    }

    function makeService(opts: { pooled?: string[]; priced?: string[] } = {}) {
        const tx = {
            product: {
                findFirst: jest.fn().mockImplementation(({ where }) =>
                    Promise.resolve({ id: where.id, name: `Product ${where.id}`, type: 'GOODS' }),
                ),
            },
            productCost: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
            productStock: { aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 0 } }) },
            productCostAdjustment: { create: jest.fn().mockResolvedValue({}) },
        };
        let created = 0;
        const db = {
            externalSyncMapping: {
                findMany: jest.fn().mockResolvedValue([]),
                upsert: jest.fn().mockResolvedValue({}),
            },
            product: {
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockImplementation(() => Promise.resolve({ id: `p${++created}` })),
            },
            productCost: {
                findMany: jest.fn().mockResolvedValue((opts.pooled ?? []).map((product_id) => ({ product_id }))),
            },
            productPrice: {
                findMany: jest.fn().mockResolvedValue((opts.priced ?? []).map((product_id) => ({ product_id }))),
            },
            $transaction: jest.fn().mockImplementation((cb) => cb(tx)),
        };
        const service = new ExternalSyncService(db as never, { decrypt: jest.fn() } as never, {} as never);
        const syncProducts = (service as never as { syncProducts: Function }).syncProducts.bind(service);
        return { db, tx, syncProducts };
    }

    it('costs an uncosted product at its buying rate', async () => {
        const { tx, syncProducts } = makeService();

        await syncProducts(connection, client, stats(), [], false, mappersFor([
            { externalId: 'a', purchaseRate: 80 },
            { externalId: 'b', purchaseRate: 45.5 },
        ]));

        expect(tx.productCostAdjustment.create).toHaveBeenCalledTimes(2);
        expect(tx.productCostAdjustment.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ product_id: 'p2', reason: 'OPENING_COST', new_cost: 45.5 }),
        });
    });

    it('never overrides a pool or a price-list cost already on file', async () => {
        const { tx, syncProducts } = makeService({ pooled: ['p1'], priced: ['p2'] });

        await syncProducts(connection, client, stats(), [], false, mappersFor([
            { externalId: 'a', purchaseRate: 80 },
            { externalId: 'b', purchaseRate: 45.5 },
        ]));

        expect(tx.productCostAdjustment.create).not.toHaveBeenCalled();
    });

    it('skips services, missing rates and dry runs', async () => {
        const { db, syncProducts } = makeService();

        await syncProducts(connection, client, stats(), [], false, mappersFor([
            { externalId: 'a', purchaseRate: 80, isService: true },
            { externalId: 'b', purchaseRate: 0 },
        ]));
        expect(db.$transaction).not.toHaveBeenCalled();

        const dry = makeService();
        await dry.syncProducts(connection, client, stats(), [], true, mappersFor([
            { externalId: 'a', purchaseRate: 80 },
            { externalId: 'b', purchaseRate: 90 },
        ]));
        expect(dry.db.$transaction).not.toHaveBeenCalled();
    });

    it('warns and carries on when one product cannot be costed', async () => {
        const { tx, syncProducts } = makeService();
        tx.productCostAdjustment.create
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce({});
        const warnings: any[] = [];

        const map = await syncProducts(connection, client, stats(), warnings, false, mappersFor([
            { externalId: 'a', purchaseRate: 80 },
            { externalId: 'b', purchaseRate: 90 },
        ]));

        // The product itself still imported; only its cost is missing.
        expect(map.get('a')).toBe('p1');
        expect(warnings).toEqual([expect.objectContaining({ externalId: 'a', code: 'COST_NOT_SET' })]);
        expect(tx.productCostAdjustment.create).toHaveBeenCalledTimes(2);
    });
});
