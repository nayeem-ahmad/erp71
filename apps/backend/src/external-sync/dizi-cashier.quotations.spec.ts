import { BadGatewayException } from '@nestjs/common';
import { DiziCashierClient } from './dizi-cashier.client';
import { mapDiziQuotation } from './dizi-cashier.mapper';
import { SyncWarning } from './external-sync.mapper';

type StubResponse = { status?: number; body?: unknown; text?: string };

/** Answers by URL, so the probe order can be asserted from the recorded calls. */
function stubFetch(route: (url: string) => StubResponse) {
    const calls: string[] = [];
    (global as any).fetch = jest.fn(async (url: string) => {
        calls.push(url);
        const stub = route(url);
        const status = stub.status ?? 200;
        return {
            status,
            ok: status >= 200 && status < 300,
            text: async () => stub.text ?? JSON.stringify(stub.body ?? {}),
            headers: { get: () => null },
        } as any;
    });
    return calls;
}

const CREDS = { baseUrl: 'https://api.dizicashier.com', username: 'u', password: 'p' };
const LOGIN = { body: { access_token: 'T', OrganizationId: 'org-1' } };
const page = (rows: unknown[], total = rows.length): StubResponse => ({
    body: { Success: true, Data: { ModelList: rows, TotalItem: total } },
});
const SQL_ERROR: StubResponse = { status: 500, body: { Success: false, ErrorMessage: "Invalid column name 'TransactionDate'." } };
const NOT_FOUND_JSON: StubResponse = { status: 404, body: { Message: 'No HTTP resource was found that matches the request URI' } };
const NOT_FOUND_HTML: StubResponse = { status: 404, text: '<!DOCTYPE html><html>404 - File or directory not found.</html>' };

async function loggedIn() {
    const client = new DiziCashierClient(CREDS);
    await client.login();
    return client;
}

describe('DiziCashierClient quotation route discovery', () => {
    it('uses api/quotation with the first sort the server accepts', async () => {
        const calls = stubFetch((url) => {
            if (url.endsWith('api/account/login')) return LOGIN;
            if (url.includes('sort=TransactionDate-desc')) return SQL_ERROR;
            return page([{ Id: 'q1' }]);
        });
        const client = await loggedIn();

        const rows = await client.fetchQuotationHeaders();

        expect(rows).toEqual([{ Id: 'q1' }]);
        // The full walk reuses the route the probe settled on.
        const walk = calls[calls.length - 1];
        expect(walk).toContain('/api/quotation?');
        expect(walk).toContain('sort=Date-desc');
        expect(walk).toContain('itemsPerPage=500');
    });

    it('moves to the plural path on a 404, including an IIS HTML 404 page', async () => {
        for (const notFound of [NOT_FOUND_JSON, NOT_FOUND_HTML]) {
            const calls = stubFetch((url) => {
                if (url.endsWith('api/account/login')) return LOGIN;
                if (url.includes('/api/quotation?')) return notFound;
                return page([{ Id: 'q1' }]);
            });
            const client = await loggedIn();

            await client.fetchQuotationHeaders();

            // A 404 rules out the whole path — no sort is retried against it.
            expect(calls.filter((url) => url.includes('/api/quotation?'))).toHaveLength(1);
            expect(calls[calls.length - 1]).toContain('/api/quotations?');
        }
    });

    it('fetches the detail from the discovered path', async () => {
        const calls = stubFetch((url) => {
            if (url.endsWith('api/account/login')) return LOGIN;
            if (url.includes('/api/quotation?')) return NOT_FOUND_JSON;
            if (url.includes('/api/quotations/q%201')) return { body: { Success: true, Data: { Id: 'q 1' } } };
            return page([]);
        });
        const client = await loggedIn();

        const detail = await client.fetchQuotationDetail('q 1');

        expect(detail.Id).toBe('q 1');
        expect(calls[calls.length - 1]).toBe('https://api.dizicashier.com/api/quotations/q%201');
    });

    it('names everything it tried when no route works', async () => {
        stubFetch((url) => (url.endsWith('api/account/login') ? LOGIN : NOT_FOUND_JSON));
        const client = await loggedIn();

        const failure = client.fetchQuotationHeaders();

        await expect(failure).rejects.toBeInstanceOf(BadGatewayException);
        await expect(failure).rejects.toThrow(/api\/quotation \(TransactionDate-desc\): HTTP 404; api\/quotations/);
    });

    it('still surfaces an expired session instead of probing on', async () => {
        stubFetch((url) => (url.endsWith('api/account/login') ? LOGIN : { status: 401, body: {} }));
        const client = await loggedIn();

        await expect(client.fetchQuotationHeaders()).rejects.toThrow(/session expired/);
    });
});

