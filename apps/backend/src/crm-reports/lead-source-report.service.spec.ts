import { LeadSourceReportService } from './lead-source-report.service';
import { revenueByConvertedLead } from './converted-revenue.util';
import { LeadStatus } from '../crm-leads/crm-leads.dto';

jest.mock('./converted-revenue.util', () => ({
    revenueByConvertedLead: jest.fn(),
}));

describe('LeadSourceReportService', () => {
    let service: LeadSourceReportService;
    let db: {
        lead: { findMany: jest.Mock };
        leadSourceOption: { findMany: jest.Mock };
        sale: { findMany: jest.Mock };
    };
    const mockedRevenue = revenueByConvertedLead as jest.MockedFunction<typeof revenueByConvertedLead>;

    beforeEach(() => {
        db = {
            lead: { findMany: jest.fn().mockResolvedValue([]) },
            leadSourceOption: { findMany: jest.fn().mockResolvedValue([]) },
            sale: { findMany: jest.fn().mockResolvedValue([]) },
        };
        mockedRevenue.mockReset();
        mockedRevenue.mockResolvedValue(new Map());
        service = new LeadSourceReportService(db as any);
    });

    it("groups the window's leads by source with conversion and win rate", async () => {
        db.leadSourceOption.findMany.mockResolvedValue([
            { id: 'S1', name: 'Website' },
        ]);
        db.lead.findMany.mockResolvedValue([
            {
                id: 'l1',
                source_id: 'S1',
                status: LeadStatus.CONVERTED,
                last_contacted_at: new Date('2026-11-02T10:00:00Z'),
                created_at: new Date('2026-11-01T10:00:00Z'),
                closed_at: new Date('2026-11-03T10:00:00Z'),
                converted_customer_id: 'c1',
            },
            {
                id: 'l2',
                source_id: 'S1',
                status: LeadStatus.CONVERTED,
                last_contacted_at: new Date('2026-11-02T10:00:00Z'),
                created_at: new Date('2026-11-01T10:00:00Z'),
                closed_at: new Date('2026-11-05T10:00:00Z'),
                converted_customer_id: 'c2',
            },
            {
                id: 'l3',
                source_id: 'S1',
                status: LeadStatus.LOST,
                last_contacted_at: new Date('2026-11-02T10:00:00Z'),
                created_at: new Date('2026-11-01T10:00:00Z'),
                closed_at: new Date('2026-11-04T10:00:00Z'),
                converted_customer_id: null,
            },
            {
                id: 'l4',
                source_id: 'S1',
                status: LeadStatus.NEW,
                last_contacted_at: null,
                created_at: new Date('2026-11-01T10:00:00Z'),
                closed_at: null,
                converted_customer_id: null,
            },
        ]);

        const res = await service.report('tenant-1', { from: '2026-11-01', to: '2026-11-10' }, 'UTC');

        expect(res.rows).toHaveLength(1);
        const row = res.rows[0];
        expect(row.source_id).toBe('S1');
        expect(row.name).toBe('Website');
        expect(row.leads).toBe(4);
        expect(row.converted).toBe(2);
        expect(row.lost).toBe(1);
        expect(row.open).toBe(1);
        expect(row.contacted).toBe(3);
        expect(row.conversion_pct).toBe(50);
        expect(row.win_rate_pct).toBe(66.7);
    });

    it('takes the median days from created_at to closed_at over converted leads', async () => {
        db.leadSourceOption.findMany.mockResolvedValue([
            { id: 'S1', name: 'Referral' },
        ]);
        db.lead.findMany.mockResolvedValue([
            {
                id: 'l1',
                source_id: 'S1',
                status: LeadStatus.CONVERTED,
                last_contacted_at: new Date(),
                created_at: new Date('2026-11-01T00:00:00Z'),
                closed_at: new Date('2026-11-03T00:00:00Z'), // 2 days
                converted_customer_id: 'c1',
            },
            {
                id: 'l2',
                source_id: 'S1',
                status: LeadStatus.CONVERTED,
                last_contacted_at: new Date(),
                created_at: new Date('2026-11-01T00:00:00Z'),
                closed_at: new Date('2026-11-05T00:00:00Z'), // 4 days
                converted_customer_id: 'c2',
            },
            {
                id: 'l3',
                source_id: 'S1',
                status: LeadStatus.CONVERTED,
                last_contacted_at: new Date(),
                created_at: new Date('2026-11-01T00:00:00Z'),
                closed_at: new Date('2026-11-11T00:00:00Z'), // 10 days
                converted_customer_id: 'c3',
            },
        ]);

        const res = await service.report('tenant-1', { from: '2026-11-01', to: '2026-11-15' }, 'UTC');

        expect(res.rows[0].median_days_to_convert).toBe(4);
        expect(res.totals.median_days_to_convert).toBe(4);
    });

    it('puts leads with no source on one row with a null name', async () => {
        db.lead.findMany.mockResolvedValue([
            {
                id: 'l1',
                source_id: null,
                status: LeadStatus.NEW,
                last_contacted_at: null,
                created_at: new Date('2026-11-01T10:00:00Z'),
                closed_at: null,
                converted_customer_id: null,
            },
        ]);

        const res = await service.report('tenant-1', {}, 'UTC');

        expect(res.rows).toHaveLength(1);
        expect(res.rows[0].source_id).toBeNull();
        expect(res.rows[0].name).toBeNull();
    });

    it('counts a converted lead with no customer as converted and earns it nothing', async () => {
        db.leadSourceOption.findMany.mockResolvedValue([{ id: 'S1', name: 'Ads' }]);
        db.lead.findMany.mockResolvedValue([
            {
                id: 'l1',
                source_id: 'S1',
                status: LeadStatus.CONVERTED,
                last_contacted_at: new Date(),
                created_at: new Date('2026-11-01T00:00:00Z'),
                closed_at: new Date('2026-11-02T00:00:00Z'),
                converted_customer_id: null,
            },
        ]);

        const res = await service.report('tenant-1', {}, 'UTC');

        expect(res.rows[0].converted).toBe(1);
        expect(res.rows[0].revenue).toBe(0);
    });

    it('returns null rates when the base is zero', async () => {
        db.leadSourceOption.findMany.mockResolvedValue([{ id: 'S1', name: 'Organic' }]);
        db.lead.findMany.mockResolvedValue([
            {
                id: 'l1',
                source_id: 'S1',
                status: LeadStatus.NEW,
                last_contacted_at: null,
                created_at: new Date('2026-11-01T00:00:00Z'),
                closed_at: null,
                converted_customer_id: null,
            },
        ]);

        const res = await service.report('tenant-1', {}, 'UTC');

        expect(res.rows[0].win_rate_pct).toBeNull();
        expect(res.rows[0].median_days_to_convert).toBeNull();
        expect(res.totals.win_rate_pct).toBeNull();
        expect(res.totals.median_days_to_convert).toBeNull();
    });

    it("narrows to the caller's leads under mine", async () => {
        await service.report('tenant-1', { mine: true }, 'UTC', 'user-1');

        expect(db.lead.findMany).toHaveBeenCalledWith({
            where: expect.objectContaining({
                tenant_id: 'tenant-1',
                assigned_to: 'user-1',
                created_at: expect.any(Object),
            }),
            select: expect.any(Object),
        });
    });

    it('sums the rows into totals and sorts by leads, most first', async () => {
        db.leadSourceOption.findMany.mockResolvedValue([
            { id: 'S1', name: 'Few' },
            { id: 'S2', name: 'Many' },
        ]);
        db.lead.findMany.mockResolvedValue([
            {
                id: 'l1',
                source_id: 'S1',
                status: LeadStatus.NEW,
                last_contacted_at: null,
                created_at: new Date('2026-11-01T00:00:00Z'),
                closed_at: null,
                converted_customer_id: null,
            },
            {
                id: 'l2',
                source_id: 'S2',
                status: LeadStatus.NEW,
                last_contacted_at: null,
                created_at: new Date('2026-11-01T00:00:00Z'),
                closed_at: null,
                converted_customer_id: null,
            },
            {
                id: 'l3',
                source_id: 'S2',
                status: LeadStatus.NEW,
                last_contacted_at: null,
                created_at: new Date('2026-11-01T00:00:00Z'),
                closed_at: null,
                converted_customer_id: null,
            },
        ]);

        const res = await service.report('tenant-1', {}, 'UTC');

        expect(res.rows).toHaveLength(2);
        expect(res.rows[0].source_id).toBe('S2');
        expect(res.rows[0].leads).toBe(2);
        expect(res.rows[1].source_id).toBe('S1');
        expect(res.rows[1].leads).toBe(1);
        expect(res.totals.leads).toBe(3);
    });
});
