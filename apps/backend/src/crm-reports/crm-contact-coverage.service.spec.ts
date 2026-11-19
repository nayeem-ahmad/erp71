import { CrmContactCoverageService } from './crm-contact-coverage.service';

describe('CrmContactCoverageService', () => {
    let service: CrmContactCoverageService;
    let db: {
        lead: { findMany: jest.Mock };
        customer: { findMany: jest.Mock };
        crmContact: { findMany: jest.Mock };
        leadSourceOption: { findMany: jest.Mock };
        customerGroup: { findMany: jest.Mock };
    };

    beforeEach(() => {
        db = {
            lead: { findMany: jest.fn().mockResolvedValue([]) },
            customer: { findMany: jest.fn().mockResolvedValue([]) },
            crmContact: { findMany: jest.fn().mockResolvedValue([]) },
            leadSourceOption: { findMany: jest.fn().mockResolvedValue([]) },
            customerGroup: { findMany: jest.fn().mockResolvedValue([]) },
        };
        service = new CrmContactCoverageService(db as any);
    });

    it('reads open leads and undeleted customers', async () => {
        await service.report('tenant-1');

        expect(db.lead.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    tenant_id: 'tenant-1',
                    status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] },
                }),
            }),
        );
        expect(db.customer.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ tenant_id: 'tenant-1', deleted_at: null }),
            }),
        );
    });

    it('counts how many people can be reached by phone, by email, by both and by neither', async () => {
        db.lead.findMany = jest.fn().mockResolvedValue([
            { source_id: 's1', mobile: '0171', email: null },
            { source_id: 's1', mobile: null, email: 'a@b.c' },
            { source_id: 's1', mobile: '0172', email: 'b@b.c' },
            { source_id: 's1', mobile: null, email: null },
        ]);

        const res = await service.report('tenant-1');

        const lead = res.by_party.find((p) => p.party === 'lead')!;
        expect(lead.total).toBe(4);
        expect(lead.reachable).toBe(3);
        expect(lead.by_phone).toBe(2);
        expect(lead.by_email).toBe(2);
        expect(lead.by_both).toBe(1);
        expect(lead.unreachable).toBe(1);
        expect(lead.reachable_pct).toBe(75);
    });

    it('treats a blank string as no contact, not as a phone number', async () => {
        db.lead.findMany = jest.fn().mockResolvedValue([
            { source_id: 's1', mobile: '   ', email: '' },
        ]);

        const res = await service.report('tenant-1');

        expect(res.by_party.find((p) => p.party === 'lead')!.reachable).toBe(0);
    });

    it('rolls leads up by source so a channel bringing unreachable leads stands out', async () => {
        db.lead.findMany = jest.fn().mockResolvedValue([
            { source_id: 's1', mobile: '0171', email: null },
            { source_id: 's1', mobile: null, email: null },
            { source_id: null, mobile: null, email: null },
        ]);
        db.leadSourceOption.findMany.mockResolvedValue([{ id: 's1', name: 'Facebook' }]);

        const res = await service.report('tenant-1');

        const fb = res.by_source.find((s) => s.source_id === 's1')!;
        expect(fb.name).toBe('Facebook');
        expect(fb.total).toBe(2);
        expect(fb.reachable).toBe(1);
        expect(fb.reachable_pct).toBe(50);

        // Leads with no source are their own row, not dropped.
        const none = res.by_source.find((s) => s.source_id === null)!;
        expect(none.total).toBe(1);
        expect(none.reachable_pct).toBe(0);
    });

    it('counts a value of only whitespace in a customer phone as missing', async () => {
        db.customer.findMany.mockResolvedValue([
            { id: 'c1', phone: ' ', email: 'x@y.z' },
            { id: 'c2', phone: '0181', email: null },
        ]);

        const res = await service.report('tenant-1');

        const customer = res.by_party.find((p) => p.party === 'customer')!;
        expect(customer.total).toBe(2);
        expect(customer.by_phone).toBe(1);
        expect(customer.by_email).toBe(1);
        expect(customer.reachable).toBe(2);
    });

    it('reports an empty book without dividing by zero', async () => {
        const res = await service.report('tenant-1');

        for (const party of res.by_party) {
            expect(party.total).toBe(0);
            expect(party.reachable_pct).toBeNull();
        }
        expect(res.totals.total).toBe(0);
        expect(res.totals.reachable_pct).toBeNull();
    });
});
