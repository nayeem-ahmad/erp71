import { CrmActivitySummaryService } from './crm-activity-summary.service';

describe('CrmActivitySummaryService', () => {
    let service: CrmActivitySummaryService;
    let db: {
        crmActivity: { findMany: jest.Mock };
        conversationChannel: { findMany: jest.Mock };
        crmActivityPurpose: { findMany: jest.Mock };
        user: { findMany: jest.Mock };
    };

    beforeEach(() => {
        db = {
            crmActivity: { findMany: jest.fn().mockResolvedValue([]) },
            conversationChannel: { findMany: jest.fn().mockResolvedValue([]) },
            crmActivityPurpose: { findMany: jest.fn().mockResolvedValue([]) },
            user: { findMany: jest.fn().mockResolvedValue([]) },
        };
        service = new CrmActivitySummaryService(db as any);
    });

    it('reads only completed work dated inside the window', async () => {
        await service.report('tenant-1', { from: '2026-11-01', to: '2026-11-15' }, 'UTC');

        expect(db.crmActivity.findMany).toHaveBeenCalledWith({
            where: expect.objectContaining({
                tenant_id: 'tenant-1',
                status: 'DONE',
                completed_at: expect.objectContaining({
                    gte: expect.any(Date),
                    lte: expect.any(Date),
                }),
            }),
            select: {
                assigned_to: true,
                channel_code: true,
            },
        });
    });

    it('counts each channel per person and totals both ways', async () => {
        db.crmActivity.findMany.mockResolvedValue([
            { assigned_to: 'u1', channel_code: 'CALL' },
            { assigned_to: 'u1', channel_code: 'CALL' },
            { assigned_to: 'u1', channel_code: 'WHATSAPP' },
            { assigned_to: 'u2', channel_code: 'CALL' },
            { assigned_to: 'u2', channel_code: 'EMAIL' },
        ]);
        db.conversationChannel.findMany.mockResolvedValue([
            { code: 'CALL', name: 'Call', sort_order: 1, is_active: true },
            { code: 'WHATSAPP', name: 'WhatsApp', sort_order: 3, is_active: true },
            { code: 'EMAIL', name: 'Email', sort_order: 4, is_active: true },
        ]);

        const res = await service.report('tenant-1', { from: '2026-11-01', to: '2026-11-15' }, 'UTC');

        expect(res.channels).toEqual([
            { code: 'CALL', name: 'Call', total: 3 },
            { code: 'WHATSAPP', name: 'WhatsApp', total: 1 },
            { code: 'EMAIL', name: 'Email', total: 1 },
        ]);
        expect(res.rows).toHaveLength(2);
        const u1 = res.rows.find((r) => r.user_id === 'u1')!;
        expect(u1.total).toBe(3);
        expect(u1.counts.CALL).toBe(2);
        expect(u1.counts.WHATSAPP).toBe(1);
        expect(u1.counts.EMAIL ?? 0).toBe(0);
        expect(res.totals.total).toBe(5);
        expect(res.totals.counts.CALL).toBe(3);
    });

    it('orders channels the tenant configured them, not alphabetically', async () => {
        db.crmActivity.findMany.mockResolvedValue([
            { assigned_to: 'u1', channel_code: 'VISIT' },
            { assigned_to: 'u1', channel_code: 'CALL' },
        ]);
        db.conversationChannel.findMany.mockResolvedValue([
            { code: 'VISIT', name: 'Visit', sort_order: 5, is_active: true },
            { code: 'CALL', name: 'Call', sort_order: 1, is_active: true },
        ]);

        const res = await service.report('tenant-1', {}, 'UTC');

        expect(res.channels.map((c) => c.code)).toEqual(['CALL', 'VISIT']);
    });

    it('keeps a deleted channel in the report rather than dropping its activities', async () => {
        // The channel row is gone (or inactive), but the denormalised code is on
        // the activity. Losing it would make the totals stop adding up.
        db.crmActivity.findMany.mockResolvedValue([
            { assigned_to: 'u1', channel_code: 'TELEGRAM' },
        ]);
        db.conversationChannel.findMany.mockResolvedValue([
            { code: 'CALL', name: 'Call', sort_order: 1, is_active: true },
        ]);

        const res = await service.report('tenant-1', {}, 'UTC');

        expect(res.totals.total).toBe(1);
        expect(res.channels.map((c) => c.code)).toContain('TELEGRAM');
        expect(res.channels.find((c) => c.code === 'TELEGRAM')?.name).toBe('TELEGRAM');
    });

    it('puts work with no type on one Unspecified column instead of vanishing', async () => {
        db.crmActivity.findMany.mockResolvedValue([
            { assigned_to: 'u1', channel_code: null },
            { assigned_to: 'u1', channel_code: 'CALL' },
        ]);
        db.conversationChannel.findMany.mockResolvedValue([
            { code: 'CALL', name: 'Call', sort_order: 1, is_active: true },
        ]);

        const res = await service.report('tenant-1', {}, 'UTC');

        expect(res.totals.total).toBe(2);
        expect(res.totals.unspecified).toBe(1);
        expect(res.channels.map((c) => c.code)).toContain('UNSPECIFIED');
    });

    it('puts unassigned work on one row with a null user, counted in the totals', async () => {
        db.crmActivity.findMany.mockResolvedValue([
            { assigned_to: null, channel_code: 'CALL' },
            { assigned_to: 'u1', channel_code: 'CALL' },
        ]);

        const res = await service.report('tenant-1', {}, 'UTC');

        const unassigned = res.rows.find((r) => r.user_id === null);
        expect(unassigned).toBeDefined();
        expect(unassigned?.name).toBeNull();
        expect(unassigned?.counts.CALL).toBe(1);
        expect(res.totals.total).toBe(2);
    });

    it('names people by name, falling back to email', async () => {
        db.crmActivity.findMany.mockResolvedValue([
            { assigned_to: 'u1', channel_code: 'CALL' },
            { assigned_to: 'u2', channel_code: 'CALL' },
        ]);
        db.user.findMany.mockResolvedValue([
            { id: 'u1', name: 'Alice Smith', email: 'alice@example.com' },
            { id: 'u2', name: null, email: 'bob@example.com' },
        ]);

        const res = await service.report('tenant-1', {}, 'UTC');

        expect(res.rows.find((r) => r.user_id === 'u1')?.name).toBe('Alice Smith');
        expect(res.rows.find((r) => r.user_id === 'u2')?.name).toBe('bob@example.com');
    });

    it('sorts people by how much they logged, most first', async () => {
        db.crmActivity.findMany.mockResolvedValue([
            { assigned_to: 'quiet', channel_code: 'CALL' },
            { assigned_to: 'busy', channel_code: 'CALL' },
            { assigned_to: 'busy', channel_code: 'CALL' },
            { assigned_to: 'busy', channel_code: 'VISIT' },
        ]);

        const res = await service.report('tenant-1', {}, 'UTC');

        expect(res.rows.map((r) => r.user_id)).toEqual(['busy', 'quiet']);
    });

    it('narrows to the caller\'s own activities under mine', async () => {
        await service.report('tenant-1', {}, 'UTC', 'user-1');

        expect(db.crmActivity.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ assigned_to: 'user-1' }),
            }),
        );
    });

    it('reports an empty window without inventing columns', async () => {
        db.conversationChannel.findMany.mockResolvedValue([
            { code: 'CALL', name: 'Call', sort_order: 1, is_active: true },
        ]);

        const res = await service.report('tenant-1', {}, 'UTC');

        // The configured channels still name the columns, at zero.
        expect(res.channels).toEqual([{ code: 'CALL', name: 'Call', total: 0 }]);
        expect(res.rows).toHaveLength(0);
        expect(res.totals).toEqual({ total: 0, unspecified: 0, counts: { CALL: 0 } });
    });

    it('echoes the resolved window back to the client', async () => {
        const res = await service.report('tenant-1', { from: '2026-11-01', to: '2026-11-15' }, 'UTC');

        expect(res.filters).toEqual({ from: '2026-11-01', to: '2026-11-15', mine: false });
    });

    it('clamps an over-long window', async () => {
        const res = await service.report('tenant-1', { from: '2020-01-01', to: '2026-11-15' }, 'UTC');

        expect(res.filters.from).toBe('2025-11-10');
    });
});
