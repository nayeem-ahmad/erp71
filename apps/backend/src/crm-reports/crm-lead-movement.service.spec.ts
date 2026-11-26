import { CrmLeadMovementService } from './crm-lead-movement.service';
import { clampWindow, resolveDateWindow } from '../common/dashboard-window';
import { REPORT_MAX_DAYS } from './follow-up-compliance.service';

const NEW = {
    id: 'st-new', code: 'NEW', name: 'New', lifecycle: 'NEW',
    is_system: true, is_active: true, sort_order: 1,
};
const CONTACTED = {
    id: 'st-con', code: 'CONTACTED', name: 'Contacted', lifecycle: 'CONTACTED',
    is_system: true, is_active: true, sort_order: 2,
};
const QUALIFIED = {
    id: 'st-qual', code: 'QUALIFIED', name: 'Qualified', lifecycle: 'QUALIFIED',
    is_system: true, is_active: true, sort_order: 3,
};
const CONVERTED = {
    id: 'st-won', code: 'CONVERTED', name: 'Converted', lifecycle: 'CONVERTED',
    is_system: true, is_active: true, sort_order: 4,
};
const LOST = {
    id: 'st-lost', code: 'LOST', name: 'Lost', lifecycle: 'LOST',
    is_system: true, is_active: true, sort_order: 5,
};
const INACTIVE = {
    id: 'st-old', code: 'OLD_STAGE', name: 'Old Stage', lifecycle: 'QUALIFIED',
    is_system: false, is_active: false, sort_order: 6,
};

const ACTIVE_STAGES = [NEW, CONTACTED, QUALIFIED, CONVERTED, LOST];

function event(args: {
    id: string;
    leadId: string;
    to: { id: string; lifecycle: string };
    at: string;
}) {
    return {
        id: args.id,
        lead_id: args.leadId,
        to_status_id: args.to.id,
        to_lifecycle: args.to.lifecycle,
        created_at: new Date(args.at),
    };
}

