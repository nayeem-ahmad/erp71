import { computeVat } from './vat';
import { analysePrice, priceForMargin, priceForMarkup } from './margin';
import { computeLandedCost } from './landed-cost';
import { computeZakat, GRAMS_PER_VORI } from './zakat';
import { computeEmi } from './emi';
import { runTape, tapeToMarkdown, type TapeLine } from './tape';
import { countNotes } from './note-counter';
import { convertPrice, convertUnit } from './units';

describe('computeVat', () => {
    it('adds 15% on top', () => {
        expect(computeVat(1000, 15, 0, 'exclusive')).toEqual({ net: 1000, sd: 0, vat: 150, gross: 1150 });
    });
    it('takes 15% back out of an inclusive price', () => {
        expect(computeVat(1150, 15, 0, 'inclusive')).toEqual({ net: 1000, sd: 0, vat: 150, gross: 1150 });
    });
    it('levies SD before VAT and VAT on value plus SD', () => {
        // 1000 + 20% SD = 1200; VAT 15% of 1200 = 180.
        expect(computeVat(1000, 15, 20, 'exclusive')).toEqual({ net: 1000, sd: 200, vat: 180, gross: 1380 });
        expect(computeVat(1380, 15, 20, 'inclusive')).toEqual({ net: 1000, sd: 200, vat: 180, gross: 1380 });
    });
});

describe('margin', () => {
    it('does not count VAT as profit', () => {
        const r = analysePrice(800, 1150, 15, true);
        expect(r.netPrice).toBe(1000);
        expect(r.profit).toBe(200);
        expect(r.marginPct).toBe(20);
        expect(r.markupPct).toBe(25);
    });
    it('prices for a margin and a markup, with the shelf price after VAT', () => {
        expect(priceForMargin(750, 25, 15)).toMatchObject({ netPrice: 1000, shelfPrice: 1150, marginPct: 25 });
        expect(priceForMarkup(800, 25, 0)).toMatchObject({ netPrice: 1000, markupPct: 25 });
        expect(priceForMargin(100, 100, 0)).toBeNull();
    });
});

describe('computeLandedCost', () => {
    it('follows the customs sequence and keeps VAT, AIT and AT out of the cost', () => {
        const r = computeLandedCost({
            cifForeign: 1000, exchangeRate: 120, landingChargePct: 1,
            cdPct: 25, rdPct: 3, sdPct: 0, vatPct: 15, aitPct: 5, atPct: 5,
            otherCharges: 5000, quantity: 100,
        });
        expect(r.cifBdt).toBe(120000);
        expect(r.assessableValue).toBe(121200);
        expect(r.cd).toBe(30300);
        expect(r.rd).toBe(3636);
        // VAT base: 121200 + 30300 + 3636 = 155136.
        expect(r.vat).toBe(23270.4);
        expect(r.at).toBe(7756.8);
        expect(r.ait).toBe(6060);
        expect(r.landedCost).toBe(121200 + 30300 + 3636 + 5000);
        expect(r.perUnit).toBe(1601.36);
        expect(r.recoverable).toBeCloseTo(37087.2, 2);
    });
});

describe('computeZakat', () => {
    const base = { cash: 0, bank: 0, stock: 0, receivables: 0, goldValue: 0, silverValue: 0, otherAssets: 0, liabilities: 0, goldPricePerVori: 140000, silverPricePerVori: 2500, nisabBasis: 'silver' as const };
    it('charges 2.5% of net wealth over the nisab', () => {
        const r = computeZakat({ ...base, cash: 300000, stock: 800000, liabilities: 100000 });
        expect(r.netWealth).toBe(1000000);
        expect(r.due).toBe(true);
        expect(r.zakat).toBe(25000);
        expect(r.nisab).toBeCloseTo((595 / GRAMS_PER_VORI) * 2500, 1);
    });
    it('owes nothing below the nisab', () => {
        const r = computeZakat({ ...base, cash: 50000, nisabBasis: 'gold' });
        expect(r.due).toBe(false);
        expect(r.zakat).toBe(0);
    });
});

describe('computeEmi', () => {
    it('matches the standard reducing-balance EMI and ends on zero', () => {
        const r = computeEmi(100000, 12, 12, 'reducing')!;
        expect(r.emi).toBe(8884.88);
        expect(r.schedule).toHaveLength(12);
        expect(r.schedule[11].balance).toBe(0);
        expect(r.totalInterest).toBeCloseTo(6618.55, 1);
    });
    it('shows how much more a flat rate costs', () => {
        const flat = computeEmi(100000, 12, 12, 'flat')!;
        expect(flat.totalInterest).toBe(12000);
        expect(flat.emi).toBe(9333.33);
    });
    it('handles zero interest and refuses nonsense', () => {
        expect(computeEmi(12000, 0, 12, 'reducing')!.emi).toBe(1000);
        expect(computeEmi(0, 10, 12, 'reducing')).toBeNull();
        expect(computeEmi(1000, 10, 0, 'reducing')).toBeNull();
    });
});

describe('runTape', () => {
    const line = (op: TapeLine['op'], value: number, label = ''): TapeLine => ({ id: String(value), op, value, label });
    it('works left to right like an adding machine', () => {
        expect(runTape([line('+', 100), line('+', 50), line('×', 2), line('-', 10)])).toEqual({ totals: [100, 150, 300, 290], total: 290 });
    });
    it('ignores a divide by zero', () => {
        expect(runTape([line('+', 100), line('÷', 0)]).total).toBe(100);
    });
    it('writes a markdown table for Notes', () => {
        const md = tapeToMarkdown([line('+', 100, 'Rice'), line('+', 50, 'Dal')], { item: 'Item', amount: 'Amount', total: 'Total' }, String);
        expect(md).toContain('| Rice | + 100 | 100 |');
        expect(md).toContain('**Total: 150**');
    });
});

describe('countNotes', () => {
    it('adds the notes and the coins', () => {
        const r = countNotes({ 1000: 3, 500: 2, 20: 4, 2: 1 }, 7);
        expect(r.notesTotal).toBe(4082);
        expect(r.pieces).toBe(10);
        expect(r.total).toBe(4089);
    });
});

describe('units', () => {
    it('converts the old weights', () => {
        expect(convertUnit('weight', 1, 'maund', 'kg')).toBeCloseTo(37.3248, 4);
        expect(convertUnit('weight', 1, 'seer', 'chhatak')).toBeCloseTo(16, 6);
    });
    it('converts gold: 1 vori = 16 ana = 96 roti', () => {
        expect(convertUnit('gold', 1, 'vori', 'ana')).toBeCloseTo(16, 6);
        expect(convertUnit('gold', 1, 'vori', 'roti')).toBeCloseTo(96, 6);
        expect(convertUnit('gold', 1, 'vori', 'g')).toBeCloseTo(11.664, 6);
    });
    it('converts land and cloth', () => {
        expect(convertUnit('land', 1, 'bigha', 'kattha')).toBeCloseTo(20, 6);
        expect(convertUnit('land', 1, 'bigha', 'decimal')).toBeCloseTo(33.06, 2);
        expect(convertUnit('length', 1, 'goj', 'haat')).toBeCloseTo(2, 6);
    });
    it('converts a price per unit the other way from a quantity', () => {
        expect(convertPrice('weight', 2400, 'maund', 'kg')).toBeCloseTo(64.3, 1);
    });
});
