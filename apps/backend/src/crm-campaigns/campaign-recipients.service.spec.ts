import { Test, TestingModule } from '@nestjs/testing';
import { CampaignRecipientsService } from './campaign-recipients.service';
import { DatabaseService } from '../database/database.service';

const ROW = { email: 'rahim@example.com', name: 'Rahim Uddin', subject: 'Hi', message: 'Hello' };

describe('CampaignRecipientsService', () => {
    let service: CampaignRecipientsService;
    let db: any;

    beforeEach(async () => {
        db = {
            customer: { findMany: jest.fn().mockResolvedValue([]) },
            lead: { findMany: jest.fn().mockResolvedValue([]) },
            crmContact: {
                findMany: jest.fn().mockResolvedValue([]),
                createMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            crmCampaignRecipient: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
        };
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CampaignRecipientsService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();
        service = module.get(CampaignRecipientsService);
    });

    /** The single recipient row a one-row upload produced. */
    const writtenRow = () => db.crmCampaignRecipient.createMany.mock.calls[0][0].data[0];

    describe('writeUploadedRecipients()', () => {
        it('links a row to a matching customer and uses the customer name', async () => {
            db.customer.findMany.mockResolvedValueOnce([
                { id: 'cus-1', name: 'Rahim Real', phone: '017', email: 'rahim@example.com' },
            ]);

            await service.writeUploadedRecipients('t1', 'camp-1', [ROW], 'user-1');

            expect(db.crmContact.createMany).not.toHaveBeenCalled();
            expect(writtenRow()).toEqual(
                expect.objectContaining({
                    campaign_id: 'camp-1',
                    customer_id: 'cus-1',
                    lead_id: null,
                    contact_id: null,
                    email: 'rahim@example.com',
                    name: 'Rahim Real',
                    phone: '017',
                    subject: 'Hi',
                    message: 'Hello',
                    status: 'PENDING',
                }),
            );
        });

        it('falls back to a lead when no customer matches', async () => {
            db.lead.findMany.mockResolvedValueOnce([
                { id: 'lead-1', name: 'Rahim Lead', mobile: '018', email: 'rahim@example.com' },
            ]);

            await service.writeUploadedRecipients('t1', 'camp-1', [ROW], 'user-1');

            expect(db.crmContact.createMany).not.toHaveBeenCalled();
            expect(writtenRow()).toEqual(
                expect.objectContaining({
                    lead_id: 'lead-1',
                    customer_id: null,
                    contact_id: null,
                    name: 'Rahim Lead',
                    phone: '018',
                }),
            );
        });

        it('falls back to an existing contact when no customer or lead matches', async () => {
            db.crmContact.findMany.mockResolvedValueOnce([
                { id: 'con-1', name: 'Rahim Contact', mobile: null, email: 'rahim@example.com' },
            ]);

            await service.writeUploadedRecipients('t1', 'camp-1', [ROW], 'user-1');

            expect(db.crmContact.createMany).not.toHaveBeenCalled();
            expect(writtenRow()).toEqual(
                expect.objectContaining({ contact_id: 'con-1', name: 'Rahim Contact', phone: null }),
            );
        });

        it('prefers a customer over a lead over a contact for the same address', async () => {
            db.customer.findMany.mockResolvedValueOnce([
                { id: 'cus-1', name: 'From Customer', phone: '017', email: 'rahim@example.com' },
            ]);
            db.lead.findMany.mockResolvedValueOnce([
                { id: 'lead-1', name: 'From Lead', mobile: '018', email: 'rahim@example.com' },
            ]);
            db.crmContact.findMany.mockResolvedValueOnce([
                { id: 'con-1', name: 'From Contact', mobile: '019', email: 'rahim@example.com' },
            ]);

            await service.writeUploadedRecipients('t1', 'camp-1', [ROW], 'user-1');

            expect(writtenRow()).toEqual(
                expect.objectContaining({
                    customer_id: 'cus-1',
                    lead_id: null,
                    contact_id: null,
                    name: 'From Customer',
                }),
            );
        });

        it('prefers a lead over a contact when there is no customer', async () => {
            db.lead.findMany.mockResolvedValueOnce([
                { id: 'lead-1', name: 'From Lead', mobile: '018', email: 'rahim@example.com' },
            ]);
            db.crmContact.findMany.mockResolvedValueOnce([
                { id: 'con-1', name: 'From Contact', mobile: '019', email: 'rahim@example.com' },
            ]);

            await service.writeUploadedRecipients('t1', 'camp-1', [ROW], 'user-1');

            expect(writtenRow()).toEqual(
                expect.objectContaining({ lead_id: 'lead-1', contact_id: null, name: 'From Lead' }),
            );
        });

        it('creates a contact when nothing matches, tagged as an import', async () => {
            await service.writeUploadedRecipients('t1', 'camp-1', [ROW], 'user-1');

            expect(db.crmContact.createMany).toHaveBeenCalledWith({
                data: [
                    expect.objectContaining({
                        tenant_id: 't1',
                        name: 'Rahim Uddin',
                        email: 'rahim@example.com',
                        capture_source: 'IMPORT',
                        created_by: 'user-1',
                    }),
                ],
            });
            const contactId = db.crmContact.createMany.mock.calls[0][0].data[0].id;
            expect(writtenRow()).toEqual(
                expect.objectContaining({ contact_id: contactId, name: 'Rahim Uddin' }),
            );
        });

        it('creates one contact for an address that repeats across rows', async () => {
            await service.writeUploadedRecipients(
                't1',
                'camp-1',
                [ROW, { ...ROW, subject: 'Second' }],
                'user-1',
            );

            expect(db.crmContact.createMany.mock.calls[0][0].data).toHaveLength(1);
            const rows = db.crmCampaignRecipient.createMany.mock.calls[0][0].data;
            expect(rows).toHaveLength(2);
            expect(rows[0].contact_id).toBe(rows[1].contact_id);
        });

        // I4: three sequential ILIKE findFirsts per row became one indexed
        // `in` per table for the whole upload.
        it('resolves the whole upload in one lookup per table, scoped to the tenant', async () => {
            const rows = [ROW, { ...ROW, email: 'karim@example.com', name: 'Karim' }];

            await service.writeUploadedRecipients('t1', 'camp-1', rows, null);

            const email = { in: ['rahim@example.com', 'karim@example.com'], mode: 'insensitive' };
            expect(db.customer.findMany).toHaveBeenCalledTimes(1);
            expect(db.customer.findMany).toHaveBeenCalledWith({
                where: { tenant_id: 't1', deleted_at: null, email },
                select: { id: true, name: true, phone: true, email: true },
            });
            expect(db.lead.findMany).toHaveBeenCalledTimes(1);
            expect(db.lead.findMany).toHaveBeenCalledWith({
                where: { tenant_id: 't1', email },
                select: { id: true, name: true, mobile: true, email: true },
            });
            expect(db.crmContact.findMany).toHaveBeenCalledTimes(1);
            expect(db.crmContact.findMany).toHaveBeenCalledWith({
                where: { tenant_id: 't1', email },
                select: { id: true, name: true, mobile: true, email: true },
            });
            expect(db.crmCampaignRecipient.createMany).toHaveBeenCalledTimes(1);
        });

        it('looks each distinct address up once however often it repeats', async () => {
            await service.writeUploadedRecipients('t1', 'camp-1', [ROW, ROW, ROW], null);

            expect(db.customer.findMany.mock.calls[0][0].where.email.in).toEqual([
                'rahim@example.com',
            ]);
        });

        it('folds casing differences in what the database returns', async () => {
            db.customer.findMany.mockResolvedValueOnce([
                { id: 'cus-1', name: 'Rahim Real', phone: '017', email: 'Rahim@Example.com' },
            ]);

            await service.writeUploadedRecipients('t1', 'camp-1', [ROW], null);

            expect(db.crmContact.createMany).not.toHaveBeenCalled();
            expect(writtenRow()).toEqual(expect.objectContaining({ customer_id: 'cus-1' }));
        });

        // The spec requires case-insensitive resolution, and none of the three
        // tables normalises email on write. Without it, every upload mints a
        // fresh duplicate contact for an address stored in mixed case — the
        // exact duplicate the resolution order exists to prevent.
        it('matches a customer whose stored address differs only in case', async () => {
            // The mock stands in for Postgres honouring mode: 'insensitive':
            // it only returns the row when the lookup asks for insensitivity.
            db.customer.findMany.mockImplementation(({ where }: any) =>
                Promise.resolve(
                    where.email.mode === 'insensitive'
                        ? [{ id: 'cus-1', name: 'Rahim Real', phone: '017', email: 'Rahim@Example.com' }]
                        : [],
                ),
            );

            await service.writeUploadedRecipients(
                't1',
                'camp-1',
                [ROW, { ...ROW, email: 'karim@example.com', name: 'Karim' }],
                'user-1',
            );

            const rows = db.crmCampaignRecipient.createMany.mock.calls[0][0].data;
            expect(rows[0]).toEqual(
                expect.objectContaining({
                    customer_id: 'cus-1',
                    contact_id: null,
                    name: 'Rahim Real',
                    phone: '017',
                }),
            );
            // Only the genuinely unknown address becomes a contact.
            expect(db.crmContact.createMany.mock.calls[0][0].data).toEqual([
                expect.objectContaining({ email: 'karim@example.com' }),
            ]);
        });

        it('writes through the transaction client it is given', async () => {
            const tx = {
                customer: { findMany: jest.fn().mockResolvedValue([]) },
                lead: { findMany: jest.fn().mockResolvedValue([]) },
                crmContact: {
                    findMany: jest.fn().mockResolvedValue([]),
                    createMany: jest.fn().mockResolvedValue({ count: 1 }),
                },
                crmCampaignRecipient: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
            };

            await service.writeUploadedRecipients('t1', 'camp-1', [ROW], null, tx as any);

            expect(tx.crmCampaignRecipient.createMany).toHaveBeenCalled();
            expect(db.crmCampaignRecipient.createMany).not.toHaveBeenCalled();
        });

        it('returns the number of recipients written', async () => {
            db.crmCampaignRecipient.createMany.mockResolvedValueOnce({ count: 1 });
            await expect(service.writeUploadedRecipients('t1', 'camp-1', [ROW], null)).resolves.toBe(1);
        });

        it('writes nothing for an empty upload', async () => {
            await expect(service.writeUploadedRecipients('t1', 'camp-1', [], null)).resolves.toBe(0);
            expect(db.customer.findMany).not.toHaveBeenCalled();
            expect(db.crmCampaignRecipient.createMany).not.toHaveBeenCalled();
        });
    });

    describe('writeSegmentRecipients()', () => {
        it('writes one PENDING recipient per targeted customer', async () => {
            db.customer.findMany.mockResolvedValueOnce([
                { id: 'c1', name: 'A', phone: '017', email: 'a@example.com' },
                { id: 'c2', name: 'B', phone: '018', email: null },
            ]);
            db.crmCampaignRecipient.createMany.mockResolvedValueOnce({ count: 2 });

            const written = await service.writeSegmentRecipients('t1', 'camp-1', 'VIP', null, 'EMAIL');

            expect(written).toBe(2);
            expect(db.crmCampaignRecipient.createMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: [
                        expect.objectContaining({ customer_id: 'c1', phone: '017', email: 'a@example.com' }),
                        expect.objectContaining({ customer_id: 'c2', phone: '018', email: null }),
                    ],
                    skipDuplicates: true,
                }),
            );
        });

        // I3: @@unique([campaign_id, email]) plus skipDuplicates silently drops
        // the second of two customers sharing an address. On SMS/WhatsApp the
        // address is never used, so storing it can only lose recipients.
        it.each(['SMS', 'WHATSAPP'])(
            'stores no email on a %s campaign, so customers sharing an address all survive',
            async (channel) => {
                db.customer.findMany.mockResolvedValueOnce([
                    { id: 'c1', name: 'Household A', phone: '017', email: 'info@shop.example' },
                    { id: 'c2', name: 'Household B', phone: '018', email: 'info@shop.example' },
                ]);
                db.crmCampaignRecipient.createMany.mockResolvedValueOnce({ count: 2 });

                const written = await service.writeSegmentRecipients('t1', 'camp-1', 'ALL', null, channel);

                expect(written).toBe(2);
                const rows = db.crmCampaignRecipient.createMany.mock.calls[0][0].data;
                expect(rows.map((r: any) => r.email)).toEqual([null, null]);
                expect(rows.map((r: any) => r.phone)).toEqual(['017', '018']);
            },
        );

        it('still stores the email on an EMAIL campaign', async () => {
            db.customer.findMany.mockResolvedValueOnce([
                { id: 'c1', name: 'A', phone: '017', email: 'a@example.com' },
            ]);
            db.crmCampaignRecipient.createMany.mockResolvedValueOnce({ count: 1 });

            await service.writeSegmentRecipients('t1', 'camp-1', 'ALL', null, 'EMAIL');

            expect(db.crmCampaignRecipient.createMany.mock.calls[0][0].data[0].email).toBe(
                'a@example.com',
            );
        });

        it('narrows by segment and group', async () => {
            db.customer.findMany.mockResolvedValueOnce([]);
            await service.writeSegmentRecipients('t1', 'camp-1', 'VIP', 'grp-1', 'SMS');
            expect(db.customer.findMany).toHaveBeenCalledWith({
                where: {
                    tenant_id: 't1',
                    deleted_at: null,
                    phone: { not: null },
                    segment_category: 'VIP',
                    customer_group_id: 'grp-1',
                },
                select: { id: true, name: true, phone: true, email: true },
            });
        });

        it('does not narrow by segment when the segment is ALL', async () => {
            db.customer.findMany.mockResolvedValueOnce([]);
            await service.writeSegmentRecipients('t1', 'camp-1', 'ALL', null, 'SMS');
            expect(db.customer.findMany).toHaveBeenCalledWith({
                where: { tenant_id: 't1', deleted_at: null, phone: { not: null } },
                select: { id: true, name: true, phone: true, email: true },
            });
        });

        it('writes nothing and returns 0 when no customer is targeted', async () => {
            db.customer.findMany.mockResolvedValueOnce([]);
            await expect(
                service.writeSegmentRecipients('t1', 'camp-1', 'VIP', null, 'SMS'),
            ).resolves.toBe(0);
            expect(db.crmCampaignRecipient.createMany).not.toHaveBeenCalled();
        });
    });
});
