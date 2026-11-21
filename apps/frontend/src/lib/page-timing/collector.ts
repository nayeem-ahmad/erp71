import { endpointPattern, routePattern } from './route-pattern';
import { parseServerTiming, type ServerSplit } from './server-timing';

/**
 * Times each page view in the app, from its start to the paint after its last
 * API response, and splits that time into the steps of the journey:
 *
 *   load:      document → boot → data → render
 *   navigate:            route → data → render
 *
 * - document: DNS, connect, server response and download of the HTML (full loads only).
 * - boot/route: until the page asks for its data — JavaScript, hydration, the
 *   route's code and first render. Named `boot_ms` in both cases.
 * - data: from the first API call starting to the last one finishing. Each call
 *   is further split into the token check, the network and the server's own
 *   phases (from its `Server-Timing` header).
 * - render: from the last response to the next paint.
 *
 * A view ends once no call has been in flight for `QUIET_MS` after a paint, or
 * at `MAX_VIEW_MS`. Views that ran in a hidden tab or hit the cap are kept for
 * the panel but not reported: rAF is paused in a hidden tab, so the numbers
 * would describe the tab, not the page.
 *
 * Framework-free on purpose: `instrumentation-client.ts` loads it on every page
 * before React, and `api.ts` feeds it, so it must stay small and import nothing
 * from either.
 */

export type NavType = 'load' | 'navigate';

export type ApiCallTiming = {
    id: number;
    method: string;
    /** The endpoint as called, query string dropped. Shown in the panel only. */
    path: string;
    /** `GET /sales/:id`: what is reported. */
    label: string;
    startedAt: number;
    /** After the token check, when the request went out. */
    sentAt: number | null;
    headersAt: number | null;
    endedAt: number | null;
    status: number | null;
    server: ServerSplit | null;
};

export type DocumentTiming = {
    dnsMs: number;
    connectMs: number;
    waitMs: number;
    downloadMs: number;
    totalMs: number;
};

export type PagePhases = {
    totalMs: number;
    documentMs: number | null;
    bootMs: number;
    dataMs: number;
    renderMs: number;
    apiCalls: number;
    networkMs: number;
    serverMs: number;
    dbMs: number;
    tokenWaitMs: number;
    slowest: { label: string; ms: number } | null;
};

export type PageView = {
    id: number;
    navType: NavType;
    path: string;
    route: string;
    /** `performance.now()` time; 0 for a full load (the navigation's own start). */
    startedAt: number;
    committedAt: number | null;
    endedAt: number | null;
    calls: ApiCallTiming[];
    document: DocumentTiming | null;
    phases: PagePhases | null;
    /** Whether it went to the dashboard. */
    reported: boolean;
    wasHidden: boolean;
    timedOut: boolean;
};

/** What the dashboard stores for one view. Mirrors the backend's `PageTimingSampleDto`. */
export type PageTimingSample = {
    route: string;
    nav_type: NavType;
    total_ms: number;
    document_ms?: number;
    boot_ms: number;
    data_ms: number;
    render_ms: number;
    api_calls: number;
    network_ms: number;
    server_ms: number;
    db_ms: number;
    token_wait_ms: number;
    slowest_endpoint?: string;
    slowest_ms?: number;
};

export type ApiCallHandle = {
    sent(): void;
    headers(status: number, serverTiming: string | null): void;
    finish(): void;
};

export type PageTimingSnapshot = {
    current: PageView | null;
    history: PageView[];
};

type Timer = ReturnType<typeof setTimeout>;

export type CollectorDeps = {
    now: () => number;
    /** Calls back once the browser has painted what is on screen now. */
    afterPaint: (callback: () => void) => void;
    setTimer: (callback: () => void, ms: number) => Timer;
    clearTimer: (timer: Timer) => void;
    navigationEntry: () => PerformanceNavigationTiming | undefined;
    currentPath: () => string;
    isHidden: () => boolean;
};

