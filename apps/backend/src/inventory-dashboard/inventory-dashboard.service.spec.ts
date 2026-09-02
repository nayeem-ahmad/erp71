import { Test } from '@nestjs/testing';
import { InventoryDashboardService } from './inventory-dashboard.service';
import { DatabaseService } from '../database/database.service';
import { PlanEntitlementsService } from '../subscription-plans/plan-entitlements.service';

const TENANT = 'tenant-1';

const product = (patch: Record<string, unknown> = {}) => ({
    id: 'p1',
    name: 'Rice 5kg',
    sku: 'RICE-5',
    price: 500,
    reorder_level: 10,
    group_id: 'g1',
    group: { id: 'g1', name: 'Groceries' },
    stocks: [{ quantity: 4 }],
    ...patch,
});

describe('InventoryDashboardService', () => {
    let service: InventoryDashboardService;
    let db: any;
    let entitlements: { getFeaturesForTenant: jest.Mock };

    beforeEach(async () => {
        db = {
            inventorySettings: { findUnique: jest.fn().mockResolvedValue({ default_reorder_level: null }) },
            product: { findMany: jest.fn().mockResolvedValue([]) },
            inventoryMovement: {
                findMany: jest.fn().mockResolvedValue([]),
                groupBy: jest.fn().mockResolvedValue([]),
            },
            inventoryShrinkage: { findMany: jest.fn().mockResolvedValue([]) },
            stockTakeSession: { count: jest.fn().mockResolvedValue(0) },
            warehouseTransferItem: { findMany: jest.fn().mockResolvedValue([]) },
        };
        entitlements = { getFeaturesForTenant: jest.fn().mockResolvedValue({ premiumInventoryReports: true }) };

        const moduleRef = await Test.createTestingModule({
            providers: [
                InventoryDashboardService,
                { provide: DatabaseService, useValue: db },
                { provide: PlanEntitlementsService, useValue: entitlements },
            ],
        }).compile();

        service = moduleRef.get(InventoryDashboardService);
    });

    it('counts out of stock, below reorder and negative stock separately', async () => {
        db.product.findMany.mockResolvedValue([
            product({ id: 'a', stocks: [{ quantity: 0 }] }),
            product({ id: 'b', stocks: [{ quantity: 4 }] }),
            product({ id: 'c', stocks: [{ quantity: -3 }] }),
            product({ id: 'd', stocks: [{ quantity: 90 }] }),
        ]);

        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        expect(result.stock.out_of_stock).toBe(1);
        expect(result.stock.below_reorder).toBe(1);
        expect(result.stock.negative_stock).toBe(1);
        expect(result.stock.active_skus).toBe(4);
    });

    it('falls back to the tenant default reorder level, and counts a product with neither as unconfigured', async () => {
        db.inventorySettings.findUnique.mockResolvedValue({ default_reorder_level: 20 });
        db.product.findMany.mockResolvedValue([
            product({ id: 'a', reorder_level: null, stocks: [{ quantity: 15 }] }),
            product({ id: 'b', reorder_level: null, stocks: [{ quantity: 15 }] }),
        ]);

        const withDefault = await service.getOverview(TENANT, {}, 'Asia/Dhaka');
        expect(withDefault.stock.below_reorder).toBe(2);
        expect(withDefault.stock.unconfigured_policy).toBe(0);

        db.inventorySettings.findUnique.mockResolvedValue(null);
        const withoutDefault = await service.getOverview(TENANT, {}, 'Asia/Dhaka');
        expect(withoutDefault.stock.below_reorder).toBe(0);
        expect(withoutDefault.stock.unconfigured_policy).toBe(2);
    });

    it('sums stock across every warehouse a product sits in', async () => {
        db.product.findMany.mockResolvedValue([
            product({ stocks: [{ quantity: 3 }, { quantity: 5 }, { quantity: 2 }] }),
        ]);

        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        expect(result.stock.total_units).toBe(10);
        expect(result.stock.total_value).toBe(5000);
    });

    it('withholds valuation from a plan without premium inventory reports, without refusing the rest', async () => {
        entitlements.getFeaturesForTenant.mockResolvedValue({ premiumInventoryReports: false });
        db.product.findMany.mockResolvedValue([product({ stocks: [{ quantity: 4 }] })]);

        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        // Null, not 0 — the tenant has stock, we are just not showing its worth.
        expect(result.stock.total_value).toBeNull();
        expect(result.aging).toBeNull();
        expect(result.top_value).toEqual([]);
        expect(result.categories).toEqual([]);
        expect(result.can_value).toBe(false);
        // The counts every plan gets are still there.
        expect(result.stock.below_reorder).toBe(1);
        expect(result.low_stock).toHaveLength(1);
    });

    it('splits movement into units in and units out, and counts the products touched once each', async () => {
        db.inventoryMovement.findMany.mockResolvedValue([
            { product_id: 'a', quantity_delta: 10 },
            { product_id: 'a', quantity_delta: -4 },
            { product_id: 'b', quantity_delta: -6 },
        ]);

        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        expect(result.movement).toEqual({
            in_units: 10,
            out_units: 10,
            movements_logged: 3,
            products_touched: 2,
        });
    });

    it('ranks low stock by shortfall, so a product at zero outranks one a unit short', async () => {
        db.product.findMany.mockResolvedValue([
            product({ id: 'near', name: 'Near', reorder_level: 10, stocks: [{ quantity: 9 }] }),
            product({ id: 'empty', name: 'Empty', reorder_level: 10, stocks: [{ quantity: 0 }] }),
        ]);

        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        expect(result.low_stock.map((row) => row.id)).toEqual(['empty', 'near']);
        expect(result.low_stock[0].shortfall).toBe(10);
    });

    it('ages stock from its product last movement, and treats a never-moved product as oldest', async () => {
        const eightyDaysAgo = new Date(Date.now() - 80 * 86_400_000);
        db.product.findMany.mockResolvedValue([
            product({ id: 'moved', stocks: [{ quantity: 2 }] }),
            product({ id: 'never', stocks: [{ quantity: 3 }] }),
        ]);
        db.inventoryMovement.groupBy.mockResolvedValue([
            { product_id: 'moved', _max: { created_at: eightyDaysAgo } },
        ]);

        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');
        const byKey = Object.fromEntries((result.aging ?? []).map((row) => [row.key, row]));

        expect(byKey.days_61_90.units).toBe(2);
        expect(byKey.days_180_plus.units).toBe(3);
    });

    it('leaves out-of-stock products out of the aging buckets entirely', async () => {
        db.product.findMany.mockResolvedValue([product({ stocks: [{ quantity: 0 }] })]);

        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        expect((result.aging ?? []).every((row) => row.units === 0)).toBe(true);
    });

    it('counts only outstanding transfer units as in transit', async () => {
        db.warehouseTransferItem.findMany.mockResolvedValue([
            { quantity_sent: 10, quantity_received: 4 },
            { quantity_sent: 5, quantity_received: 5 },
            // Over-received: negative outstanding is not negative in transit.
            { quantity_sent: 3, quantity_received: 4 },
        ]);

        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        expect(result.transfers.in_transit_units).toBe(6);
    });

    it('values shrinkage from the recorded unit cost, and treats a missing cost as zero', async () => {
        db.inventoryShrinkage.findMany.mockResolvedValue([
            { items: [{ quantity: 2, unit_cost: 50 }, { quantity: 1, unit_cost: null }] },
        ]);

        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        expect(result.shrinkage).toEqual({ events: 1, units: 3, value: 100 });
    });

    it('groups valuation by product group and folds the ungrouped into their own row', async () => {
        db.product.findMany.mockResolvedValue([
            product({ id: 'a', price: 100, stocks: [{ quantity: 2 }] }),
            product({ id: 'b', price: 100, stocks: [{ quantity: 1 }], group_id: null, group: null }),
        ]);

        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        expect(result.categories).toEqual([
            { id: 'g1', name: 'Groceries', units: 2, value: 200 },
            { id: null, name: 'Ungrouped', units: 1, value: 100 },
        ]);
    });

    it('buckets trends by local calendar day and zero-fills the quiet ones', async () => {
        const result = await service.getTrends(TENANT, { from: '2026-08-01', to: '2026-08-03' }, 'Asia/Dhaka');

        expect(result.points.map((point) => point.date)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
        expect(result.points.every((point) => point.units_in === 0 && point.units_out === 0)).toBe(true);
    });

    it('reads the window bounds as local days, not as UTC instants', async () => {
        const at = new Date('2026-08-02T21:30:00+06:00'); // 9:30pm in Dhaka on the 2nd
        db.inventoryMovement.findMany.mockResolvedValue([{ created_at: at, quantity_delta: 7 }]);

        const result = await service.getTrends(TENANT, { from: '2026-08-01', to: '2026-08-03' }, 'Asia/Dhaka');

        // toISOString() would have filed this under the 3rd in Dhaka.
        expect(result.points.find((point) => point.date === '2026-08-02')?.units_in).toBe(7);
    });
});
