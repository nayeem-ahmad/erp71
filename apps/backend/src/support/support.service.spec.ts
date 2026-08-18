import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { SupportService } from './support.service';

function makeService(opts?: {
    support?: boolean;
    feedback?: boolean;
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
            create: jest.fn().mockImplementation(({ data }: any) =>
                Promise.resolve({ id: 'th-1', ...data }),
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
    const service = new SupportService(db, platformSettings, email);
    return { service, db, tx, platformSettings, email };
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

        expect(result).toEqual({ id: 'th-1', feedbackId: null });
        expect(tx.feedback.create).not.toHaveBeenCalled();
        expect(tx.supportThread.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: 'ten-1',
                category: 'support',
                feedbackId: null,
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

        expect(result).toEqual({ id: 'th-1', feedbackId: 'fb-1' });
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
