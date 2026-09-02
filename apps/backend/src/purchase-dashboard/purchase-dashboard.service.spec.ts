import { Test } from '@nestjs/testing';
import { PurchaseDashboardService } from './purchase-dashboard.service';
import { DatabaseService } from '../database/database.service';

const TENANT = 'tenant-1';

const emptyAggregate = { _sum: { total_amount: null }, _count: { _all: 0 } };

describe('PurchaseDashboardService', () => {
    let service: PurchaseDashboardService;
    let db: any;

    beforeEach(async () => {
        db = {
            purchase: {
                aggregate: jest.fn().mockResolvedValue(emptyAggregate),
                count: jest.fn().mockResolvedValue(0),
                groupBy: jest.fn().mockResolvedValue([]),
                findMany: jest.fn().mockResolvedValue([]),
            },
            purchaseReturn: { aggregate: jest.fn().mockResolvedValue(emptyAggregate) },
            purchaseItem: { groupBy: jest.fn().mockResolvedValue([]) },
            purchaseOrder: { count: jest.fn().mockResolvedValue(0) },
            purchaseQuotation: { count: jest.fn().mockResolvedValue(0) },
            supplier: {
                aggregate: jest.fn().mockResolvedValue({ _sum: { due_balance: null } }),
                findMany: jest.fn().mockResolvedValue([]),
            },
            product: { findMany: jest.fn().mockResolvedValue([]) },
        };

        const moduleRef = await Test.createTestingModule({
            providers: [PurchaseDashboardService, { provide: DatabaseService, useValue: db }],
        }).compile();

        service = moduleRef.get(PurchaseDashboardService);
    });

    it('averages spend across the purchases in the window', async () => {
        db.purchase.aggregate.mockResolvedValue({ _sum: { total_amount: 30_000 }, _count: { _all: 4 } });

        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        expect(result.spend.total).toBe(30_000);
        expect(result.spend.purchases).toBe(4);
        expect(result.spend.avg_value).toBe(7_500);
    });

    it('reports no average rather than zero when nothing was bought', async () => {
        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        expect(result.spend.purchases).toBe(0);
        // 0 would read as "your average bill was nothing".
        expect(result.spend.avg_value).toBeNull();
    });

    it('takes payables from the whole book, not the window', async () => {
        db.supplier.aggregate.mockResolvedValue({ _sum: { due_balance: 84_500 } });

        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        expect(result.payables.outstanding).toBe(84_500);
        const call = db.supplier.aggregate.mock.calls[0][0];
        expect(call.where).not.toHaveProperty('created_at');
        expect(call.where.deleted_at).toBeNull();
    });

    it('counts a purchase order late only when it promised a date and missed it', async () => {
        await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        const overdueCall = db.purchaseOrder.count.mock.calls
            .map((call: any[]) => call[0])
            .find((arg: any) => arg.where.expected_date);

        expect(overdueCall.where.expected_date.lt).toBeInstanceOf(Date);
        expect(overdueCall.where.received_at).toBeNull();
        expect(overdueCall.where.status.in).toEqual(['DRAFT', 'SENT']);
    });

    it('counts quotations expiring within the week separately from ones already expired', async () => {
        await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        const [openCall, expiringCall, expiredCall] = db.purchaseQuotation.count.mock.calls.map((call: any[]) => call[0]);

        expect(openCall.where.status.in).toEqual(['DRAFT', 'SENT', 'RECEIVED', 'ACCEPTED']);
        expect(expiringCall.where.valid_until.gte).toBeInstanceOf(Date);
        expect(expiringCall.where.valid_until.lte).toBeInstanceOf(Date);
        expect(expiredCall.where.valid_until.lt).toBeInstanceOf(Date);
        // Seven days apart, not seven hours.
        const spanDays = Math.round(
            (expiringCall.where.valid_until.lte - expiringCall.where.valid_until.gte) / 86_400_000,
        );
        expect(spanDays).toBe(7);
    });

    it('ranks suppliers by spend and carries their outstanding balance across', async () => {
        db.purchase.groupBy.mockResolvedValue([
            { supplier_id: 's1', _sum: { total_amount: 5_000 }, _count: { _all: 2 } },
            { supplier_id: 's2', _sum: { total_amount: 12_000 }, _count: { _all: 1 } },
        ]);
        db.supplier.findMany.mockResolvedValue([
            { id: 's1', name: 'Alpha Traders', due_balance: 400 },
            { id: 's2', name: 'Beta Supply', due_balance: 0 },
        ]);

        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        expect(result.suppliers.map((row) => row.name)).toEqual(['Beta Supply', 'Alpha Traders']);
        expect(result.suppliers[1].outstanding).toBe(400);
    });

    it('names a supplier-less purchase rather than dropping it from the ranking', async () => {
        db.purchase.groupBy.mockResolvedValue([
            { supplier_id: null, _sum: { total_amount: 900 }, _count: { _all: 1 } },
        ]);

        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        expect(result.suppliers).toHaveLength(1);
        expect(result.suppliers[0].name).toBe('No supplier');
        expect(result.suppliers[0].outstanding).toBe(0);
    });

    it('ranks purchased products by spend, not by units', async () => {
        db.purchaseItem.groupBy.mockResolvedValue([
            { product_id: 'cheap', _sum: { quantity: 500, line_total: 1_000 } },
            { product_id: 'dear', _sum: { quantity: 2, line_total: 9_000 } },
        ]);
        db.product.findMany.mockResolvedValue([
            { id: 'cheap', name: 'Straws' },
            { id: 'dear', name: 'Freezer' },
        ]);

        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        expect(result.products.map((row) => row.name)).toEqual(['Freezer', 'Straws']);
    });

    it('carries returns alongside spend rather than netting them off it', async () => {
        db.purchase.aggregate.mockResolvedValue({ _sum: { total_amount: 10_000 }, _count: { _all: 2 } });
        db.purchaseReturn.aggregate.mockResolvedValue({ _sum: { total_amount: 1_500 }, _count: { _all: 1 } });

        const result = await service.getOverview(TENANT, {}, 'Asia/Dhaka');

        // Netting would hide both figures behind one that is neither.
        expect(result.spend.total).toBe(10_000);
        expect(result.spend.returns_value).toBe(1_500);
        expect(result.spend.returns_count).toBe(1);
    });

    it('buckets trends by local calendar day and zero-fills the quiet ones', async () => {
        const result = await service.getTrends(TENANT, { from: '2026-08-01', to: '2026-08-03' }, 'Asia/Dhaka');

        expect(result.points.map((point) => point.date)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
        expect(result.points.every((point) => point.spend === 0)).toBe(true);
    });

    it('reads the window bounds as local days, not as UTC instants', async () => {
        db.purchase.findMany.mockResolvedValue([
            { created_at: new Date('2026-08-02T22:15:00+06:00'), total_amount: 750 },
        ]);

        const result = await service.getTrends(TENANT, { from: '2026-08-01', to: '2026-08-03' }, 'Asia/Dhaka');

        expect(result.points.find((point) => point.date === '2026-08-02')?.spend).toBe(750);
    });
});
