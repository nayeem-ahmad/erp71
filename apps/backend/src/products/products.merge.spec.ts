import { NotFoundException, BadRequestException } from '@nestjs/common';
import { planMerge, throwIfBlocked, TAKE_FIELDS } from './products.merge';

function product(over: Record<string, unknown> = {}) {
    return { id: 'src', tenant_id: 't1', deleted_at: null, type: 'GOODS', name: 'Dup', sku: 'D', price: 16, ...over };
}

function delegate(over: Record<string, any> = {}) {
    return {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        ...over,
    };
}

function dbWith(source: any, target: any, extra: Record<string, any> = {}) {
    const base: Record<string, any> = {
        product: {
            findFirst: jest.fn(async ({ where }: any) => {
                if (where.id === source?.id && where.tenant_id === 't1' && where.deleted_at === null) return source;
                if (where.id === target?.id && where.tenant_id === 't1' && where.deleted_at === null) return target;
                return null;
            }),
        },
        productSerial: delegate(),
        bomRecipe: delegate(),
        saleItem: delegate(),
        purchaseItem: delegate(),
        salesReturnItem: delegate(),
        purchaseReturnItem: delegate(),
        salesOrderItem: delegate(),
        quotationItem: delegate(),
        inventoryMovement: delegate(),
        warrantyClaim: delegate(),
        externalSyncMapping: delegate(),
        productStock: delegate(),
        productCost: delegate(),
        warehouseTransferItem: delegate(),
        inventoryShrinkageItem: delegate(),
        stockTakeCountLine: delegate(),
        productDemandItem: delegate(),
        priceListItem: delegate(),
    };
    const db: Record<string, any> = { ...base };
    for (const [key, value] of Object.entries(extra)) {
        db[key] = { ...(base[key] ?? {}), ...value };
    }
    return db;
}

describe('planMerge guards', () => {
    it('blocks a missing source', async () => {
        const plan = await planMerge(dbWith(null, product({ id: 'tgt' })), 't1', 'src', 'tgt');
        expect(plan.blockers.map((b) => b.code)).toEqual(['SOURCE_NOT_FOUND']);
    });

    it('blocks a target in another tenant', async () => {
        const plan = await planMerge(
            dbWith(product({ id: 'src' }), product({ id: 'tgt', tenant_id: 'other' })),
            't1',
            'src',
            'tgt',
        );
        expect(plan.blockers.map((b) => b.code)).toEqual(['TARGET_NOT_FOUND']);
    });

    it('blocks merge into self', async () => {
        const p = product({ id: 'src' });
        const plan = await planMerge(dbWith(p, p), 't1', 'src', 'src');
        expect(plan.blockers.map((b) => b.code)).toContain('SAME_PRODUCT');
    });

    it('blocks GOODS into SERVICE', async () => {
        const plan = await planMerge(
            dbWith(product({ id: 'src', type: 'GOODS' }), product({ id: 'tgt', type: 'SERVICE' })),
            't1',
            'src',
            'tgt',
        );
        expect(plan.blockers.map((b) => b.code)).toContain('TYPE_MISMATCH');
    });

    it('blocks when both products share a serial_number', async () => {
        const plan = await planMerge(
            dbWith(product({ id: 'src' }), product({ id: 'tgt' }), {
                productSerial: {
                    findMany: jest.fn().mockResolvedValue([
                        { product_id: 'src', serial_number: 'SN-1' },
                        { product_id: 'tgt', serial_number: 'SN-1' },
                    ]),
                },
            }),
            't1',
            'src',
            'tgt',
        );
        expect(plan.blockers.map((b) => b.code)).toContain('SERIAL_COLLISION');
    });

    it('blocks when both products have a BomRecipe', async () => {
        const plan = await planMerge(
            dbWith(product({ id: 'src' }), product({ id: 'tgt' }), {
                bomRecipe: {
                    findMany: jest.fn().mockResolvedValue([
                        { productId: 'src' },
                        { productId: 'tgt' },
                    ]),
                },
            }),
            't1',
            'src',
            'tgt',
        );
        expect(plan.blockers.map((b) => b.code)).toContain('BOM_CONFLICT');
    });
});

describe('throwIfBlocked', () => {
    it('404s SOURCE_NOT_FOUND on preview', () => {
        expect(() => throwIfBlocked({ blockers: [{ code: 'SOURCE_NOT_FOUND', message: 'gone' }] } as any, 'preview'))
            .toThrow(NotFoundException);
    });

    it('400s TARGET_NOT_FOUND on commit and not on preview', () => {
        const plan = { blockers: [{ code: 'TARGET_NOT_FOUND', message: 'gone' }] } as any;
        expect(() => throwIfBlocked(plan, 'preview')).not.toThrow();
        expect(() => throwIfBlocked(plan, 'commit')).toThrow(BadRequestException);
    });
});

