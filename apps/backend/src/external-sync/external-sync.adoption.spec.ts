import { ExternalSyncService } from './external-sync.service';
import {
    customerAdoptionWhere,
    productAdoptionWhere,
    supplierAdoptionWhere,
} from './external-sync.service';

/**
 * Adoption decides which existing record an imported one is welded to, and the
 * weld is permanent: a mapping is written and every document the import then
 * creates is billed against it. These tests pin the three properties that make
 * that safe to do unattended.
 */
describe('adoption query shape', () => {
    describe('products', () => {
        it('is scoped to the tenant and excludes deleted rows', () => {
            expect(productAdoptionWhere('tenant-1', 'SKU-1')).toEqual({
                tenant_id: 'tenant-1',
                sku: 'SKU-1',
                deleted_at: null,
            });
        });

        it('declines to match on a null sku', () => {
            // `sku` is nullable, so matching on it would adopt an arbitrary
            // untagged product.
            expect(productAdoptionWhere('tenant-1', null)).toBeNull();
        });

        it('declines to match on an empty sku', () => {
            expect(productAdoptionWhere('tenant-1', '')).toBeNull();
        });
    });

    describe('customers', () => {
        it('matches on phone only, never on customer_code', () => {
            const where = customerAdoptionWhere('tenant-1', '+8801712345678', 'C-101');
            expect(where).toEqual({
                tenant_id: 'tenant-1',
                phone: '+8801712345678',
                deleted_at: null,
            });
            expect(JSON.stringify(where)).not.toContain('C-101');
        });

        it('declines to match when there is no phone', () => {
            // `dedupeCode` builds customer_code from the provider's row id, so
            // it is not identity and cannot stand in for a missing phone.
            expect(customerAdoptionWhere('tenant-1', null, 'C-101')).toBeNull();
        });

        it('queries the phone exactly as given, without normalizing it', () => {
            // Customer.phone stores raw input, so normalizing here would look
            // for "+8801712345678" and miss the row saved as "01712345678",
            // silently creating a duplicate customer on every import.
            expect(customerAdoptionWhere('tenant-1', '01712345678', 'C-101')).toEqual({
                tenant_id: 'tenant-1',
                phone: '01712345678',
                deleted_at: null,
            });
        });
    });

    describe('suppliers', () => {
        it('excludes soft-deleted tombstones', () => {
            expect(supplierAdoptionWhere('tenant-1', 'Beximco')).toEqual({
                tenant_id: 'tenant-1',
                name: 'Beximco',
                deleted_at: null,
            });
        });

        it('declines to match an empty name', () => {
            expect(supplierAdoptionWhere('tenant-1', '')).toBeNull();
        });
    });
});

/**
 * A reviewed decision is stored as an ExternalSyncMapping row — the same table
 * `loadMappings` consults before any sync path decides for itself. This pins
 * that a decision actually reaches the run, so a refactor cannot quietly make
 * the importer re-decide what a human already settled.
 */
describe('a decided mapping takes precedence over adoption', () => {
    const connection = {
        id: 'conn-1',
        tenant_id: 'tenant-1',
        provider: 'EXPRESS_RETAIL_PRO',
        post_impacts: false,
    };

    const mappers = {
        product: () => ({
            externalId: 'ext-1',
            sku: 'SKU-1',
            name: 'Napa 500mg',
            price: 10,
            purchaseRate: 8,
            vatRate: null,
            reorderLevel: null,
            isService: false,
            externalUpdatedAt: null,
        }),
    } as never;

    function makeService(mappingRows: { external_id: string; internal_id: string }[]) {
        const db = {
            externalSyncMapping: {
                findMany: jest.fn().mockResolvedValue(mappingRows),
                upsert: jest.fn().mockResolvedValue({}),
            },
            product: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({ id: 'created-1' }),
            },
        };
        const service = new ExternalSyncService(db as never, { decrypt: jest.fn() } as never);
        return { db, service };
    }

    const client = { fetchProducts: jest.fn().mockResolvedValue([{ id: 1 }]) } as never;
    const stats = () => ({ products: { created: 0, updated: 0, skipped: 0 } }) as never;

    it('never runs the adoption query when a decision exists', async () => {
        const { db, service } = makeService([{ external_id: 'ext-1', internal_id: 'chosen-1' }]);

        await (service as never as { syncProducts: Function }).syncProducts(
            connection, client, stats(), [], false, mappers,
        );

        // The decided record was updated in place, and the SKU-matching
        // fallback that would have guessed a different one never ran.
        expect(db.product.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ id: 'chosen-1' }) }),
        );
        expect(db.product.findFirst).not.toHaveBeenCalled();
        expect(db.product.create).not.toHaveBeenCalled();
    });

    it('falls back to adoption when no decision was recorded', async () => {
        const { db, service } = makeService([]);

        await (service as never as { syncProducts: Function }).syncProducts(
            connection, client, stats(), [], false, mappers,
        );

        expect(db.product.updateMany).not.toHaveBeenCalled();
        expect(db.product.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { tenant_id: 'tenant-1', sku: 'SKU-1', deleted_at: null },
            }),
        );
    });
});
