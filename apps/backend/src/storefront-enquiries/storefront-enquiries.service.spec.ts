import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service';
import { CrmLeadTaxonomyService } from '../crm-lead-taxonomy/crm-lead-taxonomy.service';
import { StorefrontEnquiriesService } from './storefront-enquiries.service';

const TENANT = 'tenant-1';
const SLUG = 'demo-shop';

const ENQUIRY = {
    name: 'Rahim Uddin',
    email: 'Rahim@Example.com',
    message: 'Do you deliver to Chattogram, and what is the lead time?',
};

describe('StorefrontEnquiriesService', () => {
    let service: StorefrontEnquiriesService;
    let db: any;
    let taxonomy: any;

    beforeEach(async () => {
        db = {
            tenant: { findFirst: jest.fn().mockResolvedValue({ id: TENANT }) },
            lead: {
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({ id: 'lead-new' }),
                update: jest.fn(),
            },
            leadConversation: { create: jest.fn().mockResolvedValue({ id: 'conv-1' }) },
            leadSourceOption: {
                findFirst: jest.fn().mockResolvedValue({ id: 'src-web', code: 'WEBSITE', score_weight: 20 }),
            },
            conversationChannel: { findFirst: jest.fn().mockResolvedValue({ id: 'chan-note' }) },
        };
        taxonomy = { fallbackSource: jest.fn().mockResolvedValue({ id: 'src-other', code: 'OTHER' }) };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                StorefrontEnquiriesService,
                { provide: DatabaseService, useValue: db },
                { provide: CrmLeadTaxonomyService, useValue: taxonomy },
            ],
        }).compile();

        service = module.get(StorefrontEnquiriesService);
    });

    it('files a first-time enquiry as a new WEBSITE lead with the message on the timeline', async () => {
        await expect(service.submit(SLUG, { ...ENQUIRY })).resolves.toEqual({ success: true });

        const lead = db.lead.create.mock.calls[0][0].data;
        expect(lead).toMatchObject({
            tenant_id: TENANT,
            name: 'Rahim Uddin',
            source_id: 'src-web',
            source: 'WEBSITE',
            status: 'NEW',
            // Nobody filed it, so nobody owns it — see the note in createLead.
            assigned_to: null,
            created_by: null,
        });
        // The normalised copy is what carries the per-tenant unique index; a
        // lead written without it is invisible to de-duplication for ever.
        expect(lead.email_norm).toBe('rahim@example.com');

        const conversation = db.leadConversation.create.mock.calls[0][0].data;
        expect(conversation).toMatchObject({
            lead_id: 'lead-new',
            direction: 'INBOUND',
            type: 'NOTE',
            channel_id: 'chan-note',
            created_by: null,
        });
        expect(conversation.summary).toContain(ENQUIRY.message);
    });

    it('appends to the lead a repeat enquirer already has, and creates no second lead', async () => {
        db.lead.findFirst.mockResolvedValue({ id: 'lead-existing' });

        await expect(service.submit(SLUG, { ...ENQUIRY })).resolves.toEqual({ success: true });

        // The whole reason this service exists rather than calling
        // CrmLeadsService.create, which would answer 400 "a lead with this
        // email already exists" — to a customer.
        expect(db.lead.create).not.toHaveBeenCalled();
        expect(db.leadConversation.create).toHaveBeenCalledTimes(1);
        expect(db.leadConversation.create.mock.calls[0][0].data.lead_id).toBe('lead-existing');
    });

    it('never rewrites an existing lead, so a worked lead is not dragged back to NEW', async () => {
        db.lead.findFirst.mockResolvedValue({ id: 'lead-existing' });

        await service.submit(SLUG, { ...ENQUIRY });

        expect(db.lead.update).not.toHaveBeenCalled();
    });

    it('matches an existing lead on a differently-spelled mobile number', async () => {
        db.lead.findFirst.mockResolvedValue({ id: 'lead-existing' });

        await service.submit(SLUG, { name: 'Rahim', mobile: '01712-345678', message: ENQUIRY.message });

        const where = db.lead.findFirst.mock.calls[0][0].where;
        // `01712-345678` and `+8801712345678` are one number; the normalised
        // column is what makes them match.
        expect(where.OR).toContainEqual({ mobile_norm: '+8801712345678' });
    });

    it('refuses an enquiry with no way to reply', async () => {
        await expect(
            service.submit(SLUG, { name: 'Anon', message: ENQUIRY.message }),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(db.lead.create).not.toHaveBeenCalled();
    });

    it('404s on a shop whose storefront is switched off', async () => {
        db.tenant.findFirst.mockResolvedValue(null);

        await expect(service.submit(SLUG, { ...ENQUIRY })).rejects.toBeInstanceOf(NotFoundException);
        expect(db.lead.create).not.toHaveBeenCalled();
    });

    it('falls back to the tenant OTHER source when the WEBSITE row was never seeded', async () => {
        db.leadSourceOption.findFirst.mockResolvedValue(null);

        await service.submit(SLUG, { ...ENQUIRY });

        expect(taxonomy.fallbackSource).toHaveBeenCalledWith(TENANT);
        expect(db.lead.create.mock.calls[0][0].data).toMatchObject({ source_id: 'src-other', source: 'OTHER' });
    });

    it('still logs the enquiry on a tenant with no NOTE channel row', async () => {
        db.conversationChannel.findFirst.mockResolvedValue(null);

        await service.submit(SLUG, { ...ENQUIRY });

        // `type` is NOT NULL, so it comes from the constant rather than the row.
        expect(db.leadConversation.create.mock.calls[0][0].data).toMatchObject({
            type: 'NOTE',
            channel_id: null,
        });
    });
});
