import { CrmLostLeadsService } from './crm-lost-leads.service';

describe('CrmLostLeadsService', () => {
    let service: CrmLostLeadsService;
    let db: { lead: { findMany: jest.Mock } };

    const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

    beforeEach(() => {
        db = { lead: { findMany: jest.fn().mockResolvedValue([]) } };
        service = new CrmLostLeadsService(db as any);
    });

    it('reads only lost leads closed inside the window', async () => {
        await service.report('tenant-1', { from: '2026-11-01', to: '2026-11-15' }, 'UTC');

        expect(db.lead.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    tenant_id: 'tenant-1',
                    status: 'LOST',
                    closed_at: { gte: expect.any(Date), lte: expect.any(Date) },
                },
            }),
        );
    });

    it('groups by reason, most common first, and names how much revenue left with them', async () => {
        db.lead.findMany.mockResolvedValue([
            { id: 'l1', name: 'A', lost_reason: 'Price too high', closed_at: day('2026-11-02'), created_at: day('2026-10-01') },
            { id: 'l2', name: 'B', lost_reason: 'Price too high', closed_at: day('2026-11-03'), created_at: day('2026-10-10') },
            { id: 'l3', name: 'C', lost_reason: 'Chose competitor', closed_at: day('2026-11-04'), created_at: day('2026-10-20') },
        ]);

        const res = await service.report('tenant-1', {}, 'UTC');

        expect(res.by_reason[0]).toEqual({
            reason: 'Price too high',
            leads: 2,
            share_pct: 66.7,
            // 2026-10-01 → 11-02 is 32 days; 2026-10-10 → 11-03 is 24; mean 28.
            avg_days_open: 28,
        });
        expect(res.by_reason[1].reason).toBe('Chose competitor');
        expect(res.totals.lost).toBe(3);
    });

    it('puts leads with no reason on one row rather than dropping them', async () => {
        db.lead.findMany.mockResolvedValue([
            { id: 'l1', name: 'A', lost_reason: null, closed_at: day('2026-11-02'), created_at: day('2026-10-01') },
            { id: 'l2', name: 'B', lost_reason: '   ', closed_at: day('2026-11-03'), created_at: day('2026-10-02') },
        ]);

        const res = await service.report('tenant-1', {}, 'UTC');

        expect(res.totals.lost).toBe(2);
        expect(res.by_reason).toHaveLength(1);
        expect(res.by_reason[0].reason).toBeNull();
        expect(res.by_reason[0].leads).toBe(2);
    });

    it('folds the long tail into one row so the list stays readable', async () => {
        const leads = [];
        // 30 distinct reasons, one lead each.
        for (let i = 0; i < 30; i++) {
            leads.push({
                id: `l${i}`, name: `Lead ${i}`, lost_reason: `Reason ${i}`,
                closed_at: day('2026-11-02'), created_at: day('2026-10-01'),
            });
        }
        db.lead.findMany.mockResolvedValue(leads);

        const res = await service.report('tenant-1', {}, 'UTC');

        // Ten named reasons plus one "Other reasons" row.
        expect(res.by_reason).toHaveLength(11);
        const other = res.by_reason[10];
        expect(other.reason).toBe('__other__');
        expect(other.leads).toBe(20);
        expect(res.totals.lost).toBe(30);
    });

    it('counts how long each lost lead had been open', async () => {
        db.lead.findMany.mockResolvedValue([
            { id: 'l1', name: 'A', lost_reason: 'Price', closed_at: day('2026-11-11'), created_at: day('2026-11-01') },
        ]);

        const res = await service.report('tenant-1', {}, 'UTC');

        expect(res.rows[0].days_open).toBe(10);
    });

    it('narrows to the caller’s leads under mine', async () => {
        await service.report('tenant-1', {}, 'UTC', 'user-1');

        expect(db.lead.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ assigned_to: 'user-1' }),
            }),
        );
    });

    it('reports an empty period without dividing by zero', async () => {
        const res = await service.report('tenant-1', {}, 'UTC');

        expect(res.rows).toHaveLength(0);
        expect(res.by_reason).toHaveLength(0);
        expect(res.totals).toEqual({ lost: 0, avg_days_open: null });
    });
});
