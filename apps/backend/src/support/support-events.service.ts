import { Injectable } from '@nestjs/common';
import { Observable, Subject, filter } from 'rxjs';

/**
 * What moved in a support thread.
 *
 * `status` is the one the request asked for: a thread resolved or reopened from
 * Admin › Inbox. `message` is a reply from either side — the shop owner's own
 * other tabs care about it too, which is why the owner's messages are published
 * as well as the admin's.
 */
export type SupportEventKind = 'status' | 'message';

export interface SupportThreadEvent {
    kind: SupportEventKind;
    tenantId: string;
    threadId: string;
    /** The number the ticket is known by on both sides. */
    ticketNumber: number;
    /** The thread's status *after* whatever happened. */
    status: string;
    /** Who caused it, so a client can ignore the echo of its own write. */
    actor: 'owner' | 'admin';
    at: string;
}

/**
 * The nudge that makes the tenant's Support screen live.
 *
 * Deliberately only a nudge: a subscriber is told *that* a thread moved and
 * re-reads it over the ordinary authenticated endpoints. Nothing downstream
 * treats the event as the source of truth, so a dropped or duplicated one costs
 * a redundant fetch rather than a wrong screen — which is what lets the
 * frontend keep a slow poll as a safety net without having to reconcile two
 * versions of the same thread.
 *
 * In-process, and that is a real limit: an event published by one backend
 * process only reaches clients streaming from that same process. Production
 * runs a single backend container (`docker-compose.prod.yml`), so today every
 * publisher and subscriber share one bus. Running more than one replica would
 * need this backed by Postgres `LISTEN/NOTIFY` or Redis pub/sub — until then
 * the frontend's fallback poll is what keeps a second replica merely slower
 * rather than broken.
 */
@Injectable()
export class SupportEventsService {
    private readonly events = new Subject<SupportThreadEvent>();

    publish(event: Omit<SupportThreadEvent, 'at'> & { at?: string }): void {
        this.events.next({ ...event, at: event.at ?? new Date().toISOString() });
    }

    /** Every event for one workspace. Never completes — the caller unsubscribes. */
    forTenant(tenantId: string): Observable<SupportThreadEvent> {
        return this.events.asObservable().pipe(filter((event) => event.tenantId === tenantId));
    }
}

/**
 * One `text/event-stream` frame.
 *
 * Named so the client can listen per kind, and JSON-encoded on a single line
 * because a raw newline inside `data:` would start a second field. A frame ends
 * with the blank line that tells the browser to dispatch it.
 */
export function formatSseFrame(kind: string, payload: unknown): string {
    return `event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`;
}

/** A comment frame. Keeps idle connections alive through proxy read timeouts. */
export function sseHeartbeat(): string {
    return ': keep-alive\n\n';
}
