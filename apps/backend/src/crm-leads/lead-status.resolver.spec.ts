import { BadRequestException } from '@nestjs/common';
import { LeadStatusResolver } from './lead-status.resolver';
import { LeadStatus } from './crm-leads.dto';

describe('LeadStatusResolver', () => {
    const row = (over: Record<string, unknown>) => ({
        id: 'st-x', tenant_id: 't1', code: 'X', name: 'X', lifecycle: 'QUALIFIED',
        is_system: false, is_active: true, ...over,
    });
    const seeded: Record<string, any> = {
        NEW: row({ id: 'st-new', code: 'NEW', name: 'New', lifecycle: 'NEW', is_system: true }),
        CONTACTED: row({ id: 'st-con', code: 'CONTACTED', name: 'Contacted', lifecycle: 'CONTACTED', is_system: true }),
        QUALIFIED: row({ id: 'st-qual', code: 'QUALIFIED', name: 'Qualified', is_system: true }),
        LOST: row({ id: 'st-lost', code: 'LOST', name: 'Lost', lifecycle: 'LOST', is_system: true }),
    };
    const negotiation = row({ id: 'st-neg', code: 'NEGOTIATION', name: 'Negotiation' });
    const hidden = row({ id: 'st-hidden', code: 'OLD', name: 'Old', is_active: false });
    const rows = [...Object.values(seeded), negotiation, hidden];

    let db: any;
    let resolver: LeadStatusResolver;

    beforeEach(() => {
        db = {
            leadStatusOption: {
                findFirst: jest.fn(async ({ where }: any) =>
                    rows.find((r) =>
                        r.tenant_id === where.tenant_id &&
                        (where.id === undefined || r.id === where.id) &&
                        (where.code === undefined || r.code === where.code),
                    ) ?? null,
                ),
            },
        };
        resolver = new LeadStatusResolver(db);
    });

    describe('forCreate()', () => {
        it('starts a lead on NEW when nothing is named', async () => {
            expect(await resolver.forCreate('t1', {})).toEqual({ id: 'st-new', lifecycle: LeadStatus.NEW });
        });

        it('takes a stage id and its lifecycle', async () => {
            expect(await resolver.forCreate('t1', { status_id: 'st-neg' })).toEqual({
                id: 'st-neg',
                lifecycle: LeadStatus.QUALIFIED,
            });
        });

        it('prefers status_id over a disagreeing status', async () => {
            const stage = await resolver.forCreate('t1', { status_id: 'st-neg', status: LeadStatus.LOST });
            expect(stage).toEqual({ id: 'st-neg', lifecycle: LeadStatus.QUALIFIED });
        });

        it('maps an old client\'s status code onto the seeded stage', async () => {
            expect(await resolver.forCreate('t1', { status: LeadStatus.CONTACTED })).toEqual({
                id: 'st-con',
                lifecycle: LeadStatus.CONTACTED,
            });
        });

        it('rejects another tenant\'s or an unknown stage', async () => {
            await expect(resolver.forCreate('t2', { status_id: 'st-neg' })).rejects.toThrow(BadRequestException);
            await expect(resolver.forCreate('t1', { status_id: 'nope' })).rejects.toThrow(BadRequestException);
        });

        it('rejects a hidden stage', async () => {
            await expect(resolver.forCreate('t1', { status_id: 'st-hidden' })).rejects.toThrow(BadRequestException);
        });

        it('still returns the lifecycle for a tenant whose stages were never synced', async () => {
            db.leadStatusOption.findFirst.mockResolvedValue(null);
            expect(await resolver.forCreate('t1', { status: LeadStatus.LOST })).toEqual({
                id: null,
                lifecycle: LeadStatus.LOST,
            });
        });
    });

    describe('forUpdate()', () => {
        const onNegotiation = { status: 'QUALIFIED', status_id: 'st-neg' };

        it('leaves the stage alone when the patch names none', async () => {
            expect(await resolver.forUpdate('t1', onNegotiation, {})).toBeUndefined();
        });

        it('keeps a custom stage when an old client re-sends the lifecycle it was shown', async () => {
            // An old mobile build shows "Negotiation" as Qualified and sends that back.
            expect(await resolver.forUpdate('t1', onNegotiation, { status: LeadStatus.QUALIFIED })).toBeUndefined();
        });

        it('moves an old client\'s real change onto the seeded stage', async () => {
            expect(await resolver.forUpdate('t1', onNegotiation, { status: LeadStatus.LOST })).toEqual({
                id: 'st-lost',
                lifecycle: LeadStatus.LOST,
            });
        });

        it('allows re-saving a lead on its current, since-hidden stage', async () => {
            const onHidden = { status: 'QUALIFIED', status_id: 'st-hidden' };
            expect(await resolver.forUpdate('t1', onHidden, { status_id: 'st-hidden' })).toBeUndefined();
        });

        it('refuses to move a lead onto a hidden stage', async () => {
            await expect(
                resolver.forUpdate('t1', onNegotiation, { status_id: 'st-hidden' }),
            ).rejects.toThrow(BadRequestException);
        });

        it('moves between stages by id', async () => {
            expect(await resolver.forUpdate('t1', onNegotiation, { status_id: 'st-con' })).toEqual({
                id: 'st-con',
                lifecycle: LeadStatus.CONTACTED,
            });
        });
    });

    describe('forBulk()', () => {
        it('accepts a stage id or a seeded code', async () => {
            expect(await resolver.forBulk('t1', 'st-neg')).toEqual({ id: 'st-neg', lifecycle: LeadStatus.QUALIFIED });
            expect(await resolver.forBulk('t1', 'CONTACTED')).toEqual({ id: 'st-con', lifecycle: LeadStatus.CONTACTED });
        });

        it('refuses a closing stage', async () => {
            await expect(resolver.forBulk('t1', 'st-lost')).rejects.toThrow(BadRequestException);
        });

        it('refuses an unknown or hidden value', async () => {
            await expect(resolver.forBulk('t1', 'garbage')).rejects.toThrow(BadRequestException);
            await expect(resolver.forBulk('t1', 'st-hidden')).rejects.toThrow(BadRequestException);
        });
    });
});
