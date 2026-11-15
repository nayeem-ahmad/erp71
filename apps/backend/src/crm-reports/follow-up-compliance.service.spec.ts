import {
    classifyFollowUp,
    FollowUpComplianceService,
} from './follow-up-compliance.service';
import { zonedDateString, zonedDayStart } from '../common/tenant-time.util';

describe('classifyFollowUp', () => {
    const tz = 'Asia/Dhaka';
    const dayOf = (d: Date) => zonedDateString(d, tz);
    // 2026-11-15 00:00:00 in Asia/Dhaka is 2026-11-14 18:00:00 UTC
    const todayStart = zonedDayStart('2026-11-15', tz) as Date;

    it('classifies follow-up outcomes correctly', () => {
        // due 2026-11-10 09:00 local (+06:00 is 03:00 UTC), done 2026-11-10 22:00 local (16:00 UTC) -> on_time
        expect(
            classifyFollowUp(
                {
                    status: 'DONE',
                    due_at: new Date('2026-11-10T03:00:00Z'),
                    completed_at: new Date('2026-11-10T16:00:00Z'),
                },
                todayStart,
                dayOf,
            ),
        ).toBe('on_time');

        // due 2026-11-10 23:00 local (17:00 UTC), done 2026-11-11 01:00 local (19:00 UTC on 11-10) -> late
        expect(
            classifyFollowUp(
                {
                    status: 'DONE',
                    due_at: new Date('2026-11-10T17:00:00Z'),
                    completed_at: new Date('2026-11-10T19:00:00Z'),
                },
                todayStart,
                dayOf,
            ),
        ).toBe('late');

        // PLANNED due 2026-11-14 -> overdue
        expect(
            classifyFollowUp(
                {
                    status: 'PLANNED',
                    due_at: new Date('2026-11-14T06:00:00Z'),
                    completed_at: null,
                },
                todayStart,
                dayOf,
            ),
        ).toBe('overdue');

        // PLANNED due 2026-11-15 08:00 local (02:00 UTC) -> pending
        expect(
            classifyFollowUp(
                {
                    status: 'PLANNED',
                    due_at: new Date('2026-11-15T02:00:00Z'),
                    completed_at: null,
                },
                todayStart,
                dayOf,
            ),
        ).toBe('pending');

        // CANCELLED -> cancelled
        expect(
            classifyFollowUp(
                {
                    status: 'CANCELLED',
                    due_at: new Date('2026-11-10T00:00:00Z'),
                    completed_at: null,
                },
                todayStart,
                dayOf,
            ),
        ).toBe('cancelled');

        // DONE with completed_at null -> on_time
        expect(
            classifyFollowUp(
                {
                    status: 'DONE',
                    due_at: new Date('2026-11-10T00:00:00Z'),
                    completed_at: null,
                },
                todayStart,
                dayOf,
            ),
        ).toBe('on_time');
    });
});

