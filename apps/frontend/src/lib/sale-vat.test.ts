import { computeEntryTax } from '@erp71/shared-types';
import { enteredBeforeVat, enteredDiscount, enteredUnitPrice, productTaxRates, saleLineRates } from './sale-vat';

describe('productTaxRates', () => {
    it('reads the Decimal strings the API sends, keeping "none of its own" as null', () => {
        expect(productTaxRates({ vat_rate: '15.00', sd_rate: null })).toEqual({ vatRate: 15, sdRate: null });
        // An explicit zero is a zero-rated product, not a missing rate.
        expect(productTaxRates({ vat_rate: '0.00', sd_rate: '10' })).toEqual({ vatRate: 0, sdRate: 10 });
        expect(productTaxRates(undefined)).toEqual({ vatRate: null, sdRate: null });
    });
});

describe('enteredBeforeVat', () => {
    it('is true only for a document that says so', () => {
        expect(enteredBeforeVat({ prices_include_vat: false })).toBe(true);
        expect(enteredBeforeVat({ prices_include_vat: true })).toBe(false);
        // Rows from before the flag existed, and POS sales, include VAT.
        expect(enteredBeforeVat({})).toBe(false);
        expect(enteredBeforeVat(null)).toBe(false);
    });
});

describe('saleLineRates', () => {
    it('prefers the rate the line was posted at over today’s catalogue', () => {
        expect(saleLineRates({ vat_rate: '15.00', product: { vat_rate: '5.00' } }, 10)).toEqual({ vatRate: 15, sdRate: 0 });
        expect(saleLineRates({ vat_rate: null, product: { vat_rate: '5.00' } }, 10)).toEqual({ vatRate: 5, sdRate: 0 });
        expect(saleLineRates({ vat_rate: null, product: {} }, 10)).toEqual({ vatRate: 10, sdRate: 0 });
    });
});

describe('recovering a sale entered before VAT', () => {
    it('gives back the typed prices and discount from what was stored', () => {
        // As the entry screen posted it: 3 × 333.33 and 2 × 1,499 (with 10% SD),
        // less 57.77 before VAT.
        const lines = [
            { key: 'a', quantity: 3, unitPrice: 333.33, vatRate: 15, sdRate: 0 },
            { key: 'b', quantity: 2, unitPrice: 1499, vatRate: 15, sdRate: 10 },
        ];
        const posted = computeEntryTax(lines, 57.77, false);
        const stored = lines.map((line, index) => ({
            quantity: line.quantity,
            price_at_sale: posted.postedUnitPrices[index],
            vat_rate: line.vatRate,
            sd_rate: line.sdRate,
        }));

        expect(stored.map((item) => enteredUnitPrice(item))).toEqual([333.33, 1499]);

        const gross = stored.reduce((sum, item) => sum + item.quantity * item.price_at_sale, 0);
        const net = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
        expect(Math.abs(enteredDiscount(gross, net, posted.total) - 57.77)).toBeLessThanOrEqual(0.01);
    });

    it('finds no discount where the total is the lines', () => {
        expect(enteredDiscount(1150, 1000, 1150)).toBe(0);
    });
});