describe('CrmLeadMovementService', () => {
    let service: CrmLeadMovementService;
    let db: {
        leadStatusOption: { findMany: jest.Mock };
        leadStatusEvent: { findMany: jest.Mock };
    };

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-11-15T06:00:00Z'));
        db = {
            leadStatusOption: { findMany: jest.fn().mockResolvedValue(ACTIVE_STAGES) },
            leadStatusEvent: { findMany: jest.fn().mockResolvedValue([]) },
        };
        service = new CrmLeadMovementService(db as any);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('defaults to the last 30 days', async () => {
        const res = await service.report('tenant-1', 'UTC', {});

        expect(res.filters.from).toBe('2026-10-17');
        expect(res.filters.to).toBe('2026-11-15');
        expect(res.filters.mine).toBe(false);
    });

    it('counts a Dhaka 1 Nov landing whose UTC instant is still 31 Oct', async () => {
        db.leadStatusEvent.findMany.mockResolvedValue([
            event({
                id: 'e1',
                leadId: 'lead-1',
                to: { id: NEW.id, lifecycle: 'NEW' },
                at: '2026-10-31T20:00:00Z',
            }),
        ]);

        const res = await service.report(
            'tenant-1',
            'Asia/Dhaka',
            { from: '2026-11-01', to: '2026-11-01' },
        );

        expect(res.filters.from).toBe('2026-11-01');
        expect(res.filters.to).toBe('2026-11-01');
        expect(res.stages.find((s) => s.id === NEW.id)?.count).toBe(1);
        expect(res.totals.moved).toBe(1);

        const instant = new Date('2026-10-31T20:00:00Z').getTime();
        const createdAt = db.leadStatusEvent.findMany.mock.calls[0][0].where.created_at;
        expect(createdAt.gte.getTime()).toBeLessThanOrEqual(instant);
        expect(createdAt.lte.getTime()).toBeGreaterThanOrEqual(instant);
    });

    it('counts New → Contacted in the window as Contacted, not New', async () => {
        db.leadStatusEvent.findMany.mockResolvedValue([
            event({
                id: 'e1', leadId: 'lead-1',
                to: { id: NEW.id, lifecycle: 'NEW' },
                at: '2026-11-02T00:00:00Z',
            }),
            event({
                id: 'e2', leadId: 'lead-1',
                to: { id: CONTACTED.id, lifecycle: 'CONTACTED' },
                at: '2026-11-03T00:00:00Z',
            }),
        ]);

        const res = await service.report(
            'tenant-1',
            'UTC',
            { from: '2026-11-01', to: '2026-11-15' },
        );

        expect(res.stages.find((s) => s.id === CONTACTED.id)?.count).toBe(1);
        expect(res.stages.find((s) => s.id === NEW.id)?.count).toBe(0);
        expect(res.totals.moved).toBe(1);
    });

    it('counts Qualified → Lost as Lost with conversion_pct 0', async () => {
        db.leadStatusEvent.findMany.mockResolvedValue([
            event({
                id: 'e1', leadId: 'lead-1',
                to: { id: QUALIFIED.id, lifecycle: 'QUALIFIED' },
                at: '2026-11-02T00:00:00Z',
            }),
            event({
                id: 'e2', leadId: 'lead-1',
                to: { id: LOST.id, lifecycle: 'LOST' },
                at: '2026-11-03T00:00:00Z',
            }),
        ]);

        const res = await service.report(
            'tenant-1',
            'UTC',
            { from: '2026-11-01', to: '2026-11-15' },
        );

        expect(res.stages.find((s) => s.id === LOST.id)?.count).toBe(1);
        expect(res.totals.lost).toBe(1);
        expect(res.totals.converted).toBe(0);
        expect(res.totals.conversion_pct).toBe(0);
    });

    it('hides Lost via statusIds and counts Qualified instead', async () => {
        db.leadStatusEvent.findMany.mockResolvedValue([
            event({
                id: 'e1', leadId: 'lead-1',
                to: { id: QUALIFIED.id, lifecycle: 'QUALIFIED' },
                at: '2026-11-02T00:00:00Z',
            }),
            event({
                id: 'e2', leadId: 'lead-1',
                to: { id: LOST.id, lifecycle: 'LOST' },
                at: '2026-11-03T00:00:00Z',
            }),
        ]);

        const res = await service.report(
            'tenant-1',
            'UTC',
            { from: '2026-11-01', to: '2026-11-15', statusIds: [QUALIFIED.id] },
        );

        expect(res.filters.status_ids).toEqual([QUALIFIED.id]);
        expect(res.stages).toHaveLength(1);
        expect(res.stages[0].id).toBe(QUALIFIED.id);
        expect(res.stages[0].count).toBe(1);
        expect(res.totals.lost).toBe(0);
        expect(res.totals.moved).toBe(1);
    });

    it('narrows to the caller’s leads under mine', async () => {
        const res = await service.report('tenant-1', 'UTC', { mine: true }, 'user-1');

        expect(db.leadStatusEvent.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    tenant_id: 'tenant-1',
                    lead: expect.objectContaining({ assigned_to: 'user-1' }),
                }),
            }),
        );
        expect(res.filters.mine).toBe(true);
    });

    it('lists an inactive stage with a landing in available_stages, not in stages until selected', async () => {
        db.leadStatusOption.findMany.mockResolvedValue([...ACTIVE_STAGES, INACTIVE]);
        db.leadStatusEvent.findMany.mockResolvedValue([
            event({
                id: 'e1', leadId: 'lead-1',
                to: { id: INACTIVE.id, lifecycle: 'QUALIFIED' },
                at: '2026-11-02T00:00:00Z',
            }),
        ]);

        const hidden = await service.report(
            'tenant-1',
            'UTC',
            { from: '2026-11-01', to: '2026-11-15' },
        );

        expect(hidden.available_stages.some((s) => s.id === INACTIVE.id)).toBe(true);
        expect(hidden.stages.some((s) => s.id === INACTIVE.id)).toBe(false);
        expect(hidden.totals.moved).toBe(0);

        const selected = await service.report(
            'tenant-1',
            'UTC',
            { from: '2026-11-01', to: '2026-11-15', statusIds: [INACTIVE.id] },
        );

        expect(selected.stages.some((s) => s.id === INACTIVE.id)).toBe(true);
        expect(selected.stages.find((s) => s.id === INACTIVE.id)?.count).toBe(1);
        expect(selected.totals.moved).toBe(1);
    });

    it('zero-fills active stages with no landings and leaves share_pct null when nothing moved', async () => {
        const res = await service.report(
            'tenant-1',
            'UTC',
            { from: '2026-11-01', to: '2026-11-15' },
        );

        expect(res.stages.map((s) => s.id)).toEqual(ACTIVE_STAGES.map((s) => s.id));
        expect(res.stages.every((s) => s.count === 0)).toBe(true);
        expect(res.stages.every((s) => s.share_pct === null)).toBe(true);
        expect(res.totals.moved).toBe(0);
    });

    it('leaves conversion_pct null when converted+lost is 0', async () => {
        db.leadStatusEvent.findMany.mockResolvedValue([
            event({
                id: 'e1', leadId: 'lead-1',
                to: { id: NEW.id, lifecycle: 'NEW' },
                at: '2026-11-02T00:00:00Z',
            }),
        ]);

        const res = await service.report(
            'tenant-1',
            'UTC',
            { from: '2026-11-01', to: '2026-11-15' },
        );

        expect(res.totals.moved).toBe(1);
        expect(res.totals.converted).toBe(0);
        expect(res.totals.lost).toBe(0);
        expect(res.totals.conversion_pct).toBeNull();
    });

    it('does not load landings before fromDate', async () => {
        await service.report(
            'tenant-1',
            'UTC',
            { from: '2026-11-01', to: '2026-11-15' },
        );

        const window = clampWindow(
            resolveDateWindow({ from: '2026-11-01', to: '2026-11-15' }, 'UTC'),
            REPORT_MAX_DAYS,
        );
        expect(db.leadStatusEvent.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    tenant_id: 'tenant-1',
                    created_at: { gte: window.fromDate, lte: window.toDate },
                }),
            }),
        );
    });
});
