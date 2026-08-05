/**
 * @jest-environment node
 *
 * Tests for src/app/s/[code]/route.ts.
 *
 * `NextRequest`/`NextResponse` need the real Web Fetch API globals (Request,
 * Response, Headers) that jsdom does not provide, so this file opts into the
 * `node` Jest environment via the docblock above. jest.setup.ts guards its
 * window-only setup so it still runs safely here.
 *
 * Strategy: mock global.fetch and drive the exported `GET` handler directly
 * with a real `NextRequest`, then inspect the returned redirect's status and
 * `Location` header — this is the actual contract the browser sees.
 */
import { NextRequest } from 'next/server';
import { GET } from './route';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const originalApiBase = process.env.NEXT_PUBLIC_API_BASE;
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

beforeEach(() => {
    mockFetch.mockReset();
    delete process.env.NEXT_PUBLIC_API_BASE;
    delete process.env.NEXT_PUBLIC_API_URL;
});

afterAll(() => {
    if (originalApiBase === undefined) delete process.env.NEXT_PUBLIC_API_BASE;
    else process.env.NEXT_PUBLIC_API_BASE = originalApiBase;
    if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
});

function okJson(body: unknown) {
    return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => body,
    });
}

function errorResponse(status: number) {
    return Promise.resolve({
        ok: false,
        status,
        json: async () => ({}),
    });
}

/** Response whose .json() rejects, simulating a non-JSON / malformed body. */
function malformedJson() {
    return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => {
            throw new SyntaxError('Unexpected token in JSON');
        },
    });
}

async function callGet(code: string) {
    const request = new NextRequest(`http://app.erp71.com/s/${code}`);
    return GET(request, { params: Promise.resolve({ code }) });
}

