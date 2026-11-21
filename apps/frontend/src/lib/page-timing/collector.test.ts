import {
    MAX_VIEW_MS,
    PageTimingCollector,
    QUIET_MS,
    type CollectorDeps,
    type PageTimingSample,
} from './collector';

/**
 * A collector on a hand-driven clock: `advance` moves time and fires whatever
 * timers fall due, `paint` runs the pending after-paint callbacks.
 */
function harness(options: { navigation?: Partial<PerformanceNavigationTiming>; path?: string; hidden?: boolean } = {}) {
    let now = 0;
    let routeLoading = false;
    let path = options.path ?? '/dashboard';
    let timers: { at: number; fn: () => void; id: number }[] = [];
    let paints: (() => void)[] = [];
    let nextId = 1;
    const deps: CollectorDeps = {
        now: () => now,
        afterPaint: (fn) => {
            paints.push(fn);
        },
        setTimer: (fn, ms) => {
            const id = nextId++;
            timers.push({ at: now + ms, fn, id });
            return id as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimer: (id) => {
            timers = timers.filter((timer) => timer.id !== (id as unknown as number));
        },
        navigationEntry: () => options.navigation as PerformanceNavigationTiming | undefined,
        currentPath: () => path,
        isHidden: () => options.hidden ?? false,
        isRouteLoading: () => routeLoading,
    };
    const collector = new PageTimingCollector(deps);
    const reported: PageTimingSample[] = [];
    collector.setReporter((sample) => reported.push(sample));

    const advance = (ms: number) => {
        const until = now + ms;
        for (;;) {
            const due = timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at)[0];
            if (!due) break;
            now = due.at;
            timers = timers.filter((timer) => timer !== due);
            due.fn();
        }
        now = until;
    };
    const paint = (after = 0) => {
        advance(after);
        const pending = paints;
        paints = [];
        pending.forEach((fn) => fn());
    };
    /** Paint, then sit quiet long enough for the view to end. */
    const settle = (paintAfter = 0) => {
        paint(paintAfter);
        advance(QUIET_MS);
    };
    return {
        collector,
        reported,
        advance,
        paint,
        settle,
        setPath: (next: string) => {
            path = next;
        },
        setRouteLoading: (value: boolean) => {
            routeLoading = value;
        },
        last: () => collector.getSnapshot().history[0],
    };
}

const navigation = {
    domainLookupStart: 5,
    domainLookupEnd: 15,
    connectStart: 15,
    connectEnd: 60,
    requestStart: 60,
    responseStart: 180,
    responseEnd: 200,
};

