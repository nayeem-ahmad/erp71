/**
 * @jest-environment node
 *
 * Tests for src/middleware.ts.
 *
 * `NextRequest`/`NextResponse` need the real Web Fetch API globals that jsdom
 * does not provide, so this file opts into the `node` environment the same way
 * the route-handler tests do.
 *
 * The routing rules themselves are covered in `lib/domain-routing.test.ts`.
 * What is tested here is the adapter: where the hostname is read from, and that
 * a verdict becomes the response a browser actually sees.
 */
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

const original = {
    marketing: process.env.NEXT_PUBLIC_MARKETING_URL,
    app: process.env.NEXT_PUBLIC_APP_URL,
};

beforeEach(() => {
    process.env.NEXT_PUBLIC_MARKETING_URL = 'https://erp71.com';
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.erp71.com';
});

afterAll(() => {
    process.env.NEXT_PUBLIC_MARKETING_URL = original.marketing;
    process.env.NEXT_PUBLIC_APP_URL = original.app;
});

/**
 * A request as it arrives behind the reverse proxy: the URL is whatever the
 * standalone server bound to, and the real host is in the headers.
 */
function request(host: string, path: string, headers: Record<string, string> = {}) {
    return new NextRequest(`http://0.0.0.0:3000${path}`, { headers: { host, ...headers } });
}

describe('middleware', () => {
    it('sends an app path on the marketing host to the app host', () => {
        const response = middleware(request('erp71.com', '/login?redirect=%2Fsales'));

        expect(response.status).toBe(308);
        expect(response.headers.get('location')).toBe('https://app.erp71.com/login?redirect=%2Fsales');
    });

    it('trusts x-forwarded-host over the host header', () => {
        // Caddy preserves Host, but a proxy that rewrites it must not be able to
        // make every visitor look like they came from the app host.
        const response = middleware(request('erp71-frontend-1:3000', '/dashboard', {
            'x-forwarded-host': 'erp71.com',
        }));

        expect(response.status).toBe(308);
        expect(response.headers.get('location')).toBe('https://app.erp71.com/dashboard');
    });

    it('does not build redirects from the server bind address', () => {
        // `request.nextUrl.origin` is `http://0.0.0.0:3000` inside the standalone
        // server; a Location built from it points nowhere reachable.
        const location = middleware(request('www.erp71.com', '/pricing')).headers.get('location');

        expect(location).toBe('https://erp71.com/pricing');
        expect(location).not.toContain('0.0.0.0');
    });

    it('rewrites the app host front door to the session gate', () => {
        const response = middleware(request('app.erp71.com', '/'));

        expect(response.status).toBe(200);
        // A rewrite, not a redirect: the browser's URL stays at `/`.
        expect(response.headers.get('location')).toBeNull();
        expect(response.headers.get('x-middleware-rewrite')).toContain('/app-entry');
    });

    it('leaves the marketing homepage on the marketing host alone', () => {
        const response = middleware(request('erp71.com', '/'));

        expect(response.headers.get('location')).toBeNull();
        expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    });

    it('leaves localhost entirely alone', () => {
        const response = middleware(request('localhost:3000', '/'));

        expect(response.headers.get('location')).toBeNull();
        expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    });

    it('does nothing at all while the marketing domain is unconfigured', () => {
        delete process.env.NEXT_PUBLIC_MARKETING_URL;

        for (const [host, path] of [['app.erp71.com', '/'], ['erp71.com', '/login']]) {
            const response = middleware(request(host, path));
            expect(response.headers.get('location')).toBeNull();
            expect(response.headers.get('x-middleware-rewrite')).toBeNull();
        }
    });
});
