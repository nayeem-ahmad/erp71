import { EventEmitter } from 'events';
import { ServiceUnavailableException } from '@nestjs/common';
import { SupportController } from './support.controller';
import { SupportEventsService } from './support-events.service';

const thread = {
    id: 'thr-1',
    ticketNumber: 12,
    tenantId: 'ten-1',
    subject: 'POS will not print',
    status: 'open',
    category: 'support',
    page: null,
    feedbackId: null,
};

const tenantContext = { tenantId: 'ten-1', userId: 'usr-1', timezone: 'Asia/Dhaka' } as any;

/** Enough of an Express response to see what a stream writes. */
function makeResponse() {
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
        writes: [] as string[],
        headers: undefined as Record<string, string> | undefined,
        ended: false,
        writeHead(_status: number, headers: Record<string, string>) {
            (this as any).headers = headers;
            return this;
        },
        flushHeaders() {},
        write(chunk: string) {
            (this as any).writes.push(chunk);
            return true;
        },
        end() {
            // Node emits `close` once, and ending a finished response again is
            // a no-op — copied here because the handler relies on both.
            if ((this as any).ended) return;
            (this as any).ended = true;
            emitter.emit('close');
        },
    });
}

function makeController(opts?: { inboxEnabled?: boolean }) {
    const db: any = {
        supportThread: {
            findUnique: jest.fn().mockResolvedValue(thread),
            findMany: jest.fn().mockResolvedValue([]),
            update: jest.fn().mockResolvedValue(thread),
        },
        supportMessage: {
            create: jest.fn().mockResolvedValue({ id: 'msg-1' }),
            findMany: jest.fn().mockResolvedValue([]),
        },
    };
    const support: any = {
        assertInboxEnabled: jest.fn().mockImplementation(() => {
            if (opts?.inboxEnabled === false) {
                return Promise.reject(new ServiceUnavailableException('Support is not available'));
            }
            return Promise.resolve({ support: true, feedback: true });
        }),
        createKnock: jest.fn(),
    };
    const events = new SupportEventsService();
    return { controller: new SupportController(db, support, events), db, events };
}

describe('SupportController.stream', () => {
    afterEach(() => jest.useRealTimers());

    it('opens an event stream and says hello', async () => {
        const { controller } = makeController();
        const res = makeResponse();
        const req = new EventEmitter();

        const done = controller.stream(tenantContext, req as any, res as any);
        await Promise.resolve();

        expect(res.headers?.['Content-Type']).toBe('text/event-stream; charset=utf-8');
        expect(res.headers?.['Cache-Control']).toContain('no-transform');
        expect(res.writes[0]).toContain('event: ready');

        req.emit('close');
        await done;
    });

    it('writes this tenant’s thread changes as frames, and nobody else’s', async () => {
        const { controller, events } = makeController();
        const res = makeResponse();
        const req = new EventEmitter();

        const done = controller.stream(tenantContext, req as any, res as any);
        await Promise.resolve();

        events.publish({
            kind: 'status',
            tenantId: 'ten-2',
            threadId: 'someone-else',
            ticketNumber: 99,
            status: 'resolved',
            actor: 'admin',
        });
        events.publish({
            kind: 'status',
            tenantId: 'ten-1',
            threadId: 'thr-1',
            ticketNumber: 12,
            status: 'resolved',
            actor: 'admin',
        });

        const frames = res.writes.filter((chunk) => chunk.startsWith('event: status'));
        expect(frames).toHaveLength(1);
        expect(frames[0]).toContain('"ticketNumber":12');
        expect(frames[0]).not.toContain('someone-else');

        req.emit('close');
        await done;
    });

    it('keeps an idle stream alive with heartbeats, and stops on disconnect', async () => {
        jest.useFakeTimers();
        const { controller, events } = makeController();
        const res = makeResponse();
        const req = new EventEmitter();

        const done = controller.stream(tenantContext, req as any, res as any);
        await Promise.resolve();

        jest.advanceTimersByTime(26_000);
        expect(res.writes.filter((chunk) => chunk.startsWith(': keep-alive'))).toHaveLength(1);

        req.emit('close');
        await done;

        // Nothing more is written for a client that has gone away.
        const after = res.writes.length;
        jest.advanceTimersByTime(60_000);
        events.publish({
            kind: 'message',
            tenantId: 'ten-1',
            threadId: 'thr-1',
            ticketNumber: 12,
            status: 'open',
            actor: 'admin',
        });
        expect(res.writes).toHaveLength(after);
        expect(res.ended).toBe(true);
    });

    it('ends the connection itself rather than letting it outlive the session', async () => {
        jest.useFakeTimers();
        const { controller } = makeController();
        const res = makeResponse();
        const req = new EventEmitter();

        const done = controller.stream(tenantContext, req as any, res as any);
        await Promise.resolve();

        jest.advanceTimersByTime(10 * 60_000);
        await done;

        expect(res.ended).toBe(true);
    });

    it('refuses before writing anything when the inbox feature is off', async () => {
        const { controller } = makeController({ inboxEnabled: false });
        const res = makeResponse();

        await expect(
            controller.stream(tenantContext, new EventEmitter() as any, res as any),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
        expect(res.headers).toBeUndefined();
        expect(res.writes).toEqual([]);
    });
});

describe('SupportController.sendMessage', () => {
    it('publishes the message so the workspace’s other tabs see it', async () => {
        const { controller, events } = makeController();
        const seen: unknown[] = [];
        events.forTenant('ten-1').subscribe((event) => seen.push(event));

        await controller.sendMessage(tenantContext, 'thr-1', { body: 'Still stuck' });

        expect(seen).toEqual([
            expect.objectContaining({
                kind: 'message',
                threadId: 'thr-1',
                ticketNumber: 12,
                actor: 'owner',
            }),
        ]);
    });
});

describe('SupportController.getMessages', () => {
    it('gives the tenant the ticket number', async () => {
        const { controller } = makeController();

        const result = await controller.getMessages(tenantContext, 'thr-1');

        expect(result.thread).toMatchObject({ id: 'thr-1', ticketNumber: 12 });
    });
});
