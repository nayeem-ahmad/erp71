import { BadRequestException } from '@nestjs/common';

import {
    resolveEntryWarehouses,
    reversalWarehouseResolver,
    usableWarehouseIds,
} from './inventory.utils';

const TENANT = 'tenant-1';
const STORE = 'store-1';

/**
 * The slice of the client these helpers touch. `findFirst` answers the
 * single-warehouse lookups inside `resolveWarehouseId`; `findMany` answers the
 * set lookups the new helpers do.
 */
function makeTx(warehouses: Array<{ id: string; store_id?: string; is_active?: boolean }>) {
    const rows = warehouses.map((warehouse) => ({
        store_id: STORE,
        is_active: true,
        tenant_id: TENANT,
        ...warehouse,
    }));

    const matches = (where: any, row: any) =>
        (where.id?.in ? where.id.in.includes(row.id) : !where.id || where.id === row.id)
        && (where.tenant_id === undefined || where.tenant_id === row.tenant_id)
        && (where.store_id === undefined || where.store_id === row.store_id)
        && (where.is_active === undefined || where.is_active === row.is_active);

    return {
        warehouse: {
            findFirst: jest.fn(async ({ where }: any) => rows.find((row) => matches(where, row)) ?? null),
            findMany: jest.fn(async ({ where }: any) => rows.filter((row) => matches(where, row))),
        },
        inventorySettings: { findUnique: jest.fn(async () => null) },
        store: { findFirst: jest.fn(async () => ({ id: STORE, name: 'Main' })) },
    };
}

describe('resolveEntryWarehouses', () => {
    it('falls back to the tenant default and applies it to every line', async () => {
        const tx = makeTx([{ id: 'wh-default', is_active: true }]);

        const warehouses = await resolveEntryWarehouses(tx, TENANT, STORE, undefined, [undefined, null], 'sale');

        expect(warehouses.entryWarehouseId).toBe('wh-default');
        expect(warehouses.warehouseIdFor(undefined)).toBe('wh-default');
        expect(warehouses.warehouseIdFor(null)).toBe('wh-default');
    });

    it('lets a line override the entry warehouse', async () => {
        const tx = makeTx([{ id: 'wh-main' }, { id: 'wh-annex' }]);

        const warehouses = await resolveEntryWarehouses(tx, TENANT, STORE, 'wh-main', ['wh-annex'], 'sale');

        expect(warehouses.entryWarehouseId).toBe('wh-main');
        expect(warehouses.warehouseIdFor('wh-annex')).toBe('wh-annex');
        expect(warehouses.warehouseIdFor(undefined)).toBe('wh-main');
    });

    it('validates the distinct overrides in a single query', async () => {
        // The point of resolving the set rather than the lines: a fifty-line
        // document must not cost fifty round trips.
        const tx = makeTx([{ id: 'wh-main' }, { id: 'wh-annex' }]);

        await resolveEntryWarehouses(
            tx,
            TENANT,
            STORE,
            'wh-main',
            ['wh-annex', 'wh-annex', 'wh-main', undefined],
            'sale',
        );

        expect(tx.warehouse.findMany).toHaveBeenCalledTimes(1);
        expect(tx.warehouse.findMany.mock.calls[0][0].where.id.in).toEqual(['wh-annex']);
    });

    it('skips the override query when no line names a warehouse', async () => {
        const tx = makeTx([{ id: 'wh-main' }]);

        await resolveEntryWarehouses(tx, TENANT, STORE, 'wh-main', [undefined, undefined], 'sale');

        expect(tx.warehouse.findMany).not.toHaveBeenCalled();
    });

    it('rejects a line warehouse belonging to another store', async () => {
        // A line that could reach another branch's warehouse would move stock
        // between branches without a transfer, which is the whole reason
        // transfers exist.
        const tx = makeTx([{ id: 'wh-main' }, { id: 'wh-other-branch', store_id: 'store-2' }]);

        await expect(
            resolveEntryWarehouses(tx, TENANT, STORE, 'wh-main', ['wh-other-branch'], 'sale'),
        ).rejects.toThrow(BadRequestException);
    });

    it('rejects a line warehouse that has been deactivated', async () => {
        const tx = makeTx([{ id: 'wh-main' }, { id: 'wh-closed', is_active: false }]);

        await expect(
            resolveEntryWarehouses(tx, TENANT, STORE, 'wh-main', ['wh-closed'], 'sale'),
        ).rejects.toThrow(BadRequestException);
    });
});

describe('reversalWarehouseResolver', () => {
    it('sends a line back to its own warehouse', async () => {
        const tx = makeTx([{ id: 'wh-main' }, { id: 'wh-annex' }]);
        const resolve = reversalWarehouseResolver(tx, TENANT, STORE, 'wh-main', 'sale');

        expect(await resolve('wh-annex')).toBe('wh-annex');
        expect(tx.warehouse.findFirst).not.toHaveBeenCalled();
    });

    it("falls back to the document's warehouse without querying", async () => {
        const tx = makeTx([{ id: 'wh-main' }]);
        const resolve = reversalWarehouseResolver(tx, TENANT, STORE, 'wh-main', 'sale');

        expect(await resolve(null)).toBe('wh-main');
        expect(await resolve(undefined)).toBe('wh-main');
        expect(tx.warehouse.findFirst).not.toHaveBeenCalled();
    });

    it('resolves the tenant default once for a document written before warehouses were recorded', async () => {
        const tx = makeTx([{ id: 'wh-default' }]);
        const resolve = reversalWarehouseResolver(tx, TENANT, STORE, null, 'sale');

        expect(await resolve(null)).toBe('wh-default');
        expect(await resolve(null)).toBe('wh-default');
        // Cached: a fifty-line sale must not re-read the settings fifty times.
        expect(tx.inventorySettings.findUnique).toHaveBeenCalledTimes(1);
    });
});

describe('usableWarehouseIds', () => {
    it('keeps only warehouses stock may still be booked against', async () => {
        const tx = makeTx([
            { id: 'wh-main' },
            { id: 'wh-closed', is_active: false },
            { id: 'wh-other-branch', store_id: 'store-2' },
        ]);

        const usable = await usableWarehouseIds(tx, TENANT, STORE, [
            'wh-main',
            'wh-closed',
            'wh-other-branch',
            null,
        ]);

        expect([...usable]).toEqual(['wh-main']);
    });

    it('queries nothing when there is nothing to inherit', async () => {
        const tx = makeTx([{ id: 'wh-main' }]);

        expect(await usableWarehouseIds(tx, TENANT, STORE, [null, undefined])).toEqual(new Set());
        expect(tx.warehouse.findMany).not.toHaveBeenCalled();
    });
});
