import { NotFoundException, BadRequestException } from '@nestjs/common';
import { planMerge, throwIfBlocked, TAKE_FIELDS, commitMerge, parseTakeFields } from './products.merge';
import { ProductsService } from './products.service';

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
    db.$queryRaw = jest.fn().mockResolvedValue([]);
    db.$executeRaw = jest.fn().mockResolvedValue(0);
    db.$transaction = (fn: any) => fn(db);
    return db;
}

function queryRawSql(call: unknown[]): string {
    const first = call[0] as { sql?: string; strings?: string[] } | string[] | undefined;
    if (first && typeof first === 'object' && !Array.isArray(first) && typeof first.sql === 'string') {
        return first.sql;
    }
    if (Array.isArray(first)) return first.join(' ');
    return '';
}

function lockedForUpdate(tx: any, table: string): boolean {
    return tx.$queryRaw.mock.calls.some((call) => {
        const sql = queryRawSql(call);
        return sql.includes(`"${table}"`) && /ORDER BY id/i.test(sql) && sql.includes('FOR UPDATE');
    });
}

function lockInList(tx: any, table: string): unknown[] {
    const call = tx.$queryRaw.mock.calls.find((c: unknown[]) => queryRawSql(c).includes(`"${table}"`));
    const first = call?.[0] as { values?: unknown[] } | undefined;
    const values = first && Array.isArray(first.values) ? first.values : [];
    return values.filter((v) => v === 'src' || v === 'tgt');
}

function writable(over: Record<string, any> = {}) {
    return {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        ...over,
    };
}

