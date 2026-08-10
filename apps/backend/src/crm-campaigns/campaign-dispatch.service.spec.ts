import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CampaignDispatchService, CAMPAIGN_BATCH_SIZE } from './campaign-dispatch.service';
import { CampaignRecipientsService } from './campaign-recipients.service';
import { DatabaseService } from '../database/database.service';
import { SmsService } from '../sms/sms.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { EmailService } from '../email/email.service';
import { AppLogger } from '../common/app-logger.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';

const emailCampaign = (over: Record<string, unknown> = {}) => ({
    id: 'camp-1',
    tenant_id: 't1',
    status: 'SENDING',
    channel: 'EMAIL',
    recipient_source: 'UPLOAD',
    body_format: 'TEXT',
    subject: null,
    message: null,
    target_segment: 'ALL',
    target_group_id: null,
    ...over,
});

describe('CampaignDispatchService', () => {
    let service: CampaignDispatchService;
    let db: any;
    let sms: any;
    let whatsapp: any;
    let email: any;
    let recipients: any;

    beforeEach(async () => {
        db = {
            crmCampaign: {
                findFirst: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
                update: jest.fn().mockResolvedValue({}),
            },
            crmCampaignRecipient: {
                findMany: jest.fn().mockResolvedValue([]),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
                update: jest.fn().mockResolvedValue({}),
                count: jest.fn().mockResolvedValue(0),
                groupBy: jest.fn().mockResolvedValue([]),
            },
        };
        sms = { sendSms: jest.fn().mockResolvedValue({ sent: true }) };
        whatsapp = { sendMessage: jest.fn().mockResolvedValue(undefined) };
        email = { sendCustom: jest.fn().mockResolvedValue(undefined) };
        recipients = { writeSegmentRecipients: jest.fn().mockResolvedValue(0) };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CampaignDispatchService,
                { provide: DatabaseService, useValue: db },
                { provide: CampaignRecipientsService, useValue: recipients },
                { provide: SmsService, useValue: sms },
                { provide: WhatsAppService, useValue: whatsapp },
                { provide: EmailService, useValue: email },
                { provide: AppLogger, useValue: { log: jest.fn(), error: jest.fn() } },
                { provide: JobTrackerService, useValue: { track: jest.fn((_n, fn) => fn()) } },
            ],
        }).compile();

        service = module.get(CampaignDispatchService);
    });

    describe('queue()', () => {
        it('materialises segment recipients then marks the campaign SENDING', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce(
                emailCampaign({ recipient_source: 'SEGMENT', status: 'DRAFT', message: 'Hi', subject: 'S' }),
            );
            recipients.writeSegmentRecipients.mockResolvedValueOnce(3);

            const result = await service.queue('t1', 'camp-1');

            expect(recipients.writeSegmentRecipients).toHaveBeenCalledWith('t1', 'camp-1', 'ALL', null);
            expect(db.crmCampaign.update).toHaveBeenCalledWith({
                where: { id: 'camp-1' },
                data: { status: 'SENDING', recipient_count: 3 },
            });
            expect(result).toEqual({ queued: 3 });
        });

        it('does not materialise anything for an UPLOAD campaign', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce(emailCampaign({ status: 'DRAFT' }));
            db.crmCampaignRecipient.count.mockResolvedValueOnce(5);

            const result = await service.queue('t1', 'camp-1');

            expect(recipients.writeSegmentRecipients).not.toHaveBeenCalled();
            expect(result).toEqual({ queued: 5 });
        });

        it('rejects a campaign with no eligible recipients', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce(
                emailCampaign({ recipient_source: 'SEGMENT', status: 'DRAFT' }),
            );
            recipients.writeSegmentRecipients.mockResolvedValueOnce(0);

            await expect(service.queue('t1', 'camp-1')).rejects.toThrow(BadRequestException);
            expect(db.crmCampaign.update).not.toHaveBeenCalled();
        });

        it('rejects a campaign that is not DRAFT or SCHEDULED', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce(emailCampaign({ status: 'COMPLETED' }));
            await expect(service.queue('t1', 'camp-1')).rejects.toThrow(BadRequestException);
        });
    });

    describe('drainCampaign()', () => {
        const pending = (id: string, over: Record<string, unknown> = {}) => ({
            id,
            email: `${id}@example.com`,
            phone: '01700000000',
            subject: 'Row subject',
            message: 'Row message',
            ...over,
        });

        it('claims a batch before sending so an overlapping pass cannot double-send', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
            db.crmCampaignRecipient.findMany.mockResolvedValueOnce([pending('r1'), pending('r2')]);
            db.crmCampaignRecipient.updateMany.mockResolvedValueOnce({ count: 2 });

            await service.drainCampaign('camp-1');

            expect(db.crmCampaignRecipient.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { campaign_id: 'camp-1', status: 'PENDING' },
                    take: CAMPAIGN_BATCH_SIZE,
                }),
            );
            expect(db.crmCampaignRecipient.updateMany).toHaveBeenCalledWith({
                where: { id: { in: ['r1', 'r2'] }, status: 'PENDING' },
                data: { status: 'SENDING' },
            });
            expect(email.sendCustom).toHaveBeenCalledTimes(2);
        });

        it('sends nothing when another pass already claimed the batch', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
            db.crmCampaignRecipient.findMany.mockResolvedValueOnce([pending('r1')]);
            db.crmCampaignRecipient.updateMany.mockResolvedValueOnce({ count: 0 });

            await service.drainCampaign('camp-1');

            expect(email.sendCustom).not.toHaveBeenCalled();
        });

        it('sends the row subject and the rendered row message', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
            db.crmCampaignRecipient.findMany.mockResolvedValueOnce([
                pending('r1', { message: 'Line 1\nLine <2>' }),
            ]);
            db.crmCampaignRecipient.updateMany.mockResolvedValueOnce({ count: 1 });

            await service.drainCampaign('camp-1');

            expect(email.sendCustom).toHaveBeenCalledWith(
                'r1@example.com',
                'Row subject',
                'Line 1<br>Line &lt;2&gt;',
                { tenantId: 't1' },
            );
        });

        it('falls back to the campaign subject and message for a segment recipient', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(
                emailCampaign({ recipient_source: 'SEGMENT', subject: 'Camp subject', message: 'Camp body' }),
            );
            db.crmCampaignRecipient.findMany.mockResolvedValueOnce([
                pending('r1', { subject: null, message: null }),
            ]);
            db.crmCampaignRecipient.updateMany.mockResolvedValueOnce({ count: 1 });

            await service.drainCampaign('camp-1');

            expect(email.sendCustom).toHaveBeenCalledWith(
                'r1@example.com',
                'Camp subject',
                'Camp body',
                { tenantId: 't1' },
            );
        });

        it('marks a recipient FAILED with the reason when the send throws', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
            db.crmCampaignRecipient.findMany.mockResolvedValueOnce([pending('r1')]);
            db.crmCampaignRecipient.updateMany.mockResolvedValueOnce({ count: 1 });
            email.sendCustom.mockRejectedValueOnce(new Error('SMTP down'));

            await service.drainCampaign('camp-1');

            expect(db.crmCampaignRecipient.update).toHaveBeenCalledWith({
                where: { id: 'r1' },
                data: { status: 'FAILED', error: 'Error: SMTP down' },
            });
        });

        it('fails a row with no email rather than sending nowhere', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
            db.crmCampaignRecipient.findMany.mockResolvedValueOnce([pending('r1', { email: null })]);
            db.crmCampaignRecipient.updateMany.mockResolvedValueOnce({ count: 1 });

            await service.drainCampaign('camp-1');

            expect(email.sendCustom).not.toHaveBeenCalled();
            expect(db.crmCampaignRecipient.update).toHaveBeenCalledWith({
                where: { id: 'r1' },
                data: { status: 'FAILED', error: 'Error: Recipient has no email address' },
            });
        });

        it('completes the campaign with its counts once nothing is pending', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
            db.crmCampaignRecipient.findMany.mockResolvedValueOnce([]);
            db.crmCampaignRecipient.groupBy.mockResolvedValueOnce([
                { status: 'SENT', _count: { _all: 7 } },
                { status: 'FAILED', _count: { _all: 2 } },
            ]);

            await service.drainCampaign('camp-1');

            expect(db.crmCampaign.update).toHaveBeenCalledWith({
                where: { id: 'camp-1' },
                data: {
                    status: 'COMPLETED',
                    sent_at: expect.any(Date),
                    delivered_count: 7,
                    failed_count: 2,
                },
            });
        });

        it('completes straight away when the batch was the last one', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
            db.crmCampaignRecipient.findMany.mockResolvedValueOnce([pending('r1')]);
            db.crmCampaignRecipient.updateMany.mockResolvedValueOnce({ count: 1 });
            db.crmCampaignRecipient.groupBy.mockResolvedValueOnce([{ status: 'SENT', _count: { _all: 1 } }]);

            await service.drainCampaign('camp-1');

            expect(db.crmCampaign.update).toHaveBeenCalledWith({
                where: { id: 'camp-1' },
                data: {
                    status: 'COMPLETED',
                    sent_at: expect.any(Date),
                    delivered_count: 1,
                    failed_count: 0,
                },
            });
        });

        it('leaves a full batch SENDING so the next pass picks up the rest', async () => {
            const full = Array.from({ length: CAMPAIGN_BATCH_SIZE }, (_, i) => pending(`r${i}`));
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
            db.crmCampaignRecipient.findMany.mockResolvedValueOnce(full);
            db.crmCampaignRecipient.updateMany.mockResolvedValueOnce({ count: full.length });

            await service.drainCampaign('camp-1');

            expect(db.crmCampaign.update).not.toHaveBeenCalled();
        });

        it('stops without sending when the campaign is no longer SENDING', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign({ status: 'CANCELLED' }));

            await service.drainCampaign('camp-1');

            expect(db.crmCampaignRecipient.findMany).not.toHaveBeenCalled();
            expect(email.sendCustom).not.toHaveBeenCalled();
        });

        it('routes an SMS campaign through the SMS service', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(
                emailCampaign({ channel: 'SMS', recipient_source: 'SEGMENT', message: 'Camp body' }),
            );
            db.crmCampaignRecipient.findMany.mockResolvedValueOnce([
                pending('r1', { subject: null, message: null }),
            ]);
            db.crmCampaignRecipient.updateMany.mockResolvedValueOnce({ count: 1 });

            await service.drainCampaign('camp-1');

            expect(sms.sendSms).toHaveBeenCalledWith('01700000000', 'Camp body', {
                tenantId: 't1',
                purpose: 'CRM campaign',
            });
        });

        it('fails an SMS recipient when there are no credits', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(
                emailCampaign({ channel: 'SMS', recipient_source: 'SEGMENT', message: 'Camp body' }),
            );
            db.crmCampaignRecipient.findMany.mockResolvedValueOnce([
                pending('r1', { subject: null, message: null }),
            ]);
            db.crmCampaignRecipient.updateMany.mockResolvedValueOnce({ count: 1 });
            sms.sendSms.mockResolvedValueOnce({ sent: false });

            await service.drainCampaign('camp-1');

            expect(db.crmCampaignRecipient.update).toHaveBeenCalledWith({
                where: { id: 'r1' },
                data: { status: 'FAILED', error: 'Error: Insufficient SMS credits' },
            });
        });
    });

    describe('processCampaigns()', () => {
        it('queues every campaign whose scheduled time has passed, then drains what is sending', async () => {
            db.crmCampaign.findMany
                .mockResolvedValueOnce([{ id: 'due-1', tenant_id: 't1' }])
                .mockResolvedValueOnce([{ id: 'sending-1', tenant_id: 't1' }]);
            jest.spyOn(service, 'queue').mockResolvedValue({ queued: 1 });
            jest.spyOn(service, 'drainCampaign').mockResolvedValue(undefined);

            await service.processCampaigns();

            expect(service.queue).toHaveBeenCalledWith('t1', 'due-1');
            expect(service.drainCampaign).toHaveBeenCalledWith('sending-1');
        });

        it('keeps going when one campaign throws', async () => {
            db.crmCampaign.findMany
                .mockResolvedValueOnce([{ id: 'bad', tenant_id: 't1' }, { id: 'good', tenant_id: 't1' }])
                .mockResolvedValueOnce([]);
            jest.spyOn(service, 'queue')
                .mockRejectedValueOnce(new Error('boom'))
                .mockResolvedValueOnce({ queued: 1 });

            await expect(service.processCampaigns()).resolves.toBeUndefined();
            expect(service.queue).toHaveBeenCalledTimes(2);
        });
    });
});
