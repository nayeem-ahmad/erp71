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
