/**
 * @jest-environment node
 *
 * Tests for src/app/r/[code]/route.ts — the referral tracking redirect.
 *
 * `NextRequest`/`NextResponse` need the real Web Fetch API globals that jsdom
 * does not provide, so this file opts into the `node` Jest environment.
 *
 * The click-tracking POST here was silently going to the wrong URL in
 * production for the same reason the short-link routes were: the configured
 * `NEXT_PUBLIC_API_BASE` is a bare origin with no `/api/v1`, and the tracking
 * write is best-effort, so a 404 looked exactly like success. Nothing on screen
 * ever changed; the referral numbers were simply always zero.
 */
import { NextRequest } from 'next/server';
import { GET } from './route';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const originalApiBase = process.env.NEXT_PUBLIC_API_BASE;
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    delete process.env.NEXT_PUBLIC_API_BASE;
    delete process.env.NEXT_PUBLIC_API_URL;
});

afterAll(() => {
    if (originalApiBase === undefined) delete process.env.NEXT_PUBLIC_API_BASE;
    else process.env.NEXT_PUBLIC_API_BASE = originalApiBase;
    if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
});

async function callGet(code: string) {
    // Origin the standalone server actually reports — see the note in
    // src/app/s/[code]/route.test.ts. Using a real hostname here hid the fact
    // that every referral link emitted `https://0.0.0.0:3000/signup`.
    const request = new NextRequest(`http://0.0.0.0:3000/r/${code}`);
    return GET(request, { params: Promise.resolve({ code }) });
}

describe('GET /r/[code]', () => {
    it('records the click against /api/v1 exactly once when the base omits the prefix', async () => {
        process.env.NEXT_PUBLIC_API_BASE = 'https://api.erp71.com';

        await callGet('partner1');

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, init] = mockFetch.mock.calls[0];
        expect(String(url)).toBe('https://api.erp71.com/api/v1/referrals/clicks/PARTNER1');
        expect(String(url).match(/\/api\/v1(\/|$)/g)?.length ?? 0).toBe(1);
        expect(init?.method).toBe('POST');
    });

    it('does not double the prefix when the configured base already carries it', async () => {
        process.env.NEXT_PUBLIC_API_BASE = 'https://api.erp71.com/api/v1';

        await callGet('partner1');

        expect(String(mockFetch.mock.calls[0][0])).toBe(
            'https://api.erp71.com/api/v1/referrals/clicks/PARTNER1',
        );
    });

    it('redirects to signup carrying the normalized code', async () => {
        const response = await callGet('partner1');

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('/signup?ref=PARTNER1');
    });

    it('still redirects when the tracking call fails', async () => {
        mockFetch.mockRejectedValue(new Error('network down'));

        const response = await callGet('partner1');

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('/signup?ref=PARTNER1');
    });

    it('skips tracking and the ref param entirely for an empty code', async () => {
        const response = await callGet('');

        expect(mockFetch).not.toHaveBeenCalled();
        expect(response.headers.get('location')).toBe('/signup');
    });
});
