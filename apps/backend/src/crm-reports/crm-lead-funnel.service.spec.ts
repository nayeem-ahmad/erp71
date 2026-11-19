import { CrmLeadFunnelService } from './crm-lead-funnel.service';

describe('CrmLeadFunnelService', () => {
    let service: CrmLeadFunnelService;
    let db: { lead: { findMany: jest.Mock } };

    const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-11-15T06:00:00Z'));
        db = { lead: { findMany: jest.fn().mockResolvedValue([]) } };
        service = new CrmLeadFunnelService(db as any);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('defaults to the last 12 months of arrivals', async () => {
        const res = await service.report('tenant-1', 'UTC');

        expect(res.months).toHaveLength(12);
        expect(res.months[0]).toBe('2025-12');
        expect(res.months[11]).toBe('2026-11');
    });

    it('groups arrivals into the month they were created, on the tenant calendar', async () => {
        db.lead.findMany.mockResolvedValue([
            // 20:00 UTC on 31 Oct is 02:00 on 1 Nov in Dhaka.
            { status: 'NEW', created_at: new Date('2026-10-31T20:00:00Z') },
            { status: 'CONTACTED', created_at: day('2026-11-02') },
        ]);

        const res = await service.report('tenant-1', 'Asia/Dhaka');

        expect(res.rows.find((r) => r.month === '2026-11')?.arrived).toBe(2);
        expect(res.rows.find((r) => r.month === '2026-10')?.arrived ?? 0).toBe(0);
    });

    it('counts each month’s cohort by the furthest stage it reached', async () => {
        db.lead.findMany.mockResolvedValue([
            { status: 'NEW', created_at: day('2026-11-01') },
            { status: 'CONTACTED', created_at: day('2026-11-02') },
            { status: 'CONTACTED', created_at: day('2026-11-03') },
            { status: 'QUALIFIED', created_at: day('2026-11-04') },
            { status: 'CONVERTED', created_at: day('2026-11-05') },
            { status: 'LOST', created_at: day('2026-11-06') },
        ]);

        const row = (await service.report('tenant-1', 'UTC')).rows.find((r) => r.month === '2026-11')!;

        expect(row.arrived).toBe(6);
        expect(row.new).toBe(1);
        expect(row.contacted).toBe(2);
        expect(row.qualified).toBe(1);
        expect(row.converted).toBe(1);
        expect(row.lost).toBe(1);
        // Still open = new + contacted + qualified.
        expect(row.open).toBe(4);
        expect(row.conversion_pct).toBe(16.7);
    });

    it('gives every month in the window a row, even one with no arrivals', async () => {
        const res = await service.report('tenant-1', 'UTC');

        expect(res.rows.every((r) => r.arrived === 0)).toBe(true);
        expect(res.rows.every((r) => r.conversion_pct === null)).toBe(true);
    });

    it('honours an explicit month window', async () => {
        const res = await service.report(
            'tenant-1',
            'UTC',
            { from: '2026-01-01', to: '2026-03-31' },
        );

        expect(res.months).toEqual(['2026-01', '2026-02', '2026-03']);
    });

    it('narrows to the caller’s leads under mine', async () => {
        await service.report('tenant-1', 'UTC', undefined, 'user-1');

        expect(db.lead.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ tenant_id: 'tenant-1', assigned_to: 'user-1' }),
            }),
        );
    });

    it('sums the cohorts into a funnel for the whole window', async () => {
        db.lead.findMany.mockResolvedValue([
            { status: 'NEW', created_at: day('2026-10-01') },
            { status: 'QUALIFIED', created_at: day('2026-11-01') },
            { status: 'CONVERTED', created_at: day('2026-11-02') },
        ]);

        const res = await service.report('tenant-1', 'UTC');

        expect(res.totals.arrived).toBe(3);
        expect(res.totals.converted).toBe(1);
        expect(res.totals.conversion_pct).toBe(33.3);
    });
});
