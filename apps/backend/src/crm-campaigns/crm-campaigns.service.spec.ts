import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CrmCampaignsService } from './crm-campaigns.service';
import { DatabaseService } from '../database/database.service';
import { SmsService } from '../sms/sms.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { EmailService } from '../email/email.service';
import { AppLogger } from '../common/app-logger.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';

describe('CrmCampaignsService', () => {
    let service: CrmCampaignsService;
    let db: any;
    let sms: any;
    let whatsapp: any;
    let email: any;

    beforeEach(async () => {
        db = {
            crmCampaign: {
                create: jest.fn(),
                findFirst: jest.fn(),
                update: jest.fn(),
            },
            crmCampaignRecipient: {
                updateMany: jest.fn().mockResolvedValue({}),
            },
        };
        sms = { sendSms: jest.fn() };
        whatsapp = { sendMessage: jest.fn() };
        email = { sendCustom: jest.fn() };
        const logger = { log: jest.fn(), error: jest.fn() };
        const jobTracker = { track: jest.fn() };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CrmCampaignsService,
                { provide: DatabaseService, useValue: db },
                { provide: SmsService, useValue: sms },
                { provide: WhatsAppService, useValue: whatsapp },
                { provide: EmailService, useValue: email },
                { provide: AppLogger, useValue: logger },
                { provide: JobTrackerService, useValue: jobTracker },
            ],
        }).compile();

        service = module.get<CrmCampaignsService>(CrmCampaignsService);
    });

    describe('create() — EMAIL subject requirement', () => {
        it('rejects an EMAIL campaign with no subject', async () => {
            await expect(
                service.create('tenant-1', 'user-1', {
                    name: 'Blast',
                    channel: 'EMAIL',
                    message: 'Hello',
                } as any),
            ).rejects.toThrow(BadRequestException);
            expect(db.crmCampaign.create).not.toHaveBeenCalled();
        });

        it('accepts an EMAIL campaign with a subject', async () => {
            db.crmCampaign.create.mockResolvedValueOnce({ id: 'camp-1' });
            await service.create('tenant-1', 'user-1', {
                name: 'Blast',
                channel: 'EMAIL',
                subject: 'Big Sale',
                message: 'Hello',
            } as any);
            expect(db.crmCampaign.create).toHaveBeenCalled();
        });
    });

    describe('dispatchCampaign()', () => {
        const customers = [
            { id: 'c1', phone: '01700000001', email: 'c1@example.com' },
            { id: 'c2', phone: '01700000002', email: 'c2@example.com' },
        ];

        const runDispatch = (subject: string | null, channel: string, custs = customers) =>
            (service as any).dispatchCampaign('tenant-1', 'camp-1', 'Hello there', subject, channel, custs);

        it('sends via SMS and marks all recipients SENT when credits are available', async () => {
            sms.sendSms.mockResolvedValue({ sent: true });

            await runDispatch(null, 'SMS');

            expect(sms.sendSms).toHaveBeenCalledTimes(2);
            expect(db.crmCampaignRecipient.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({ data: { status: 'SENT', sent_at: expect.any(Date) } }),
            );
            expect(db.crmCampaign.update).toHaveBeenCalledWith({
                where: { id: 'camp-1' },
                data: expect.objectContaining({ status: 'COMPLETED', delivered_count: 2, failed_count: 0 }),
            });
        });

        it('marks a recipient FAILED when SMS credits are insufficient', async () => {
            sms.sendSms.mockResolvedValue({ sent: false });

            await runDispatch(null, 'SMS');

            expect(db.crmCampaign.update).toHaveBeenCalledWith({
                where: { id: 'camp-1' },
                data: expect.objectContaining({ delivered_count: 0, failed_count: 2 }),
            });
        });

        it('sends via WhatsApp for each recipient', async () => {
            whatsapp.sendMessage.mockResolvedValue(undefined);

            await runDispatch(null, 'WHATSAPP');

            expect(whatsapp.sendMessage).toHaveBeenCalledTimes(2);
            expect(db.crmCampaign.update).toHaveBeenCalledWith({
                where: { id: 'camp-1' },
                data: expect.objectContaining({ delivered_count: 2, failed_count: 0 }),
            });
        });

        it('sends EMAIL campaigns with the subject line to each customer email', async () => {
            email.sendCustom.mockResolvedValue(undefined);

            await runDispatch('Big Sale', 'EMAIL');

            expect(email.sendCustom).toHaveBeenCalledWith('c1@example.com', 'Big Sale', 'Hello there');
            expect(email.sendCustom).toHaveBeenCalledWith('c2@example.com', 'Big Sale', 'Hello there');
            expect(db.crmCampaign.update).toHaveBeenCalledWith({
                where: { id: 'camp-1' },
                data: expect.objectContaining({ delivered_count: 2, failed_count: 0 }),
            });
        });

        it('marks a recipient FAILED (not silently SENT) when they have no email on file', async () => {
            const custsWithoutEmail = [{ id: 'c3', phone: '01700000003', email: null }];

            await runDispatch('Big Sale', 'EMAIL', custsWithoutEmail);

            expect(email.sendCustom).not.toHaveBeenCalled();
            expect(db.crmCampaign.update).toHaveBeenCalledWith({
                where: { id: 'camp-1' },
                data: expect.objectContaining({ delivered_count: 0, failed_count: 1 }),
            });
        });

        it('propagates EmailService failures as a FAILED recipient', async () => {
            email.sendCustom.mockRejectedValue(new Error('SMTP is not configured'));

            await runDispatch('Big Sale', 'EMAIL');

            expect(db.crmCampaign.update).toHaveBeenCalledWith({
                where: { id: 'camp-1' },
                data: expect.objectContaining({ delivered_count: 0, failed_count: 2 }),
            });
        });
    });
});
