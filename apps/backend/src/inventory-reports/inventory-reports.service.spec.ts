import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service';
import { InventoryReportsService } from './inventory-reports.service';

describe('InventoryReportsService', () => {
    let service: InventoryReportsService;
    let db: any;

    beforeEach(async () => {
        db = {
            inventorySettings: { findUnique: jest.fn() },
            product: { findMany: jest.fn() },
            warehouseTransferItem: { findMany: jest.fn() },
            inventoryShrinkage: { findMany: jest.fn() },
            inventoryMovement: { groupBy: jest.fn().mockResolvedValue([]) },
            warehouse: { findMany: jest.fn().mockResolvedValue([]) },
            productPrice: { findMany: jest.fn().mockResolvedValue([]) },
            $queryRaw: jest.fn().mockResolvedValue([]),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [InventoryReportsService, { provide: DatabaseService, useValue: db }],
        }).compile();

        service = module.get(InventoryReportsService);
    });

    it('calculates reorder suggestions using on-hand stock, defaults, and in-transit quantities', async () => {
        db.inventorySettings.findUnique.mockResolvedValue({ default_reorder_level: 10, default_safety_stock: 2, default_lead_time_days: 4 });
        db.product.findMany.mockResolvedValue([
            { id: 'prod-1', name: 'Coffee', reorder_level: null, safety_stock: null, lead_time_days: null, stocks: [{ quantity: 5 }], group: null, subgroup: null },
        ]);
        db.warehouseTransferItem.findMany.mockResolvedValue([{ product_id: 'prod-1', quantity_sent: 4, quantity_received: 1 }]);

        const [row] = await service.getReorderSuggestions('tenant-1', {});

        expect(row.onHand).toBe(5);
        expect(row.inTransit).toBe(3);
        expect(row.targetStock).toBe(12);
        expect(row.suggestedQuantity).toBe(4);
    });

    it('returns explicit unconfigured rows when stock policy data is missing', async () => {
        db.inventorySettings.findUnique.mockResolvedValue(null);
        db.product.findMany.mockResolvedValue([
            { id: 'prod-1', name: 'Coffee', reorder_level: null, safety_stock: null, lead_time_days: null, stocks: [{ quantity: 1 }], group: null, subgroup: null },
        ]);
        db.warehouseTransferItem.findMany.mockResolvedValue([]);

        const [row] = await service.getReorderSuggestions('tenant-1', {});
        expect(row.configSource).toBe('UNCONFIGURED');
        expect(row.shortageReason).toMatch(/Missing stock policy configuration/);
    });

    it('calculates inventory valuation summary and row values', async () => {
        db.product.findMany.mockResolvedValue([
            { id: 'prod-1', name: 'Coffee', price: 10, stocks: [{ quantity: 3 }], group: null, subgroup: null },
            { id: 'prod-2', name: 'Tea', price: 5, stocks: [{ quantity: 2 }], group: null, subgroup: null },
        ]);

        const result = await service.getInventoryValuation('tenant-1', {});

        expect(result.summary.totalQuantity).toBe(5);
        expect(result.summary.totalStockValue).toBe(40);
        expect(result.summary.productCount).toBe(2);
        expect(result.rows[0].stockValue).toBe(30);
    });

    it('groups shrinkage summary by warehouse and reason', async () => {
        db.inventoryShrinkage.findMany.mockResolvedValue([
            {
                id: 'shr-1',
                reference_number: 'SHR-001',
                created_at: new Date('2024-01-15T00:00:00.000Z'),
                warehouse: { id: 'wh-1', name: 'Main Warehouse' },
                reason: { id: 'reason-1', label: 'Damaged' },
                items: [
                    {
                        product_id: 'prod-1',
                        quantity: 2,
                        unit_cost: 6,
                        product: { id: 'prod-1', name: 'Coffee', price: 8, group_id: null, subgroup_id: null, group: null, subgroup: null },
                    },
                ],
            },
        ]);

        const result = await service.getShrinkageSummary('tenant-1', {});

        expect(result.summary.totalQuantity).toBe(2);
        expect(result.summary.totalValue).toBe(12);
        expect(result.rows[0]).toEqual(
            expect.objectContaining({ warehouseName: 'Main Warehouse', reasonLabel: 'Damaged', quantity: 2, value: 12 }),
        );
    });

    describe('getStockAging', () => {
        const product = (id: string, name: string, quantity: number, price = 100) => ({
            id,
            name,
            sku: `SKU-${id}`,
            price,
            group: null,
            stocks: [{ quantity }],
        });

        beforeEach(() => {
            jest.useFakeTimers().setSystemTime(new Date('2026-07-25T00:00:00Z'));
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('ignores products with nothing on hand', async () => {
            db.product.findMany.mockResolvedValue([product('p1', 'Rice', 0)]);

            const result = await service.getStockAging('tenant-1', {});

            expect(result.rows).toHaveLength(0);
            expect(result.summary.productsInStock).toBe(0);
        });

        it('buckets stock by days since it last sold', async () => {
            db.product.findMany.mockResolvedValue([product('p1', 'Rice', 2), product('p2', 'Oil', 3)]);
            db.inventoryMovement.groupBy.mockResolvedValue([
                { product_id: 'p1', _max: { created_at: new Date('2026-07-20T00:00:00Z') } }, // 5 days
                { product_id: 'p2', _max: { created_at: new Date('2026-01-01T00:00:00Z') } }, // ~205 days
            ]);

            const result = await service.getStockAging('tenant-1', {});

            const rice = result.rows.find((r) => r.product.name === 'Rice')!;
            const oil = result.rows.find((r) => r.product.name === 'Oil')!;
            expect(rice.daysSinceLastSale).toBe(5);
            expect(rice.bucket).toBe('days_0_30');
            expect(oil.bucket).toBe('days_180_plus');
        });

        /**
         * "Never sold" and "sold a very long time ago" are different problems,
         * and folding the first into a huge day count buries genuinely stale
         * stock underneath brand-new arrivals that have simply not moved yet.
         */
        it('reports never-sold stock as null days and counts it separately', async () => {
            db.product.findMany.mockResolvedValue([product('p1', 'Untouched', 4, 250)]);
            db.inventoryMovement.groupBy.mockResolvedValue([]);

            const result = await service.getStockAging('tenant-1', {});

            expect(result.rows[0].daysSinceLastSale).toBeNull();
            expect(result.rows[0].lastSoldAt).toBeNull();
            expect(result.rows[0].bucket).toBe('never_sold');
            expect(result.summary.neverSoldProducts).toBe(1);
            expect(result.summary.slowMovingProducts).toBe(1);
        });

        it('ranks the stalest stock first, with never-sold at the top', async () => {
            db.product.findMany.mockResolvedValue([
                product('p1', 'Fresh', 1),
                product('p2', 'Stale', 1),
                product('p3', 'Never', 1),
            ]);
            db.inventoryMovement.groupBy.mockResolvedValue([
                { product_id: 'p1', _max: { created_at: new Date('2026-07-24T00:00:00Z') } },
                { product_id: 'p2', _max: { created_at: new Date('2026-05-01T00:00:00Z') } },
            ]);

            const result = await service.getStockAging('tenant-1', {});

            expect(result.rows.map((r) => r.product.name)).toEqual(['Never', 'Stale', 'Fresh']);
        });

        it('honours a custom slow-moving threshold', async () => {
            db.product.findMany.mockResolvedValue([product('p1', 'Rice', 1)]);
            db.inventoryMovement.groupBy.mockResolvedValue([
                { product_id: 'p1', _max: { created_at: new Date('2026-07-15T00:00:00Z') } }, // 10 days
            ]);

            const strict = await service.getStockAging('tenant-1', { slowMovingAfterDays: 7 });
            const lenient = await service.getStockAging('tenant-1', { slowMovingAfterDays: 30 });

            expect(strict.summary.slowMovingProducts).toBe(1);
            expect(lenient.summary.slowMovingProducts).toBe(0);
        });

        /**
         * The warehouse filter has to reach the movement query too. A product
         * selling briskly in one branch can be dead stock in another, and a
         * tenant-wide last-sold date hides exactly that.
         */
        it('scopes the last-sold lookup to the requested warehouse', async () => {
            db.product.findMany.mockResolvedValue([product('p1', 'Rice', 1)]);

            await service.getStockAging('tenant-1', { warehouseId: 'wh-1' });

            expect(db.inventoryMovement.groupBy).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ warehouse_id: 'wh-1', movement_type: 'SALE' }),
                }),
            );
        });

        it('reports the slow-moving share of value without dividing by zero', async () => {
            db.product.findMany.mockResolvedValue([product('p1', 'Rice', 2, 500)]);
            db.inventoryMovement.groupBy.mockResolvedValue([]);

            const result = await service.getStockAging('tenant-1', {});

            expect(result.summary.totalStockValue).toBe(1000);
            expect(result.summary.slowMovingShareOfValuePct).toBe(100);
        });
    });

    describe('getStockOnHand', () => {
        const warehouses = [
            { id: 'wh-1', name: 'Dhaka Main', code: 'WH-1', is_default: true },
            { id: 'wh-2', name: 'Chattogram', code: 'WH-2', is_default: false },
        ];

        const product = (id: string, name: string, stocks: { warehouse_id: string; quantity: number }[]) => ({
            id,
            name,
            sku: `SKU-${id}`,
            unit_type: 'none',
            price: 100,
            brand: null,
            group: null,
            subgroup: null,
            stocks,
        });

        beforeEach(() => {
            db.warehouse.findMany.mockResolvedValue(warehouses);
        });

        it('splits quantity into one column per warehouse and values it at weighted average purchase cost', async () => {
            db.product.findMany.mockResolvedValue([
                product('p1', 'Rice', [
                    { warehouse_id: 'wh-1', quantity: 6 },
                    { warehouse_id: 'wh-2', quantity: 4 },
                ]),
            ]);
            // 10 @ 50 + 10 @ 70 = 1200 over 20 units => 60 each.
            db.$queryRaw.mockResolvedValue([{ product_id: 'p1', cost_total: 1200, quantity_total: 20 }]);

            const result = await service.getStockOnHand('tenant-1', {});

            const [row] = result.rows;
            expect(row.quantityByWarehouse).toEqual({ 'wh-1': 6, 'wh-2': 4 });
            expect(row.totalQuantity).toBe(10);
            expect(row.averageUnitCost).toBe(60);
            expect(row.costBasis).toBe('WEIGHTED_AVERAGE');
            expect(row.totalStockValue).toBe(600);
            expect(result.summary.totalStockValue).toBe(600);
        });

        it('reports zero for a warehouse the product has no stock row in', async () => {
            db.product.findMany.mockResolvedValue([product('p1', 'Rice', [{ warehouse_id: 'wh-1', quantity: 5 }])]);

            const result = await service.getStockOnHand('tenant-1', {});

            expect(result.rows[0].quantityByWarehouse['wh-2']).toBe(0);
        });

        it('per-warehouse value totals add up to the report total', async () => {
            db.product.findMany.mockResolvedValue([
                product('p1', 'Rice', [
                    { warehouse_id: 'wh-1', quantity: 3 },
                    { warehouse_id: 'wh-2', quantity: 7 },
                ]),
            ]);
            db.$queryRaw.mockResolvedValue([{ product_id: 'p1', cost_total: 250, quantity_total: 10 }]);

            const result = await service.getStockOnHand('tenant-1', {});

            const warehouseSum = result.warehouses.reduce((sum, warehouse) => sum + warehouse.stockValue, 0);
            expect(warehouseSum).toBeCloseTo(result.summary.totalStockValue, 6);
        });

        it('falls back to the latest recorded cost when nothing was purchased through the ledger', async () => {
            db.product.findMany.mockResolvedValue([product('p1', 'Rice', [{ warehouse_id: 'wh-1', quantity: 2 }])]);
            db.$queryRaw.mockResolvedValue([]);
            db.productPrice.findMany.mockResolvedValue([{ product_id: 'p1', cost: 45 }]);

            const result = await service.getStockOnHand('tenant-1', {});

            expect(result.rows[0].averageUnitCost).toBe(45);
            expect(result.rows[0].costBasis).toBe('LATEST_COST');
            expect(result.rows[0].totalStockValue).toBe(90);
        });

        it('flags products with no cost basis instead of quietly valuing them at zero', async () => {
            db.product.findMany.mockResolvedValue([product('p1', 'Rice', [{ warehouse_id: 'wh-1', quantity: 8 }])]);

            const result = await service.getStockOnHand('tenant-1', {});

            expect(result.rows[0].costBasis).toBe('UNCOSTED');
            expect(result.rows[0].averageUnitCost).toBeNull();
            expect(result.summary.uncostedProductCount).toBe(1);
            expect(result.summary.uncostedQuantity).toBe(8);
        });

        it('ignores a purchase pool that nets to zero or less rather than emitting an absurd cost', async () => {
            db.product.findMany.mockResolvedValue([product('p1', 'Rice', [{ warehouse_id: 'wh-1', quantity: 1 }])]);
            // Everything bought was returned, so the average is undefined.
            db.$queryRaw.mockResolvedValue([{ product_id: 'p1', cost_total: 0, quantity_total: 0 }]);
            db.productPrice.findMany.mockResolvedValue([{ product_id: 'p1', cost: 12 }]);

            const result = await service.getStockOnHand('tenant-1', {});

            expect(result.rows[0].costBasis).toBe('LATEST_COST');
            expect(result.rows[0].averageUnitCost).toBe(12);
        });

        it('drops zero-stock products by default and keeps them when asked', async () => {
            db.product.findMany.mockResolvedValue([
                product('p1', 'Rice', [{ warehouse_id: 'wh-1', quantity: 4 }]),
                product('p2', 'Dal', []),
            ]);

            const withoutZeros = await service.getStockOnHand('tenant-1', {});
            expect(withoutZeros.rows.map((row) => row.product.id)).toEqual(['p1']);

            const withZeros = await service.getStockOnHand('tenant-1', { includeZeroStock: true });
            expect(withZeros.rows.map((row) => row.product.id)).toEqual(['p1', 'p2']);
        });

        it('narrows to a single warehouse column when one is selected', async () => {
            db.warehouse.findMany.mockResolvedValue([warehouses[1]]);
            db.product.findMany.mockResolvedValue([
                product('p1', 'Rice', [
                    { warehouse_id: 'wh-1', quantity: 6 },
                    { warehouse_id: 'wh-2', quantity: 4 },
                ]),
            ]);

            const result = await service.getStockOnHand('tenant-1', { warehouseId: 'wh-2' });

            expect(result.warehouses.map((warehouse) => warehouse.id)).toEqual(['wh-2']);
            expect(result.rows[0].totalQuantity).toBe(4);
            expect(db.product.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    select: expect.objectContaining({
                        stocks: expect.objectContaining({ where: { warehouse_id: { in: ['wh-2'] } } }),
                    }),
                }),
            );
        });

        it('returns an empty report rather than the whole tenant when the warehouse filter matches nothing', async () => {
            db.warehouse.findMany.mockResolvedValue([]);

            const result = await service.getStockOnHand('tenant-1', { warehouseId: 'missing' });

            expect(result.rows).toEqual([]);
            expect(result.warehouses).toEqual([]);
            expect(result.summary.totalStockValue).toBe(0);
            expect(db.product.findMany).not.toHaveBeenCalled();
        });

        it('excludes service products, which are never stock-tracked', async () => {
            db.product.findMany.mockResolvedValue([]);

            await service.getStockOnHand('tenant-1', {});

            expect(db.product.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ type: { not: 'SERVICE' } }),
                }),
            );
        });
    });
});