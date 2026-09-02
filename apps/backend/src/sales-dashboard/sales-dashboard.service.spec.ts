import { Test } from '@nestjs/testing';
import { SalesDashboardService } from './sales-dashboard.service';
import { DatabaseService } from '../database/database.service';

const TENANT = 'tenant-1';

describe('SalesDashboardService', () => {
    let service: SalesDashboardService;
    let db: any;

    beforeEach(async () => {
        db = {
            sale: {
                aggregate: jest.fn().mockResolvedValue({ _sum: { total_amount: null }, _count: { _all: 0 } }),
                groupBy: jest.fn().mockResolvedValue([]),
                findMany: jest.fn().mockResolvedValue([]),
            },
            salesReturn: {
                aggregate: jest.fn().mockResolvedValue({ _sum: { total_refund: null }, _count: { _all: 0 } }),
                findMany: jest.fn().mockResolvedValue([]),
            },
            saleItem: {
                findMany: jest.fn().mockResolvedValue([]),
                groupBy: jest.fn().mockResolvedValue([]),
            },
            salesOrder: { count: jest.fn().mockResolvedValue(0) },
            quotation: { count: jest.fn().mockResolvedValue(0) },
            deliveryOrder: { count: jest.fn().mockResolvedValue(0) },
            customer: {
                aggregate: jest.fn().mockResolvedValue({ _sum: { due_balance: null } }),
                count: jest.fn().mockResolvedValue(0),
                findMany: jest.fn().mockResolvedValue([]),
            },
            product: { findMany: jest.fn().mockResolvedValue([]) },
        };

        const moduleRef = await Test.createTestingModule({
            providers: [SalesDashboardService, { provide: DatabaseService, useValue: db }],
        }).compile();

        service = moduleRef.get(SalesDashboardService);
    });

    it('nets returns off gross rather than reporting one figure for both', async () => {
        db.sale.aggregate.mockResolvedValue({ _sum: { total_amount: 100_000 }, _count: { _all: 20 } });
        db.salesReturn.aggregate.mockResolvedValue({ _sum: { total_refund: 8_000 }, _count: { _all: 3 } });

        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        expect(result.sales.gross).toBe(100_000);
        expect(result.sales.returns).toBe(8_000);
        expect(result.sales.net).toBe(92_000);
        expect(result.sales.avg_ticket).toBe(5_000);
    });

    it('reports no average ticket rather than zero when nothing sold', async () => {
        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        expect(result.sales.count).toBe(0);
        expect(result.sales.avg_ticket).toBeNull();
    });

    it('counts only completed sales as revenue', async () => {
        await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        expect(db.sale.aggregate).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ status: 'COMPLETED' }) }),
        );
    });

    it('computes margin only over lines that carry a cost, and says how many did not', async () => {
        db.saleItem.findMany.mockResolvedValue([
            { quantity: 2, price_at_sale: 100, unit_cost_at_sale: 60 },
            { quantity: 1, price_at_sale: 500, unit_cost_at_sale: null },
        ]);

        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        // The uncosted line is excluded from both sides, not treated as free stock.
        expect(result.margin.gross_profit).toBe(80);
        expect(result.margin.margin_pct).toBe(40);
        expect(result.margin.costed_items).toBe(1);
        expect(result.margin.uncosted_items).toBe(1);
        // Units still count the whole basket — that figure has no cost basis.
        expect(result.margin.units).toBe(3);
    });

    it('reports no margin at all when no line carries a cost', async () => {
        db.saleItem.findMany.mockResolvedValue([
            { quantity: 4, price_at_sale: 100, unit_cost_at_sale: null },
        ]);

        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        // A margin over none of the basket is not a margin.
        expect(result.margin.gross_profit).toBeNull();
        expect(result.margin.margin_pct).toBeNull();
        expect(result.margin.uncosted_items).toBe(1);
    });

    it('takes receivables from the whole book, not the window', async () => {
        db.customer.aggregate.mockResolvedValue({ _sum: { due_balance: 45_000 } });
        db.customer.count.mockResolvedValue(9);

        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        expect(result.receivables).toEqual({ outstanding: 45_000, customers_owing: 9 });
        expect(db.customer.aggregate.mock.calls[0][0].where).not.toHaveProperty('sale_date');
    });

    it('counts an order late only when it promised a delivery date and missed it', async () => {
        await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        const overdueCall = db.salesOrder.count.mock.calls
            .map((call: any[]) => call[0])
            .find((arg: any) => arg.where.delivery_date);

        expect(overdueCall.where.delivery_date.lt).toBeInstanceOf(Date);
        expect(overdueCall.where.status.in).toEqual(['DRAFT', 'CONFIRMED', 'PROCESSING']);
    });

    it('rolls the product ranking up into a category mix from the same rows', async () => {
        db.saleItem.groupBy.mockResolvedValue([
            { product_id: 'a', _sum: { quantity: 10 } },
            { product_id: 'b', _sum: { quantity: 4 } },
            { product_id: 'c', _sum: { quantity: 1 } },
        ]);
        db.product.findMany.mockResolvedValue([
            { id: 'a', name: 'Rice', price: 100, group: { id: 'g1', name: 'Grains' } },
            { id: 'b', name: 'Dal', price: 200, group: { id: 'g1', name: 'Grains' } },
            { id: 'c', name: 'Pan', price: 900, group: null },
        ]);

        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        // By revenue, not units: Rice 10×100, Pan 1×900, Dal 4×200.
        expect(result.products.map((row) => row.name)).toEqual(['Rice', 'Pan', 'Dal']);
        expect(result.categories).toEqual([
            { id: 'g1', name: 'Grains', units: 14, revenue: 1_800 },
            { id: null, name: 'Ungrouped', units: 1, revenue: 900 },
        ]);
        // One scan of the items, not two.
        expect(db.saleItem.groupBy).toHaveBeenCalledTimes(1);
    });

    it('names a walk-in sale rather than dropping it from the customer ranking', async () => {
        db.sale.groupBy.mockResolvedValue([
            { customer_id: null, _sum: { total_amount: 3_000 }, _count: { _all: 6 } },
        ]);

        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        expect(result.customers[0].name).toBe('Walk-in');
        expect(result.customers[0].orders).toBe(6);
    });

    it('carries what each ranked customer still owes', async () => {
        db.sale.groupBy.mockResolvedValue([
            { customer_id: 'c1', _sum: { total_amount: 9_000 }, _count: { _all: 3 } },
        ]);
        db.customer.findMany.mockResolvedValue([{ id: 'c1', name: 'Karim', due_balance: 1_200 }]);

        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        expect(result.customers[0]).toEqual({
            id: 'c1', name: 'Karim', revenue: 9_000, orders: 3, owed: 1_200,
        });
    });

    it('subtracts a refund from the day it was recorded, not from the day of the sale', async () => {
        db.sale.findMany.mockResolvedValue([
            { sale_date: new Date(2026, 7, 1, 12), total_amount: 1_000 },
        ]);
        db.salesReturn.findMany.mockResolvedValue([
            { created_at: new Date(2026, 7, 3, 12), total_refund: 400 },
        ]);

        const result = await service.getTrends(TENANT, { from: '2026-08-01', to: '2026-08-03' }, 'Asia/Dhaka');

        expect(result.points[0].net_sales).toBe(1_000);
        expect(result.points[2].net_sales).toBe(-400);
        expect(result.points[2].returns).toBe(400);
    });

    it('buckets by local calendar day, unlike the sales reports it replaces', async () => {
        db.sale.findMany.mockResolvedValue([
            { sale_date: new Date(2026, 7, 2, 23, 45), total_amount: 500 },
        ]);

        const result = await service.getTrends(TENANT, { from: '2026-08-01', to: '2026-08-03' }, 'Asia/Dhaka');

        // `toISOString()` would have filed a Dhaka 11:45pm under the 2nd's UTC
        // afternoon — right here, but wrong for any evening after 6pm.
        expect(result.points.find((point) => point.date === '2026-08-02')?.net_sales).toBe(500);
    });
});
