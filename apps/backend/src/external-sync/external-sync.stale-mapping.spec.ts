import { ExternalSyncService } from './external-sync.service';

/**
 * `ExternalSyncMapping.internal_id` carries no foreign key — it names rows in
 * five different tables — so a mapping can outlive the row it points at, for
 * example when imported products are purged and the import is re-run.
 *
 * Before this was handled, the next run died on
 * "prisma.product.update() ... Record to update not found".
 */
describe('external-sync stale mapping repair', () => {
    const PRODUCT_ROW = {
        id: 135024,
        code: 'P01221',
        name: 'Pill Cutter',
        purchase_rate: '140.000',
        sale_rate: '360.000',
        vat: '0.000',
        reorder: '0.00',
        is_service: 'false',
        status: 'a',
        organization_id: '262',
        updated_at: null,
    };

    function makeDb(updateCount: number) {
        return {
            externalSyncMapping: {
                findMany: jest.fn(async () => [{ external_id: '135024', internal_id: 'gone-product-id' }]),
                deleteMany: jest.fn(async () => ({ count: 1 })),
                upsert: jest.fn(async () => ({})),
            },
            product: {
                updateMany: jest.fn(async () => ({ count: updateCount })),
                findFirst: jest.fn(async () => null),
                create: jest.fn(async () => ({ id: 'fresh-product-id' })),
            },
        } as any;
    }

    const connection = { id: 'conn-1', tenant_id: 'tenant-1' };
    const client = { fetchProducts: jest.fn(async () => [PRODUCT_ROW]) } as any;

    function emptyStats() {
        const tally = () => ({ created: 0, updated: 0, skipped: 0 });
        return {
            products: tally(),
            customers: tally(),
            suppliers: tally(),
            sales: tally(),
            purchases: tally(),
            customerPayments: tally(),
            supplierPayments: tally(),
            saleReturns: tally(),
        };
    }

    it('re-imports the record and repairs the link when the mapped row is gone', async () => {
        const db = makeDb(0); // nothing updated => the mapped product no longer exists
        const service = new ExternalSyncService(db, {} as any);
        const stats = emptyStats();
        const warnings: any[] = [];

        const map = await (service as any).syncProducts(connection, client, stats, warnings, false);

        // The dangling mapping is removed rather than left to fail again.
        expect(db.externalSyncMapping.deleteMany).toHaveBeenCalledWith({
            where: { connection_id: 'conn-1', entity_type: 'PRODUCT', external_id: '135024' },
        });
        // ...and the product is created fresh and re-linked.
        expect(db.product.create).toHaveBeenCalled();
        expect(db.externalSyncMapping.upsert).toHaveBeenCalled();
        expect(map.get('135024')).toBe('fresh-product-id');

        expect(stats.products.created).toBe(1);
        expect(warnings.map((w) => w.code)).toContain('STALE_MAPPING_REPAIRED');
    });

    it('updates in place and leaves the mapping alone when the row is still there', async () => {
        const db = makeDb(1);
        const service = new ExternalSyncService(db, {} as any);
        const stats = emptyStats();
        const warnings: any[] = [];

        await (service as any).syncProducts(connection, client, stats, warnings, false);

        expect(db.externalSyncMapping.deleteMany).not.toHaveBeenCalled();
        expect(db.product.create).not.toHaveBeenCalled();
        expect(stats.products.updated).toBe(1);
        expect(warnings).toHaveLength(0);
    });

    it('scopes the update to the tenant, so a mapping cannot reach across tenants', async () => {
        const db = makeDb(1);
        const service = new ExternalSyncService(db, {} as any);

        await (service as any).syncProducts(connection, client, emptyStats(), [], false);

        expect(db.product.updateMany.mock.calls[0][0].where).toEqual({
            id: 'gone-product-id',
            tenant_id: 'tenant-1',
        });
    });
});
