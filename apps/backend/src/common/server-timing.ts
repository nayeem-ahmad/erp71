import { AsyncLocalStorage } from 'async_hooks';
import { performance } from 'perf_hooks';
import type { NextFunction, Request, Response } from 'express';
import { resolvePlatformRole } from '@erp71/shared-types';
import { isPlatformAdminEmail } from '../auth/platform-admin.util';

/**
 * Where one request's time went, sent back in a `Server-Timing` header so the
 * browser can split a slow page into network and server, and the server part
 * into its phases:
 *
 * - `auth`  — from the request reaching Nest to the guards letting it through
 *             (JWT check, user load, throttling, billing suspension), its own
 *             queries included.
 * - `db`    — wall time with at least one query in flight after that. Queries
 *             run in parallel count once, so this never exceeds `total`.
 * - `app`   — the rest: handler code, serialisation, interceptors.
 * - `total` — the whole request as the server saw it.
 *
 * Everyone gets the durations. Platform staff also get the query counts, in
 * each phase's `desc`: the numbers say nothing about any one tenant's data, but
 * how many queries an endpoint runs is detail only the platform team needs.
 */
export class RequestTiming {
    private readonly startedAt: number;
    private authDoneAt: number | null = null;
    private inflight = 0;
    private busySince = 0;
    private dbBusyMs = 0;
    private dbBeforeAuthMs = 0;
    private queries = 0;
    private queriesBeforeAuth = 0;

    constructor(private readonly now: () => number = () => performance.now()) {
        this.startedAt = now();
    }

    queryStarted(): void {
        if (this.inflight === 0) this.busySince = this.now();
        this.inflight += 1;
        this.queries += 1;
    }

    queryEnded(): void {
        if (this.inflight === 0) return;
        this.inflight -= 1;
        if (this.inflight === 0) this.dbBusyMs += this.now() - this.busySince;
    }

    /** The guards are done. Called by the first interceptor to run; later calls are ignored. */
    markAuthDone(): void {
        if (this.authDoneAt !== null) return;
        this.authDoneAt = this.now();
        this.dbBeforeAuthMs = this.dbMsSoFar(this.authDoneAt);
        this.queriesBeforeAuth = this.queries;
    }

    summary(): TimingSummary {
        const at = this.now();
        const total = at - this.startedAt;
        // Never reached an interceptor: refused by a guard, or no route matched.
        const authEnd = this.authDoneAt ?? at;
        const auth = authEnd - this.startedAt;
        const db = this.authDoneAt === null ? 0 : this.dbMsSoFar(at) - this.dbBeforeAuthMs;
        return {
            authMs: auth,
            dbMs: db,
            appMs: Math.max(0, total - auth - db),
            totalMs: total,
            authQueries: this.authDoneAt === null ? this.queries : this.queriesBeforeAuth,
            dbQueries: this.authDoneAt === null ? 0 : this.queries - this.queriesBeforeAuth,
        };
    }

    private dbMsSoFar(at: number): number {
        return this.dbBusyMs + (this.inflight > 0 ? at - this.busySince : 0);
    }
}

export type TimingSummary = {
    authMs: number;
    dbMs: number;
    appMs: number;
    totalMs: number;
    authQueries: number;
    dbQueries: number;
};

const round = (ms: number) => Math.round(ms * 10) / 10;
const queries = (n: number) => `${n} ${n === 1 ? 'query' : 'queries'}`;

/** The `Server-Timing` header value. `detailed` adds the query counts. */
export function formatServerTiming(summary: TimingSummary, detailed: boolean): string {
    const auth = `auth;dur=${round(summary.authMs)}`;
    const db = `db;dur=${round(summary.dbMs)}`;
    return [
        detailed ? `${auth};desc="${queries(summary.authQueries)}"` : auth,
        detailed ? `${db};desc="${queries(summary.dbQueries)}"` : db,
        `app;dur=${round(summary.appMs)}`,
        `total;dur=${round(summary.totalMs)}`,
    ].join(', ');
}

/** The request's timing, for code that runs inside it (the Prisma hook). */
export const serverTimingContext = new AsyncLocalStorage<RequestTiming>();

export const currentRequestTiming = (): RequestTiming | undefined => serverTimingContext.getStore();

type TimedRequest = Request & { serverTiming?: RequestTiming; user?: any };

/** Whether the signed-in user holds a platform console seat (admin or support engineer). */
export function isPlatformStaff(user: { isPlatformAdmin?: boolean; email?: string; platformRole?: string | null } | undefined): boolean {
    if (!user?.email) return false;
    return resolvePlatformRole({
        isPlatformAdmin: user.isPlatformAdmin === true || isPlatformAdminEmail(user.email),
        platformRole: user.platformRole,
    }) !== null;
}

/**
 * Starts the request's clock and writes `Server-Timing` as the headers go out.
 * Registered with `app.use` after the body parsers: AsyncLocalStorage context
 * set before them does not survive their stream callbacks.
 *
 * The header is set from `writeHead`, which Node calls for every response —
 * explicitly, or implicitly from the first `write`/`end` — so it is the last
 * moment a header can still be added, and by then the guards have set
 * `req.user`.
 */
export function serverTimingMiddleware(req: Request, res: Response, next: NextFunction): void {
    const timing = new RequestTiming();
    (req as TimedRequest).serverTiming = timing;

    const writeHead = res.writeHead;
    res.writeHead = function patchedWriteHead(this: Response, ...args: unknown[]) {
        if (!this.headersSent) {
            try {
                const detailed = isPlatformStaff((req as TimedRequest).user);
                this.setHeader('Server-Timing', formatServerTiming(timing.summary(), detailed));
            } catch {
                // Timing is never worth failing a response over.
            }
        }
        return (writeHead as (...a: unknown[]) => Response).apply(this, args);
    } as typeof res.writeHead;

    serverTimingContext.run(timing, () => next());
}