/** No call in flight for this long after a paint, and the page is done. */
export const QUIET_MS = 300;
/** A view still busy after this is stopped and not reported. */
export const MAX_VIEW_MS = 30_000;
const HISTORY_SIZE = 20;
const MAX_CALLS_PER_VIEW = 100;
/** The beacon's own request, which must not time itself. */
const IGNORED_ENDPOINTS = ['/page-timings'];

const pathOf = (url: string) => {
    try {
        return new URL(url, 'http://x').pathname;
    } catch {
        return url.split(/[?#]/)[0];
    }
};

const ms = (value: number) => Math.max(0, Math.round(value));

function documentTiming(entry: PerformanceNavigationTiming | undefined): DocumentTiming | null {
    if (!entry || !(entry.responseEnd > 0)) return null;
    return {
        dnsMs: ms(entry.domainLookupEnd - entry.domainLookupStart),
        connectMs: ms(entry.connectEnd - entry.connectStart),
        waitMs: ms(entry.responseStart - entry.requestStart),
        downloadMs: ms(entry.responseEnd - entry.responseStart),
        totalMs: ms(entry.responseEnd),
    };
}

/** The split of a finished view. Exported for the tests. */
export function computePhases(view: PageView): PagePhases {
    const endedAt = view.endedAt ?? view.startedAt;
    const documentEnd = view.document ? view.startedAt + view.document.totalMs : view.startedAt;
    const calls = view.calls.filter((call) => call.endedAt !== null);
    const firstStart = calls.length ? Math.min(...calls.map((call) => call.startedAt)) : null;
    const lastEnd = calls.length ? Math.max(...calls.map((call) => call.endedAt as number)) : null;
    const bootEnd = firstStart ?? view.committedAt ?? endedAt;

    let networkMs = 0;
    let serverMs = 0;
    let dbMs = 0;
    let tokenWaitMs = 0;
    let slowest: PagePhases['slowest'] = null;
    for (const call of calls) {
        const sentAt = call.sentAt ?? call.startedAt;
        const took = (call.endedAt as number) - call.startedAt;
        const server = call.server?.totalMs ?? 0;
        tokenWaitMs += sentAt - call.startedAt;
        serverMs += server;
        dbMs += call.server?.dbMs ?? 0;
        networkMs += Math.max(0, (call.endedAt as number) - sentAt - server);
        if (!slowest || took > slowest.ms) slowest = { label: call.label, ms: took };
    }

    return {
        totalMs: ms(endedAt - view.startedAt),
        documentMs: view.document ? view.document.totalMs : null,
        bootMs: ms(bootEnd - documentEnd),
        dataMs: firstStart !== null && lastEnd !== null ? ms(lastEnd - firstStart) : 0,
        renderMs: ms(endedAt - (lastEnd ?? bootEnd)),
        apiCalls: calls.length,
        networkMs: ms(networkMs),
        serverMs: ms(serverMs),
        dbMs: ms(dbMs),
        tokenWaitMs: ms(tokenWaitMs),
        slowest: slowest ? { label: slowest.label, ms: ms(slowest.ms) } : null,
    };
}

export function toSample(view: PageView, phases: PagePhases): PageTimingSample {
    return {
        route: view.route,
        nav_type: view.navType,
        total_ms: phases.totalMs,
        ...(phases.documentMs !== null ? { document_ms: phases.documentMs } : {}),
        boot_ms: phases.bootMs,
        data_ms: phases.dataMs,
        render_ms: phases.renderMs,
        api_calls: phases.apiCalls,
        network_ms: phases.networkMs,
        server_ms: phases.serverMs,
        db_ms: phases.dbMs,
        token_wait_ms: phases.tokenWaitMs,
        ...(phases.slowest ? { slowest_endpoint: phases.slowest.label, slowest_ms: phases.slowest.ms } : {}),
    };
}

type LiveView = PageView & { inflight: number };

export class PageTimingCollector {
    private current: LiveView | null = null;
    private history: PageView[] = [];
    private readonly listeners = new Set<() => void>();
    private snapshot: PageTimingSnapshot = { current: null, history: [] };
    private dirty = false;
    private nextViewId = 1;
    private nextCallId = 1;
    /** Bumped by every activity; a paint or quiet timer from an older one is stale. */
    private activitySeq = 0;
    private quietTimer: Timer | null = null;
    private maxTimer: Timer | null = null;
    private interacted = false;
    private reporter: ((sample: PageTimingSample) => void) | null = null;

    constructor(private readonly deps: CollectorDeps) {}

    /** The full page load this document started with. */
    startInitialLoad(path: string): void {
        this.begin('load', path, 0);
    }

    /** The user clicked or typed: a router transition after this is theirs, not a redirect. */
    noteInteraction(): void {
        this.interacted = true;
    }

    noteHidden(): void {
        if (this.current) this.current.wasHidden = true;
    }

    /** A router transition began (`onRouterTransitionStart`). */
    navigationStarted(url: string): void {
        const path = pathOf(url);
        const view = this.current;
        if (view && view.endedAt === null) {
            // Redirected on the way in (`/app-entry` → the dashboard) before
            // anyone touched the page: still the same full load.
            if (view.navType === 'load' && !this.interacted) {
                view.path = path;
                view.route = routePattern(path);
                view.committedAt = null;
                this.changed();
                return;
            }
            this.discardCurrent();
        }
        this.begin('navigate', path, this.deps.now());
        // A query-string change, or a link to this very page: no new pathname
        // will be committed, so the route is already on screen.
        if (path === this.deps.currentPath()) this.routeCommitted(path);
    }

    /** The app shell rendered this pathname. */
    routeCommitted(pathname: string): void {
        let view = this.current;
        if (!view || view.endedAt !== null) {
            const last = this.history[0];
            // The shell mounting on a view already measured, or re-rendering.
            if (last && last.path === pathname) return;
            // A pathname change no transition announced (a direct history write).
            this.begin('navigate', pathname, this.deps.now());
            view = this.current as LiveView;
        }
        view.path = pathname;
        view.route = routePattern(pathname);
        if (view.committedAt === null) view.committedAt = this.deps.now();
        this.changed();
        this.activity(view);
    }

    apiCallStarted(method: string | undefined, endpoint: string): ApiCallHandle | null {
        const view = this.current;
        const path = pathOf(endpoint);
        if (!view || view.endedAt !== null) return null;
        if (IGNORED_ENDPOINTS.some((ignored) => path === ignored || path.startsWith(`${ignored}/`))) return null;
        if (view.calls.length >= MAX_CALLS_PER_VIEW) return null;

        const verb = (method ?? 'GET').toUpperCase();
        const call: ApiCallTiming = {
            id: this.nextCallId++,
            method: verb,
            path,
            label: endpointPattern(verb, endpoint),
            startedAt: this.deps.now(),
            sentAt: null,
            headersAt: null,
            endedAt: null,
            status: null,
            server: null,
        };
        view.calls.push(call);
        view.inflight += 1;
        this.activitySeq += 1;
        this.clearQuietTimer();
        this.changed();

        let finished = false;
        return {
            sent: () => {
                call.sentAt = this.deps.now();
            },
            headers: (status, serverTiming) => {
                call.headersAt = this.deps.now();
                call.status = status;
                call.server = parseServerTiming(serverTiming);
            },
            finish: () => {
                if (finished) return;
                finished = true;
                call.endedAt = this.deps.now();
                view.inflight -= 1;
                this.changed();
                if (this.current === view) this.activity(view);
            },
        };
    }

    /** Where finished views go; null stops reporting. */
    setReporter(reporter: ((sample: PageTimingSample) => void) | null): void {
        this.reporter = reporter;
    }

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    getSnapshot = (): PageTimingSnapshot => {
        if (this.dirty) {
            const copy = (view: PageView): PageView => ({ ...view, calls: view.calls.map((call) => ({ ...call })) });
            this.snapshot = {
                current: this.current ? copy(this.current) : null,
                history: this.history,
            };
            this.dirty = false;
        }
        return this.snapshot;
    };

    private begin(navType: NavType, path: string, startedAt: number): void {
        this.discardCurrent();
        this.current = {
            id: this.nextViewId++,
            navType,
            path,
            route: routePattern(path),
            startedAt,
            committedAt: null,
            endedAt: null,
            calls: [],
            document: navType === 'load' ? documentTiming(this.deps.navigationEntry()) : null,
            phases: null,
            reported: false,
            // A tab opened in the background starts hidden, with no event to say so.
            wasHidden: this.deps.isHidden(),
            timedOut: false,
            inflight: 0,
        };
        const view = this.current;
        const remaining = Math.max(0, MAX_VIEW_MS - (this.deps.now() - startedAt));
        this.maxTimer = this.deps.setTimer(() => {
            if (this.current !== view) return;
            view.timedOut = true;
            this.finish(view, this.deps.now());
        }, remaining);
        this.changed();
    }

    /** Nothing in flight: wait for the paint, then for quiet. */
    private activity(view: LiveView): void {
        if (view.endedAt !== null || view.committedAt === null || view.inflight > 0) return;
        const seq = ++this.activitySeq;
        this.clearQuietTimer();
        this.deps.afterPaint(() => {
            if (this.current !== view || seq !== this.activitySeq) return;
            const paintedAt = this.deps.now();
            this.quietTimer = this.deps.setTimer(() => {
                if (this.current !== view || seq !== this.activitySeq) return;
                this.finish(view, paintedAt);
            }, QUIET_MS);
        });
    }

    private finish(view: LiveView, endedAt: number): void {
        this.clearTimers();
        this.current = null;
        // Never reached the app shell (a page outside the app): nothing to show.
        if (view.committedAt === null) {
            this.changed();
            return;
        }
        view.endedAt = endedAt;
        view.phases = computePhases(view);
        const finished: PageView = { ...view };
        delete (finished as Partial<LiveView>).inflight;
        const reportable = !view.wasHidden && !view.timedOut && Boolean(this.reporter);
        finished.reported = reportable;
        this.history = [finished, ...this.history].slice(0, HISTORY_SIZE);
        this.changed();
        if (reportable) {
            try {
                this.reporter?.(toSample(finished, view.phases));
            } catch {
                // Reporting is best effort.
            }
        }
    }

    private discardCurrent(): void {
        this.clearTimers();
        if (this.current) {
            this.current = null;
            this.changed();
        }
    }

    private clearQuietTimer(): void {
        if (this.quietTimer) this.deps.clearTimer(this.quietTimer);
        this.quietTimer = null;
    }

    private clearTimers(): void {
        this.clearQuietTimer();
        if (this.maxTimer) this.deps.clearTimer(this.maxTimer);
        this.maxTimer = null;
    }

    private changed(): void {
        this.dirty = true;
        for (const listener of this.listeners) listener();
    }
}

function browserDeps(): CollectorDeps {
    return {
        now: () => performance.now(),
        afterPaint: (callback) => {
            // The render a response triggers lands in a task after it; the
            // frame after that render is the paint the user sees.
            setTimeout(() => requestAnimationFrame(() => setTimeout(callback, 0)), 0);
        },
        setTimer: (callback, delay) => setTimeout(callback, delay),
        clearTimer: (timer) => clearTimeout(timer),
        navigationEntry: () =>
            performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined,
        currentPath: () => window.location.pathname,
        isHidden: () => document.visibilityState === 'hidden',
    };
}

/** The page's collector. Started on import in a real browser; tests build their own. */
export const pageTiming = new PageTimingCollector(
    typeof window === 'undefined' ? ({} as CollectorDeps) : browserDeps(),
);

if (typeof window !== 'undefined' && typeof performance !== 'undefined' && process.env.NODE_ENV !== 'test') {
    pageTiming.startInitialLoad(window.location.pathname);
    const interacted = () => pageTiming.noteInteraction();
    window.addEventListener('pointerdown', interacted, { capture: true, once: true });
    window.addEventListener('keydown', interacted, { capture: true, once: true });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') pageTiming.noteHidden();
    });
}
