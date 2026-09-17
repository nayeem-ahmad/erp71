import { NotFoundException } from '@nestjs/common';
import { AdminSupportController } from './admin-support.controller';
import { SupportEventsService, type SupportThreadEvent } from './support-events.service';

const thread = {
    id: 'thr-1',
    ticketNumber: 12,
    tenantId: 'ten-1',
    subject: 'POS will not print',
    status: 'open',
    category: 'support',
};

function makeController(overrides?: { thread?: Partial<typeof thread> | null }) {
    const current = overrides?.thread === null ? null : { ...thread, ...overrides?.thread };
    const db: any = {
        supportThread: {
            findUnique: jest.fn().mockResolvedValue(current),
            findMany: jest.fn().mockResolvedValue([]),
            count: jest.fn().mockResolvedValue(0),
            update: jest.fn().mockImplementation(({ where, data }: any) =>
                Promise.resolve({ ...current, ...data, id: where.id }),
            ),
        },
        supportMessage: {
            create: jest.fn().mockResolvedValue({ id: 'msg-1' }),
            findMany: jest.fn().mockResolvedValue([]),
        },
    };
    const events = new SupportEventsService();
    const published: SupportThreadEvent[] = [];
    events.forTenant('ten-1').subscribe((event) => published.push(event));
    return { controller: new AdminSupportController(db, events), db, published };
}

describe('AdminSupportController.updateThread', () => {
    it('tells the tenant when a thread is resolved', async () => {
        const { controller, published } = makeController();

        await controller.updateThread('thr-1', { status: 'resolved' });

        expect(published).toEqual([
            expect.objectContaining({
                kind: 'status',
                tenantId: 'ten-1',
                threadId: 'thr-1',
                ticketNumber: 12,
                status: 'resolved',
                actor: 'admin',
            }),
        ]);
    });

    it('tells the tenant when a thread is reopened', async () => {
        const { controller, published } = makeController({ thread: { status: 'resolved' } });

        await controller.updateThread('thr-1', { status: 'open' });

        expect(published).toEqual([expect.objectContaining({ kind: 'status', status: 'open' })]);
    });

    it('says nothing when the status did not actually change', async () => {
        const { controller, published } = makeController();

        await controller.updateThread('thr-1', { status: 'open' });

        expect(published).toEqual([]);
    });

    it('404s an unknown thread without publishing', async () => {
        const { controller, published } = makeController({ thread: null });

        await expect(controller.updateThread('nope', { status: 'resolved' })).rejects.toBeInstanceOf(
            NotFoundException,
        );
        expect(published).toEqual([]);
    });
});

describe('AdminSupportController.sendMessage', () => {
    it('publishes the reply, and the reopen that comes with it', async () => {
        const { controller, published } = makeController({ thread: { status: 'resolved' } });

        await controller.sendMessage('thr-1', { body: 'Try a reboot' }, { user: { userId: 'admin-1' } });

        expect(published).toEqual([
            expect.objectContaining({
                kind: 'message',
                threadId: 'thr-1',
                ticketNumber: 12,
                // The endpoint forces the thread back open, so the event has to
                // carry the status the tenant will now see, not the old one.
                status: 'open',
                actor: 'admin',
            }),
        ]);
    });
});

describe('AdminSupportController.listThreads', () => {
    it('looks a ticket number up by number as well as by subject', async () => {
        const { controller, db } = makeController();

        await controller.listThreads(undefined, '#12');

        expect(db.supportThread.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    OR: [{ ticketNumber: 12 }, { subject: { contains: '#12', mode: 'insensitive' } }],
                }),
            }),
        );
    });

    it('searches subjects only when the query is not a number', async () => {
        const { controller, db } = makeController();

        await controller.listThreads(undefined, 'printer');

        expect(db.supportThread.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    OR: [{ subject: { contains: 'printer', mode: 'insensitive' } }],
                }),
            }),
        );
    });
});
