import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { SupportService } from './support.service';

function makeService(opts?: {
    support?: boolean;
    feedback?: boolean;
    storage?: boolean;
}) {
    const features = {
        support: opts?.support ?? true,
        feedback: opts?.feedback ?? true,
    };
    const tx = {
        feedback: {
            create: jest.fn().mockImplementation(({ data }: any) =>
                Promise.resolve({ id: 'fb-1', ...data }),
            ),
        },
        supportThread: {
            // `ticketNumber` comes from a Postgres sequence, so the row that
            // comes back carries one the caller never sent.
            create: jest.fn().mockImplementation(({ data }: any) =>
                Promise.resolve({ id: 'th-1', ticketNumber: 12, ...data }),
            ),
        },
    };
    const db: any = {
        $transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)),
        feedback: {
            findMany: jest.fn().mockResolvedValue([]),
        },
        supportThread: {
            create: jest.fn(),
        },
    };
    const platformSettings: any = {
        getFeaturesForTenant: jest.fn().mockResolvedValue(features),
    };
    const email: any = {
        sendFeedbackNotification: jest.fn().mockResolvedValue(undefined),
    };
    let uploads = 0;
    const assets: any = {
        isEnabled: jest.fn().mockReturnValue(opts?.storage ?? true),
        uploadBuffer: jest.fn().mockImplementation((buffer: Buffer, _folder: string, _name: string) => {
            uploads += 1;
            return Promise.resolve({
                url: `https://cdn.example/${uploads}`,
                publicId: `retail/support/ten-1/${uploads}`,
                bytes: buffer.byteLength,
            });
        }),
        deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SupportService(db, platformSettings, email, assets);
    return { service, db, tx, platformSettings, email, assets };
}

describe('SupportService.createKnock', () => {
    const previousFeedbackEmail = process.env.FEEDBACK_EMAIL;

    beforeEach(() => {
        process.env.FEEDBACK_EMAIL = 'ops@example.com';
    });

    afterAll(() => {
        if (previousFeedbackEmail === undefined) delete process.env.FEEDBACK_EMAIL;
        else process.env.FEEDBACK_EMAIL = previousFeedbackEmail;
    });

    const base = {
        tenantId: 'ten-1',
        userId: 'user-1',
        body: 'The receipt printer is jammed.',
    };

    it('creates a conversation-only thread for support', async () => {
        const { service, tx, email } = makeService();
        const result = await service.createKnock({ ...base, category: 'support' });

        expect(result).toEqual({ id: 'th-1', ticketNumber: 12, feedbackId: null });
        expect(tx.feedback.create).not.toHaveBeenCalled();
        expect(tx.supportThread.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: 'ten-1',
                category: 'support',
                feedbackId: null,
                createdById: 'user-1',
                page: null,
                subject: 'The receipt printer is jammed.',
                messages: {
                    create: {
                        senderId: 'user-1',
                        senderRole: 'owner',
                        body: 'The receipt printer is jammed.',
                    },
                },
            }),
        });
        expect(email.sendFeedbackNotification).not.toHaveBeenCalled();
    });

    it('creates a Feedback row and a thread for a bug', async () => {
        const { service, tx, email } = makeService();
        const result = await service.createKnock({
            ...base,
            category: 'bug',
            page: '/sales/new',
        });

        expect(result).toEqual({ id: 'th-1', ticketNumber: 12, feedbackId: 'fb-1' });
        expect(tx.feedback.create).toHaveBeenCalledWith({
            data: {
                tenantId: 'ten-1',
                userId: 'user-1',
                type: 'bug',
                message: 'The receipt printer is jammed.',
                page: '/sales/new',
            },
        });
        expect(tx.supportThread.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                category: 'bug',
                feedbackId: 'fb-1',
                page: '/sales/new',
                subject: 'Bug on /sales/new',
            }),
        });
        expect(email.sendFeedbackNotification).toHaveBeenCalledWith(
            'ops@example.com',
            'fb-1',
            'bug',
            'The receipt printer is jammed.',
            '/sales/new',
        );
    });

    it('uses an explicit subject when provided', async () => {
        const { service, tx } = makeService();
        await service.createKnock({
            ...base,
            category: 'support',
            subject: 'POS will not open',
        });
        expect(tx.supportThread.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ subject: 'POS will not open' }),
        });
    });

    it('rejects when both flags are off', async () => {
        const { service } = makeService({ support: false, feedback: false });
        await expect(service.createKnock({ ...base, category: 'support' })).rejects.toBeInstanceOf(
            ServiceUnavailableException,
        );
    });

    it('rejects a support knock when only feedback is on', async () => {
        const { service } = makeService({ support: false, feedback: true });
        await expect(service.createKnock({ ...base, category: 'support' })).rejects.toBeInstanceOf(
            ForbiddenException,
        );
    });

    it('rejects a bug knock when only support is on', async () => {
        const { service } = makeService({ support: true, feedback: false });
        await expect(service.createKnock({ ...base, category: 'bug' })).rejects.toBeInstanceOf(
            ForbiddenException,
        );
    });
});

