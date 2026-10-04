/**
 * @jest-environment node
 *
 * Tests for public/sw.js — the offline-POS service worker.
 *
 * The worker is a plain script, not a module, so it runs here the way a browser
 * runs it: evaluated in its own context, whose `self` collects the event
 * listeners, with `fetch`, `caches` and `indexedDB` stubbed. Node rather than
 * jsdom for the real `Headers`/`Response`/`URL` a worker sees.
 */
import { readFileSync } from 'fs';
import path from 'path';
import vm from 'vm';

const SOURCE = readFileSync(path.join(__dirname, '../../public/sw.js'), 'utf8');
const ORIGIN = 'https://app.erp71.com';

type Listener = (event: any) => void;

type WorkerOptions = {
    fetch?: jest.Mock;
    indexedDB?: unknown;
    URLPattern?: unknown;
};

function okResponse(extra: Partial<{ redirected: boolean; ok: boolean; status: number }> = {}) {
    return { ok: true, redirected: false, status: 200, clone() { return this; }, ...extra };
}

function loadWorker(options: WorkerOptions = {}) {
    const listeners: Record<string, Listener> = {};
    const cache = { put: jest.fn().mockResolvedValue(undefined) };
    const caches = {
        open: jest.fn().mockResolvedValue(cache),
        keys: jest.fn().mockResolvedValue([]),
        delete: jest.fn(),
        match: jest.fn().mockResolvedValue(undefined),
    };
    const fetch = options.fetch ?? jest.fn().mockResolvedValue(okResponse());
    const client = { postMessage: jest.fn() };
    const self = {
        addEventListener: (type: string, listener: Listener) => {
            listeners[type] = listener;
        },
        skipWaiting: jest.fn(),
        clients: { claim: jest.fn(), matchAll: jest.fn().mockResolvedValue([client]) },
        location: { origin: ORIGIN },
    };
    const console = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

    vm.runInNewContext(SOURCE, {
        self,
        caches,
        fetch,
        console,
        URL,
        Headers,
        Response,
        indexedDB: options.indexedDB,
        URLPattern: options.URLPattern,
    });

    return { listeners, cache, fetch, client };
}

/** Dispatches an extendable event and waits for everything it handed to `waitUntil`. */
async function dispatch(listener: Listener, extra: Record<string, unknown> = {}) {
    const pending: Promise<unknown>[] = [];
    const event = { waitUntil: (promise: Promise<unknown>) => pending.push(promise), ...extra };
    listener(event);
    await Promise.all(pending);
    return event;
}

function fetchEvent(url: string, init: { mode?: string; headers?: Record<string, string> } = {}) {
    return {
        request: { url, mode: init.mode ?? 'cors', headers: new Headers(init.headers) },
        respondWith: jest.fn(),
    };
}

describe('sw.js fetch handler', () => {
    // Same-origin since the app calls the API on its own domain, so answering
    // these would put the worker in front of every call the app makes.
    it.each([
        `${ORIGIN}/api/v1/sales`,
        `${ORIGIN}/api/v1/support/stream`,
        'https://api.erp71.com/api/v1/products',
    ])('leaves %s to the network', (url) => {
        const worker = loadWorker();
        const event = fetchEvent(url);

        worker.listeners.fetch(event);

        expect(event.respondWith).not.toHaveBeenCalled();
        expect(worker.fetch).not.toHaveBeenCalled();
    });

    it('still answers page navigations, for the offline shell', () => {
        const worker = loadWorker();
        const event = fetchEvent(`${ORIGIN}/sales/pos`, { mode: 'navigate' });

        worker.listeners.fetch(event);

        expect(event.respondWith).toHaveBeenCalledTimes(1);
    });
});

