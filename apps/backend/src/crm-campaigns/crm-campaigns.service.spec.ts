import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CrmCampaignsService } from './crm-campaigns.service';
import { DatabaseService } from '../database/database.service';
import { AppLogger } from '../common/app-logger.service';
import { CampaignRecipientsService } from './campaign-recipients.service';
import { CampaignDispatchService } from './campaign-dispatch.service';

describe('CrmCampaignsService', () => {
    let service: CrmCampaignsService;
    let db: any;
    let recipients: any;
    let dispatch: any;

    beforeEach(async () => {
        db = {
            crmCampaign: {
                create: jest.fn().mockResolvedValue({ id: 'camp-1' }),
                findFirst: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
                update: jest.fn().mockResolvedValue({}),
                delete: jest.fn().mockResolvedValue({}),
            },
            crmCampaignRecipient: {
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
                groupBy: jest.fn().mockResolvedValue([]),
            },
        };
        recipients = { writeUploadedRecipients: jest.fn().mockResolvedValue(0), resolveTargetCustomers: jest.fn().mockResolvedValue([]) };
        dispatch = { queue: jest.fn().mockResolvedValue({ queued: 0 }) };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CrmCampaignsService,
                { provide: DatabaseService, useValue: db },
                { provide: CampaignRecipientsService, useValue: recipients },
                { provide: CampaignDispatchService, useValue: dispatch },
                { provide: AppLogger, useValue: { log: jest.fn(), error: jest.fn() } },
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

    describe('create() — uploaded lists', () => {
        const uploadDto = (over: Record<string, unknown> = {}) => ({
            name: 'Eid blast',
            channel: 'EMAIL',
            recipient_source: 'UPLOAD',
            body_format: 'TEXT',
            rows: [{ email: 'a@example.com', name: 'A', subject: 'Hi', message: 'Hello' }],
            ...over,
        });

        it('creates the campaign and writes its recipients', async () => {
            recipients.writeUploadedRecipients.mockResolvedValueOnce(1);

            await service.create('t1', 'u1', uploadDto() as any);

            expect(db.crmCampaign.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        recipient_source: 'UPLOAD',
                        body_format: 'TEXT',
                        message: null,
                        subject: null,
                        status: 'DRAFT',
                    }),
                }),
            );
            expect(recipients.writeUploadedRecipients).toHaveBeenCalledWith(
                't1',
                'camp-1',
                [{ email: 'a@example.com', name: 'A', subject: 'Hi', message: 'Hello' }],
                'u1',
            );
            expect(db.crmCampaign.update).toHaveBeenCalledWith({
                where: { id: 'camp-1' },
                data: { recipient_count: 1 },
            });
        });

        it('does not require a campaign-level subject or message', async () => {
            recipients.writeUploadedRecipients.mockResolvedValueOnce(1);
            await expect(service.create('t1', 'u1', uploadDto() as any)).resolves.toBeDefined();
        });

        it('rejects an uploaded list on a non-EMAIL channel', async () => {
            await expect(
                service.create('t1', 'u1', uploadDto({ channel: 'SMS' }) as any),
            ).rejects.toThrow(BadRequestException);
            expect(db.crmCampaign.create).not.toHaveBeenCalled();
        });

        it('rejects an upload with no rows', async () => {
            await expect(
                service.create('t1', 'u1', uploadDto({ rows: [] }) as any),
            ).rejects.toThrow(BadRequestException);
        });

        it('rejects an upload whose rows all fail validation', async () => {
            await expect(
                service.create('t1', 'u1', uploadDto({ rows: [{ email: 'nope', subject: 'a', message: 'b' }] }) as any),
            ).rejects.toThrow(BadRequestException);
            expect(db.crmCampaign.create).not.toHaveBeenCalled();
        });

        it('rejects an upload over the row cap', async () => {
            const rows = Array.from({ length: 1001 }, (_, i) => ({
                email: `p${i}@example.com`, name: 'P', subject: 'Hi', message: 'Hello',
            }));
            await expect(service.create('t1', 'u1', uploadDto({ rows }) as any)).rejects.toThrow(
                BadRequestException,
            );
        });

        it('marks the campaign SCHEDULED when a time is given', async () => {
            recipients.writeUploadedRecipients.mockResolvedValueOnce(1);
            await service.create('t1', 'u1', uploadDto({ scheduled_at: '2026-08-10T14:30:00+06:00' }) as any);
            expect(db.crmCampaign.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: 'SCHEDULED' }) }),
            );
        });
    });

    describe('create() — segment campaigns', () => {
        it('still requires a message', async () => {
            await expect(
                service.create('t1', 'u1', { name: 'X', channel: 'SMS' } as any),
            ).rejects.toThrow(BadRequestException);
        });
    });

    describe('send()', () => {
        it('delegates to the dispatcher', async () => {
            dispatch.queue.mockResolvedValueOnce({ queued: 4 });
            await expect(service.send('t1', 'camp-1')).resolves.toEqual({ queued: 4 });
            expect(dispatch.queue).toHaveBeenCalledWith('t1', 'camp-1');
        });
    });

    describe('cancel()', () => {
        it('cancels a scheduled campaign', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce({ id: 'camp-1', status: 'SCHEDULED' });
            await service.cancel('t1', 'camp-1');
            expect(db.crmCampaign.update).toHaveBeenCalledWith({
                where: { id: 'camp-1' },
                data: { status: 'CANCELLED' },
            });
        });

        it('cancels the pending remainder of a sending campaign and keeps its counts', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce({ id: 'camp-1', status: 'SENDING' });
            db.crmCampaignRecipient.groupBy.mockResolvedValueOnce([
                { status: 'SENT', _count: { _all: 3 } },
                { status: 'FAILED', _count: { _all: 1 } },
            ]);

            await service.cancel('t1', 'camp-1');

            expect(db.crmCampaignRecipient.updateMany).toHaveBeenCalledWith({
                where: { campaign_id: 'camp-1', status: 'PENDING' },
                data: { status: 'CANCELLED' },
            });
            expect(db.crmCampaign.update).toHaveBeenCalledWith({
                where: { id: 'camp-1' },
                data: { status: 'CANCELLED', delivered_count: 3, failed_count: 1 },
            });
        });

        it('refuses to cancel a completed campaign', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce({ id: 'camp-1', status: 'COMPLETED' });
            await expect(service.cancel('t1', 'camp-1')).rejects.toThrow(BadRequestException);
        });
    });

    describe('findOne()', () => {
        it('reports live progress alongside the campaign', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce({ id: 'camp-1', status: 'SENDING' });
            db.crmCampaignRecipient.groupBy.mockResolvedValueOnce([
                { status: 'SENT', _count: { _all: 5 } },
                { status: 'FAILED', _count: { _all: 1 } },
                { status: 'PENDING', _count: { _all: 4 } },
            ]);

            const result = await service.findOne('t1', 'camp-1');

            expect(result.progress).toEqual({ total: 10, sent: 5, failed: 1, pending: 4 });
        });
    });
});