describe('mapDiziQuotation', () => {
    const HEADER = {
        Id: 'q-1',
        QuotationNo: 'QT-0042',
        TransactionDate: '2026-08-14T00:00:00',
        TraderId: 'cust-1',
        TotalAmount: 1150,
        IsDeleted: false,
    };
    const DETAIL = {
        Id: 'q-1',
        ValidUntil: '2026-08-28T00:00:00',
        Narration: 'Price valid for two weeks',
        UpdatedOn: '2026-08-14T09:00:00',
        QuotationItems: [
            { ItemId: 'item-1', Quantity: 2, PricePerUnitWithTax: 400, DiscountedPricePerUnitWithTax: 375 },
            { ItemId: 'item-2', Quantity: 1, PricePerUnit: 400 },
        ],
    };

    it('maps header, lines and dates', () => {
        const warnings: SyncWarning[] = [];
        const mapped = mapDiziQuotation(HEADER, DETAIL, 'DZ-', warnings);

        expect(mapped).toMatchObject({
            externalId: 'q-1',
            quoteNumber: 'DZ-QT-0042',
            referenceNumber: 'QT-0042',
            externalCustomerId: 'cust-1',
            totalAmount: 1150,
            status: 'SENT',
            notes: 'Price valid for two weeks',
        });
        expect(mapped.quoteDate).toEqual(new Date('2026-08-14T00:00:00.000Z'));
        expect(mapped.validUntil).toEqual(new Date('2026-08-28T00:00:00.000Z'));
        // The discounted, tax-inclusive price wins where Dizi gives one.
        expect(mapped.items).toEqual([
            { externalProductId: 'item-1', quantity: 2, unitPrice: 375 },
            { externalProductId: 'item-2', quantity: 1, unitPrice: 400 },
        ]);
        expect(warnings).toEqual([]);
    });

    it('reads the alternative field names and derives a unit price from the line total', () => {
        const mapped = mapDiziQuotation(
            { Id: 'q-2', SlipNo: '77', QuotationDate: '2026-01-05', CustomerId: 'cust-2' },
            { Id: 'q-2', ExpiryDate: '2026-01-20', Note: 'n', Items: [{ ItemId: 'i', Quantity: 4, TotalAmount: 100 }] },
            'DZ-',
            [],
        );

        expect(mapped.quoteNumber).toBe('DZ-77');
        expect(mapped.externalCustomerId).toBe('cust-2');
        expect(mapped.quoteDate).toEqual(new Date('2026-01-05T00:00:00.000Z'));
        expect(mapped.validUntil).toEqual(new Date('2026-01-20T00:00:00.000Z'));
        expect(mapped.notes).toBe('n');
        expect(mapped.items).toEqual([{ externalProductId: 'i', quantity: 4, unitPrice: 25 }]);
        // No header total, so the lines supply it.
        expect(mapped.totalAmount).toBe(100);
    });

    it.each([
        [{ Status: 'Approved' }, 'ACCEPTED'],
        [{ Status: 'cancelled' }, 'REJECTED'],
        [{ Status: 'Expired' }, 'EXPIRED'],
        [{ Status: 'something new' }, 'SENT'],
        [{ IsConverted: true }, 'CONVERTED'],
        [{ Status: 'Pending', SalesId: 'sale-9' }, 'CONVERTED'],
    ])('maps %j to %s', (extra, status) => {
        const mapped = mapDiziQuotation(HEADER, { ...DETAIL, ...extra }, 'DZ-', []);
        expect(mapped.status).toBe(status);
    });

    it('imports a header whose detail failed, and says so', () => {
        const warnings: SyncWarning[] = [];
        const mapped = mapDiziQuotation(HEADER, null, 'DZ-', warnings);

        expect(mapped.items).toEqual([]);
        expect(mapped.totalAmount).toBe(1150);
        expect(warnings.map((w) => w.code)).toEqual(['QUOTATION_LINES_MISSING']);
    });

    it('rounds a fractional quantity and warns', () => {
        const warnings: SyncWarning[] = [];
        const mapped = mapDiziQuotation(
            HEADER,
            { ...DETAIL, QuotationItems: [{ ItemId: 'item-1', Quantity: 2.5, PricePerUnit: 10 }] },
            'DZ-',
            warnings,
        );

        expect(mapped.items[0].quantity).toBe(3);
        expect(warnings.map((w) => [w.entity, w.code])).toEqual([['QUOTATION', 'QUANTITY_ROUNDED']]);
    });

    it('falls back to the row id when Dizi gives no number', () => {
        const mapped = mapDiziQuotation({ Id: 'q-3', Date: '2026-02-01' }, { Id: 'q-3', Items: [] }, 'DZ-', []);
        expect(mapped.quoteNumber).toBe('DZ-q-3');
        expect(mapped.referenceNumber).toBeNull();
    });
});
