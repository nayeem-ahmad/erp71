import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
    CampaignDispatchService,
    CAMPAIGN_BATCH_SIZE,
    STALE_CLAIM_MS,
    CLAIM_HEARTBEAT_MS,
} from './campaign-dispatch.service';
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
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
                { provide: AppLogger, useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } },
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

            expect(recipients.writeSegmentRecipients).toHaveBeenCalledWith(
                't1',
                'camp-1',
                'ALL',
                null,
                'EMAIL',
            );
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

        /**
         * Stands in for the recipient queue. The drain now reads twice — the
         * PENDING queue, then back the rows it actually claimed — so the mock
         * answers on the shape of the `where` rather than on call order.
         */
        const queueRows = (
            rows: any[],
            opts: { claimed?: any[]; heartbeatHeld?: boolean } = {},
        ) => {
            const claimedRows = opts.claimed ?? rows;
            const heartbeatHeld = opts.heartbeatHeld ?? true;
            db.crmCampaignRecipient.findMany.mockImplementation(({ where }: any) =>
                Promise.resolve(where.status === 'PENDING' ? rows.map((r) => ({ id: r.id })) : claimedRows),
            );
            db.crmCampaignRecipient.updateMany.mockImplementation(({ where, data }: any) => {
                if (data.status === 'SENDING') return Promise.resolve({ count: claimedRows.length });
                // The stale sweep: back to PENDING, claim cleared.
                if (data.status === 'PENDING') return Promise.resolve({ count: 0 });
                // The heartbeat: claimed_at alone, no status change.
                if (data.claimed_at !== undefined) {
                    return Promise.resolve({ count: heartbeatHeld ? where.id.in.length : 0 });
                }
                // A terminal SENT/FAILED write for one row.
                return Promise.resolve({ count: 1 });
            });
        };

        /** All heartbeat calls, in order — claimed_at refreshed, status untouched. */
        const heartbeats = () =>
            db.crmCampaignRecipient.updateMany.mock.calls
                .map(([arg]: any[]) => arg)
                .filter((arg: any) => arg.data.claimed_at !== undefined && !arg.data.status);

        /** Makes every send outrun the heartbeat interval. */
        const sendsSlowerThanTheHeartbeat = () =>
            email.sendCustom.mockImplementation(() => {
                jest.setSystemTime(Date.now() + CLAIM_HEARTBEAT_MS + 1_000);
                return Promise.resolve(undefined);
            });

        it('claims a batch before sending so an overlapping pass cannot double-send', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
            queueRows([pending('r1'), pending('r2')]);

            await service.drainCampaign('camp-1');

            expect(db.crmCampaignRecipient.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { campaign_id: 'camp-1', status: 'PENDING' },
                    orderBy: { id: 'asc' },
                    take: CAMPAIGN_BATCH_SIZE,
                }),
            );
            expect(db.crmCampaignRecipient.updateMany).toHaveBeenCalledWith({
                where: { id: { in: ['r1', 'r2'] }, status: 'PENDING' },
                data: { status: 'SENDING', claimed_at: expect.any(Date) },
            });
            expect(email.sendCustom).toHaveBeenCalledTimes(2);
        });

        it('reads the batch in a deterministic order so racing passes claim all-or-nothing', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
            queueRows([]);

            await service.drainCampaign('camp-1');

            expect(db.crmCampaignRecipient.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ orderBy: { id: 'asc' } }),
            );
        });

        it('sends nothing when another pass already claimed the batch', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
            queueRows([pending('r1')], { claimed: [] });

            await service.drainCampaign('camp-1');

            expect(email.sendCustom).not.toHaveBeenCalled();
        });

        // I6: the loop must iterate what it claimed, not what it read. A
        // partial claim is unreachable today only because every reader shares a
        // where/orderBy/take; iterating the read set would email r2 anyway.
        it('sends only the rows it actually claimed, not the rows it read', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
            queueRows([pending('r1'), pending('r2')], { claimed: [pending('r1')] });

            await service.drainCampaign('camp-1');

            expect(db.crmCampaignRecipient.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        id: { in: ['r1', 'r2'] },
                        status: 'SENDING',
                        claimed_at: expect.any(Date),
                    },
                }),
            );
            expect(email.sendCustom).toHaveBeenCalledTimes(1);
            expect(email.sendCustom).toHaveBeenCalledWith(
                'r1@example.com',
                expect.anything(),
                expect.anything(),
                expect.anything(),
            );
        });

        it('sends the row subject and the rendered row message', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
            queueRows([pending('r1', { message: 'Line 1\nLine <2>' })]);

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
            queueRows([pending('r1', { subject: null, message: null })]);

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
            queueRows([pending('r1')]);
            email.sendCustom.mockRejectedValueOnce(new Error('SMTP down'));

            await service.drainCampaign('camp-1');

            expect(db.crmCampaignRecipient.updateMany).toHaveBeenCalledWith({
                where: { id: 'r1', status: 'SENDING', claimed_at: expect.any(Date) },
                data: { status: 'FAILED', error: 'Error: SMTP down' },
            });
        });

        it('fails a row with no email rather than sending nowhere', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
            queueRows([pending('r1', { email: null })]);

            await service.drainCampaign('camp-1');

            expect(email.sendCustom).not.toHaveBeenCalled();
            expect(db.crmCampaignRecipient.updateMany).toHaveBeenCalledWith({
                where: { id: 'r1', status: 'SENDING', claimed_at: expect.any(Date) },
                data: { status: 'FAILED', error: 'Error: Recipient has no email address' },
            });
        });

        it('completes the campaign with its counts once nothing is pending', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
            queueRows([]);
            db.crmCampaignRecipient.groupBy.mockResolvedValueOnce([
                { status: 'SENT', _count: { _all: 7 } },
                { status: 'FAILED', _count: { _all: 2 } },
            ]);

            await service.drainCampaign('camp-1');

            expect(db.crmCampaign.updateMany).toHaveBeenCalledWith({
                where: { id: 'camp-1', status: 'SENDING' },
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
            queueRows([pending('r1')]);
            db.crmCampaignRecipient.groupBy.mockResolvedValueOnce([{ status: 'SENT', _count: { _all: 1 } }]);

            await service.drainCampaign('camp-1');

            expect(db.crmCampaign.updateMany).toHaveBeenCalledWith({
                where: { id: 'camp-1', status: 'SENDING' },
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
            queueRows(full);

            await service.drainCampaign('camp-1');

            expect(db.crmCampaign.updateMany).not.toHaveBeenCalled();
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
            queueRows([pending('r1', { subject: null, message: null })]);

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
            queueRows([pending('r1', { subject: null, message: null })]);
            sms.sendSms.mockResolvedValueOnce({ sent: false });

            await service.drainCampaign('camp-1');

            expect(db.crmCampaignRecipient.updateMany).toHaveBeenCalledWith({
                where: { id: 'r1', status: 'SENDING', claimed_at: expect.any(Date) },
                data: { status: 'FAILED', error: 'Error: Insufficient SMS credits' },
            });
        });

        // C1: "Send, then Cancel" on a campaign that fits in one batch used to
        // send the lot, because the loop never re-read the campaign's status.
        describe('cancelling mid-batch', () => {
            it('stops the loop as soon as the campaign leaves SENDING', async () => {
                db.crmCampaign.findFirst
                    .mockResolvedValueOnce(emailCampaign()) // opening read
                    .mockResolvedValueOnce({ status: 'SENDING' }) // r1 goes out
                    .mockResolvedValue({ status: 'CANCELLED' }); // cancel lands
                queueRows([pending('r1'), pending('r2'), pending('r3')]);

                await service.drainCampaign('camp-1');

                expect(email.sendCustom).toHaveBeenCalledTimes(1);
                expect(email.sendCustom).toHaveBeenCalledWith(
                    'r1@example.com',
                    expect.anything(),
                    expect.anything(),
                    expect.anything(),
                );
            });

            it('does not record the cancelled campaign as COMPLETED', async () => {
                db.crmCampaign.findFirst
                    .mockResolvedValueOnce(emailCampaign())
                    .mockResolvedValue({ status: 'CANCELLED' });
                queueRows([pending('r1')]);

                await service.drainCampaign('camp-1');

                expect(email.sendCustom).not.toHaveBeenCalled();
                expect(db.crmCampaign.updateMany).not.toHaveBeenCalled();
                expect(db.crmCampaign.update).not.toHaveBeenCalled();
            });

            it('guards completion on SENDING so a cancel that raced it stands', async () => {
                db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
                queueRows([]);
                db.crmCampaign.updateMany.mockResolvedValueOnce({ count: 0 });

                await service.drainCampaign('camp-1');

                expect(db.crmCampaign.updateMany).toHaveBeenCalledWith(
                    expect.objectContaining({ where: { id: 'camp-1', status: 'SENDING' } }),
                );
            });
        });

        // I2: a crash or redeploy between the claim and the send used to orphan
        // up to a full batch in SENDING forever — counted as neither delivered
        // nor failed, with the campaign quietly marked COMPLETED.
        describe('recovering orphaned claims', () => {
            it('re-queues rows claimed longer ago than the stale threshold', async () => {
                db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
                queueRows([]);

                await service.drainCampaign('camp-1');

                const call = db.crmCampaignRecipient.updateMany.mock.calls.find(
                    ([arg]: any[]) => arg.data.status === 'PENDING',
                );
                expect(call).toBeDefined();
                expect(call[0]).toEqual({
                    where: {
                        campaign_id: 'camp-1',
                        status: 'SENDING',
                        OR: [{ claimed_at: null }, { claimed_at: { lt: expect.any(Date) } }],
                    },
                    data: { status: 'PENDING', claimed_at: null },
                });
                const cutoff: Date = call[0].where.OR[1].claimed_at.lt;
                expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(STALE_CLAIM_MS);
            });

            it('recovers before reading the queue, so recovered rows are sent this pass', async () => {
                db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
                const order: string[] = [];
                db.crmCampaignRecipient.updateMany.mockImplementation(({ data }: any) => {
                    order.push(`updateMany:${data.status}`);
                    return Promise.resolve({ count: 0 });
                });
                db.crmCampaignRecipient.findMany.mockImplementation(() => {
                    order.push('findMany');
                    return Promise.resolve([]);
                });

                await service.drainCampaign('camp-1');

                expect(order[0]).toBe('updateMany:PENDING');
                expect(order[1]).toBe('findMany');
            });

            // The sweep only knows "SENDING and old". Without a heartbeat it
            // cannot tell a dead pass from a slow one, so a batch that outran
            // STALE_CLAIM_MS would be reclaimed and re-sent by a concurrent
            // pass while this loop, holding the rows in memory, sent them
            // again. One batch over 15 minutes is ~4.5s/recipient across 200,
            // which a handful of timing-out SMTP sockets reaches on its own.
            describe('while a slow batch is in flight', () => {
                beforeEach(() => {
                    jest.useFakeTimers();
                    jest.setSystemTime(new Date('2026-08-10T00:00:00.000Z'));
                });
                afterEach(() => jest.useRealTimers());

                it('renews the claim on the unsent tail so a live pass is never swept', async () => {
                    db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
                    queueRows([pending('r1'), pending('r2'), pending('r3')]);
                    sendsSlowerThanTheHeartbeat();

                    await service.drainCampaign('camp-1');

                    const claim = db.crmCampaignRecipient.updateMany.mock.calls
                        .map(([arg]: any[]) => arg)
                        .find((arg: any) => arg.data.status === 'SENDING');
                    const beats = heartbeats();

                    expect(email.sendCustom).toHaveBeenCalledTimes(3);
                    // First beat fires before r2 and covers only what is unsent,
                    // matched on the stamp the claim wrote.
                    expect(beats[0].where.id.in).toEqual(['r2', 'r3']);
                    expect(beats[0].where.status).toBe('SENDING');
                    expect(beats[0].where.claimed_at).toEqual(claim.data.claimed_at);
                    // The second beat chains off the first, not off the claim.
                    expect(beats[1].where.id.in).toEqual(['r3']);
                    expect(beats[1].where.claimed_at).toEqual(beats[0].data.claimed_at);
                });

                it('stops rather than re-sending when a sweep has already reclaimed the batch', async () => {
                    db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
                    queueRows([pending('r1'), pending('r2'), pending('r3')], {
                        heartbeatHeld: false,
                    });
                    sendsSlowerThanTheHeartbeat();

                    await service.drainCampaign('camp-1');

                    // r1 went out before the claim lapsed; r2 and r3 belong to
                    // whoever swept them and must not be sent from here too.
                    expect(email.sendCustom).toHaveBeenCalledTimes(1);
                    expect(email.sendCustom).toHaveBeenCalledWith(
                        'r1@example.com',
                        expect.anything(),
                        expect.anything(),
                        expect.anything(),
                    );
                    expect(db.crmCampaign.updateMany).not.toHaveBeenCalled();
                });
            });

            it('writes SENT only while it still holds the claim', async () => {
                db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
                queueRows([pending('r1')]);

                await service.drainCampaign('camp-1');

                expect(db.crmCampaignRecipient.updateMany).toHaveBeenCalledWith({
                    where: { id: 'r1', status: 'SENDING', claimed_at: expect.any(Date) },
                    data: { status: 'SENT', sent_at: expect.any(Date) },
                });
            });

            it('does not overwrite a row another pass reclaimed mid-send', async () => {
                db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
                queueRows([pending('r1')]);
                // The claim-scoped SENT write matches nothing: the row moved on.
                db.crmCampaignRecipient.updateMany.mockImplementation(({ data }: any) =>
                    Promise.resolve({ count: data.status === 'SENDING' ? 1 : 0 }),
                );

                await expect(service.drainCampaign('camp-1')).resolves.toBeUndefined();

                const sent = db.crmCampaignRecipient.updateMany.mock.calls
                    .map(([arg]: any[]) => arg)
                    .find((arg: any) => arg.data.status === 'SENT');
                expect(sent.where).toEqual({
                    id: 'r1',
                    status: 'SENDING',
                    claimed_at: expect.any(Date),
                });
            });

            it('refuses to complete while any row is still pending or claimed', async () => {
                db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
                queueRows([]);
                db.crmCampaignRecipient.count.mockResolvedValueOnce(4);

                await service.drainCampaign('camp-1');

                expect(db.crmCampaignRecipient.count).toHaveBeenCalledWith({
                    where: { campaign_id: 'camp-1', status: { in: ['PENDING', 'SENDING'] } },
                });
                expect(db.crmCampaign.updateMany).not.toHaveBeenCalled();
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
