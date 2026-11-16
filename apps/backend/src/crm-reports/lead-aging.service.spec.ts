import { LeadAgingService, AGING_BUCKETS } from './lead-aging.service';

describe('LeadAgingService', () => {
    let service: LeadAgingService;
    let db: { lead: { findMany: jest.Mock } };

    const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

    beforeEach(() => {
        jest.useFakeTimers();
        // 12:00 on 2026-11-15 in Dhaka (06:00 UTC), so "today" is unambiguous.
        jest.setSystemTime(new Date('2026-11-15T06:00:00Z'));

        db = { lead: { findMany: jest.fn().mockResolvedValue([]) } };
        service = new LeadAgingService(db as any);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('reads only open leads, with just the columns aging needs', async () => {
        await service.report('tenant-1');

        expect(db.lead.findMany).toHaveBeenCalledWith({
            where: {
                tenant_id: 'tenant-1',
                status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] },
            },
            select: {
                id: true,
                status: true,
                created_at: true,
                last_activity_at: true,
            },
        });
    });

    it('puts each lead in the bucket its age falls in', async () => {
        db.lead.findMany.mockResolvedValue([
            // 3 days old
            { id: 'l1', status: 'NEW', created_at: day('2026-11-12'), last_activity_at: day('2026-11-13') },
            // 10 days old
            { id: 'l2', status: 'CONTACTED', created_at: day('2026-11-05'), last_activity_at: day('2026-11-14') },
            // 20 days old
            { id: 'l3', status: 'QUALIFIED', created_at: day('2026-10-26'), last_activity_at: day('2026-11-14') },
            // 45 days old
            { id: 'l4', status: 'NEW', created_at: day('2026-10-01'), last_activity_at: day('2026-11-14') },
            // 75 days old
            { id: 'l5', status: 'CONTACTED', created_at: day('2026-09-01'), last_activity_at: day('2026-11-14') },
            // 200 days old
            { id: 'l6', status: 'QUALIFIED', created_at: day('2026-04-29'), last_activity_at: day('2026-11-14') },
        ]);

        const report = await service.report('tenant-1');
        const byKey = Object.fromEntries(report.buckets.map((b) => [b.key, b.leads]));

        expect(byKey).toEqual({
            '0-7': 1,
            '8-14': 1,
            '15-30': 1,
            '31-60': 1,
            '61-90': 1,
            '90+': 1,
        });
        expect(report.totals.open).toBe(6);
    });

    it('measures the oldest lead in each bucket and the whole book', async () => {
        db.lead.findMany.mockResolvedValue([
            { id: 'l1', status: 'NEW', created_at: day('2026-09-01'), last_activity_at: day('2026-11-14') },
            { id: 'l2', status: 'NEW', created_at: day('2026-09-16'), last_activity_at: day('2026-11-14') },
        ]);

        const report = await service.report('tenant-1');

        expect(report.buckets.find((b) => b.key === '61-90')?.oldest_days).toBe(75);
        expect(report.totals.oldest_days).toBe(75);
        expect(report.totals.avg_age_days).toBe(67.5); // (75 + 60) / 2
    });

    it('counts a lead with no activity since the cutoff as stale, and falls back to created_at', async () => {
        // cutoff is 14 days before 2026-11-15 → 2026-11-01
        db.lead.findMany.mockResolvedValue([
            // never worked, filed long ago → stale
            { id: 'l1', status: 'NEW', created_at: day('2026-10-01'), last_activity_at: null },
            // never worked, filed yesterday → not stale
            { id: 'l2', status: 'NEW', created_at: day('2026-11-14'), last_activity_at: null },
            // worked 3 days ago → not stale
            { id: 'l3', status: 'CONTACTED', created_at: day('2026-08-01'), last_activity_at: day('2026-11-12') },
            // worked 30 days ago → stale
            { id: 'l4', status: 'QUALIFIED', created_at: day('2026-08-01'), last_activity_at: day('2026-10-16') },
        ]);

        const report = await service.report('tenant-1');

        expect(report.totals.stale).toBe(2);
        expect(report.totals.stale_pct).toBe(50);
        expect(report.stale_after_days).toBe(14);
        expect(report.buckets.find((b) => b.key === '31-60')?.stale).toBe(1);
    });

    it('rolls the same leads up by stage', async () => {
        db.lead.findMany.mockResolvedValue([
            { id: 'l1', status: 'NEW', created_at: day('2026-11-12'), last_activity_at: day('2026-11-14') },
            { id: 'l2', status: 'NEW', created_at: day('2026-09-01'), last_activity_at: day('2026-09-02') },
            { id: 'l3', status: 'QUALIFIED', created_at: day('2026-11-05'), last_activity_at: day('2026-11-14') },
        ]);

        const report = await service.report('tenant-1');

        const newRow = report.by_stage.find((s) => s.status === 'NEW');
        expect(newRow).toEqual({
            status: 'NEW',
            leads: 2,
            avg_age_days: 39, // (3 + 75) / 2
            oldest_days: 75,
            stale: 1,
        });
        expect(report.by_stage.find((s) => s.status === 'QUALIFIED')?.leads).toBe(1);
    });

    it('leaves out a stage with no open leads rather than showing a zero row', async () => {
        db.lead.findMany.mockResolvedValue([
            { id: 'l1', status: 'NEW', created_at: day('2026-11-12'), last_activity_at: day('2026-11-14') },
        ]);

        const report = await service.report('tenant-1');

        expect(report.by_stage.map((s) => s.status)).toEqual(['NEW']);
    });

    it('narrows to the caller\u2019s leads under mine', async () => {
        await service.report('tenant-1', 'user-1');

        expect(db.lead.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    tenant_id: 'tenant-1',
                    assigned_to: 'user-1',
                }),
            }),
        );
    });

    it('counts the calendar day, not 24-hour blocks', async () => {
        // Filed at 23:00 Dhaka on the 14th; "now" is 12:00 on the 15th — one day
        // old on the calendar, even though barely 13 hours have passed.
        db.lead.findMany.mockResolvedValue([
            { id: 'l1', status: 'NEW', created_at: new Date('2026-11-14T17:00:00Z'), last_activity_at: new Date('2026-11-14T17:00:00Z') },
        ]);

        const report = await service.report('tenant-1');

        expect(report.buckets.find((b) => b.key === '0-7')?.leads).toBe(1);
        expect(report.totals.avg_age_days).toBe(1);
    });

    it('reports an empty book without dividing by zero', async () => {
        const report = await service.report('tenant-1');

        expect(report.totals).toEqual({
            open: 0,
            stale: 0,
            stale_pct: null,
            avg_age_days: null,
            oldest_days: null,
        });
        expect(report.buckets).toHaveLength(AGING_BUCKETS.length);
        expect(report.buckets.every((b) => b.leads === 0 && b.share_pct === null)).toBe(true);
    });

    it('names the as-of day on the tenant calendar', async () => {
        const report = await service.report('tenant-1', undefined, 'Asia/Dhaka');

        expect(report.as_of).toBe('2026-11-15');
    });
});
