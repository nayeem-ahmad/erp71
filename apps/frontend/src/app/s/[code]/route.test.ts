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

/** Body the handler POSTed to the API, parsed back out of the fetch call. */
function sentBody(call = 0) {
    return JSON.parse(String(mockFetch.mock.calls[call][1].body));
}

function sentHeaders(call = 0): Record<string, string> {
    return mockFetch.mock.calls[call][1].headers ?? {};
}

/**
 * Drive the handler from the origin the standalone server actually reports.
 *
 * Next's `request.nextUrl.origin` inside a container is built from the server's
 * own bind address (`HOSTNAME=0.0.0.0`, `PORT=3000` — see apps/frontend/Dockerfile),
 * NOT the public host: it ignores both `Host` and `X-Forwarded-Host`. Fabricating
 * a request from `http://app.erp71.com` — as these tests used to — hides the only
 * condition that matters, which is how every `/s/` link shipped emitting
 * `https://0.0.0.0:3000/...` while the suite stayed green.
 */
async function callGet(
    code: string,
    origin = 'http://0.0.0.0:3000',
    init?: { headers?: Record<string, string>; search?: string },
) {
    const request = new NextRequest(`${origin}/s/${code}${init?.search ?? ''}`, {
        headers: init?.headers,
    });
    return GET(request, { params: Promise.resolve({ code }) });
}

