import {
    priceQuotationForSale,
    quotationExchangeRate,
    quotationSkipReason,
    totalChangedSinceQuoted,
    type QuotationForSale,
} from './quotation-to-sale.util';

const quote = (overrides: Partial<QuotationForSale> = {}): QuotationForSale => ({
    status: 'SENT',
    customer_id: 'cust-1',
    currency: 'BDT',
    exchange_rate: null,
    prices_include_vat: true,
    total_amount: '230',
    items: [
        { product_id: 'p-1', quantity: 2, unit_price: '100', product: { vat_rate: '15', sd_rate: null } },
        { product_id: 'p-2', quantity: 1, unit_price: '30', product: { vat_rate: null, sd_rate: null } },
    ],
    ...overrides,
});

describe('quotationExchangeRate', () => {
    it('is 1 for a BDT document, or one with no currency at all', () => {
        expect(quotationExchangeRate({ currency: 'BDT', exchange_rate: '120' })).toBe(1);
        expect(quotationExchangeRate({ currency: null, exchange_rate: null })).toBe(1);
    });

    it('is the rate written on a foreign document, and 0 when it carries none', () => {
        expect(quotationExchangeRate({ currency: 'USD', exchange_rate: '117.5' })).toBe(117.5);
        expect(quotationExchangeRate({ currency: 'USD', exchange_rate: null })).toBe(0);
    });
});

describe('quotationSkipReason', () => {
    it('lets an open quotation with a customer, lines and a rate through', () => {
        for (const status of ['DRAFT', 'SENT', 'ACCEPTED']) {
            expect(quotationSkipReason(quote({ status }), false)).toBeNull();
        }
    });

    it('refuses a quotation that is converted, superseded or turned down', () => {
        for (const status of ['CONVERTED', 'REVISED', 'REJECTED', 'EXPIRED']) {
            expect(quotationSkipReason(quote({ status }), false)).toBe('NOT_CONVERTIBLE');
        }
    });

    it('refuses one a sale already points at', () => {
        expect(quotationSkipReason(quote(), true)).toBe('ALREADY_INVOICED');
    });

    it('refuses a walk-in quotation, since a credit sale needs someone to owe it', () => {
        expect(quotationSkipReason(quote({ customer_id: null }), false)).toBe('NO_CUSTOMER');
    });

    it('refuses one with no lines', () => {
        expect(quotationSkipReason(quote({ items: [] }), false)).toBe('NO_ITEMS');
    });

    it('refuses a foreign document with no exchange rate', () => {
        expect(quotationSkipReason(quote({ currency: 'USD', exchange_rate: null }), false)).toBe('NO_EXCHANGE_RATE');
    });
});

describe('priceQuotationForSale', () => {
    it('posts a VAT-inclusive quotation at its own prices', () => {
        const pricing = priceQuotationForSale(quote(), 15);

        expect(pricing.items).toEqual([
            { productId: 'p-1', quantity: 2, priceAtSale: 100 },
            { productId: 'p-2', quantity: 1, priceAtSale: 30 },
        ]);
        expect(pricing.totalAmount).toBe(230);
        expect(pricing.quotedTotal).toBe(230);
        expect(pricing.pricesIncludeVat).toBe(true);
        expect(totalChangedSinceQuoted(pricing)).toBe(false);
    });

    it("grosses a before-VAT quotation up with each product's rate, the shop default where it has none", () => {
        // 2 × 100 + 15% and 1 × 30 + the shop's 10%: 230 + 33 = 263 quoted.
        const pricing = priceQuotationForSale(quote({ prices_include_vat: false, total_amount: '263' }), 10);

        expect(pricing.items.map((item) => item.priceAtSale)).toEqual([115, 33]);
        expect(pricing.totalAmount).toBe(263);
        expect(pricing.pricesIncludeVat).toBe(false);
        expect(totalChangedSinceQuoted(pricing)).toBe(false);
    });

    it('translates a foreign proforma at its own rate, to the paisa, and adds no VAT', () => {
        const pricing = priceQuotationForSale(
            quote({
                currency: 'USD',
                exchange_rate: '117.333',
                // An export price: whatever the document says about VAT, none is added.
                prices_include_vat: false,
                total_amount: '50.5',
                items: [{ product_id: 'p-1', quantity: 5, unit_price: '10.1', product: { vat_rate: '15', sd_rate: null } }],
            }),
            15,
        );

        // 10.1 × 117.333 = 1185.0633 → 1185.06 a unit.
        expect(pricing.items[0].priceAtSale).toBe(1185.06);
        expect(pricing.totalAmount).toBe(5925.3);
        expect(pricing.quotedTotal).toBe(5925.32);
        expect(pricing.pricesIncludeVat).toBe(true);
        // Two paisa of rounding across five units is not a changed price.
        expect(totalChangedSinceQuoted(pricing)).toBe(false);
    });

    it('notices when the lines no longer come to the quoted total', () => {
        // The product's VAT went from 15% to 7.5% after this was quoted.
        const pricing = priceQuotationForSale(
            quote({
                prices_include_vat: false,
                total_amount: '115',
                items: [{ product_id: 'p-1', quantity: 1, unit_price: '100', product: { vat_rate: '7.5', sd_rate: null } }],
            }),
            15,
        );

        expect(pricing.totalAmount).toBe(107.5);
        expect(totalChangedSinceQuoted(pricing)).toBe(true);
    });

    it('notices an imported total that was never the sum of its lines', () => {
        const pricing = priceQuotationForSale(quote({ total_amount: '200' }), 15);

        expect(totalChangedSinceQuoted(pricing)).toBe(true);
    });
});
