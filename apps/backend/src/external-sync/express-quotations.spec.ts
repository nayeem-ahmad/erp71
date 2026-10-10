import { ExpressRetailClient } from './express-retail.client';
import { mapQuotation, type SyncWarning } from './external-sync.mapper';
import { EXPRESS_RETAIL_DEFINITION } from './provider-adapter';

/**
 * Express Retail quotations: a `/get-quotation` header list and a
 * `/get-quotation-details` line list for the same window, paired by
 * `quotation_id` exactly as sales are. Shaped from real rows, names dropped.
 */

const HEADER: any = {
    id: 2704,
    invoice: '2600628',
    customer_id: '45494',
    customer_type: 'retail',
    customer_name: null,
    customer_phone: null,
    customer_address: null,
    date: '2026-10-08',
    subtotal: '116000.000',
    discount: '0.000',
    discountAmount: '0.000',
    vat: '0.000',
    vatAmount: '0.000',
    transport_cost: '3000.000',
    total: '119000.000',
    description: null,
    status: 'a',
    created_at: '2026-10-08T06:44:03.000000Z',
    updated_at: '2026-10-08T06:44:03.000000Z',
    organization_id: '262',
};

function line(overrides: Record<string, unknown> = {}): any {
    return {
        id: '34099',
        quotation_id: '2704',
        product_id: '123199',
        quantity: '20.00',
        unit_price: '5800.000',
        discount: '0.000',
        discountAmount: '0.000',
        total: '116000.000',
        note: null,
        is_service: 'false',
        status: 'a',
        organization_id: '262',
        invoice: '2600628',
        date: '2026-10-08',
        ...overrides,
    };
}

describe('mapQuotation (Express Retail)', () => {
    it('maps a header and its lines onto our quotation shape', () => {
        const warnings: SyncWarning[] = [];
        const mapped = mapQuotation(HEADER, [line()], 'XR-', warnings);

        expect(mapped).toEqual({
            externalId: '2704',
            quoteNumber: 'XR-2600628',
            referenceNumber: '2600628',
            externalCustomerId: '45494',
            // The header total, transport included, not the sum of the lines.
            totalAmount: 119000,
            quoteDate: new Date('2026-10-08T00:00:00.000Z'),
            validUntil: null,
            status: 'SENT',
            notes: null,
            externalUpdatedAt: new Date('2026-10-08T06:44:03.000Z'),
            items: [{ externalProductId: '123199', quantity: 20, unitPrice: 5800 }],
        });
        expect(warnings).toEqual([]);
    });

    it('offers a discounted line at its net unit price', () => {
        const mapped = mapQuotation(
            HEADER,
            [line({ quantity: '10.00', unit_price: '670.000', discountAmount: '70.000', total: '6630.000' })],
            'XR-',
            [],
        );
        expect(mapped.items).toEqual([{ externalProductId: '123199', quantity: 10, unitPrice: 663 }]);
    });

    it('rounds a fractional quantity and says so', () => {
        const warnings: SyncWarning[] = [];
        const mapped = mapQuotation(HEADER, [line({ quantity: '2.50', unit_price: '100.000', total: '250.000' })], 'XR-', warnings);

        expect(mapped.items).toEqual([{ externalProductId: '123199', quantity: 3, unitPrice: 100 }]);
        expect(warnings).toEqual([expect.objectContaining({ entity: 'QUOTATION', code: 'QUANTITY_ROUNDED', externalId: '2704' })]);
    });

    it('imports a quotation whose lines did not come back with its total, and warns', () => {
        const warnings: SyncWarning[] = [];
        const mapped = mapQuotation(HEADER, [], 'XR-', warnings);

        expect(mapped.items).toEqual([]);
        expect(mapped.totalAmount).toBe(119000);
        expect(warnings).toEqual([expect.objectContaining({ entity: 'QUOTATION', code: 'QUOTATION_LINES_MISSING' })]);
    });

    it('keeps the description as notes and treats a blank customer as none', () => {
        const mapped = mapQuotation({ ...HEADER, customer_id: '', description: 'valid for 7 days' }, [line()], 'XR-', []);
        expect(mapped.externalCustomerId).toBeNull();
        expect(mapped.notes).toBe('valid for 7 days');
    });
});

describe('Express Retail provider quotations', () => {
    const credentials = { baseUrl: 'https://erp.example.com', username: 'user', password: 'secret' };
    const window = { from: '2026-10-01', to: '2026-10-31' };

    afterEach(() => jest.restoreAllMocks());

    it('pairs each quotation with its own lines', async () => {
        const other = { ...HEADER, id: 2705, invoice: '2600629' };
        const lines = [line(), line({ id: '34100', quotation_id: '2705', product_id: '98497' }), line({ id: '34101', quotation_id: '2704', product_id: '98496' })];
        jest.spyOn(ExpressRetailClient.prototype, 'fetchQuotations').mockResolvedValue([HEADER, other]);
        jest.spyOn(ExpressRetailClient.prototype, 'fetchQuotationLines').mockResolvedValue(lines);

        const client = EXPRESS_RETAIL_DEFINITION.createClient(credentials);
        const docs = await client.fetchQuotationDocuments!(window);

        expect(docs).toEqual([
            { header: HEADER, lines: [lines[0], lines[2]] },
            { header: other, lines: [lines[1]] },
        ]);
    });

    it('maps those documents through the Express definition', () => {
        const mapped = EXPRESS_RETAIL_DEFINITION.mappers.quotation!({ header: HEADER, lines: [line()] }, 'XR-', []);
        expect(mapped).toEqual(mapQuotation(HEADER, [line()], 'XR-', []));
    });
});