describe('sw.js install', () => {
    it('pre-caches the POS under its real URL, and nothing else', async () => {
        const worker = loadWorker();

        await dispatch(worker.listeners.install);

        expect(worker.fetch).toHaveBeenCalledTimes(1);
        expect(worker.fetch).toHaveBeenCalledWith('/sales/pos');
        expect(worker.cache.put).toHaveBeenCalledWith('/sales/pos', expect.objectContaining({ ok: true }));
    });

    // A redirected response cannot answer a navigation, which is all the copy
    // is kept for — the old `/dashboard/pos` entry was exactly that.
    it('does not keep a redirected response', async () => {
        const worker = loadWorker({ fetch: jest.fn().mockResolvedValue(okResponse({ redirected: true })) });

        await dispatch(worker.listeners.install);

        expect(worker.cache.put).not.toHaveBeenCalled();
    });

    it('still installs when the pre-cache fetch fails', async () => {
        const worker = loadWorker({ fetch: jest.fn().mockRejectedValue(new TypeError('Failed to fetch')) });

        await expect(dispatch(worker.listeners.install)).resolves.toBeDefined();
        expect(worker.cache.put).not.toHaveBeenCalled();
    });

    it('routes /api/* past the worker where the browser supports static routes', async () => {
        class FakeURLPattern {
            constructor(public readonly init: { pathname: string }) {}
        }
        const worker = loadWorker({ URLPattern: FakeURLPattern });
        const addRoutes = jest.fn().mockResolvedValue(undefined);

        await dispatch(worker.listeners.install, { addRoutes });

        expect(addRoutes).toHaveBeenCalledTimes(1);
        const [rule] = addRoutes.mock.calls[0];
        expect(rule.source).toBe('network');
        expect(rule.condition.urlPattern.init).toEqual({ pathname: '/api/*' });
    });

    it('still installs when the browser refuses the static route', async () => {
        class FakeURLPattern {
            constructor(public readonly init: unknown) {}
        }
        const worker = loadWorker({ URLPattern: FakeURLPattern });
        const addRoutes = jest.fn().mockRejectedValue(new Error('not allowed'));

        await expect(dispatch(worker.listeners.install, { addRoutes })).resolves.toBeDefined();
    });
});

describe('sw.js background sync', () => {
    /** Just enough IndexedDB for openSwDb/getAllFromStore/deleteFromStore. */
    function fakeIndexedDb(sales: object[]) {
        const deleted: string[] = [];
        const request = (result?: unknown) => {
            const req: { result?: unknown; onsuccess?: () => void } = { result };
            queueMicrotask(() => req.onsuccess?.());
            return req;
        };
        const db = {
            transaction: () => ({
                objectStore: () => ({
                    getAll: () => request(sales),
                    delete: (id: string) => {
                        deleted.push(id);
                        return request();
                    },
                }),
            }),
        };
        return { deleted, indexedDB: { open: () => request(db) } };
    }

    // The queue's own path: the worker posts the sale itself, with the token
    // and workspace captured when it was rung up. The API bypass above must
    // not touch it.
    it('posts a queued sale to the API and drops it once accepted', async () => {
        const sale = { id: 'sale-1', authToken: 'tok-1', tenantId: 'tenant-1', storeId: 'store-1', totalAmount: 250 };
        const idb = fakeIndexedDb([sale]);
        const fetch = jest.fn().mockResolvedValue(okResponse({ status: 201 }));
        const worker = loadWorker({ fetch, indexedDB: idb.indexedDB });

        await dispatch(worker.listeners.sync, { tag: 'pos-sync' });

        expect(fetch).toHaveBeenCalledTimes(1);
        const [url, init] = fetch.mock.calls[0];
        expect(url).toBe('/api/v1/sales');
        expect(init.method).toBe('POST');
        expect(init.headers).toEqual(expect.objectContaining({
            Authorization: 'Bearer tok-1',
            'x-tenant-id': 'tenant-1',
        }));
        expect(JSON.parse(init.body)).toEqual({ storeId: 'store-1', totalAmount: 250 });
        expect(idb.deleted).toEqual(['sale-1']);
        expect(worker.client.postMessage).toHaveBeenCalledWith({ type: 'sync-complete' });
    });

    it('keeps a sale the API refused, for the next attempt', async () => {
        const idb = fakeIndexedDb([{ id: 'sale-2', authToken: 't', tenantId: 'x' }]);
        const fetch = jest.fn().mockResolvedValue(okResponse({ ok: false, status: 503 }));
        const worker = loadWorker({ fetch, indexedDB: idb.indexedDB });

        await dispatch(worker.listeners.sync, { tag: 'pos-sync' });

        expect(idb.deleted).toEqual([]);
        expect(worker.client.postMessage).not.toHaveBeenCalled();
    });
});
