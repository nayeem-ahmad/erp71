import express from 'express';
import request from 'supertest';
import {
    RequestTiming,
    currentRequestTiming,
    formatServerTiming,
    isPlatformStaff,
    serverTimingMiddleware,
} from './server-timing';
import { corsOptions } from './allowed-origins.util';

/** A clock the test moves by hand. */
function fakeClock(start = 1000) {
    let t = start;
    return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('RequestTiming', () => {
    it('splits a request into auth, db and app', () => {
        const clock = fakeClock();
        const timing = new RequestTiming(clock.now);

        clock.advance(5); // JWT check
        timing.queryStarted(); // the user lookup
        clock.advance(3);
        timing.queryEnded();
        timing.markAuthDone();

        clock.advance(2); // handler code
        timing.queryStarted();
        clock.advance(20);
        timing.queryEnded();
        clock.advance(4); // serialisation

        expect(timing.summary()).toEqual({
            authMs: 8,
            dbMs: 20,
            appMs: 6,
            totalMs: 34,
            authQueries: 1,
            dbQueries: 1,
        });
    });

    it('counts parallel queries once, so db never exceeds the request', () => {
        const clock = fakeClock();
        const timing = new RequestTiming(clock.now);
        timing.markAuthDone();

        timing.queryStarted();
        timing.queryStarted();
        timing.queryStarted();
        clock.advance(10);
        timing.queryEnded();
        clock.advance(5);
        timing.queryEnded();
        timing.queryEnded();

        const summary = timing.summary();
        expect(summary.dbMs).toBe(15);
        expect(summary.dbQueries).toBe(3);
        expect(summary.appMs).toBe(0);
    });

    it('splits a query running across the end of the guards between the two phases', () => {
        const clock = fakeClock();
        const timing = new RequestTiming(clock.now);
        timing.queryStarted();
        clock.advance(4);
        timing.markAuthDone();
        clock.advance(6);
        timing.queryEnded();

        const summary = timing.summary();
        expect(summary.authMs).toBe(4);
        expect(summary.dbMs).toBe(6);
        expect(summary.totalMs).toBe(10);
    });

    it('files a request a guard refused entirely under auth', () => {
        const clock = fakeClock();
        const timing = new RequestTiming(clock.now);
        timing.queryStarted();
        clock.advance(7);
        timing.queryEnded();

        expect(timing.summary()).toMatchObject({ authMs: 7, dbMs: 0, appMs: 0, totalMs: 7, authQueries: 1 });
    });

    it('keeps the first end-of-guards mark', () => {
        const clock = fakeClock();
        const timing = new RequestTiming(clock.now);
        clock.advance(3);
        timing.markAuthDone();
        clock.advance(10);
        timing.markAuthDone();

        expect(timing.summary().authMs).toBe(3);
    });

    it('ignores a stray query end', () => {
        const timing = new RequestTiming(fakeClock().now);
        timing.queryEnded();
        expect(timing.summary().dbMs).toBe(0);
    });
});

describe('formatServerTiming', () => {
    const summary = { authMs: 8.04, dbMs: 20.26, appMs: 6, totalMs: 34.3, authQueries: 1, dbQueries: 9 };

    it('gives everyone the durations', () => {
        expect(formatServerTiming(summary, false)).toBe('auth;dur=8, db;dur=20.3, app;dur=6, total;dur=34.3');
    });

    it('adds the query counts for platform staff', () => {
        expect(formatServerTiming(summary, true)).toBe(
            'auth;dur=8;desc="1 query", db;dur=20.3;desc="9 queries", app;dur=6, total;dur=34.3',
        );
    });
});

describe('isPlatformStaff', () => {
    it('is true for admins and support engineers only', () => {
        expect(isPlatformStaff({ email: 'a@x.com', isPlatformAdmin: true })).toBe(true);
        expect(isPlatformStaff({ email: 'a@x.com', platformRole: 'SUPPORT_ENGINEER' })).toBe(true);
        expect(isPlatformStaff({ email: 'a@x.com', isPlatformAdmin: false, platformRole: null })).toBe(false);
        expect(isPlatformStaff(undefined)).toBe(false);
    });
});

describe('serverTimingMiddleware', () => {
    function app(user?: object) {
        const server = express();
        server.use(serverTimingMiddleware);
        server.use((req, _res, next) => {
            if (user) (req as any).user = user;
            next();
        });
        server.get('/ok', async (_req, res) => {
            // A query issued later in the request still finds the request's timing.
            await new Promise((resolve) => setTimeout(resolve, 1));
            const timing = currentRequestTiming();
            timing?.markAuthDone();
            timing?.queryStarted();
            timing?.queryEnded();
            res.json({ found: Boolean(timing) });
        });
        server.get('/stream', (_req, res) => {
            res.write('partial');
            res.end();
        });
        return server;
    }

    it('sends the split on a JSON response, without counts for a tenant user', async () => {
        const res = await request(app({ email: 'cashier@shop.com' })).get('/ok');

        expect(res.body).toEqual({ found: true });
        expect(res.headers['server-timing']).toMatch(/^auth;dur=[\d.]+, db;dur=[\d.]+, app;dur=[\d.]+, total;dur=[\d.]+$/);
    });

    it('adds the query counts for a platform admin', async () => {
        const res = await request(app({ email: 'ops@erp71.com', isPlatformAdmin: true })).get('/ok');

        expect(res.headers['server-timing']).toContain('db;dur=');
        expect(res.headers['server-timing']).toContain('desc="1 query"');
    });

    it('sets the header on a response written without an explicit writeHead', async () => {
        const res = await request(app()).get('/stream');

        expect(res.text).toBe('partial');
        expect(res.headers['server-timing']).toContain('total;dur=');
    });

    it('is a header the browser may read across origins', () => {
        expect(corsOptions(['https://app.erp71.com']).exposedHeaders).toContain('Server-Timing');
    });
});