describe('PageTimingCollector', () => {
    it('splits a full load into document, boot, data and render', () => {
        const h = harness({ navigation });
        h.collector.startInitialLoad('/dashboard');

        h.advance(400); // JS, hydration, first render
        const me = h.collector.apiCallStarted('GET', '/auth/me')!;
        me.sent();
        h.advance(100);
        me.headers(200, 'auth;dur=5, db;dur=20, app;dur=10, total;dur=35');
        h.advance(10);
        h.collector.routeCommitted('/dashboard');
        me.finish(); // at 510
        h.settle(40); // painted at 550

        const view = h.last();
        expect(view.document).toEqual({ dnsMs: 10, connectMs: 45, waitMs: 120, downloadMs: 20, totalMs: 200 });
        expect(view.phases).toMatchObject({
            totalMs: 550,
            documentMs: 200,
            bootMs: 200,
            dataMs: 110,
            renderMs: 40,
            apiCalls: 1,
            serverMs: 35,
            dbMs: 20,
            networkMs: 75,
            slowest: { label: 'GET /auth/me', ms: 110 },
        });
        expect(h.reported).toEqual([
            expect.objectContaining({ route: '/dashboard', nav_type: 'load', total_ms: 550, document_ms: 200, boot_ms: 200 }),
        ]);
    });

    it('times a route change from the transition start, with ids taken out of the route', () => {
        const h = harness();
        h.collector.startInitialLoad('/dashboard');
        h.collector.routeCommitted('/dashboard');
        h.settle();

        h.advance(1000);
        h.collector.navigationStarted('/sales/3f2c9a1e-0000-4000-8000-000000000001?tab=items');
        h.advance(60);
        h.setPath('/sales/3f2c9a1e-0000-4000-8000-000000000001');
        h.collector.routeCommitted('/sales/3f2c9a1e-0000-4000-8000-000000000001');
        const sale = h.collector.apiCallStarted('GET', '/sales/3f2c9a1e-0000-4000-8000-000000000001?include=lines')!;
        const lines = h.collector.apiCallStarted('GET', '/customers/123')!;
        h.advance(200);
        lines.finish();
        h.advance(100);
        sale.finish();
        h.settle(30);

        expect(h.last().navType).toBe('navigate');
        expect(h.last().phases).toMatchObject({ totalMs: 390, documentMs: null, bootMs: 60, dataMs: 300, renderMs: 30, apiCalls: 2 });
        expect(h.reported[1]).toMatchObject({
            route: '/sales/:id',
            nav_type: 'navigate',
            slowest_endpoint: 'GET /sales/:id',
            slowest_ms: 300,
        });
        expect(h.reported[1]).not.toHaveProperty('document_ms');
    });

    it('waits for a call that starts during the quiet window', () => {
        const h = harness();
        h.collector.startInitialLoad('/dashboard');
        h.collector.routeCommitted('/dashboard');
        h.paint();
        h.advance(QUIET_MS - 50);
        const late = h.collector.apiCallStarted('GET', '/kpis')!;
        h.advance(500);
        expect(h.last()).toBeUndefined();

        late.finish();
        h.settle();
        expect(h.last().phases?.apiCalls).toBe(1);
    });

    it('keeps waiting while the route loading skeleton is up, then times the page behind it', () => {
        const h = harness();
        h.collector.startInitialLoad('/dashboard');
        h.collector.routeCommitted('/dashboard');
        h.settle();

        // Next shows `loading.tsx` and commits the path at once; the page's
        // own code takes a while, and only then does it ask for its data.
        h.collector.navigationStarted('/sales/customers');
        h.setPath('/sales/customers');
        h.setRouteLoading(true);
        h.collector.routeCommitted('/sales/customers');
        h.paint(20);
        h.advance(900);
        h.paint();
        expect(h.collector.getSnapshot().current).not.toBeNull();

        h.setRouteLoading(false);
        const list = h.collector.apiCallStarted('GET', '/customers?page=1')!;
        h.advance(200);
        list.finish();
        h.settle(40);

        expect(h.reported[1]).toMatchObject({ route: '/sales/customers', api_calls: 1, boot_ms: 920, data_ms: 200, render_ms: 40 });
    });

    it('keeps a redirect on the way in as part of the full load', () => {
        const h = harness();
        h.collector.startInitialLoad('/app-entry');
        h.advance(100);
        h.collector.navigationStarted('/dashboard');
        h.setPath('/dashboard');
        h.collector.routeCommitted('/dashboard');
        h.settle();

        expect(h.reported).toHaveLength(1);
        expect(h.reported[0]).toMatchObject({ nav_type: 'load', route: '/dashboard' });
    });

    it('starts a new view when the user navigates away mid-load, dropping the unfinished one', () => {
        const h = harness();
        h.collector.startInitialLoad('/dashboard');
        h.collector.routeCommitted('/dashboard');
        h.collector.apiCallStarted('GET', '/slow');
        h.collector.noteInteraction();
        h.advance(500);
        h.collector.navigationStarted('/customers');
        h.setPath('/customers');
        h.collector.routeCommitted('/customers');
        h.settle();

        expect(h.reported).toEqual([expect.objectContaining({ route: '/customers', nav_type: 'navigate' })]);
    });

    it('commits straight away when only the query string changes', () => {
        const h = harness({ path: '/sales' });
        h.collector.startInitialLoad('/sales');
        h.collector.routeCommitted('/sales');
        h.settle();

        h.collector.navigationStarted('/sales?page=2');
        const page = h.collector.apiCallStarted('GET', '/sales?page=2')!;
        h.advance(80);
        page.finish();
        h.settle();

        expect(h.reported[1]).toMatchObject({ route: '/sales', nav_type: 'navigate', data_ms: 80 });
    });

    it('stops a view at the cap and does not report it', () => {
        const h = harness();
        h.collector.startInitialLoad('/dashboard');
        h.collector.routeCommitted('/dashboard');
        h.collector.apiCallStarted('GET', '/never-answers');
        h.advance(MAX_VIEW_MS);

        expect(h.last()).toMatchObject({ timedOut: true, reported: false });
        expect(h.reported).toEqual([]);
    });

    it('does not report a view that ran in a hidden tab', () => {
        const h = harness();
        h.collector.startInitialLoad('/dashboard');
        h.collector.noteHidden();
        h.collector.routeCommitted('/dashboard');
        h.settle();

        expect(h.last()).toMatchObject({ wasHidden: true, reported: false });
        expect(h.reported).toEqual([]);
    });

    it('does not report a tab that was opened in the background', () => {
        const h = harness({ hidden: true });
        h.collector.startInitialLoad('/dashboard');
        h.collector.routeCommitted('/dashboard');
        h.settle();
        expect(h.reported).toEqual([]);
    });

    it('drops a view that never reached the app shell', () => {
        const h = harness();
        h.collector.startInitialLoad('/login');
        h.advance(MAX_VIEW_MS);
        expect(h.collector.getSnapshot().history).toEqual([]);
    });

    it('ignores its own beacon and calls made between views', () => {
        const h = harness();
        expect(h.collector.apiCallStarted('GET', '/kpis')).toBeNull();
        h.collector.startInitialLoad('/dashboard');
        expect(h.collector.apiCallStarted('POST', '/page-timings')).toBeNull();
    });

    it('does not start a view when the shell re-renders the page already measured', () => {
        const h = harness();
        h.collector.startInitialLoad('/dashboard');
        h.collector.routeCommitted('/dashboard');
        h.settle();
        h.collector.routeCommitted('/dashboard');
        expect(h.collector.getSnapshot().current).toBeNull();
    });

    it('keeps measuring without a reporter, and reports nothing', () => {
        const h = harness();
        h.collector.setReporter(null);
        h.collector.startInitialLoad('/dashboard');
        h.collector.routeCommitted('/dashboard');
        h.settle();
        expect(h.last()).toMatchObject({ reported: false });
    });

    it('notifies subscribers and hands out a stable snapshot between changes', () => {
        const h = harness();
        const listener = jest.fn();
        h.collector.subscribe(listener);
        h.collector.startInitialLoad('/dashboard');
        expect(listener).toHaveBeenCalled();
        const first = h.collector.getSnapshot();
        expect(h.collector.getSnapshot()).toBe(first);
        h.collector.routeCommitted('/dashboard');
        expect(h.collector.getSnapshot()).not.toBe(first);
    });
});
