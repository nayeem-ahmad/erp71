import { BadGatewayException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ExpressRetailClient, assertValidBaseUrl } from './express-retail.client';

type StubResponse = {
    status?: number;
    ok?: boolean;
    body?: unknown;
    text?: string;
    setCookie?: string[];
};

/**
 * Stubs global fetch and records every call so the tests can assert on the
 * headers we send — the cookie/XSRF handshake is the part most likely to
 * silently regress.
 */
function stubFetch(responses: StubResponse[]) {
    const calls: Array<{ url: string; init: any }> = [];
    let index = 0;

    const impl = jest.fn(async (url: string, init: any) => {
        calls.push({ url, init });
        const stub = responses[Math.min(index, responses.length - 1)];
        index += 1;

        const status = stub.status ?? 200;
        const text = stub.text ?? JSON.stringify(stub.body ?? {});

        return {
            status,
            ok: stub.ok ?? (status >= 200 && status < 300),
            text: async () => text,
            headers: {
                getSetCookie: () => stub.setCookie ?? [],
                get: () => null,
            },
        } as any;
    });

    (global as any).fetch = impl;
    return calls;
}

const LOGIN_OK = {
    setCookie: [
        'XSRF-TOKEN=token%2Bwith%2Fencoding; Path=/',
        'laravel_session=abc123; Path=/; HttpOnly',
    ],
    body: {
        status: true,
        message: 'Successfully Login',
        data: { id: 604, username: 'user', name: 'Towfiq', organization_id: '262', role: 'admin' },
    },
};

describe('assertValidBaseUrl', () => {
    it('accepts an https origin and strips any path', () => {
        expect(assertValidBaseUrl('https://www.expressretailerp.com/module/dashboard')).toBe(
            'https://www.expressretailerp.com',
        );
    });

    it('rejects plaintext http', () => {
        expect(() => assertValidBaseUrl('http://www.expressretailerp.com')).toThrow(BadRequestException);
    });

    it('rejects a non-URL', () => {
        expect(() => assertValidBaseUrl('expressretailerp.com')).toThrow(BadRequestException);
    });
});

describe('ExpressRetailClient', () => {
    const credentials = { baseUrl: 'https://erp.example.com', username: 'user', password: 'secret' };

    afterEach(() => {
        jest.restoreAllMocks();
        delete (global as any).fetch;
    });

    it('logs in and returns the provider session', async () => {
        stubFetch([{ setCookie: ['XSRF-TOKEN=abc; Path=/'] }, LOGIN_OK]);

        const client = new ExpressRetailClient(credentials);
        const session = await client.login();

        expect(session).toEqual({
            userId: 604,
            username: 'user',
            name: 'Towfiq',
            organizationId: '262',
            role: 'admin',
        });
    });

    it('sends the XSRF cookie back URL-decoded, which is what Laravel checks', async () => {
        const calls = stubFetch([
            { setCookie: [] },
            LOGIN_OK,
            { body: { status: true, data: { sales: [] } } },
        ]);

        const client = new ExpressRetailClient(credentials);
        await client.login();
        await client.fetchSales({ from: '2026-01-01', to: '2026-01-31' });

        const dataCall = calls[2];
        expect(dataCall.init.headers['X-XSRF-TOKEN']).toBe('token+with/encoding');
        expect(dataCall.init.headers.Cookie).toContain('laravel_session=abc123');
        expect(dataCall.init.headers.Cookie).toContain('XSRF-TOKEN=token%2Bwith%2Fencoding');
    });

    it('posts the date window the provider expects', async () => {
        const calls = stubFetch([
            { setCookie: [] },
            LOGIN_OK,
            { body: { status: true, data: { sales: [] } } },
        ]);

        const client = new ExpressRetailClient(credentials);
        await client.login();
        await client.fetchSales({ from: '2026-01-01', to: '2026-01-31' });

        expect(calls[2].url).toBe('https://erp.example.com/get-sale');
        expect(JSON.parse(calls[2].init.body)).toEqual({
            searchType: '',
            recordType: 'without',
            dateFrom: '2026-01-01',
            dateTo: '2026-01-31',
        });
    });

    it('surfaces bad credentials as an auth error, not a gateway error', async () => {
        stubFetch([
            { setCookie: [] },
            { status: 401, ok: false, body: { status: false, message: 'Invalid credentials' } },
        ]);

        const client = new ExpressRetailClient(credentials);
        await expect(client.login()).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('refuses to call data endpoints before logging in', async () => {
        stubFetch([{ body: { status: true, data: { sales: [] } } }]);

        const client = new ExpressRetailClient(credentials);
        await expect(client.fetchSales({ from: '2026-01-01', to: '2026-01-31' })).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
    });

    it('treats an HTML response as an expired session rather than parsing garbage', async () => {
        stubFetch([
            { setCookie: [] },
            LOGIN_OK,
            { text: '<!DOCTYPE html><html><body>Login</body></html>' },
        ]);

        const client = new ExpressRetailClient(credentials);
        await client.login();

        await expect(client.fetchSales({ from: '2026-01-01', to: '2026-01-31' })).rejects.toThrow(
            /session likely expired/,
        );
    });

    it('fails loudly when the upstream response shape changes', async () => {
        stubFetch([
            { setCookie: [] },
            LOGIN_OK,
            { body: { status: true, data: { unexpected: [] } } },
        ]);

        const client = new ExpressRetailClient(credentials);
        await client.login();

        await expect(client.fetchSales({ from: '2026-01-01', to: '2026-01-31' })).rejects.toThrow(
            /returned no "sales" array/,
        );
    });

    it('reports a provider-side failure flag as a gateway error', async () => {
        stubFetch([
            { setCookie: [] },
            LOGIN_OK,
            { body: { status: false, message: 'Something broke' } },
        ]);

        const client = new ExpressRetailClient(credentials);
        await client.login();

        await expect(client.fetchPurchases({ from: '2026-01-01', to: '2026-01-31' })).rejects.toBeInstanceOf(
            BadGatewayException,
        );
    });

    it('reads sale and purchase line items from the details endpoints', async () => {
        const calls = stubFetch([
            { setCookie: [] },
            LOGIN_OK,
            { body: { status: true, data: { sales: [{ id: '1', sale_id: '9' }] } } },
            { body: { status: true, data: { purchases: [{ id: '2', purchase_id: '8' }] } } },
        ]);

        const client = new ExpressRetailClient(credentials);
        await client.login();

        const saleLines = await client.fetchSaleLines({ from: '2026-01-01', to: '2026-01-31' });
        const purchaseLines = await client.fetchPurchaseLines({ from: '2026-01-01', to: '2026-01-31' });

        expect(saleLines).toHaveLength(1);
        expect(purchaseLines).toHaveLength(1);
        expect(calls[2].url).toContain('/get-sale-details');
        expect(calls[3].url).toContain('/get-purchase-details');
        // The details endpoints only return rows when searchType is a
        // line-level mode; guard against that regressing to ''.
        expect(JSON.parse(calls[2].init.body).searchType).toBe('quantity');
    });
});
