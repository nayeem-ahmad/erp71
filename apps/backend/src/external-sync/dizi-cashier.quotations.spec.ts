import { DiziCashierClient } from './dizi-cashier.client';
import { mapDiziQuotation } from './dizi-cashier.mapper';
import { SyncWarning } from './external-sync.mapper';

type StubResponse = { status?: number; body?: unknown; text?: string };

/** Answers by URL, so the requests made can be asserted from the recorded calls. */
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
async function loggedIn() {
    const client = new DiziCashierClient(CREDS);
    await client.login();
    return client;
}

// Dizi's own quotation screen (App/Controller/saleQuotationController.js and
// gridListServices.getOrdersDataSaleQuotation) reads api/SaleQuotation/ sorted
// by TransactionDate, and api/SaleQuotation/{id} for one document.
describe('DiziCashierClient quotations', () => {
    it('walks api/SaleQuotation/ sorted by TransactionDate, as Dizi\'s quotation grid does', async () => {
        const calls = stubFetch((url) => (url.endsWith('api/account/login') ? LOGIN : page([{ Id: 'q1' }])));
        const client = await loggedIn();

        const rows = await client.fetchQuotationHeaders();

        expect(rows).toEqual([{ Id: 'q1' }]);
        expect(calls).toHaveLength(2);
        const walk = calls[1];
        expect(walk).toContain('https://api.dizicashier.com/api/SaleQuotation/?');
        expect(walk).toContain('sort=TransactionDate-desc');
        expect(walk).toContain('itemsPerPage=500');
    });

    it('fetches the detail from api/SaleQuotation/{id}', async () => {
        const calls = stubFetch((url) =>
            url.endsWith('api/account/login') ? LOGIN : { body: { Success: true, Data: { Id: 'q 1' } } },
        );
        const client = await loggedIn();

        const detail = await client.fetchQuotationDetail('q 1');

        expect(detail.Id).toBe('q 1');
        expect(calls).toEqual([
            'https://api.dizicashier.com/api/account/login',
            'https://api.dizicashier.com/api/SaleQuotation/q%201',
        ]);
    });

    it('surfaces an expired session', async () => {
        stubFetch((url) => (url.endsWith('api/account/login') ? LOGIN : { status: 401, body: {} }));
        const client = await loggedIn();

        await expect(client.fetchQuotationHeaders()).rejects.toThrow(/session expired/);
    });
});

describe('mapDiziQuotation', () => {
    // Field names as Dizi's quotation screen reads and writes them: the list
    // row (salequotation/list.html) and the detail (saleQuotationController).
    const HEADER = {
        Id: 'q-1',
        QuotationNo: 'QT-0042',
        TransactionDate: '2026-08-14T00:00:00',
        TraderId: 'cust-1',
        TraderName: 'Rahim Traders',
        TotalAmount: 1150,
    };
    const DETAIL = {
        Id: 'q-1',
        QuotationNo: 'QT-0042',
        Date: '2026-08-14T00:00:00',
        ValidUntil: '2026-08-28T00:00:00',
        CustomerId: 'cust-1',
        TotalAmount: 1150,
        Narration: 'Price valid for two weeks',
        // Lines are pre-tax (PricePerUnit x Quantity = SubTotalAmount); the
        // header discount is spread over them as DiscountAmount/DiscountOnTax.
        SaleQuotationItems: [
            { ItemId: 'item-1', Quantity: 2, PricePerUnit: 400, SubTotalAmount: 800, TaxAmount: 40, DiscountAmount: 40, DiscountOnTax: 0, IsDeleted: false },
            { ItemId: 'item-2', Quantity: 1, PricePerUnit: 300, SubTotalAmount: 300, TaxAmount: 60, DiscountAmount: 10, DiscountOnTax: 0, IsDeleted: false },
            { ItemId: 'item-3', Quantity: 5, PricePerUnit: 99, SubTotalAmount: 495, TaxAmount: 0, IsDeleted: true },
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
        // Each price is the line's tax-inclusive, post-discount net per unit,
        // so the lines add up to the quotation total. Deleted lines are dropped.
        expect(mapped.items).toEqual([
            { externalProductId: 'item-1', quantity: 2, unitPrice: 400 },
            { externalProductId: 'item-2', quantity: 1, unitPrice: 350 },
        ]);
        expect(mapped.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)).toBe(mapped.totalAmount);
        expect(warnings).toEqual([]);
    });

    it('reads the alternative field names and derives a unit price from the line subtotal', () => {
        const mapped = mapDiziQuotation(
            { Id: 'q-2', SlipNo: '77', QuotationDate: '2026-01-05', CustomerId: 'cust-2' },
            { Id: 'q-2', ExpiryDate: '2026-01-20', Note: 'n', SaleQuotationItems: [{ ItemId: 'i', Quantity: 4, SubTotalAmount: 100 }] },
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
            { ...DETAIL, SaleQuotationItems: [{ ItemId: 'item-1', Quantity: 2.5, PricePerUnit: 10 }] },
            'DZ-',
            warnings,
        );

        expect(mapped.items[0].quantity).toBe(3);
        // The price stays the offered one; only the quantity is rounded.
        expect(mapped.items[0].unitPrice).toBe(10);
        expect(warnings.map((w) => [w.entity, w.code])).toEqual([['QUOTATION', 'QUANTITY_ROUNDED']]);
    });

    it('falls back to the row id when Dizi gives no number', () => {
        const mapped = mapDiziQuotation({ Id: 'q-3', Date: '2026-02-01' }, { Id: 'q-3', SaleQuotationItems: [] }, 'DZ-', []);
        expect(mapped.quoteNumber).toBe('DZ-q-3');
        expect(mapped.referenceNumber).toBeNull();
    });
});
