import { computeSaleTax } from './mushak';
import { computeEntryTax, grossUpUnitPrice, netUnitPrice } from './vat-pricing';

describe('grossUpUnitPrice / netUnitPrice', () => {
  it('adds VAT, and SD under it, to a before-VAT price', () => {
    expect(grossUpUnitPrice(1000, { vatRate: 15, sdRate: 0 })).toBe(1150);
    // SD on the value, VAT on value + SD: 1000 → 1100 → 1265.
    expect(grossUpUnitPrice(1000, { vatRate: 15, sdRate: 10 })).toBe(1265);
    expect(grossUpUnitPrice(330, { vatRate: 0, sdRate: 0 })).toBe(330);
  });

  it('takes a VAT-inclusive price back to the before-VAT one', () => {
    expect(netUnitPrice(1150, { vatRate: 15, sdRate: 0 })).toBe(1000);
    expect(netUnitPrice(1265, { vatRate: 15, sdRate: 10 })).toBe(1000);
  });

  it('always returns the exact price that was typed, across prices and rates', () => {
    const rates = [0, 5, 7.5, 10, 15, 25, 100];
    const sds = [0, 10, 20, 45];
    for (let paisa = 1; paisa <= 200000; paisa += 137) {
      const price = paisa / 100;
      for (const vatRate of rates) {
        for (const sdRate of sds) {
          const back = netUnitPrice(grossUpUnitPrice(price, { vatRate, sdRate }), { vatRate, sdRate });
          if (back !== price) {
            throw new Error(`${price} at VAT ${vatRate}% SD ${sdRate}% came back as ${back}`);
          }
        }
      }
    }
  });
});

describe('computeEntryTax', () => {
  const line = (key: string, quantity: number, unitPrice: number, vatRate = 15, sdRate = 0) => ({
    key,
    quantity,
    unitPrice,
    vatRate,
    sdRate,
  });

  /**
   * What the server's `prepareSale` will compute from the posted figures, and
   * the VAT it will snapshot — the screen must agree with both, or the sale is
   * refused ("Sale total mismatch") or prints a different VAT than it stores.
   */
  function serverView(result: ReturnType<typeof computeEntryTax>, lines: ReturnType<typeof line>[]) {
    const posted = lines.map((l, i) => ({ ...l, unitPrice: result.postedUnitPrices[i] }));
    const itemsSubtotal = posted.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
    const total = Math.round((Math.max(0, itemsSubtotal - result.postedDiscount)) * 100) / 100;
    return { total, tax: computeSaleTax(posted, total) };
  }

  describe('prices include VAT', () => {
    it('posts what was typed and shows the VAT already inside it', () => {
      const lines = [line('a', 1, 1150)];
      const result = computeEntryTax(lines, 0, true);

      expect(result.postedUnitPrices).toEqual([1150]);
      expect(result.subtotal).toBe(1150);
      expect(result.total).toBe(1150);
      expect(result.vatAmount).toBe(150);
      expect(result.discountShown).toBe(0);
    });

    it('works the VAT out of the discounted total, as the server does', () => {
      const lines = [line('a', 2, 575), line('b', 1, 200, 0)];
      const result = computeEntryTax(lines, 100, true);
      const server = serverView(result, lines);

      expect(result.total).toBe(1250);
      expect(server.total).toBe(result.total);
      expect(server.tax.vatAmount).toBe(result.vatAmount);
      expect(result.discountShown).toBe(100);
    });
  });

  describe('VAT added on top', () => {
    it('adds 15% to a before-VAT price', () => {
      const lines = [line('a', 1, 1000)];
      const result = computeEntryTax(lines, 0, false);

      expect(result.postedUnitPrices).toEqual([1150]);
      expect(result.subtotal).toBe(1000);
      expect(result.vatAmount).toBe(150);
      expect(result.total).toBe(1150);
    });

    it('charges VAT on the amount after the discount', () => {
      // 6,040 less 10 is 6,030; 15% of that is 904.50.
      const lines = [line('a', 1, 6040)];
      const result = computeEntryTax(lines, 10, false);

      expect(result.subtotal).toBe(6040);
      expect(result.vatAmount).toBe(904.5);
      expect(result.total).toBe(6934.5);
      expect(result.discountShown).toBe(10);
    });

    it('foots on its face: sub total − discount + VAT + SD = total', () => {
      const lines = [line('a', 7, 333.33), line('b', 3, 129.99, 7.5, 20), line('c', 11, 18.45, 0)];
      const result = computeEntryTax(lines, 57.77, false);

      expect(
        Math.round((result.subtotal - result.discountShown + result.vatAmount + result.sdAmount) * 100) / 100,
      ).toBe(result.total);
      // Only paisa rounding separates the shown discount from the typed one.
      expect(Math.abs(result.discountShown - 57.77)).toBeLessThanOrEqual(0.05);
    });

    it('posts figures the server accepts, and shows the VAT it will store', () => {
      const cases = [
        { lines: [line('a', 1, 1000)], discount: 0 },
        { lines: [line('a', 3, 6040), line('b', 2, 99.99, 5)], discount: 250 },
        { lines: [line('a', 10, 333.33), line('b', 4, 1499, 15, 10), line('c', 1, 75, 0)], discount: 123.45 },
        { lines: [line('a', 100, 2.37)], discount: 0.01 },
      ];
      for (const { lines, discount } of cases) {
        const result = computeEntryTax(lines, discount, false);
        const server = serverView(result, lines);

        expect(server.total).toBe(result.total);
        expect(server.tax.vatAmount).toBe(result.vatAmount);
        expect(server.tax.sdAmount).toBe(result.sdAmount);
      }
    });

    it('honours each product’s own rate, line by line', () => {
      const result = computeEntryTax([line('a', 1, 1000, 15), line('b', 1, 1000, 0)], 0, false);

      expect(result.postedUnitPrices).toEqual([1150, 1000]);
      expect(result.vatAmount).toBe(150);
      expect(result.total).toBe(2150);
    });

    it('never discounts below zero', () => {
      const result = computeEntryTax([line('a', 1, 100)], 500, false);

      expect(result.total).toBe(0);
      expect(result.postedDiscount).toBe(115);
    });

    it('handles an empty document', () => {
      const result = computeEntryTax([], 0, false);
      expect(result).toMatchObject({ subtotal: 0, total: 0, vatAmount: 0, postedDiscount: 0 });
    });
  });
});
