import { resolveWarehouseId } from './inventory.utils';

/**
 * Unit tests for the warehouse resolver's default-selection priority:
 *   explicit id -> per-store default -> tenant-level default -> ensureDefaultWarehouse.
 */
describe('resolveWarehouseId', () => {
    const tenantId = 'tenant-1';
    const storeId = 'store-1';

    function makeTx(overrides: Partial<Record<string, any>> = {}) {
        return {
            warehouse: {
                findFirst: jest.fn(),
                count: jest.fn().mockResolvedValue(0),
                create: jest.fn(),
            },
            store: { findFirst: jest.fn() },
            storeInventoryDefaults: { findUnique: jest.fn().mockResolvedValue(null) },
            inventorySettings: { findUnique: jest.fn().mockResolvedValue(null) },
            ...overrides,
        } as any;
    }

    it('returns the explicit warehouse when it belongs to the store', async () => {
        const tx = makeTx();
        tx.warehouse.findFirst.mockResolvedValue({ id: 'wh-explicit' });

        const result = await resolveWarehouseId(tx, tenantId, storeId, 'wh-explicit', 'sale');

        expect(result).toBe('wh-explicit');
        // Explicit id short-circuits: no default lookups happen.
        expect(tx.storeInventoryDefaults.findUnique).not.toHaveBeenCalled();
        expect(tx.inventorySettings.findUnique).not.toHaveBeenCalled();
    });

    it('throws when the explicit warehouse does not belong to the store', async () => {
        const tx = makeTx();
        tx.warehouse.findFirst.mockResolvedValue(null);

        await expect(resolveWarehouseId(tx, tenantId, storeId, 'wh-x', 'sale')).rejects.toThrow(
            'Warehouse not found for this store.',
        );
    });

    it('prefers the per-store default over the tenant-level default', async () => {
        const tx = makeTx();
        tx.storeInventoryDefaults.findUnique.mockResolvedValue({ default_sales_warehouse_id: 'wh-store' });
        tx.inventorySettings.findUnique.mockResolvedValue({ default_sales_warehouse_id: 'wh-tenant' });
        tx.warehouse.findFirst.mockResolvedValue({ id: 'wh-store' });

        const result = await resolveWarehouseId(tx, tenantId, storeId, undefined, 'sale');

        expect(result).toBe('wh-store');
        expect(tx.inventorySettings.findUnique).not.toHaveBeenCalled();
    });

    it('falls through to the tenant-level default when the per-store default is inactive/missing', async () => {
        const tx = makeTx();
        tx.storeInventoryDefaults.findUnique.mockResolvedValue({ default_sales_warehouse_id: 'wh-store' });
        tx.inventorySettings.findUnique.mockResolvedValue({ default_sales_warehouse_id: 'wh-tenant' });
        // First lookup (per-store id) misses, second lookup (tenant id) hits.
        tx.warehouse.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'wh-tenant' });

        const result = await resolveWarehouseId(tx, tenantId, storeId, undefined, 'sale');

        expect(result).toBe('wh-tenant');
    });

    it('falls through to ensureDefaultWarehouse when the tenant default belongs to another store (no throw)', async () => {
        const tx = makeTx();
        tx.inventorySettings.findUnique.mockResolvedValue({ default_sales_warehouse_id: 'wh-other-store' });
        // Configured tenant default does not match this store -> findFirst returns null.
        tx.warehouse.findFirst
            .mockResolvedValueOnce(null) // tenant default lookup misses
            .mockResolvedValueOnce({ id: 'wh-store-default' }); // ensureDefaultWarehouse existing

        const result = await resolveWarehouseId(tx, tenantId, storeId, undefined, 'sale');

        expect(result).toBe('wh-store-default');
    });

    it('uses ensureDefaultWarehouse when no defaults are configured', async () => {
        const tx = makeTx();
        tx.warehouse.findFirst.mockResolvedValue({ id: 'wh-fallback' });

        const result = await resolveWarehouseId(tx, tenantId, storeId, undefined, 'sale');

        expect(result).toBe('wh-fallback');
    });
});