describe('SupportService.createKnock with attachments', () => {
    const base = { tenantId: 'ten-1', userId: 'user-1', category: 'bug' };
    const file = (originalname: string, mimetype: string, size = 4) => ({
        buffer: Buffer.alloc(size, 1),
        originalname,
        mimetype,
        size,
    });

    it('stores each file and attaches it to the first message', async () => {
        const { service, tx, assets } = makeService();
        await service.createKnock({
            ...base,
            body: 'Totals are wrong',
            attachments: [
                file('screen.png', 'image/png'),
                file('voice-note.webm', 'audio/webm;codecs=opus'),
                file('invoice.pdf', 'application/pdf'),
            ],
        });

        expect(assets.uploadBuffer.mock.calls.map((c: any[]) => [c[1], c[3]])).toEqual([
            ['support/ten-1', 'image'],
            ['support/ten-1', 'video'],
            ['support/ten-1', 'raw'],
        ]);
        const message = tx.supportThread.create.mock.calls[0][0].data.messages.create;
        expect(message.body).toBe('Totals are wrong');
        expect(message.attachments.create).toEqual([
            expect.objectContaining({ tenantId: 'ten-1', kind: 'file', mimeType: 'image/png', resourceType: 'image', storageKey: 'retail/support/ten-1/1' }),
            expect.objectContaining({ tenantId: 'ten-1', kind: 'voice', mimeType: 'audio/webm', resourceType: 'video' }),
            expect.objectContaining({ tenantId: 'ten-1', kind: 'file', mimeType: 'application/pdf', resourceType: 'raw' }),
        ]);
    });

    it('accepts a voice note with no written message', async () => {
        const { service, tx } = makeService();
        await service.createKnock({ ...base, body: '  ', attachments: [file('voice-note.webm', 'audio/webm')] });
        expect(tx.supportThread.create.mock.calls[0][0].data.messages.create.body).toBe('(Voice note)');
    });

    it('keeps a short note that came with a file', async () => {
        const { service, tx } = makeService();
        await service.createKnock({ ...base, body: 'ok', attachments: [file('a.png', 'image/png')] });
        expect(tx.supportThread.create.mock.calls[0][0].data.messages.create.body).toBe('ok');
    });

    it('still rejects a ticket with neither words nor files', async () => {
        const { service } = makeService();
        await expect(service.createKnock({ ...base, body: '' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an unsupported type before uploading anything', async () => {
        const { service, assets } = makeService();
        await expect(
            service.createKnock({
                ...base,
                body: 'See attached',
                attachments: [file('a.png', 'image/png'), file('evil.exe', 'application/x-msdownload')],
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(assets.uploadBuffer).not.toHaveBeenCalled();
    });

    it('says attachments are unavailable when storage is not configured', async () => {
        const { service, tx } = makeService({ storage: false });
        await expect(
            service.createKnock({ ...base, body: 'See attached', attachments: [file('a.png', 'image/png')] }),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
        expect(tx.supportThread.create).not.toHaveBeenCalled();
    });

    it('removes the stored files when the thread cannot be saved', async () => {
        const { service, tx, assets } = makeService();
        tx.supportThread.create.mockRejectedValue(new Error('db down'));
        await expect(
            service.createKnock({
                ...base,
                body: 'See attached',
                attachments: [file('a.png', 'image/png'), file('v.m4a', 'audio/mp4')],
            }),
        ).rejects.toThrow('db down');
        expect(assets.deleteFile.mock.calls).toEqual([
            ['retail/support/ten-1/1', 'image'],
            ['retail/support/ten-1/2', 'video'],
        ]);
    });

    it('undoes earlier uploads when a later one fails', async () => {
        const { service, tx, assets } = makeService();
        assets.uploadBuffer
            .mockResolvedValueOnce({ url: 'u1', publicId: 'p1', bytes: 4 })
            .mockRejectedValueOnce(new Error('cloudinary down'));
        await expect(
            service.createKnock({
                ...base,
                body: 'See attached',
                attachments: [file('a.png', 'image/png'), file('b.png', 'image/png')],
            }),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
        expect(assets.deleteFile).toHaveBeenCalledWith('p1', 'image');
        expect(tx.supportThread.create).not.toHaveBeenCalled();
    });
});

describe('SupportService.backfillFeedbackThreads', () => {
    it('creates a thread for each Feedback row that has none', async () => {
        const { service, db } = makeService();
        db.feedback.findMany.mockResolvedValue([
            {
                id: 'fb-old',
                tenantId: 'ten-1',
                userId: 'user-1',
                type: 'feature',
                message: 'Need barcode search',
                page: '/inventory',
                createdAt: new Date('2026-06-01T00:00:00Z'),
            },
        ]);
        db.supportThread.create.mockResolvedValue({ id: 'th-old' });

        const count = await service.backfillFeedbackThreads();

        expect(count).toBe(1);
        expect(db.supportThread.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: 'ten-1',
                category: 'feature',
                feedbackId: 'fb-old',
                createdById: 'user-1',
                page: '/inventory',
                subject: 'Feature on /inventory',
                messages: {
                    create: expect.objectContaining({
                        senderId: 'user-1',
                        senderRole: 'owner',
                        body: 'Need barcode search',
                    }),
                },
            }),
        });
    });

    it('is a no-op when every feedback already has a thread', async () => {
        const { service, db } = makeService();
        db.feedback.findMany.mockResolvedValue([]);
        expect(await service.backfillFeedbackThreads()).toBe(0);
        expect(db.supportThread.create).not.toHaveBeenCalled();
    });
});
