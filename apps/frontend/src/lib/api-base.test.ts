/**
 * @jest-environment node
 *
 * Tests for src/lib/api-base.ts.
 *
 * Node rather than jsdom because `publicApiBase` behaves differently on the
 * server, and a jsdom `window` would hide that half. The browser case defines a
 * `window` for the duration of the test instead.
 */
import { browserApiBase, DEFAULT_LOCAL_API_BASE, publicApiBase } from './api-base';

const KEYS = ['NEXT_PUBLIC_API_BASE', 'NEXT_PUBLIC_API_URL', 'BACKEND_URL', 'NEXT_PHASE'] as const;
const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
    for (const key of KEYS) delete process.env[key];
});

afterAll(() => {
    for (const key of KEYS) {
        if (original[key] === undefined) delete process.env[key];
        else process.env[key] = original[key];
    }
});

function inBrowser<T>(fn: () => T): T {
    const scope = globalThis as { window?: unknown };
    scope.window = globalThis;
    try {
        return fn();
    } finally {
        delete scope.window;
    }
}

describe('browserApiBase', () => {
    it('is the configured app origin under /api/v1', () => {
        process.env.NEXT_PUBLIC_API_BASE = 'https://app.erp71.com';
        expect(browserApiBase()).toBe('https://app.erp71.com/api/v1');
    });

    it('falls back to NEXT_PUBLIC_API_URL', () => {
        process.env.NEXT_PUBLIC_API_URL = 'https://app.erp71.com/';
        expect(browserApiBase()).toBe('https://app.erp71.com/api/v1');
    });

    // The fallback used to be the retired Render host, so a build without the
    // variable shipped an app that could not reach its API at all.
    it('is same-origin /api/v1 when nothing is configured', () => {
        expect(browserApiBase()).toBe('/api/v1');
    });

    it('ignores BACKEND_URL, which the browser cannot reach', () => {
        process.env.BACKEND_URL = 'http://backend:4000';
        expect(browserApiBase()).toBe('/api/v1');
    });
});

describe('publicApiBase', () => {
    it('prefers the backend on the compose network when running on the server', () => {
        process.env.BACKEND_URL = 'http://backend:4000';
        process.env.NEXT_PUBLIC_API_BASE = 'https://app.erp71.com';
        expect(publicApiBase()).toBe('http://backend:4000/api/v1');
    });

    // No backend runs next to `next build`; the sitemap and RSS feed pre-render
    // then and would bake in an empty result.
    it('keeps the public origin during next build', () => {
        process.env.BACKEND_URL = 'http://backend:4000';
        process.env.NEXT_PUBLIC_API_BASE = 'https://app.erp71.com';
        process.env.NEXT_PHASE = 'phase-production-build';
        expect(publicApiBase()).toBe('https://app.erp71.com/api/v1');
    });

    it('never hands BACKEND_URL to code running in the browser', () => {
        process.env.BACKEND_URL = 'http://backend:4000';
        process.env.NEXT_PUBLIC_API_BASE = 'https://app.erp71.com';
        expect(inBrowser(publicApiBase)).toBe('https://app.erp71.com/api/v1');
    });

    it('uses the public origin when BACKEND_URL is unset', () => {
        process.env.NEXT_PUBLIC_API_BASE = 'https://app.erp71.com';
        expect(publicApiBase()).toBe('https://app.erp71.com/api/v1');
    });

    it('falls back to the local backend when nothing is configured', () => {
        expect(publicApiBase()).toBe(DEFAULT_LOCAL_API_BASE);
    });
});
