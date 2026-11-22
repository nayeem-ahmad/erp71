import { CrmCampaignPerformanceService } from './crm-campaign-performance.service';

describe('CrmCampaignPerformanceService', () => {
    let service: CrmCampaignPerformanceService;
    let db: { crmCampaign: { findMany: jest.Mock } };

    beforeEach(() => {
        db = { crmCampaign: { findMany: jest.fn().mockResolvedValue([]) } };
        service = new CrmCampaignPerformanceService(db as any);
    });

    it('reads campaigns sent inside the window', async () => {
        await service.report('tenant-1', { from: '2026-11-01', to: '2026-11-15' }, 'UTC');

        expect(db.crmCampaign.findMany).toHaveBeenCalledWith({
            where: expect.objectContaining({
                tenant_id: 'tenant-1',
                sent_at: expect.objectContaining({ gte: expect.any(Date), lte: expect.any(Date) }),
            }),
            select: expect.objectContaining({
                id: true,
                name: true,
                channel: true,
                sent_at: true,
                recipient_count: true,
                delivered_count: true,
                failed_count: true,
                attributed_revenue: true,
                attributed_orders: true,
            }),
        });
    });

    it('works out delivery and conversion rates per campaign', async () => {
        db.crmCampaign.findMany.mockResolvedValue([
            {
                id: 'c1', name: 'Eid offer', channel: 'SMS', status: 'SENT',
                sent_at: new Date('2026-11-10T10:00:00Z'),
                recipient_count: 200, delivered_count: 190, failed_count: 10,
                attributed_revenue: 5000, attributed_orders: 12,
            },
        ]);

        const res = await service.report('tenant-1', { from: '2026-11-01', to: '2026-11-15' }, 'UTC');

        const row = res.rows[0];
        expect(row.delivery_pct).toBe(95);
        expect(row.conversion_pct).toBe(6.3); // 12 / 190
        expect(row.revenue_per_order).toBe(416.67); // 5000 / 12
        expect(row.recipients).toBe(200);
        expect(row.revenue).toBe(5000);
    });

    it('leaves a rate null when its base is zero', async () => {
        db.crmCampaign.findMany.mockResolvedValue([
            {
                id: 'c1', name: 'Empty', channel: 'EMAIL', status: 'SENT',
                sent_at: new Date('2026-11-10T10:00:00Z'),
                recipient_count: 0, delivered_count: 0, failed_count: 0,
                attributed_revenue: 0, attributed_orders: 0,
            },
        ]);

        const res = await service.report('tenant-1', {}, 'UTC');

        expect(res.rows[0].delivery_pct).toBeNull();
        expect(res.rows[0].conversion_pct).toBeNull();
        expect(res.rows[0].revenue_per_order).toBeNull();
    });

    it('sums the campaigns into totals and rolls them up by channel', async () => {
        db.crmCampaign.findMany.mockResolvedValue([
            {
                id: 'c1', name: 'A', channel: 'SMS', status: 'SENT',
                sent_at: new Date('2026-11-10T10:00:00Z'),
                recipient_count: 100, delivered_count: 90, failed_count: 10,
                attributed_revenue: 1000, attributed_orders: 5,
            },
            {
                id: 'c2', name: 'B', channel: 'SMS', status: 'SENT',
                sent_at: new Date('2026-11-11T10:00:00Z'),
                recipient_count: 50, delivered_count: 50, failed_count: 0,
                attributed_revenue: 500, attributed_orders: 2,
            },
            {
                id: 'c3', name: 'C', channel: 'EMAIL', status: 'SENT',
                sent_at: new Date('2026-11-12T10:00:00Z'),
                recipient_count: 40, delivered_count: 38, failed_count: 2,
                attributed_revenue: 2000, attributed_orders: 8,
            },
        ]);

        const res = await service.report('tenant-1', {}, 'UTC');

        expect(res.totals.campaigns).toBe(3);
        expect(res.totals.recipients).toBe(190);
        expect(res.totals.delivered).toBe(178);
        expect(res.totals.revenue).toBe(3500);
        expect(res.totals.orders).toBe(15);

        const sms = res.by_channel.find((c) => c.channel === 'SMS')!;
        expect(sms.campaigns).toBe(2);
        expect(sms.recipients).toBe(150);
        expect(sms.revenue).toBe(1500);
        expect(res.by_channel.map((c) => c.channel)).toEqual(['EMAIL', 'SMS']);
    });

    it('sorts campaigns by the revenue they returned, most first', async () => {
        db.crmCampaign.findMany.mockResolvedValue([
            {
                id: 'small', name: 'Small', channel: 'SMS', status: 'SENT',
                sent_at: new Date('2026-11-10T10:00:00Z'),
                recipient_count: 10, delivered_count: 10, failed_count: 0,
                attributed_revenue: 100, attributed_orders: 1,
            },
            {
                id: 'big', name: 'Big', channel: 'SMS', status: 'SENT',
                sent_at: new Date('2026-11-11T10:00:00Z'),
                recipient_count: 10, delivered_count: 10, failed_count: 0,
                attributed_revenue: 9000, attributed_orders: 9,
            },
        ]);

        const res = await service.report('tenant-1', {}, 'UTC');

        expect(res.rows.map((r) => r.campaign_id)).toEqual(['big', 'small']);
    });

    it('reports an empty period without dividing by zero', async () => {
        const res = await service.report('tenant-1', {}, 'UTC');

        expect(res.rows).toHaveLength(0);
        expect(res.by_channel).toHaveLength(0);
        expect(res.totals).toEqual({
            campaigns: 0, recipients: 0, delivered: 0, failed: 0,
            orders: 0, revenue: 0, delivery_pct: null, conversion_pct: null,
        });
    });
});