describe('planMerge preview payload', () => {
    it('counts source sale lines and combines stock and cost', async () => {
        const src = product({ id: 'src' });
        const tgt = product({ id: 'tgt', name: 'Napa 500mg', sku: 'NAP-500', price: 15 });
        const db = dbWith(src, tgt, {
            saleItem: { count: jest.fn().mockResolvedValue(12) },
            purchaseItem: { count: jest.fn().mockResolvedValue(3) },
            salesReturnItem: { count: jest.fn().mockResolvedValue(0) },
            purchaseReturnItem: { count: jest.fn().mockResolvedValue(0) },
            salesOrderItem: { count: jest.fn().mockResolvedValue(0) },
            quotationItem: { count: jest.fn().mockResolvedValue(0) },
            inventoryMovement: { count: jest.fn().mockResolvedValue(20) },
            productSerial: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
            warrantyClaim: { count: jest.fn().mockResolvedValue(0) },
            externalSyncMapping: { count: jest.fn().mockResolvedValue(1) },
            productStock: {
                findMany: jest.fn().mockResolvedValue([
                    { product_id: 'src', warehouse_id: 'wh1', quantity: 8, warehouse: { name: 'Main' } },
                    { product_id: 'tgt', warehouse_id: 'wh1', quantity: 40, warehouse: { name: 'Main' } },
                ]),
            },
            productCost: {
                findUnique: jest.fn(async ({ where }: any) =>
                    where.product_id === 'src'
                        ? { avg_cost: 13, qty_on_hand: 8 }
                        : { avg_cost: 10, qty_on_hand: 40 },
                ),
            },
            warehouseTransferItem: { findMany: jest.fn().mockResolvedValue([]) },
            inventoryShrinkageItem: { findMany: jest.fn().mockResolvedValue([]) },
            stockTakeCountLine: { findMany: jest.fn().mockResolvedValue([]) },
            productDemandItem: { findMany: jest.fn().mockResolvedValue([]) },
            priceListItem: { findMany: jest.fn().mockResolvedValue([]) },
            bomRecipe: { findMany: jest.fn().mockResolvedValue([]) },
        });
        const plan = await planMerge(db, 't1', 'src', 'tgt');
        expect(plan.blockers).toEqual([]);
        expect(plan.counts).toEqual({
            saleLines: 12,
            purchaseLines: 3,
            saleReturnLines: 0,
            purchaseReturnLines: 0,
            orderLines: 0,
            quoteLines: 0,
            movements: 20,
            serials: 0,
            warranties: 0,
            mappings: 1,
        });
        expect(plan.stock).toEqual([
            { warehouseId: 'wh1', warehouseName: 'Main', sourceQty: 8, targetQty: 40, combinedQty: 48 },
        ]);
        expect(plan.cost.source).toEqual({ avgCost: 13, qtyOnHand: 8 });
        expect(plan.cost.target).toEqual({ avgCost: 10, qtyOnHand: 40 });
        expect(plan.cost.combined).toEqual({ avgCost: 10.5, qtyOnHand: 48 });
        expect(plan.fields.map((f) => f.key)).toEqual([...TAKE_FIELDS]);
        expect(plan.fields.find((f) => f.key === 'name')).toEqual({
            key: 'name', sourceValue: 'Dup', targetValue: 'Napa 500mg',
        });
        expect(plan.fields.find((f) => f.key === 'price')).toEqual({
            key: 'price', sourceValue: 16, targetValue: 15,
        });
    });

    it('lists a transfer fold when both products are on the same transfer', async () => {
        const db = dbWith(product({ id: 'src' }), product({ id: 'tgt' }), {
            warehouseTransferItem: {
                findMany: jest.fn().mockResolvedValue([
                    { transfer_id: 'tr1', product_id: 'src', quantity_sent: 2, quantity_received: 2, transfer: { transfer_number: 'TRF-00012' } },
                    { transfer_id: 'tr1', product_id: 'tgt', quantity_sent: 3, quantity_received: 3, transfer: { transfer_number: 'TRF-00012' } },
                ]),
            },
        });
        const plan = await planMerge(db, 't1', 'src', 'tgt');
        expect(plan.folds).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'transfer', parentLabel: 'TRF-00012' }),
        ]));
    });

    it('skips expensive counts when the source is missing', async () => {
        const saleItem = { count: jest.fn().mockResolvedValue(12) };
        const plan = await planMerge(
            dbWith(null, product({ id: 'tgt' }), { saleItem }),
            't1',
            'src',
            'tgt',
        );
        expect(plan.blockers.map((b) => b.code)).toEqual(['SOURCE_NOT_FOUND']);
        expect(saleItem.count).not.toHaveBeenCalled();
        expect(plan.counts.saleLines).toBe(0);
        expect(plan.stock).toEqual([]);
        expect(plan.fields).toEqual([]);
    });

    it('treats missing warehouse stock as zero', async () => {
        const db = dbWith(product({ id: 'src' }), product({ id: 'tgt' }), {
            productStock: {
                findMany: jest.fn().mockResolvedValue([
                    { product_id: 'src', warehouse_id: 'wh2', quantity: 5, warehouse: { name: 'Back' } },
                ]),
            },
        });
        const plan = await planMerge(db, 't1', 'src', 'tgt');
        expect(plan.stock).toEqual([
            { warehouseId: 'wh2', warehouseName: 'Back', sourceQty: 5, targetQty: 0, combinedQty: 5 },
        ]);
    });

    it('still fills counts when types mismatch', async () => {
        const db = dbWith(
            product({ id: 'src', type: 'GOODS' }),
            product({ id: 'tgt', type: 'SERVICE' }),
            { saleItem: { count: jest.fn().mockResolvedValue(4) } },
        );
        const plan = await planMerge(db, 't1', 'src', 'tgt');
        expect(plan.blockers.map((b) => b.code)).toContain('TYPE_MISMATCH');
        expect(plan.counts.saleLines).toBe(4);
        expect(plan.fields.find((f) => f.key === 'name')).toEqual({
            key: 'name', sourceValue: 'Dup', targetValue: 'Dup',
        });
    });

    it('lists folds for shrinkage, stock take, demand, and price list parents', async () => {
        const db = dbWith(product({ id: 'src' }), product({ id: 'tgt' }), {
            inventoryShrinkageItem: {
                findMany: jest.fn().mockResolvedValue([
                    { shrinkage_id: 'sh1', product_id: 'src', shrinkage: { reference_number: 'SHR-1' } },
                    { shrinkage_id: 'sh1', product_id: 'tgt', shrinkage: { reference_number: 'SHR-1' } },
                ]),
            },
            stockTakeCountLine: {
                findMany: jest.fn().mockResolvedValue([
                    { session_id: 'st1', product_id: 'src', session: { session_number: 'ST-9' } },
                    { session_id: 'st1', product_id: 'tgt', session: { session_number: 'ST-9' } },
                ]),
            },
            productDemandItem: {
                findMany: jest.fn().mockResolvedValue([
                    { demand_id: 'dm1', product_id: 'src', demand: { demand_number: 'DEM-3' } },
                    { demand_id: 'dm1', product_id: 'tgt', demand: { demand_number: 'DEM-3' } },
                ]),
            },
            priceListItem: {
                findMany: jest.fn().mockResolvedValue([
                    { price_list_id: 'pl1', product_id: 'src', priceList: { name: 'Retail' } },
                    { price_list_id: 'pl1', product_id: 'tgt', priceList: { name: 'Retail' } },
                ]),
            },
        });
        const plan = await planMerge(db, 't1', 'src', 'tgt');
        expect(plan.folds).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'shrinkage', parentLabel: 'SHR-1' }),
            expect.objectContaining({ kind: 'stockTake', parentLabel: 'ST-9' }),
            expect.objectContaining({ kind: 'demand', parentLabel: 'DEM-3' }),
            expect.objectContaining({ kind: 'priceList', parentLabel: 'Retail' }),
        ]));
    });

    it('keeps the keeper pool when the source has no cost row', async () => {
        const db = dbWith(product({ id: 'src' }), product({ id: 'tgt' }), {
            productCost: {
                findUnique: jest.fn(async ({ where }: any) =>
                    where.product_id === 'tgt' ? { avg_cost: '10.2500', qty_on_hand: 40 } : null,
                ),
            },
        });
        const plan = await planMerge(db, 't1', 'src', 'tgt');
        expect(plan.cost.source).toEqual({ avgCost: null, qtyOnHand: 0 });
        expect(plan.cost.target).toEqual({ avgCost: 10.25, qtyOnHand: 40 });
        expect(plan.cost.combined).toEqual({ avgCost: 10.25, qtyOnHand: 40 });
    });
});
