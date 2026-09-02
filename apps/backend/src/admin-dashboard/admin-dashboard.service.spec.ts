import { Test } from '@nestjs/testing';
import { AdminDashboardService } from './admin-dashboard.service';
import { DatabaseService } from '../database/database.service';

describe('AdminDashboardService', () => {
    let service: AdminDashboardService;
    let db: any;

    beforeEach(async () => {
        db = {
            tenant: {
                count: jest.fn().mockResolvedValue(0),
                findMany: jest.fn().mockResolvedValue([]),
            },
            user: { count: jest.fn().mockResolvedValue(0) },
            tenantSubscription: {
                groupBy: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
                findMany: jest.fn().mockResolvedValue([]),
            },
            billingEvent: {
                aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null }, _count: { _all: 0 } }),
                groupBy: jest.fn().mockResolvedValue([]),
                findMany: jest.fn().mockResolvedValue([]),
            },
            supportThread: { findMany: jest.fn().mockResolvedValue([]) },
            subscriptionPlan: { findMany: jest.fn().mockResolvedValue([]) },
        };

        const moduleRef = await Test.createTestingModule({
            providers: [AdminDashboardService, { provide: DatabaseService, useValue: db }],
        }).compile();

        service = moduleRef.get(AdminDashboardService);
    });

    it('counts only live tenants, never the soft-deleted ones', async () => {
        await service.getOverview({}, 'Asia/Dhaka');

        for (const call of db.tenant.count.mock.calls) {
            expect(call[0].where.deleted_at).toBeNull();
        }
    });

    it('splits subscriptions by status and flags trials about to lapse', async () => {
        db.tenantSubscription.groupBy.mockResolvedValue([
            { status: 'ACTIVE', _count: { status: 40 } },
            { status: 'TRIALING', _count: { status: 7 } },
            { status: 'PAST_DUE', _count: { status: 3 } },
        ]);

        const result = await service.getOverview({}, 'Asia/Dhaka');

        expect(result.subscriptions.active).toBe(40);
        expect(result.subscriptions.trialing).toBe(7);
        expect(result.subscriptions.past_due).toBe(3);
        // Absent from the groupBy is zero, not undefined.
        expect(result.subscriptions.cancelled).toBe(0);

        const trialCall = db.tenantSubscription.count.mock.calls
            .map((call: any[]) => call[0])
            .find((arg: any) => arg.where.status === 'TRIALING');
        const spanDays = Math.round(
            (trialCall.where.current_period_end.lte - trialCall.where.current_period_end.gte) / 86_400_000,
        );
        expect(spanDays).toBe(7);
    });

    it('names the run rate a ceiling, because it ignores per-tenant discounts', async () => {
        db.tenantSubscription.findMany.mockResolvedValue([
            { plan: { monthly_price: 2_000 } },
            { plan: { monthly_price: 5_000 } },
        ]);

        const result = await service.getOverview({}, 'Asia/Dhaka');

        // The field is `mrr_ceiling`, not `mrr` — discounts are stored as a type
        // and a value, and resolving them here would fork billing arithmetic.
        expect(result.revenue.mrr_ceiling).toBe(7_000);
    });

    it('counts only successful billing events as revenue', async () => {
        await service.getOverview({}, 'Asia/Dhaka');

        expect(db.billingEvent.aggregate).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ status: 'SUCCESS' }) }),
        );
    });

    it('counts a support thread as awaiting reply only when the owner spoke last', async () => {
        db.supportThread.findMany.mockResolvedValue([
            { id: 't1', messages: [{ senderRole: 'owner' }] },
            { id: 't2', messages: [{ senderRole: 'admin' }] },
            { id: 't3', messages: [] },
        ]);

        const result = await service.getOverview({}, 'Asia/Dhaka');

        expect(result.support.open_threads).toBe(3);
        expect(result.support.awaiting_reply).toBe(1);
    });

    it('ranks tenants by what they actually paid in the window', async () => {
        db.billingEvent.groupBy.mockResolvedValue([
            { tenant_id: 'a', _sum: { amount: 1_000 }, _count: { _all: 1 } },
            { tenant_id: 'b', _sum: { amount: 9_000 }, _count: { _all: 3 } },
        ]);
        db.tenant.findMany.mockResolvedValue([
            { id: 'a', name: 'Alpha Shop', subscription: { plan: { code: 'BASIC' } } },
            { id: 'b', name: 'Beta Store', subscription: { plan: { code: 'PREMIUM' } } },
        ]);

        const result = await service.getOverview({}, 'Asia/Dhaka');

        expect(result.top_tenants.map((row) => row.name)).toEqual(['Beta Store', 'Alpha Shop']);
        expect(result.top_tenants[0].plan).toBe('PREMIUM');
    });

    it('reports a tenant with no subscription rather than dropping it from recent signups', async () => {
        db.tenant.findMany.mockResolvedValue([
            { id: 't1', name: 'New Shop', created_at: new Date(), subscription: null },
        ]);

        const result = await service.getOverview({}, 'Asia/Dhaka');

        expect(result.recent_signups[0]).toMatchObject({ name: 'New Shop', plan: null, status: null });
    });

    it('buckets trends by local calendar day and zero-fills the quiet ones', async () => {
        db.tenant.findMany.mockResolvedValue([{ created_at: new Date('2026-08-02T20:00:00+06:00') }]);
        db.billingEvent.findMany.mockResolvedValue([
            { created_at: new Date('2026-08-02T20:00:00+06:00'), amount: 2_000 },
        ]);

        const result = await service.getTrends({ from: '2026-08-01', to: '2026-08-03' }, 'Asia/Dhaka');

        expect(result.points.map((point) => point.date)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
        expect(result.points[1]).toEqual({ date: '2026-08-02', signups: 1, billed: 2_000 });
    });
});
