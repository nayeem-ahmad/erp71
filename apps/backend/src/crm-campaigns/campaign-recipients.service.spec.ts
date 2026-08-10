import { Test, TestingModule } from '@nestjs/testing';
import { CampaignRecipientsService } from './campaign-recipients.service';
import { DatabaseService } from '../database/database.service';

const ROW = { email: 'rahim@example.com', name: 'Rahim Uddin', subject: 'Hi', message: 'Hello' };

describe('CampaignRecipientsService', () => {
    let service: CampaignRecipientsService;
    let db: any;

    beforeEach(async () => {
        db = {
            customer: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn() },
            lead: { findFirst: jest.fn().mockResolvedValue(null) },
            crmContact: {
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({ id: 'con-default', name: 'Default Contact' }),
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

    describe('writeUploadedRecipients()', () => {
        it('links a row to a matching customer and uses the customer name', async () => {
            db.customer.findFirst.mockResolvedValueOnce({ id: 'cus-1', name: 'Rahim Real', phone: '017' });

            await service.writeUploadedRecipients('t1', 'camp-1', [ROW], 'user-1');

            expect(db.lead.findFirst).not.toHaveBeenCalled();
            expect(db.crmContact.create).not.toHaveBeenCalled();
            expect(db.crmCampaignRecipient.createMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: [
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
                    ],
                }),
            );
        });

        it('falls back to a lead when no customer matches', async () => {
            db.lead.findFirst.mockResolvedValueOnce({ id: 'lead-1', name: 'Rahim Lead', mobile: '018' });

            await service.writeUploadedRecipients('t1', 'camp-1', [ROW], 'user-1');

            expect(db.crmContact.findFirst).not.toHaveBeenCalled();
            expect(db.crmCampaignRecipient.createMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: [expect.objectContaining({ lead_id: 'lead-1', customer_id: null, name: 'Rahim Lead' })],
                }),
            );
        });

        it('falls back to an existing contact when no customer or lead matches', async () => {
            db.crmContact.findFirst.mockResolvedValueOnce({ id: 'con-1', name: 'Rahim Contact', mobile: null });

            await service.writeUploadedRecipients('t1', 'camp-1', [ROW], 'user-1');

            expect(db.crmContact.create).not.toHaveBeenCalled();
            expect(db.crmCampaignRecipient.createMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: [expect.objectContaining({ contact_id: 'con-1', name: 'Rahim Contact' })],
                }),
            );
        });

        it('creates a contact when nothing matches, tagged as an import', async () => {
            db.crmContact.create.mockResolvedValueOnce({ id: 'con-new', name: 'Rahim Uddin' });

            await service.writeUploadedRecipients('t1', 'camp-1', [ROW], 'user-1');

            expect(db.crmContact.create).toHaveBeenCalledWith({
                data: {
                    tenant_id: 't1',
                    name: 'Rahim Uddin',
                    email: 'rahim@example.com',
                    capture_source: 'IMPORT',
                    created_by: 'user-1',
                },
            });
            expect(db.crmCampaignRecipient.createMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: [expect.objectContaining({ contact_id: 'con-new', name: 'Rahim Uddin' })],
                }),
            );
        });

        it('matches on email case-insensitively and scoped to the tenant', async () => {
            await service.writeUploadedRecipients('t1', 'camp-1', [ROW], null);

            expect(db.customer.findFirst).toHaveBeenCalledWith({
                where: {
                    tenant_id: 't1',
                    deleted_at: null,
                    email: { equals: 'rahim@example.com', mode: 'insensitive' },
                },
                select: { id: true, name: true, phone: true },
            });
        });

        it('returns the number of recipients written', async () => {
            db.crmCampaignRecipient.createMany.mockResolvedValueOnce({ count: 1 });
            await expect(service.writeUploadedRecipients('t1', 'camp-1', [ROW], null)).resolves.toBe(1);
        });
    });

    describe('writeSegmentRecipients()', () => {
        it('writes one PENDING recipient per targeted customer', async () => {
            db.customer.findMany.mockResolvedValueOnce([
                { id: 'c1', name: 'A', phone: '017', email: 'a@example.com' },
                { id: 'c2', name: 'B', phone: '018', email: null },
            ]);
            db.crmCampaignRecipient.createMany.mockResolvedValueOnce({ count: 2 });

            const written = await service.writeSegmentRecipients('t1', 'camp-1', 'VIP', null);

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

        it('narrows by segment and group', async () => {
            db.customer.findMany.mockResolvedValueOnce([]);
            await service.writeSegmentRecipients('t1', 'camp-1', 'VIP', 'grp-1');
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
            await service.writeSegmentRecipients('t1', 'camp-1', 'ALL', null);
            expect(db.customer.findMany).toHaveBeenCalledWith({
                where: { tenant_id: 't1', deleted_at: null, phone: { not: null } },
                select: { id: true, name: true, phone: true, email: true },
            });
        });

        it('writes nothing and returns 0 when no customer is targeted', async () => {
            db.customer.findMany.mockResolvedValueOnce([]);
            await expect(service.writeSegmentRecipients('t1', 'camp-1', 'VIP', null)).resolves.toBe(0);
            expect(db.crmCampaignRecipient.createMany).not.toHaveBeenCalled();
        });
    });
});
