import { seedFromQuotation, seedFromSale, seedFromSalesOrder } from './source-document';

const INCLUDED = { defaultVatRate: 15, pricesIncludeVat: true };
const ON_TOP = { defaultVatRate: 15, pricesIncludeVat: false };

const sale = (overrides: Record<string, unknown> = {}) => ({
    id: 'sale-1',
    serial_number: 'S-1',
    total_amount: '1138.50',
    prices_include_vat: false,
    items: [{ product_id: 'p1', quantity: 1, price_at_sale: '1150.00', vat_rate: '15.00', sd_rate: '0', product: { name: 'Rice' } }],
    ...overrides,
});

describe('seedFromSale (Duplicate)', () => {
    it('copies a sale into a before-VAT shop in those terms, with its discount', () => {
        const seeded = seedFromSale(sale(), ON_TOP);

        expect(seeded.items[0]).toEqual(expect.objectContaining({ price: 1000, vatRate: 15, sdRate: 0 }));
        // 1,150 lines less a 1,138.50 total is 11.50 VAT-inclusive, 10 before VAT.
        expect(seeded.discountAmount).toBe(10);
        expect(seeded.rounding).toBe(0);
    });

    it('copies into a VAT-inclusive shop as before: stored prices and the gap as rounding', () => {
        const seeded = seedFromSale(sale(), INCLUDED);

        expect(seeded.items[0].price).toBe(1150);
        expect(seeded.rounding).toBe(-11.5);
        expect(seeded.discountAmount).toBe(0);
    });
});

describe('seedFromQuotation / seedFromSalesOrder', () => {
    const quote = (pricesIncludeVat: boolean, unitPrice: string) => ({
        id: 'q1',
        quote_number: 'Q-1',
        currency: 'BDT',
        prices_include_vat: pricesIncludeVat,
        items: [{ product_id: 'p1', quantity: 2, unit_price: unitPrice, product: { name: 'Rice', vat_rate: null } }],
    });

    it('takes the lines as they stand when the quotation was priced the way the shop prices now', () => {
        expect(seedFromQuotation(quote(false, '1000'), ON_TOP).items[0].price).toBe(1000);
        expect(seedFromQuotation(quote(true, '1150'), INCLUDED).items[0].price).toBe(1150);
    });

    it('converts the price when the shop has since switched how it prices', () => {
        expect(seedFromQuotation(quote(false, '1000'), INCLUDED).items[0].price).toBe(1150);
        expect(seedFromQuotation(quote(true, '1150'), ON_TOP).items[0].price).toBe(1000);
    });

    it('takes a foreign-currency proforma’s price as it stands', () => {
        const proforma = { ...quote(true, '10'), currency: 'USD', exchange_rate: '120' };
        expect(seedFromQuotation(proforma, ON_TOP).items[0].price).toBe(1200);
    });

    it('carries the product’s own rate onto the line', () => {
        const zeroRated = {
            ...quote(false, '1000'),
            items: [{ product_id: 'p1', quantity: 1, unit_price: '1000', product: { name: 'Book', vat_rate: '0.00' } }],
        };
        expect(seedFromQuotation(zeroRated, INCLUDED).items[0]).toEqual(expect.objectContaining({ price: 1000, vatRate: 0 }));
    });

    it('converts a sales order the same way', () => {
        const order = {
            id: 'o1',
            order_number: 'SO-1',
            prices_include_vat: false,
            items: [{ product_id: 'p1', quantity: 1, price_at_order: '1000', product: { name: 'Rice' } }],
        };
        expect(seedFromSalesOrder(order, ON_TOP).items[0].price).toBe(1000);
        expect(seedFromSalesOrder(order, INCLUDED).items[0].price).toBe(1150);
    });
});