function makeCommitTx(opts: {
    onSaleUpdateMany?: (args: any) => void;
    stocks?: Array<{ id: string; product_id: string; warehouse_id: string; quantity: number }>;
    costs?: Array<{ product_id: string; avg_cost: number; qty_on_hand: number }>;
    transfers?: any[];
    shrinkages?: any[];
    stockTakes?: any[];
    demands?: any[];
    priceListItems?: any[];
    productPrices?: any[];
    bomComponents?: any[];
} = {}) {
    const stocks = opts.stocks ?? [];
    const costs = opts.costs ?? [];
    return dbWith(product({ id: 'src' }), product({ id: 'tgt' }), {
        saleItem: writable({
            updateMany: jest.fn(async (args: any) => {
                opts.onSaleUpdateMany?.(args);
                return { count: 0 };
            }),
        }),
        salesReturnItem: writable(),
        purchaseItem: writable(),
        purchaseReturnItem: writable(),
        salesOrderItem: writable(),
        quotationItem: writable(),
        purchaseOrderItem: writable(),
        purchaseQuotationItem: writable(),
        importShipmentItem: writable(),
        storefrontOrderItem: writable(),
        warrantyClaim: writable(),
        inventoryMovement: writable(),
        productionJob: writable(),
        productionWastage: writable(),
        productSerial: writable(),
        productPrice: writable({
            findMany: jest.fn().mockResolvedValue(opts.productPrices ?? []),
        }),
        warehouseTransferItem: writable({
            findMany: jest.fn().mockResolvedValue(opts.transfers ?? []),
        }),
        inventoryShrinkageItem: writable({
            findMany: jest.fn().mockResolvedValue(opts.shrinkages ?? []),
        }),
        stockTakeCountLine: writable({
            findMany: jest.fn().mockResolvedValue(opts.stockTakes ?? []),
        }),
        productDemandItem: writable({
            findMany: jest.fn().mockResolvedValue(opts.demands ?? []),
        }),
        priceListItem: writable({
            findMany: jest.fn().mockResolvedValue(opts.priceListItems ?? []),
        }),
        bomComponent: writable({
            findMany: jest.fn().mockResolvedValue(opts.bomComponents ?? []),
        }),
        bomRecipe: writable(),
        externalSyncMapping: writable(),
        productStock: writable({
            findMany: jest.fn().mockResolvedValue(stocks),
        }),
        productCost: writable({
            findUnique: jest.fn(async ({ where }: any) => {
                const id = where.product_id ?? where.tenant_id_product_id?.product_id;
                return costs.find((c) => c.product_id === id) ?? null;
            }),
        }),
        product: {
            update: jest.fn().mockResolvedValue({}),
        },
    });
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
        const saleItem = { count: jest.fn().mockResolvedValue(12) };
        const plan = await planMerge(dbWith(p, p, { saleItem }), 't1', 'src', 'src');
        expect(plan.blockers.map((b) => b.code)).toContain('SAME_PRODUCT');
        expect(saleItem.count).not.toHaveBeenCalled();
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

describe('commitMerge', () => {
    it('re-points sale lines, combines same-warehouse stock, soft-deletes source, invalidates cache', async () => {
        const calls: string[] = [];
        const tx = makeCommitTx({
            onSaleUpdateMany: (args) => calls.push(`sale:${args.where.product_id}->${args.data.product_id}`),
            stocks: [
                { id: 'ss', product_id: 'src', warehouse_id: 'wh1', quantity: 8 },
                { id: 'ts', product_id: 'tgt', warehouse_id: 'wh1', quantity: 40 },
            ],
            costs: [
                { product_id: 'src', avg_cost: 13, qty_on_hand: 8 },
                { product_id: 'tgt', avg_cost: 10, qty_on_hand: 40 },
            ],
        });
        const db = { $transaction: (fn: any) => fn(tx) };
        const redis = { invalidatePattern: jest.fn() };
        const result = await commitMerge(db, redis, 't1', 'src', { targetId: 'tgt', takeFields: [] });
        expect(calls).toContain('sale:src->tgt');
        expect(tx.product.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'src' },
            data: expect.objectContaining({ sku: null, deleted_at: expect.any(Date) }),
        }));
        expect(result.combinedStock).toBe(48);
        expect(result.combinedCost.avgCost).toBe(10.5);
        expect(result.combinedCost.qtyOnHand).toBe(48);
        expect(redis.invalidatePattern).toHaveBeenCalledWith('products:t1:');
    });

    it('keeps two sale lines when a sale already listed both products', async () => {
        const tx = makeCommitTx({});
        const db = { $transaction: (fn: any) => fn(tx) };
        await commitMerge(db, { invalidatePattern: jest.fn() }, 't1', 'src', { targetId: 'tgt', takeFields: [] });
        expect(tx.saleItem.updateMany).toHaveBeenCalled();
        expect(tx.saleItem.delete).not.toHaveBeenCalled();
        expect(tx.saleItem.deleteMany).not.toHaveBeenCalled();
    });

    it('moves a warehouse-only-on-source stock row onto the keeper', async () => {
        const tx = makeCommitTx({
            stocks: [{ id: 'ss2', product_id: 'src', warehouse_id: 'wh2', quantity: 5 }],
        });
        const db = { $transaction: (fn: any) => fn(tx) };
        await commitMerge(db, { invalidatePattern: jest.fn() }, 't1', 'src', { targetId: 'tgt', takeFields: [] });
        expect(tx.productStock.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'ss2' },
            data: { product_id: 'tgt' },
        }));
        expect(tx.productStock.delete).not.toHaveBeenCalled();
    });

    it('404s a second merge of an already-deleted source', async () => {
        const src = product({ id: 'src', deleted_at: new Date() });
        await expect(commitMerge(dbWith(src, product({ id: 'tgt' })), { invalidatePattern: jest.fn() }, 't1', 'src', { targetId: 'tgt', takeFields: [] }))
            .rejects.toBeInstanceOf(NotFoundException);
    });

    it('adds same-warehouse source qty onto the keeper and drops the duplicate stock and cost rows', async () => {
        const tx = makeCommitTx({
            stocks: [
                { id: 'ss', product_id: 'src', warehouse_id: 'wh1', quantity: 8 },
                { id: 'ts', product_id: 'tgt', warehouse_id: 'wh1', quantity: 40 },
            ],
            costs: [
                { product_id: 'src', avg_cost: 13, qty_on_hand: 8 },
                { product_id: 'tgt', avg_cost: 10, qty_on_hand: 40 },
            ],
        });
        const db = { $transaction: (fn: any) => fn(tx) };
        await commitMerge(db, { invalidatePattern: jest.fn() }, 't1', 'src', { targetId: 'tgt', takeFields: [] });
        expect(lockedForUpdate(tx, 'Product')).toBe(true);
        expect(lockedForUpdate(tx, 'ProductStock')).toBe(true);
        expect(lockInList(tx, 'Product')).toEqual(['src', 'tgt']);
        expect(lockInList(tx, 'ProductStock')).toEqual(['src', 'tgt']);
        expect(tx.$queryRaw.mock.invocationCallOrder[0])
            .toBeLessThan(tx.product.findFirst.mock.invocationCallOrder[0]);
        expect(tx.productStock.update).toHaveBeenCalledWith({
            where: { id: 'ts' },
            data: { quantity: { increment: 8 } },
        });
        expect(tx.productStock.delete).toHaveBeenCalledWith({ where: { id: 'ss' } });
        expect(tx.productCost.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { product_id: 'tgt' },
            update: { avg_cost: 10.5, qty_on_hand: 48 },
        }));
        expect(tx.productCost.delete).toHaveBeenCalledWith({ where: { product_id: 'src' } });
    });

    it('locks product ids in lexicographic order so A→B and B→A share a sequence', async () => {
        const tx = makeCommitTx({});
        const db = { $transaction: (fn: any) => fn(tx) };
        await commitMerge(db, { invalidatePattern: jest.fn() }, 't1', 'tgt', { targetId: 'src', takeFields: [] });
        expect(lockInList(tx, 'Product')).toEqual(['src', 'tgt']);
        expect(lockInList(tx, 'ProductStock')).toEqual(['src', 'tgt']);
        expect(lockedForUpdate(tx, 'Product')).toBe(true);
        expect(lockedForUpdate(tx, 'ProductStock')).toBe(true);
    });

    it('re-points camelCase productId rows', async () => {
        const tx = makeCommitTx({});
        const db = { $transaction: (fn: any) => fn(tx) };
        await commitMerge(db, { invalidatePattern: jest.fn() }, 't1', 'src', { targetId: 'tgt', takeFields: [] });
        expect(tx.storefrontOrderItem.updateMany).toHaveBeenCalledWith({
            where: { productId: 'src' },
            data: { productId: 'tgt' },
        });
        expect(tx.productionJob.updateMany).toHaveBeenCalledWith({
            where: { productId: 'src' },
            data: { productId: 'tgt' },
        });
        expect(tx.productionWastage.updateMany).toHaveBeenCalledWith({
            where: { productId: 'src' },
            data: { productId: 'tgt' },
        });
    });

    it('does not invalidate cache when commit is blocked', async () => {
        const redis = { invalidatePattern: jest.fn() };
        const src = product({ id: 'src', deleted_at: new Date() });
        await expect(commitMerge(dbWith(src, product({ id: 'tgt' })), redis, 't1', 'src', { targetId: 'tgt', takeFields: [] }))
            .rejects.toBeInstanceOf(NotFoundException);
        expect(redis.invalidatePattern).not.toHaveBeenCalled();
    });

    it('folds two transfer lines on the same transfer', async () => {
        const tx = makeCommitTx({
            transfers: [
                { id: 'ti-src', transfer_id: 'tr1', product_id: 'src', quantity_sent: 2, quantity_received: 2 },
                { id: 'ti-tgt', transfer_id: 'tr1', product_id: 'tgt', quantity_sent: 3, quantity_received: 3 },
            ],
        });
        const db = { $transaction: (fn: any) => fn(tx) };
        await commitMerge(db, { invalidatePattern: jest.fn() }, 't1', 'src', { targetId: 'tgt', takeFields: [] });
        expect(tx.warehouseTransferItem.update).toHaveBeenCalledWith({
            where: { id: 'ti-tgt' },
            data: { quantity_sent: 5, quantity_received: 5 },
        });
        expect(tx.warehouseTransferItem.delete).toHaveBeenCalledWith({ where: { id: 'ti-src' } });
    });

    it('drops the duplicate price-list row and keeps the keeper price', async () => {
        const tx = makeCommitTx({
            priceListItems: [
                { id: 'pli-src', price_list_id: 'L', product_id: 'src', selling_price: 16 },
                { id: 'pli-tgt', price_list_id: 'L', product_id: 'tgt', selling_price: 15 },
            ],
        });
        const db = { $transaction: (fn: any) => fn(tx) };
        await commitMerge(db, { invalidatePattern: jest.fn() }, 't1', 'src', { targetId: 'tgt', takeFields: [] });
        expect(tx.priceListItem.delete).toHaveBeenCalledWith({ where: { id: 'pli-src' } });
        expect(tx.priceListItem.update).not.toHaveBeenCalled();
        expect(tx.priceListItem.delete).not.toHaveBeenCalledWith({ where: { id: 'pli-tgt' } });
    });

    it('copies only name and sku when takeFields says so', async () => {
        const tx = makeCommitTx({});
        const db = { $transaction: (fn: any) => fn(tx) };
        const redis = { invalidatePattern: jest.fn() };
        const result = await commitMerge(db, redis, 't1', 'src', { targetId: 'tgt', takeFields: ['name', 'sku'] });
        expect(result.targetId).toBe('tgt');
        expect(tx.product.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'tgt' },
            data: expect.objectContaining({ name: 'Dup', sku: 'D' }),
        }));
        const calls = tx.product.update.mock.calls.map((c: any) => c[0]);
        const srcNull = calls.findIndex((a: any) => a.where.id === 'src' && a.data.sku === null);
        const tgtSku = calls.findIndex((a: any) => a.where.id === 'tgt' && a.data.sku === 'D');
        expect(srcNull).toBeGreaterThanOrEqual(0);
        expect(tgtSku).toBeGreaterThan(srcNull);
    });

    it('leaves keeper name unchanged when takeFields is empty', async () => {
        const tx = makeCommitTx({});
        const db = { $transaction: (fn: any) => fn(tx) };
        await commitMerge(db, { invalidatePattern: jest.fn() }, 't1', 'src', { targetId: 'tgt', takeFields: [] });
        const keeperUpdates = tx.product.update.mock.calls.filter((c: any) => c[0].where.id === 'tgt');
        for (const [args] of keeperUpdates) {
            expect(args.data).not.toHaveProperty('name');
        }
    });

    it('400s an unknown takeFields value', async () => {
        const tx = makeCommitTx({});
        const db = { $transaction: (fn: any) => fn(tx) };
        await expect(commitMerge(db, { invalidatePattern: jest.fn() }, 't1', 'src', { targetId: 'tgt', takeFields: ['nope'] as any }))
            .rejects.toBeInstanceOf(BadRequestException);
    });

    it('retargets ExternalSyncMapping PRODUCT internal_id', async () => {
        const tx = makeCommitTx({});
        const db = { $transaction: (fn: any) => fn(tx) };
        await commitMerge(db, { invalidatePattern: jest.fn() }, 't1', 'src', { targetId: 'tgt', takeFields: [] });
        expect(tx.externalSyncMapping.updateMany).toHaveBeenCalledWith({
            where: { tenant_id: 't1', entity_type: 'PRODUCT', internal_id: 'src' },
            data: { internal_id: 'tgt' },
        });
    });

    it('closes the duplicate open ProductPrice when the keeper already has one for that store', async () => {
        const tx = makeCommitTx({
            productPrices: [
                { id: 'pp-src', product_id: 'src', store_id: 's1', effective_to: null, price: 16 },
                { id: 'pp-tgt', product_id: 'tgt', store_id: 's1', effective_to: null, price: 15 },
            ],
        });
        const db = { $transaction: (fn: any) => fn(tx) };
        await commitMerge(db, { invalidatePattern: jest.fn() }, 't1', 'src', { targetId: 'tgt', takeFields: [] });
        expect(tx.productPrice.update).toHaveBeenCalledWith({
            where: { id: 'pp-src' },
            data: { effective_to: expect.any(Date) },
        });
        expect(tx.productPrice.updateMany).toHaveBeenCalledWith({
            where: { product_id: 'src' },
            data: { product_id: 'tgt' },
        });
        expect(tx.productPrice.update.mock.invocationCallOrder[0])
            .toBeLessThan(tx.productPrice.updateMany.mock.invocationCallOrder[0]);
    });

    it('keeps the only counted stock-take number and recomputes variance', async () => {
        const tx = makeCommitTx({
            stockTakes: [
                { id: 'st-src', session_id: 'st1', product_id: 'src', expected_quantity: 10, counted_quantity: 8, variance_quantity: -2 },
                { id: 'st-tgt', session_id: 'st1', product_id: 'tgt', expected_quantity: 5, counted_quantity: null, variance_quantity: null },
            ],
        });
        const db = { $transaction: (fn: any) => fn(tx) };
        await commitMerge(db, { invalidatePattern: jest.fn() }, 't1', 'src', { targetId: 'tgt', takeFields: [] });
        expect(tx.stockTakeCountLine.update).toHaveBeenCalledWith({
            where: { id: 'st-tgt' },
            data: { expected_quantity: 15, counted_quantity: 8, variance_quantity: -7 },
        });
        expect(tx.stockTakeCountLine.delete).toHaveBeenCalledWith({ where: { id: 'st-src' } });
    });

    it('weights shrinkage unit_cost by quantity when both sides have a cost', async () => {
        const tx = makeCommitTx({
            shrinkages: [
                { id: 'sh-src', shrinkage_id: 'sh1', product_id: 'src', quantity: 2, unit_cost: 10 },
                { id: 'sh-tgt', shrinkage_id: 'sh1', product_id: 'tgt', quantity: 3, unit_cost: 20 },
            ],
        });
        const db = { $transaction: (fn: any) => fn(tx) };
        await commitMerge(db, { invalidatePattern: jest.fn() }, 't1', 'src', { targetId: 'tgt', takeFields: [] });
        expect(tx.inventoryShrinkageItem.update).toHaveBeenCalledWith({
            where: { id: 'sh-tgt' },
            data: { quantity: 5, unit_cost: 16 },
        });
        expect(tx.inventoryShrinkageItem.delete).toHaveBeenCalledWith({ where: { id: 'sh-src' } });
    });
});

describe('ProductsService merge wrappers', () => {
    it('previewMerge 404s a missing source', async () => {
        const service = new ProductsService(
            dbWith(null, product({ id: 'tgt' })) as any,
            { invalidatePattern: jest.fn() } as any,
            {} as any,
            {} as any,
        );
        await expect(service.previewMerge('t1', 'src', 'tgt')).rejects.toBeInstanceOf(NotFoundException);
    });
});

describe('parseTakeFields', () => {
    it('treats a missing value as an empty list', () => {
        expect(parseTakeFields(undefined)).toEqual([]);
        expect(parseTakeFields(null)).toEqual([]);
    });

    it('dedupes while keeping first-seen order', () => {
        expect(parseTakeFields(['name', 'sku', 'name', 'price'])).toEqual(['name', 'sku', 'price']);
    });

    it('400s an unknown field', () => {
        expect(() => parseTakeFields(['nope'])).toThrow(BadRequestException);
    });
});