describe('GET /s/[code]', () => {
    it('redirects an internal target straight to that path on the request origin', async () => {
        mockFetch.mockReturnValueOnce(okJson({ data: { kind: 'internal', target_url: '/q/abc123' } }));

        const response = await callGet('abc123');

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('http://app.erp71.com/q/abc123');
    });

    it('redirects an external target to the interstitial with no query string', async () => {
        mockFetch.mockReturnValueOnce(
            okJson({ data: { kind: 'external', target_url: 'https://evil.example.com/phish' } }),
        );

        const response = await callGet('ext123');

        expect(response.status).toBe(302);
        const location = response.headers.get('location')!;
        expect(location).toBe('http://app.erp71.com/s/ext123/leaving');
        // The anti-phishing property under test: the destination must never
        // travel in the URL the browser is handed. If it did, anyone could
        // craft an app.erp71.com link that displays one host and sends the
        // visitor to another.
        expect(new URL(location).search).toBe('');
        expect(location).not.toContain('evil.example.com');
    });

    it('falls back to not-found for an unknown kind rather than the interstitial or the target', async () => {
        mockFetch.mockReturnValueOnce(
            okJson({ data: { kind: 'weird', target_url: 'https://evil.example.com/' } }),
        );

        const response = await callGet('weird1');

        expect(response.status).toBe(302);
        const location = response.headers.get('location')!;
        expect(location).toBe('http://app.erp71.com/not-found');
        expect(location).not.toContain('evil.example.com');
        expect(location).not.toContain('/leaving');
    });

    it('falls back to not-found when the backend responds non-ok', async () => {
        mockFetch.mockReturnValueOnce(errorResponse(404));

        const response = await callGet('missing');

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('http://app.erp71.com/not-found');
    });

    it('falls back to not-found when the response body is not valid JSON', async () => {
        mockFetch.mockReturnValueOnce(malformedJson());

        const response = await callGet('bad-json');

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('http://app.erp71.com/not-found');
    });

    it('falls back to not-found for a 200 with an empty body', async () => {
        mockFetch.mockReturnValueOnce(okJson({}));

        const response = await callGet('empty');

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('http://app.erp71.com/not-found');
    });

    it('falls back to not-found when an internal target_url is not a same-origin path', async () => {
        // Defence-in-depth case: even if `kind: 'internal'` is reported, an
        // absolute or protocol-relative target_url must not be trusted, since
        // `new URL(target, origin)` would silently redirect off-origin.
        mockFetch.mockReturnValueOnce(
            okJson({ data: { kind: 'internal', target_url: '//evil.example.com/phish' } }),
        );

        const response = await callGet('sneaky1');

        expect(response.status).toBe(302);
        const location = response.headers.get('location')!;
        expect(location).toBe('http://app.erp71.com/not-found');
        expect(location).not.toContain('evil.example.com');
    });

    it('falls back to not-found when an internal target_url is an absolute URL', async () => {
        mockFetch.mockReturnValueOnce(
            okJson({ data: { kind: 'internal', target_url: 'https://evil.example.com/phish' } }),
        );

        const response = await callGet('sneaky2');

        expect(response.status).toBe(302);
        const location = response.headers.get('location')!;
        expect(location).toBe('http://app.erp71.com/not-found');
        expect(location).not.toContain('evil.example.com');
    });

    it('calls POST against /short-links/resolve/<code> exactly once in the URL', async () => {
        mockFetch.mockReturnValueOnce(okJson({ data: { kind: 'internal', target_url: '/q/abc123' } }));

        await callGet('abc123');

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, init] = mockFetch.mock.calls[0];
        expect(init?.method).toBe('POST');
        expect(String(url)).toMatch(/\/short-links\/resolve\/abc123$/);
        const occurrences = String(url).split('/short-links/resolve/').length - 1;
        expect(occurrences).toBe(1);
        // Exactly one `/api/v1`, not "at most one". The previous `toBeLessThanOrEqual(1)`
        // was satisfied by *zero* prefixes, which is precisely the production bug it
        // was supposed to be guarding: with NEXT_PUBLIC_API_BASE set to a bare origin
        // every request went to https://api.erp71.com/short-links/... and 404'd.
        expect(String(url).match(/\/api\/v1(\/|$)/g)?.length ?? 0).toBe(1);
    });

    describe('API base resolution', () => {
        // The deploy script writes NEXT_PUBLIC_API_BASE=https://api.erp71.com — the
        // bare origin — while the backend mounts everything under api/v1. Any
        // handler that trusts the configured value verbatim is dead on deploy while
        // passing locally, where the fallback happens to carry the prefix.
        it('appends /api/v1 to a configured base that lacks it', async () => {
            process.env.NEXT_PUBLIC_API_BASE = 'https://api.erp71.com';
            mockFetch.mockReturnValueOnce(okJson({ data: { kind: 'internal', target_url: '/q/abc123' } }));

            await callGet('abc123');

            const url = String(mockFetch.mock.calls[0][0]);
            expect(url).toBe('https://api.erp71.com/api/v1/short-links/resolve/abc123');
            expect(url.match(/\/api\/v1(\/|$)/g)?.length ?? 0).toBe(1);
        });

        it('does not double the prefix when the configured base already carries it', async () => {
            process.env.NEXT_PUBLIC_API_BASE = 'https://api.erp71.com/api/v1';
            mockFetch.mockReturnValueOnce(okJson({ data: { kind: 'internal', target_url: '/q/abc123' } }));

            await callGet('abc123');

            const url = String(mockFetch.mock.calls[0][0]);
            expect(url).toBe('https://api.erp71.com/api/v1/short-links/resolve/abc123');
        });

        it('tolerates a trailing slash on the configured base', async () => {
            process.env.NEXT_PUBLIC_API_BASE = 'https://api.erp71.com/';
            mockFetch.mockReturnValueOnce(okJson({ data: { kind: 'internal', target_url: '/q/abc123' } }));

            await callGet('abc123');

            expect(String(mockFetch.mock.calls[0][0])).toBe(
                'https://api.erp71.com/api/v1/short-links/resolve/abc123',
            );
        });

        it('falls back to NEXT_PUBLIC_API_URL when NEXT_PUBLIC_API_BASE is unset', async () => {
            process.env.NEXT_PUBLIC_API_URL = 'https://api.erp71.com';
            mockFetch.mockReturnValueOnce(okJson({ data: { kind: 'internal', target_url: '/q/abc123' } }));

            await callGet('abc123');

            expect(String(mockFetch.mock.calls[0][0])).toBe(
                'https://api.erp71.com/api/v1/short-links/resolve/abc123',
            );
        });
    });

    it('falls back to not-found when fetch rejects (e.g. network error)', async () => {
        mockFetch.mockReturnValueOnce(Promise.reject(new Error('network down')));

        const response = await callGet('neterr');

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('http://app.erp71.com/not-found');
    });

    it('falls back to not-found when fetch times out (abort)', async () => {
        // A real timeout manifests to the handler as fetch rejecting with an
        // AbortError once the 3s AbortController fires — reject with that
        // directly rather than waiting out the real timer, since the handler's
        // catch-all treats any rejection the same way.
        const abortError = new Error('This operation was aborted');
        abortError.name = 'AbortError';
        mockFetch.mockReturnValueOnce(Promise.reject(abortError));

        const response = await callGet('slow1');

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('http://app.erp71.com/not-found');
    });

    it('passes an AbortSignal to fetch so a hung backend is actually cancelled', async () => {
        mockFetch.mockReturnValueOnce(okJson({ data: { kind: 'internal', target_url: '/q/abc123' } }));

        await callGet('abc123');

        const [, init] = mockFetch.mock.calls[0];
        expect(init?.signal).toBeInstanceOf(AbortSignal);
    });

    it('falls back to not-found when the code is empty', async () => {
        const request = new NextRequest('http://app.erp71.com/s/');
        const response = await GET(request, { params: Promise.resolve({ code: '' }) });

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('http://app.erp71.com/not-found');
        expect(mockFetch).not.toHaveBeenCalled();
    });
});
