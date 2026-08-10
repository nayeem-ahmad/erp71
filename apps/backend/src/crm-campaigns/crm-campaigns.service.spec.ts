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
                findMany: jest.fn().mockResolvedValue([]),
            },
            // The upload path runs its three writes in one transaction; the
            // callback is handed the same mock client so the assertions below
            // still see them.
            $transaction: jest.fn((fn: any) => fn(db)),
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
                db,
            );
            expect(db.crmCampaign.update).toHaveBeenCalledWith({
                where: { id: 'camp-1' },
                data: { recipient_count: 1 },
            });
        });

        // I5: three separate writes could leave a DRAFT campaign holding a
        // partial list with recipient_count 0, which then sends to a silently
        // truncated subset.
        it('creates the campaign, its recipients and its count in one transaction', async () => {
            recipients.writeUploadedRecipients.mockResolvedValueOnce(1);

            await service.create('t1', 'u1', uploadDto() as any);

            expect(db.$transaction).toHaveBeenCalledTimes(1);
            expect(recipients.writeUploadedRecipients).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything(),
                expect.anything(),
                expect.anything(),
                db,
            );
        });

        it('lets a mid-write failure escape the transaction so it rolls back', async () => {
            recipients.writeUploadedRecipients.mockRejectedValueOnce(new Error('boom'));

            await expect(service.create('t1', 'u1', uploadDto() as any)).rejects.toThrow('boom');

            expect(db.$transaction).toHaveBeenCalledTimes(1);
            // The count patch is the third write; it must not have run alone.
            expect(db.crmCampaign.update).not.toHaveBeenCalled();
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

    describe('update() — scheduling', () => {
        // M10's server half: the UI now sends an explicit null to unschedule.
        it('unschedules and returns to DRAFT when scheduled_at is null', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce({
                id: 'camp-1',
                status: 'SCHEDULED',
                channel: 'EMAIL',
                recipient_source: 'UPLOAD',
            });

            await service.update('t1', 'camp-1', { scheduled_at: null } as any);

            expect(db.crmCampaign.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'camp-1' },
                    data: expect.objectContaining({ scheduled_at: null, status: 'DRAFT' }),
                }),
            );
        });

        it('schedules a DRAFT campaign given a time', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce({
                id: 'camp-1',
                status: 'DRAFT',
                channel: 'EMAIL',
                recipient_source: 'UPLOAD',
            });

            await service.update('t1', 'camp-1', { scheduled_at: '2026-08-20T09:00:00+06:00' } as any);

            expect(db.crmCampaign.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        scheduled_at: new Date('2026-08-20T09:00:00+06:00'),
                        status: 'SCHEDULED',
                    }),
                }),
            );
        });

        it('leaves the schedule alone when the key is absent', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce({
                id: 'camp-1',
                status: 'SCHEDULED',
                channel: 'EMAIL',
                recipient_source: 'UPLOAD',
            });

            await service.update('t1', 'camp-1', { name: 'Renamed' } as any);

            const data = db.crmCampaign.update.mock.calls[0][0].data;
            expect(data).not.toHaveProperty('scheduled_at');
            expect(data).not.toHaveProperty('status');
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

        // C1: a batch the drain has already claimed sits on SENDING, not
        // PENDING. Cancelling only the PENDING rows left the claimed batch to
        // go out in full — on a campaign of one batch, the entire campaign.
        it('cancels the pending and the already-claimed remainder, and keeps its counts', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce({ id: 'camp-1', status: 'SENDING' });
            db.crmCampaignRecipient.groupBy.mockResolvedValueOnce([
                { status: 'SENT', _count: { _all: 3 } },
                { status: 'FAILED', _count: { _all: 1 } },
            ]);

            await service.cancel('t1', 'camp-1');

            expect(db.crmCampaignRecipient.updateMany).toHaveBeenCalledWith({
                where: { campaign_id: 'camp-1', status: { in: ['PENDING', 'SENDING'] } },
                data: { status: 'CANCELLED' },
            });
            expect(db.crmCampaign.update).toHaveBeenCalledWith({
                where: { id: 'camp-1' },
                data: { status: 'CANCELLED', delivered_count: 3, failed_count: 1 },
            });
        });

        it('flips the rows before the campaign, so the drain sees them already cancelled', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce({ id: 'camp-1', status: 'SENDING' });
            const order: string[] = [];
            db.crmCampaignRecipient.updateMany.mockImplementationOnce(() => {
                order.push('rows');
                return Promise.resolve({ count: 2 });
            });
            db.crmCampaign.update.mockImplementationOnce(() => {
                order.push('campaign');
                return Promise.resolve({});
            });

            await service.cancel('t1', 'camp-1');

            expect(order).toEqual(['rows', 'campaign']);
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

        // M17: `orderBy: { status: 'asc' }` sorted alphabetically, so on a
        // 1,000-row campaign the visible 100 were CANCELLED and every failure
        // was off the end of the page.
        it('leads the recipient page with failures, then in-flight, then sent', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce({ id: 'camp-1', status: 'SENDING' });
            db.crmCampaignRecipient.findMany.mockImplementation(({ where }: any) =>
                Promise.resolve(where.status.in.map((s: string) => ({ id: `${s}-1`, status: s }))),
            );

            const result = await service.findOne('t1', 'camp-1');

            expect(result.recipients.map((r: any) => r.status)).toEqual([
                'FAILED',
                'SENDING',
                'PENDING',
                'SENT',
                'CANCELLED',
            ]);
            expect(db.crmCampaignRecipient.findMany.mock.calls.map(([a]: any[]) => a.where.status.in)).toEqual([
                ['FAILED'],
                ['SENDING', 'PENDING'],
                ['SENT'],
                ['CANCELLED'],
            ]);
        });

        it('stops fetching once the page is full', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce({ id: 'camp-1', status: 'SENDING' });
            db.crmCampaignRecipient.findMany.mockImplementation(({ take }: any) =>
                Promise.resolve(Array.from({ length: take }, (_, i) => ({ id: `r${i}`, status: 'FAILED' }))),
            );

            const result = await service.findOne('t1', 'camp-1');

            expect(result.recipients).toHaveLength(100);
            expect(db.crmCampaignRecipient.findMany).toHaveBeenCalledTimes(1);
        });

        it('scopes the campaign lookup to the tenant', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce({ id: 'camp-1', status: 'DRAFT' });

            await service.findOne('t1', 'camp-1');

            expect(db.crmCampaign.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 'camp-1', tenant_id: 't1' } }),
            );
            expect(db.crmCampaignRecipient.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: expect.objectContaining({ campaign_id: 'camp-1' }) }),
            );
        });
    });
});
