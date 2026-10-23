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

function contact(extra: Record<string, unknown> = {}) {
    return {
        id: 'contact-1',
        organization_id: null as string | null,
        mobile: null as string | null,
        mobile_norm: null as string | null,
        email: null as string | null,
        email_norm: null as string | null,
        created_at: new Date('2020-01-01T00:00:00.000Z'),
        ...extra,
    };
}

/** Mobile lookup asks for `mobile_norm`; the email lookup does not. */
function isMobileLookup(where: { OR?: Array<Record<string, unknown>> } | undefined): boolean {
    return !!where?.OR?.some((arm) => Object.prototype.hasOwnProperty.call(arm, 'mobile_norm'));
}

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
            leadStatusOption: { findFirst: jest.fn().mockResolvedValue({ id: 'st-new' }) },
            crmContact: {
                findMany: jest.fn().mockResolvedValue([]),
                create: jest.fn().mockResolvedValue({ id: 'contact-new', organization_id: null }),
                update: jest.fn(),
            },
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
            status_id: 'st-new',
            // Nobody filed it, so nobody owns it — see the note in createLead.
            assigned_to: null,
            created_by: null,
        });
        // The lead keeps its own normalised snapshot, and a first enquiry
        // points at a contact. contact_id must not stay null.
        expect(lead.email_norm).toBe('rahim@example.com');
        expect(lead.contact_id).toBe('contact-new');
        expect(db.crmContact.create).toHaveBeenCalledTimes(1);
        expect(db.crmContact.create.mock.calls[0][0].data).toMatchObject({
            tenant_id: TENANT,
            name: 'Rahim Uddin',
            email: 'Rahim@Example.com',
            email_norm: 'rahim@example.com',
            mobile: null,
            mobile_norm: null,
        });
        expect(db.crmContact.update).not.toHaveBeenCalled();

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
        db.crmContact.findMany.mockResolvedValue([
            contact({ email: 'rahim@example.com', email_norm: 'rahim@example.com' }),
        ]);
        db.lead.findFirst.mockResolvedValue({ id: 'lead-existing' });

        await expect(service.submit(SLUG, { ...ENQUIRY })).resolves.toEqual({ success: true });

        // A repeat is the one contact with this email, then that contact's
        // newest open lead. It is not "the" lead that happens to share the address.
        expect(db.crmContact.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    tenant_id: TENANT,
                    OR: [
                        { email: { equals: 'Rahim@Example.com', mode: 'insensitive' } },
                        { email_norm: 'rahim@example.com' },
                    ],
                },
            }),
        );
        expect(db.lead.findFirst).toHaveBeenCalledWith({
            where: {
                tenant_id: TENANT,
                contact_id: 'contact-1',
                status: { notIn: ['CONVERTED', 'LOST'] },
            },
            orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
            select: { id: true },
        });
        expect(db.lead.create).not.toHaveBeenCalled();
        expect(db.crmContact.create).not.toHaveBeenCalled();
        expect(db.leadConversation.create).toHaveBeenCalledTimes(1);
        expect(db.leadConversation.create.mock.calls[0][0].data.lead_id).toBe('lead-existing');
    });

    it('never rewrites an existing lead, so a worked lead is not dragged back to NEW', async () => {
        db.crmContact.findMany.mockResolvedValue([
            contact({ email: 'rahim@example.com', email_norm: 'rahim@example.com' }),
        ]);
        db.lead.findFirst.mockResolvedValue({ id: 'lead-existing', status: 'NEGOTIATION' });

        await service.submit(SLUG, { ...ENQUIRY });

        expect(db.lead.update).not.toHaveBeenCalled();
        expect(db.crmContact.update).not.toHaveBeenCalled();
        expect(db.lead.create).not.toHaveBeenCalled();
    });

    it('matches an existing lead on a differently-spelled mobile number', async () => {
        const created = new Date('2020-06-01T00:00:00.000Z');
        db.crmContact.findMany.mockResolvedValue([
            // A set norm that is a different number does not match, even when
            // the raw spelling does and the row is older.
            contact({
                id: 'contact-decoy',
                mobile: '01712-345678',
                mobile_norm: '+8801999999999',
                created_at: new Date('2019-01-01T00:00:00.000Z'),
            }),
            // Same instant: the lower id is the older person.
            contact({
                id: 'contact-b',
                mobile: '01712-345678',
                mobile_norm: null,
                created_at: created,
            }),
            contact({
                id: 'contact-a',
                organization_id: 'org-a',
                mobile: '+8801712345678',
                mobile_norm: null,
                created_at: created,
            }),
        ]);
        db.lead.findFirst.mockResolvedValue({ id: 'lead-existing' });

        await service.submit(SLUG, {
            name: 'Rahim',
            mobile: '01712-345678',
            email: 'someone-else@example.com',
            message: ENQUIRY.message,
        });

        // `01712-345678` and `+8801712345678` are one number. The email is ignored.
        expect(db.crmContact.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    tenant_id: TENANT,
                    OR: [
                        { mobile_norm: '+8801712345678' },
                        { mobile_norm: null, mobile: { not: null } },
                    ],
                },
                orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
            }),
        );
        expect(db.lead.findFirst.mock.calls[0][0].where).toMatchObject({ contact_id: 'contact-a' });
        expect(db.lead.create).not.toHaveBeenCalled();
        expect(db.crmContact.create).not.toHaveBeenCalled();
        expect(db.lead.update).not.toHaveBeenCalled();
        expect(db.leadConversation.create.mock.calls[0][0].data.lead_id).toBe('lead-existing');
    });

    it('creates a lead pointing at the contact when none of that contact\'s leads are open', async () => {
        db.crmContact.findMany.mockResolvedValue([
            contact({
                id: 'contact-1',
                organization_id: 'org-9',
                mobile: '01712345678',
                mobile_norm: '+8801712345678',
            }),
        ]);
        db.lead.findFirst.mockResolvedValue(null);

        await expect(
            service.submit(SLUG, { name: 'Rahim', mobile: '01712345678', message: ENQUIRY.message }),
        ).resolves.toEqual({ success: true });

        expect(db.crmContact.create).not.toHaveBeenCalled();
        expect(db.crmContact.update).not.toHaveBeenCalled();
        expect(db.lead.update).not.toHaveBeenCalled();
        expect(db.lead.create.mock.calls[0][0].data).toMatchObject({
            contact_id: 'contact-1',
            organization_id: 'org-9',
            status: 'NEW',
            assigned_to: null,
        });
        expect(db.leadConversation.create.mock.calls[0][0].data.lead_id).toBe('lead-new');
    });

    it('creates a new contact and a new lead when the email matches two contacts', async () => {
        db.crmContact.findMany.mockResolvedValue([
            contact({ id: 'contact-a', organization_id: 'org-a', email: 'rahim@example.com', email_norm: 'rahim@example.com' }),
            contact({ id: 'contact-b', organization_id: 'org-b', email: 'Rahim@Example.com', email_norm: 'rahim@example.com', created_at: new Date('2021-01-01T00:00:00.000Z') }),
        ]);

        await expect(service.submit(SLUG, { ...ENQUIRY })).resolves.toEqual({ success: true });

        expect(db.crmContact.update).not.toHaveBeenCalled();
        expect(db.lead.update).not.toHaveBeenCalled();
        expect(db.crmContact.create).toHaveBeenCalledTimes(1);
        expect(db.crmContact.create.mock.calls[0][0].data).toMatchObject({
            tenant_id: TENANT,
            name: 'Rahim Uddin',
            email: 'Rahim@Example.com',
            email_norm: 'rahim@example.com',
            mobile: null,
            mobile_norm: null,
        });
        expect(db.lead.create.mock.calls[0][0].data.contact_id).toBe('contact-new');
        expect(db.leadConversation.create.mock.calls[0][0].data.lead_id).toBe('lead-new');
    });

    it('stores a normalizing mobile on the new contact when the email is shared', async () => {
        db.crmContact.findMany.mockImplementation(({ where }: { where?: { OR?: Array<Record<string, unknown>> } }) =>
            Promise.resolve(
                isMobileLookup(where)
                    ? []
                    : [
                        contact({ id: 'contact-a' }),
                        contact({ id: 'contact-b', created_at: new Date('2021-01-01T00:00:00.000Z') }),
                    ],
            ),
        );

        await service.submit(SLUG, {
            name: 'Rahim',
            email: 'rahim@example.com',
            mobile: '01712-345678',
            message: ENQUIRY.message,
        });

        expect(db.crmContact.update).not.toHaveBeenCalled();
        expect(db.crmContact.create.mock.calls[0][0].data).toMatchObject({
            email: 'rahim@example.com',
            email_norm: 'rahim@example.com',
            mobile: '01712-345678',
            mobile_norm: '+8801712345678',
        });
        expect(db.lead.create.mock.calls[0][0].data.contact_id).toBe('contact-new');
    });

    it('stores a null mobile on a new contact when the number does not normalize', async () => {
        await service.submit(SLUG, {
            name: 'Rahim',
            email: 'rahim@example.com',
            mobile: '---',
            message: ENQUIRY.message,
        });

        expect(db.crmContact.create.mock.calls[0][0].data).toMatchObject({
            email: 'rahim@example.com',
            email_norm: 'rahim@example.com',
            mobile: null,
            mobile_norm: null,
        });
        expect(db.lead.create.mock.calls[0][0].data.contact_id).toBe('contact-new');
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
