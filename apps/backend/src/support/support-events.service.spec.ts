import { firstValueFrom, take, toArray } from 'rxjs';
import {
    SupportEventsService,
    formatSseFrame,
    sseHeartbeat,
    type SupportThreadEvent,
} from './support-events.service';

const base = {
    kind: 'status' as const,
    threadId: 'thr-1',
    ticketNumber: 12,
    status: 'resolved',
    actor: 'admin' as const,
};

describe('SupportEventsService', () => {
    it('delivers an event to a subscriber of that tenant', async () => {
        const events = new SupportEventsService();
        const received = firstValueFrom(events.forTenant('ten-1'));

        events.publish({ ...base, tenantId: 'ten-1' });

        await expect(received).resolves.toMatchObject({
            kind: 'status',
            threadId: 'thr-1',
            ticketNumber: 12,
            status: 'resolved',
        });
    });

    it('stamps the event with a time when the publisher does not', async () => {
        const events = new SupportEventsService();
        const received = firstValueFrom(events.forTenant('ten-1'));

        events.publish({ ...base, tenantId: 'ten-1' });

        const event = await received;
        expect(Number.isNaN(Date.parse(event.at))).toBe(false);
    });

    it('never leaks another tenant’s events', async () => {
        const events = new SupportEventsService();
        const collected = firstValueFrom(
            events.forTenant('ten-1').pipe(take(1), toArray()),
        );

        events.publish({ ...base, tenantId: 'ten-2', threadId: 'other-tenant-thread' });
        events.publish({ ...base, tenantId: 'ten-1' });

        const [event] = await collected;
        expect(event.threadId).toBe('thr-1');
    });

    it('drops events published with nobody listening', () => {
        const events = new SupportEventsService();
        // A shop with no tab open is the normal case, and publishing must not
        // throw or queue anything for whoever connects next.
        expect(() => events.publish({ ...base, tenantId: 'ten-1' })).not.toThrow();
    });

    it('stops delivering once a subscriber unsubscribes', () => {
        const events = new SupportEventsService();
        const seen: SupportThreadEvent[] = [];
        const subscription = events.forTenant('ten-1').subscribe((event) => seen.push(event));

        events.publish({ ...base, tenantId: 'ten-1' });
        subscription.unsubscribe();
        events.publish({ ...base, tenantId: 'ten-1', kind: 'message' });

        expect(seen).toHaveLength(1);
        expect(seen[0].kind).toBe('status');
    });
});

describe('formatSseFrame', () => {
    it('writes an event name, one data line, and the blank line that dispatches it', () => {
        expect(formatSseFrame('status', { threadId: 'thr-1' })).toBe(
            'event: status\ndata: {"threadId":"thr-1"}\n\n',
        );
    });

    it('keeps the payload on one line so a newline in it cannot split the frame', () => {
        const frame = formatSseFrame('message', { body: 'first\nsecond' });
        expect(frame.split('\n').filter((line) => line.startsWith('data:'))).toHaveLength(1);
    });
});

describe('sseHeartbeat', () => {
    it('is a comment frame, which carries no event', () => {
        expect(sseHeartbeat()).toBe(': keep-alive\n\n');
    });
});