describe('FollowUpComplianceService', () => {
    let service: FollowUpComplianceService;
    let db: {
        crmActivity: { findMany: jest.Mock; count: jest.Mock };
        crmActivityPurpose: { findMany: jest.Mock };
        user: { findMany: jest.Mock };
    };

    beforeEach(() => {
        db = {
            crmActivity: {
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
            },
            crmActivityPurpose: { findMany: jest.fn().mockResolvedValue([]) },
            user: { findMany: jest.fn().mockResolvedValue([]) },
        };
        service = new FollowUpComplianceService(db as any);
    });

    it('reads only planned work with a due date in the window', async () => {
        await service.report('tenant-1', { from: '2026-11-01', to: '2026-11-15' }, 'Asia/Dhaka');

        expect(db.crmActivity.findMany).toHaveBeenCalledWith({
            where: expect.objectContaining({
                tenant_id: 'tenant-1',
                subject: { not: null },
                due_at: expect.objectContaining({
                    gte: expect.any(Date),
                    lte: expect.any(Date),
                }),
            }),
            select: {
                assigned_to: true,
                purpose_id: true,
                status: true,
                due_at: true,
                completed_at: true,
            },
        });
    });

    it('puts unassigned follow-ups on one row with a null user', async () => {
        db.crmActivity.findMany.mockResolvedValue([
            {
                assigned_to: null,
                purpose_id: null,
                status: 'DONE',
                due_at: new Date('2026-11-10T00:00:00Z'),
                completed_at: new Date('2026-11-10T00:00:00Z'),
            },
        ]);

        const res = await service.report('tenant-1', { from: '2026-11-01', to: '2026-11-15' }, 'UTC');

        expect(res.by_assignee).toHaveLength(1);
        expect(res.by_assignee[0].user_id).toBeNull();
        expect(res.by_assignee[0].name).toBeNull();
    });

    it('leaves pending and cancelled out of compliance', async () => {
        // 1 on time, 1 late, 2 pending, 1 cancelled
        // Base for compliance = on_time (1) + late (1) + overdue (0) = 2.
        // compliance_pct = 1 / 2 = 50. Total due = 5.
        // Let's set a future date for pending, a past date for on_time/late, etc.
        const futureDate = new Date(Date.now() + 86400000 * 2);
        const pastDate = new Date(Date.now() - 86400000 * 2);
        const pastDate2 = new Date(Date.now() - 86400000 * 3);

        db.crmActivity.findMany.mockResolvedValue([
            {
                assigned_to: 'u1',
                purpose_id: 'p1',
                status: 'DONE',
                due_at: pastDate,
                completed_at: pastDate, // on time
            },
            {
                assigned_to: 'u1',
                purpose_id: 'p1',
                status: 'DONE',
                due_at: pastDate2,
                completed_at: pastDate, // late
            },
            {
                assigned_to: 'u1',
                purpose_id: 'p1',
                status: 'PLANNED',
                due_at: futureDate,
                completed_at: null, // pending
            },
            {
                assigned_to: 'u1',
                purpose_id: 'p1',
                status: 'PLANNED',
                due_at: futureDate,
                completed_at: null, // pending
            },
            {
                assigned_to: 'u1',
                purpose_id: 'p1',
                status: 'CANCELLED',
                due_at: pastDate,
                completed_at: null, // cancelled
            },
        ]);

        const res = await service.report('tenant-1', { from: '2026-01-01', to: '2026-12-31' }, 'UTC');

        expect(res.totals.due).toBe(5);
        expect(res.totals.on_time).toBe(1);
        expect(res.totals.late).toBe(1);
        expect(res.totals.pending).toBe(2);
        expect(res.totals.cancelled).toBe(1);
        expect(res.totals.compliance_pct).toBe(50);
    });

    it('counts undated open work separately', async () => {
        db.crmActivity.count.mockResolvedValue(4);

        const res = await service.report('tenant-1', {}, 'UTC');

        expect(db.crmActivity.count).toHaveBeenCalledWith({
            where: {
                tenant_id: 'tenant-1',
                status: 'PLANNED',
                due_at: null,
                subject: { not: null },
            },
        });
        expect(res.undated_open).toBe(4);
    });

    it('names purposes from CrmActivityPurpose and users by name, falling back to email', async () => {
        db.user.findMany.mockResolvedValue([
            { id: 'u1', name: 'Alice Smith', email: 'alice@example.com' },
            { id: 'u2', name: null, email: 'bob@example.com' },
        ]);
        db.crmActivityPurpose.findMany.mockResolvedValue([
            { id: 'p1', name: 'Demo Call' },
        ]);
        db.crmActivity.findMany.mockResolvedValue([
            {
                assigned_to: 'u1',
                purpose_id: 'p1',
                status: 'DONE',
                due_at: new Date('2026-11-10T00:00:00Z'),
                completed_at: new Date('2026-11-10T00:00:00Z'),
            },
            {
                assigned_to: 'u2',
                purpose_id: 'p1',
                status: 'DONE',
                due_at: new Date('2026-11-10T00:00:00Z'),
                completed_at: new Date('2026-11-10T00:00:00Z'),
            },
        ]);

        const res = await service.report('tenant-1', { from: '2026-11-01', to: '2026-11-15' }, 'UTC');

        const alice = res.by_assignee.find((r) => r.user_id === 'u1');
        const bob = res.by_assignee.find((r) => r.user_id === 'u2');
        const demo = res.by_purpose.find((r) => r.purpose_id === 'p1');

        expect(alice?.name).toBe('Alice Smith');
        expect(bob?.name).toBe('bob@example.com');
        expect(demo?.name).toBe('Demo Call');
    });
});
