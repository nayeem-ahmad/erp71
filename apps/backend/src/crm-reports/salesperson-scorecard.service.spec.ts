import { SalespersonScorecardService } from './salesperson-scorecard.service';
import { revenueByConvertedLead } from './converted-revenue.util';
import { FollowUpComplianceService } from './follow-up-compliance.service';
import { LeadStatus } from '../crm-leads/crm-leads.dto';

jest.mock('./converted-revenue.util', () => ({
    revenueByConvertedLead: jest.fn(),
}));

describe('SalespersonScorecardService', () => {
    let service: SalespersonScorecardService;
    let followUpComplianceService: { byAssignee: jest.Mock };
    let db: {
        lead: { groupBy: jest.Mock; findMany: jest.Mock };
        crmActivity: { groupBy: jest.Mock };
        user: { findMany: jest.Mock };
    };
    const mockedRevenue = revenueByConvertedLead as jest.MockedFunction<typeof revenueByConvertedLead>;

    beforeEach(() => {
        followUpComplianceService = {
            byAssignee: jest.fn().mockResolvedValue(new Map()),
        };
        db = {
            lead: {
                groupBy: jest.fn().mockResolvedValue([]),
                findMany: jest.fn().mockResolvedValue([]),
            },
            crmActivity: {
                groupBy: jest.fn().mockResolvedValue([]),
            },
            user: {
                findMany: jest.fn().mockResolvedValue([]),
            },
        };
        mockedRevenue.mockReset();
        mockedRevenue.mockResolvedValue(new Map());
        service = new SalespersonScorecardService(db as any, followUpComplianceService as any);
    });

    it('builds one row per person who owns, worked or closed anything', async () => {
        db.user.findMany.mockResolvedValue([
            { id: 'user-A', name: 'Alice', email: 'alice@example.com' },
            { id: 'user-B', name: 'Bob', email: 'bob@example.com' },
        ]);

        // user A has only an overdue activity
        // user B has only a conversion
        db.crmActivity.groupBy.mockImplementation(async ({ where }) => {
            if (where.status === 'PLANNED') {
                return [{ assigned_to: 'user-A', _count: { _all: 1 } }];
            }
            return [];
        });

        db.lead.groupBy.mockImplementation(async ({ where }) => {
            if (where.status?.in?.includes(LeadStatus.CONVERTED)) {
                return [{ assigned_to: 'user-B', status: LeadStatus.CONVERTED, _count: { _all: 1 } }];
            }
            return [];
        });

        const res = await service.report('tenant-1', {}, 'UTC');

        expect(res.rows).toHaveLength(2);
        const userA = res.rows.find((r) => r.user_id === 'user-A');
        const userB = res.rows.find((r) => r.user_id === 'user-B');
        expect(userA).toBeDefined();
        expect(userA?.overdue_now).toBe(1);
        expect(userB).toBeDefined();
        expect(userB?.converted).toBe(1);
    });

    it('takes follow-up figures from FollowUpComplianceService for the same window', async () => {
        await service.report('tenant-1', { from: '2026-11-01', to: '2026-11-15' }, 'UTC');

        expect(followUpComplianceService.byAssignee).toHaveBeenCalledWith(
            'tenant-1',
            expect.objectContaining({ from: '2026-11-01', to: '2026-11-15' }),
            undefined,
        );
    });

    it('credits revenue only from sales inside the window', async () => {
        db.user.findMany.mockResolvedValue([{ id: 'user-1', name: 'Alice', email: 'alice@test' }]);
        db.lead.findMany.mockResolvedValue([
            { id: 'l1', assigned_to: 'user-1', converted_customer_id: 'c1', closed_at: new Date('2026-10-01') },
        ]);
        mockedRevenue.mockResolvedValue(new Map([['l1', { orders: 1, revenue: 5000 }]]));

        const res = await service.report('tenant-1', { from: '2026-11-01', to: '2026-11-15' }, 'UTC');

        expect(mockedRevenue).toHaveBeenCalledWith(
            db,
            'tenant-1',
            expect.any(Array),
            expect.objectContaining({
                fromDate: expect.any(Date),
                toDate: expect.any(Date),
            }),
        );
        expect(res.rows[0].revenue).toBe(5000);
        expect(res.totals.revenue).toBe(5000);
    });

    it('leaves unassigned work out of the rows', async () => {
        db.crmActivity.groupBy.mockImplementation(async ({ where }) => {
            if (where.status === 'PLANNED') {
                return [{ assigned_to: null, _count: { _all: 3 } }];
            }
            return [];
        });

        const res = await service.report('tenant-1', {}, 'UTC');

        expect(res.rows).toHaveLength(0);
        expect(res.totals.overdue_now).toBe(0);
    });

    it('returns null win rate when nothing closed', async () => {
        db.user.findMany.mockResolvedValue([{ id: 'user-1', name: 'Alice', email: 'alice@test' }]);
        db.lead.groupBy.mockImplementation(async ({ where }) => {
            if (where.created_at) {
                return [{ assigned_to: 'user-1', _count: { _all: 2 } }];
            }
            return [];
        });

        const res = await service.report('tenant-1', {}, 'UTC');

        expect(res.rows).toHaveLength(1);
        expect(res.rows[0].win_rate_pct).toBeNull();
        expect(res.totals.win_rate_pct).toBeNull();
    });

    it("under mine, returns only the caller's row", async () => {
        db.user.findMany.mockResolvedValue([{ id: 'user-1', name: 'Alice', email: 'alice@test' }]);
        db.lead.groupBy.mockImplementation(async ({ where }) => {
            expect(where.assigned_to).toBe('user-1');
            return [{ assigned_to: 'user-1', _count: { _all: 1 } }];
        });
        db.crmActivity.groupBy.mockImplementation(async ({ where }) => {
            expect(where.assigned_to).toBe('user-1');
            return [];
        });

        const res = await service.report('tenant-1', { mine: true }, 'UTC', 'user-1');

        expect(res.rows).toHaveLength(1);
        expect(res.rows[0].user_id).toBe('user-1');
        expect(followUpComplianceService.byAssignee).toHaveBeenCalledWith(
            'tenant-1',
            expect.any(Object),
            'user-1',
        );
    });
});
