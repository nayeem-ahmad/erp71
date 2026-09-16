import { buildSaleTaxSnapshot, loadTaxRates, snapshotSaleTax } from './sale-tax.util';

function db(products: any[], defaultVatRate: number | null) {
    return {
        product: { findMany: jest.fn().mockResolvedValue(products) },
        tenant: { findUnique: jest.fn().mockResolvedValue({ default_vat_rate: defaultVatRate }) },
    };
}

describe('loadTaxRates', () => {
    it('prefers the product rate and falls back to the workspace default', async () => {
        const tx = db([
            { id: 'p1', vat_rate: 5, sd_rate: null },
            { id: 'p2', vat_rate: null, sd_rate: null },
        ], 15);

        const rates = await loadTaxRates(tx as any, 't1', ['p1', 'p2']);

        expect(rates.get('p1')).toEqual({ vatRate: 5, sdRate: 0 });
        expect(rates.get('p2')).toEqual({ vatRate: 15, sdRate: 0 });
    });

    it('treats an explicit product zero as exempt rather than unset', async () => {
        const tx = db([{ id: 'p1', vat_rate: 0, sd_rate: null }], 15);
        const rates = await loadTaxRates(tx as any, 't1', ['p1']);
        expect(rates.get('p1')!.vatRate).toBe(0);
    });

    it('reads supplementary duty from the product only — a workspace has no SD rate', async () => {
        const tx = db([{ id: 'p1', vat_rate: 15, sd_rate: 25 }], 15);
        const rates = await loadTaxRates(tx as any, 't1', ['p1']);
        expect(rates.get('p1')).toEqual({ vatRate: 15, sdRate: 25 });
    });

    it('still prices a product that has gone missing since the cart was built', async () => {
        const tx = db([], 15);
        const rates = await loadTaxRates(tx as any, 't1', ['ghost']);
        expect(rates.get('ghost')).toEqual({ vatRate: 15, sdRate: 0 });
    });

    it('asks the database once for a repeated product', async () => {
        const tx = db([{ id: 'p1', vat_rate: 15, sd_rate: null }], 15);
        await loadTaxRates(tx as any, 't1', ['p1', 'p1', 'p1']);
        expect(tx.product.findMany).toHaveBeenCalledTimes(1);
        expect(tx.product.findMany.mock.calls[0][0].where.id.in).toEqual(['p1']);
    });

    it('does not query at all for an empty sale', async () => {
        const tx = db([], 15);
        const rates = await loadTaxRates(tx as any, 't1', []);
        expect(rates.size).toBe(0);
        expect(tx.product.findMany).not.toHaveBeenCalled();
    });
});

describe('buildSaleTaxSnapshot', () => {
    const rates = new Map([
        ['p1', { vatRate: 15, sdRate: 0 }],
        ['p2', { vatRate: 0, sdRate: 0 }],
    ]);

    it('backs the tax out of a tax-inclusive line', () => {
        const snapshot = buildSaleTaxSnapshot(
            [{ productId: 'p1', quantity: 2, priceAtSale: 575 }],
            rates,
        );

        expect(snapshot.lines).toEqual([
            { vat_rate: 15, sd_rate: 0, vat_amount: 150, sd_amount: 0 },
        ]);
        expect(snapshot.vat_amount).toBe(150);
        expect(snapshot.taxable_value).toBe(1000);
    });

    it('keeps two lines of the same product apart', () => {
        const snapshot = buildSaleTaxSnapshot(
            [
                { productId: 'p1', quantity: 1, priceAtSale: 115 },
                { productId: 'p1', quantity: 1, priceAtSale: 230 },
            ],
            rates,
        );

        expect(snapshot.lines.map((l) => l.vat_amount)).toEqual([15, 30]);
    });

    it('spreads an invoice-level discount before taxing, so declared VAT matches what was collected', () => {
        const lines = [
            { productId: 'p1', quantity: 1, priceAtSale: 1150 },
            { productId: 'p1', quantity: 1, priceAtSale: 1150 },
        ];

        const undiscounted = buildSaleTaxSnapshot(lines, rates);
        const discounted = buildSaleTaxSnapshot(lines, rates, 2000);

        expect(undiscounted.vat_amount).toBe(300);
        expect(discounted.vat_amount).toBeLessThan(300);
        // The three parts of the billed amount still reconcile exactly.
        expect(discounted.taxable_value + discounted.vat_amount + discounted.sd_amount).toBe(2000);
    });

    it('leaves an exempt line untaxed', () => {
        const snapshot = buildSaleTaxSnapshot(
            [{ productId: 'p2', quantity: 1, priceAtSale: 500 }],
            rates,
        );
        expect(snapshot.vat_amount).toBe(0);
        expect(snapshot.taxable_value).toBe(500);
    });

    it('prices a product with no resolved rate at zero rather than throwing', () => {
        const snapshot = buildSaleTaxSnapshot(
            [{ productId: 'unknown', quantity: 1, priceAtSale: 100 }],
            rates,
        );
        expect(snapshot).toMatchObject({ vat_amount: 0, sd_amount: 0, taxable_value: 100 });
    });

    it('returns an empty snapshot for a sale with no lines', () => {
        expect(buildSaleTaxSnapshot([], rates)).toEqual({
            lines: [],
            vat_amount: 0,
            sd_amount: 0,
            taxable_value: 0,
        });
    });
});

describe('snapshotSaleTax', () => {
    it('resolves the rates and applies them in one call', async () => {
        const tx = db([{ id: 'p1', vat_rate: 15, sd_rate: 10 }], null);

        const snapshot = await snapshotSaleTax(
            tx as any,
            't1',
            [{ productId: 'p1', quantity: 1, priceAtSale: 1265 }],
        );

        // 1000 value, 10% SD on it, 15% VAT on value plus SD.
        expect(snapshot.lines[0]).toEqual({
            vat_rate: 15,
            sd_rate: 10,
            vat_amount: 165,
            sd_amount: 100,
        });
        expect(snapshot.taxable_value).toBe(1000);
    });

    it('skips the database entirely for an empty sale', async () => {
        const tx = db([], 15);
        await snapshotSaleTax(tx as any, 't1', []);
        expect(tx.tenant.findUnique).not.toHaveBeenCalled();
    });
});