describe('GET /s/[code]', () => {
    it('redirects an internal target straight to that path on the request origin', async () => {
        mockFetch.mockReturnValueOnce(okJson({ data: { kind: 'internal', target_url: '/q/abc123' } }));

        const response = await callGet('abc123');

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('/q/abc123');
    });

    // The "you are leaving ERP71" interstitial was removed: a shortener that
    // stops to ask costs every recipient an extra tap. The safety it used to
    // provide lives upstream — only MANAGE_SHORT_LINKS mints a link, and
    // isSafeTarget vets the target — so the redirect goes straight through.
    it('redirects an external target straight to the destination', async () => {
        mockFetch.mockReturnValueOnce(
            okJson({ data: { kind: 'external', target_url: 'https://example.com/promo' } }),
        );

        const response = await callGet('ext123');

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('https://example.com/promo');
    });

    it('sends no visitor through an interstitial path any more', async () => {
        mockFetch.mockReturnValueOnce(
            okJson({ data: { kind: 'external', target_url: 'https://example.com/promo' } }),
        );

        const response = await callGet('ext123');

        expect(response.headers.get('location')).not.toContain('/leaving');
    });

    it('falls back to not-found for an unknown kind rather than the target', async () => {
        mockFetch.mockReturnValueOnce(
            okJson({ data: { kind: 'weird', target_url: 'https://evil.example.com/' } }),
        );

        const response = await callGet('weird1');

        expect(response.status).toBe(302);
        const location = response.headers.get('location')!;
        expect(location).toBe('/not-found');
        expect(location).not.toContain('evil.example.com');
    });

    // `kind: 'external'` is a claim from another service, not a licence to emit
    // any string as a Location. A javascript:/data: URL handed out under our own
    // domain is script execution, so the scheme is re-checked here.
    it.each([
        ['javascript:', 'javascript:alert(1)'],
        ['data:', 'data:text/html,<script>alert(1)</script>'],
        ['a bare path', '/q/not-external'],
        ['protocol-relative', '//evil.example.com/phish'],
    ])('falls back to not-found when an external target_url is %s', async (_label, target) => {
        mockFetch.mockReturnValueOnce(okJson({ data: { kind: 'external', target_url: target } }));

        const response = await callGet('badext');

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('/not-found');
    });

    it('falls back to not-found when the backend responds non-ok', async () => {
        mockFetch.mockReturnValueOnce(errorResponse(404));

        const response = await callGet('missing');

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('/not-found');
    });

    it('falls back to not-found when the response body is not valid JSON', async () => {
        mockFetch.mockReturnValueOnce(malformedJson());

        const response = await callGet('bad-json');

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('/not-found');
    });

    it('falls back to not-found for a 200 with an empty body', async () => {
        mockFetch.mockReturnValueOnce(okJson({}));

        const response = await callGet('empty');

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('/not-found');
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
        expect(location).toBe('/not-found');
        expect(location).not.toContain('evil.example.com');
    });

    it('falls back to not-found when an internal target_url is an absolute URL', async () => {
        mockFetch.mockReturnValueOnce(
            okJson({ data: { kind: 'internal', target_url: 'https://evil.example.com/phish' } }),
        );

        const response = await callGet('sneaky2');

        expect(response.status).toBe(302);
        const location = response.headers.get('location')!;
        expect(location).toBe('/not-found');
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
        expect(response.headers.get('location')).toBe('/not-found');
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
        expect(response.headers.get('location')).toBe('/not-found');
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
        expect(response.headers.get('location')).toBe('/not-found');
        expect(mockFetch).not.toHaveBeenCalled();
    });

    /**
     * The click is recorded by the API, but everything worth knowing about the
     * visitor is only visible *here* — this handler is a server-to-server fetch,
     * so none of the original request's headers reach the API on their own. If
     * this forwarding regresses, clicks keep counting and every analytics column
     * silently goes null, which is exactly the failure a counter cannot show.
     */
    describe('visitor context forwarded for analytics', () => {
        it('forwards referrer, user agent, language and the /s/ query string', async () => {
            mockFetch.mockReturnValueOnce(okJson({ data: { kind: 'internal', target_url: '/q/abc' } }));

            await callGet('abc123', 'http://0.0.0.0:3000', {
                search: '?utm_source=facebook&utm_medium=cpc',
                headers: {
                    referer: 'https://l.facebook.com/',
                    'user-agent': 'Mozilla/5.0 (iPhone)',
                    'accept-language': 'bn-BD,bn;q=0.9',
                },
            });

            expect(sentBody()).toEqual(
                expect.objectContaining({
                    referrer: 'https://l.facebook.com/',
                    user_agent: 'Mozilla/5.0 (iPhone)',
                    language: 'bn-BD,bn;q=0.9',
                    query: '?utm_source=facebook&utm_medium=cpc',
                }),
            );
        });

        it('passes the visitor IP as X-Forwarded-For rather than a body field', async () => {
            // The API reads the address off the header the same way it does for
            // every other request; putting it in the body would mean trusting a
            // public caller's claim about its own IP.
            mockFetch.mockReturnValueOnce(okJson({ data: { kind: 'internal', target_url: '/q/abc' } }));

            await callGet('abc123', 'http://0.0.0.0:3000', {
                headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
            });

            expect(sentHeaders()['x-forwarded-for']).toBe('203.0.113.9, 10.0.0.1');
            expect(sentBody()).not.toHaveProperty('ip_address');
        });

        it('picks up an edge geo header when one is present', async () => {
            mockFetch.mockReturnValueOnce(okJson({ data: { kind: 'internal', target_url: '/q/abc' } }));

            await callGet('abc123', 'http://0.0.0.0:3000', { headers: { 'cf-ipcountry': 'BD' } });

            expect(sentBody().country).toBe('BD');
        });

        it('still redirects when the visitor sends none of those headers', async () => {
            // A bare request must not be a special case — a click with no context
            // is still a click, and the redirect is what the visitor is waiting on.
            mockFetch.mockReturnValueOnce(okJson({ data: { kind: 'internal', target_url: '/q/abc' } }));

            const response = await callGet('abc123');

            expect(response.headers.get('location')).toBe('/q/abc');
            expect(sentBody()).toEqual({});
        });

        it('sends JSON so the API parses the body at all', async () => {
            mockFetch.mockReturnValueOnce(okJson({ data: { kind: 'internal', target_url: '/q/abc' } }));

            await callGet('abc123', 'http://0.0.0.0:3000', { headers: { referer: 'https://example.com/' } });

            expect(sentHeaders()['Content-Type']).toBe('application/json');
        });
    });

    /**
     * Regression: every `/s/` link in production emitted
     * `https://0.0.0.0:3000/...`, which no browser can reach
     * (ERR_SSL_PROTOCOL_ERROR). The handler had built absolute URLs from
     * `request.nextUrl.origin`, which in a standalone container is the bind
     * address rather than the public host.
     *
     * A relative `Location` (RFC 7231 §7.1.2) is resolved by the browser against
     * the URL it actually requested, so the public origin never has to be
     * guessed or reconstructed from proxy headers.
     */
    describe('Location is origin-independent', () => {
        it.each([
            ['internal', { kind: 'internal', target_url: '/q/abc123' }, '/q/abc123'],
            ['unknown kind', { kind: 'nope' }, '/not-found'],
        ])('emits a host-less Location for a %s target', async (_label, payload, expected) => {
            mockFetch.mockReturnValueOnce(okJson({ data: payload }));

            const response = await callGet('code99');
            const location = response.headers.get('location')!;

            expect(location).toBe(expected);
            expect(location.startsWith('/')).toBe(true);
            expect(location).not.toContain('0.0.0.0');
            expect(location).not.toContain('://');
        });

        it('never leaks the bind address regardless of the origin the server reports', async () => {
            mockFetch.mockReturnValueOnce(okJson({ data: { kind: 'internal', target_url: '/q/abc' } }));

            // Whatever origin the standalone server reports — bind address,
            // container hostname, anything — must not reach the browser.
            const response = await callGet('abc', 'http://erp71-frontend:3000');

            expect(response.headers.get('location')).toBe('/q/abc');
        });
    });
});
