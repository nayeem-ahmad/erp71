import { BadGatewayException, UnauthorizedException } from '@nestjs/common';
import { DiziCashierClient } from './dizi-cashier.client';

type StubResponse = {
    status?: number;
    ok?: boolean;
    body?: unknown;
    text?: string;
};

/**
 * Stubs global fetch and records every call so the tests can assert on the
 * bearer header and the pagination query — the two things most likely to
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
            headers: { get: () => null },
        } as any;
    });

    (global as any).fetch = impl;
    return calls;
}

const CREDS = { baseUrl: 'https://api.dizicashier.com', username: '01734287103', password: '12345' };

const LOGIN_OK: StubResponse = {
    body: {
        access_token: 'TOKEN-ABC',
        token_type: 'bearer',
        OrganizationId: 'org-1',
        OrganizationName: 'Life Tech Medical',
        UserName: '01734287103',
        FullName: 'Anisur Rahman Titu',
        IsOwner: 'True',
    },
};

/** One page of a list response in the `{Success, Data:{ModelList, TotalItem}}` envelope. */
function listPage(rows: unknown[], total: number): StubResponse {
    return { body: { Success: true, Data: { ModelList: rows, TotalItem: total } } };
}

describe('DiziCashierClient login', () => {
    it('captures the bearer token and org profile', async () => {
        const calls = stubFetch([LOGIN_OK]);
        const client = new DiziCashierClient(CREDS);

        const session = await client.login();

        expect(session.organizationId).toBe('org-1');
        expect(session.organizationName).toBe('Life Tech Medical');
        expect(session.isOwner).toBe(true);
        // The login call posts JSON credentials to the token endpoint.
        expect(calls[0].url).toBe('https://api.dizicashier.com/api/account/login');
        expect(JSON.parse(calls[0].init.body)).toEqual({ UserName: CREDS.username, Password: CREDS.password });
    });

    it('rejects bad credentials as Unauthorized', async () => {
        stubFetch([{ status: 400, body: { error_description: 'invalid grant' } }]);
        const client = new DiziCashierClient(CREDS);
        await expect(client.login()).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('treats a missing token as a gateway failure', async () => {
        stubFetch([{ status: 200, body: { token_type: 'bearer' } }]);
        const client = new DiziCashierClient(CREDS);
        await expect(client.login()).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('refuses a non-https base URL', () => {
        expect(() => new DiziCashierClient({ ...CREDS, baseUrl: 'http://api.dizicashier.com' })).toThrow();
    });
});

describe('DiziCashierClient list pagination', () => {
    it('sends the bearer token and the sort/page query', async () => {
        const calls = stubFetch([LOGIN_OK, listPage([{ Id: 'a' }], 1)]);
        const client = new DiziCashierClient(CREDS);
        await client.login();

        await client.fetchProducts();

        const listCall = calls[1];
        expect(listCall.init.headers.Authorization).toBe('Bearer TOKEN-ABC');
        expect(listCall.url).toContain('api/item?');
        expect(listCall.url).toContain('sort=Name-desc');
        expect(listCall.url).toContain('page=1');
    });

    it('walks every page until the reported total is collected', async () => {
        const first = Array.from({ length: 500 }, (_, i) => ({ Id: `p${i}` }));
        const second = [{ Id: 'p500' }];
        const calls = stubFetch([LOGIN_OK, listPage(first, 501), listPage(second, 501)]);
        const client = new DiziCashierClient(CREDS);
        await client.login();

        const rows = await client.fetchCustomers();

        expect(rows).toHaveLength(501);
        // login + two list pages
        expect(calls).toHaveLength(3);
        expect(calls[2].url).toContain('page=2');
    });

    it('stops on a short page even when the total disagrees', async () => {
        // TotalItem overstates the count; a page shorter than the page size ends the walk.
        const calls = stubFetch([LOGIN_OK, listPage([{ Id: 'x' }], 999)]);
        const client = new DiziCashierClient(CREDS);
        await client.login();

        const rows = await client.fetchSuppliers();

        expect(rows).toHaveLength(1);
        expect(calls).toHaveLength(2);
    });

    it('surfaces a false Success (a raw SQL error) as a gateway failure', async () => {
        stubFetch([LOGIN_OK, { body: { Success: false, ErrorMessage: "Invalid column name 'CreatedOn'." } }]);
        const client = new DiziCashierClient(CREDS);
        await client.login();
        await expect(client.fetchSaleHeaders()).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('treats an HTML body as an expired/redirected session', async () => {
        stubFetch([LOGIN_OK, { text: '<!DOCTYPE html><html>login</html>' }]);
        const client = new DiziCashierClient(CREDS);
        await client.login();
        await expect(client.fetchProducts()).rejects.toThrow(/HTML instead of JSON/);
    });
});

describe('DiziCashierClient detail fetch', () => {
    it('unwraps the Data envelope for a single document', async () => {
        stubFetch([LOGIN_OK, { body: { Success: true, Data: { Id: 's1', SalesItems: [{ ItemId: 'i1' }] } } }]);
        const client = new DiziCashierClient(CREDS);
        await client.login();

        const detail = await client.fetchSaleDetail('s1');
        expect(detail.Id).toBe('s1');
        expect(detail.SalesItems).toHaveLength(1);
    });

    it('requires a login before any data call', async () => {
        stubFetch([listPage([], 0)]);
        const client = new DiziCashierClient(CREDS);
        await expect(client.fetchProducts()).rejects.toBeInstanceOf(UnauthorizedException);
    });
});
