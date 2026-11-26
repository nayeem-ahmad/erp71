import { recordLeadStatusChange } from './lead-status-event.util';

describe('recordLeadStatusChange()', () => {
    const tenantId = 't1';
    const leadId = 'lead-1';
    let create: jest.Mock;
    let db: { leadStatusEvent: { create: jest.Mock } };

    beforeEach(() => {
        create = jest.fn().mockResolvedValue({ id: 'evt-1' });
        db = { leadStatusEvent: { create } };
    });

    it('inserts a create landing with from_* null', async () => {
        const inserted = await recordLeadStatusChange(db, {
            tenantId,
            leadId,
            from: null,
            to: { id: 'st-new', lifecycle: 'NEW' },
            actorId: 'u1',
        });

        expect(inserted).toBe(true);
        expect(create).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0][0].data).toEqual(expect.objectContaining({
            tenant_id: tenantId,
            lead_id: leadId,
            to_status_id: 'st-new',
            to_lifecycle: 'NEW',
            from_status_id: null,
            from_lifecycle: null,
            created_by: 'u1',
        }));
        expect(create.mock.calls[0][0].data).not.toHaveProperty('created_at');
    });

    it('skips when from.id equals to.id', async () => {
        const inserted = await recordLeadStatusChange(db, {
            tenantId,
            leadId,
            from: { id: 'st-new', lifecycle: 'NEW' },
            to: { id: 'st-new', lifecycle: 'NEW' },
        });

        expect(inserted).toBe(false);
        expect(create).not.toHaveBeenCalled();
    });

    it('inserts when the stage id changes', async () => {
        const inserted = await recordLeadStatusChange(db, {
            tenantId,
            leadId,
            from: { id: 'st-new', lifecycle: 'NEW' },
            to: { id: 'st-con', lifecycle: 'CONTACTED' },
        });

        expect(inserted).toBe(true);
        expect(create).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0][0].data).toEqual(expect.objectContaining({
            from_status_id: 'st-new',
            from_lifecycle: 'NEW',
            to_status_id: 'st-con',
            to_lifecycle: 'CONTACTED',
        }));
    });

    it('honours at', async () => {
        const at = new Date('2026-01-02T12:00:00Z');
        await recordLeadStatusChange(db, {
            tenantId,
            leadId,
            from: null,
            to: { id: 'st-new', lifecycle: 'NEW' },
            at,
        });

        expect(create.mock.calls[0][0].data.created_at).toBe(at);
    });
});
