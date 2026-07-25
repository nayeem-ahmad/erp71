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
});