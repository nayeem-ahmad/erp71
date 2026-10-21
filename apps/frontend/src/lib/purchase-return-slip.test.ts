import {
    applyScan,
    exactSkuMatch,
    filterLines,
    purchaseMatchesQuery,
    remainingQuantity,
    resolveLineEnter,
    returnAllRemaining,
    setSlipQuantity,
    slipTotal,
} from './purchase-return-slip';
import type { SlipLine } from './purchase-return-slip';

const OIL: SlipLine = {
    id: 'oil',
    name: 'Soyabean oil 5L',
    sku: 'OIL-5',
    purchased: 10,
    remaining: 10,
    unitCost: 1180,
};
const RICE: SlipLine = {
    id: 'rice',
    name: 'Loose rice',
    sku: 'RICE',
    purchased: 12,
    remaining: 8,
    unitCost: 3400,
};
const RICE_AGAIN: SlipLine = {
    id: 'rice-2',
    name: 'Loose rice (second lot)',
    sku: 'RICE',
    purchased: 4,
    remaining: 4,
    unitCost: 3400,
};

describe('purchase return slip', () => {
    it('counts what is left after earlier returns', () => {
        expect(remainingQuantity(5, 1)).toBe(4);
        expect(remainingQuantity(5, 9)).toBe(0);
    });

    it('matches a line by name or SKU and keeps the list when the query is empty', () => {
        expect(filterLines([OIL, RICE], '').map((line) => line.id)).toEqual(['oil', 'rice']);
        expect(filterLines([OIL, RICE], 'oil').map((line) => line.id)).toEqual(['oil']);
        expect(filterLines([OIL, RICE], 'rice').map((line) => line.id)).toEqual(['rice']);
    });

    it('treats one exact SKU as a scan and two lines sharing it as a choice', () => {
        expect(exactSkuMatch([OIL, RICE], 'oil-5')?.id).toBe('oil');
        expect(exactSkuMatch([RICE, RICE_AGAIN], 'RICE')).toBeNull();
        expect(exactSkuMatch([OIL], '   ')).toBeNull();
    });

    it('adds one on the first scan and one more on the next, and stops at what is left', () => {
        const once = applyScan({}, { ...OIL, remaining: 2 });
        expect(once).toEqual({ oil: 1 });
        const twice = applyScan(once, { ...OIL, remaining: 2 });
        expect(twice).toEqual({ oil: 2 });
        expect(applyScan(twice, { ...OIL, remaining: 2 })).toEqual({ oil: 2 });
    });

    it('clamps a typed quantity and drops the line at zero', () => {
        expect(setSlipQuantity({}, OIL, 2.9)).toEqual({ oil: 2 });
        expect(setSlipQuantity({}, OIL, 40)).toEqual({ oil: 10 });
        expect(setSlipQuantity({ oil: 2 }, OIL, 0)).toEqual({});
        expect(setSlipQuantity({ oil: 2 }, OIL, Number.NaN)).toEqual({});
    });

    it('adds a typed match at the full remaining quantity', () => {
        const action = resolveLineEnter([OIL, RICE], {}, 'soya', 0);
        expect(action).toEqual({ type: 'add-full', lineId: 'oil', quantities: { oil: 10 } });
    });

    it('scans an exact SKU instead of loading the whole line', () => {
        const first = resolveLineEnter([OIL, RICE], {}, 'OIL-5', 0);
        expect(first).toEqual({ type: 'scan', lineId: 'oil', quantities: { oil: 1 } });
        if (first.type !== 'scan') return;
        const second = resolveLineEnter([OIL, RICE], first.quantities, 'OIL-5', 0);
        expect(second).toEqual({ type: 'scan', lineId: 'oil', quantities: { oil: 2 } });
    });

    it('moves to a line that is already on the slip when the search only matches that', () => {
        expect(resolveLineEnter([OIL], { oil: 4 }, 'soya', 0)).toEqual({ type: 'focus', lineId: 'oil' });
    });

    it('does nothing on Enter until there is a query', () => {
        expect(resolveLineEnter([OIL, RICE], {}, '  ', 0)).toEqual({ type: 'none' });
    });

    it('fills every open line and raises a partial to what is left', () => {
        expect(returnAllRemaining([OIL, RICE], { rice: 1 })).toEqual({ oil: 10, rice: 8 });
    });

    it('totals only quantities that are on the slip', () => {
        expect(slipTotal([OIL, RICE], { oil: 2 })).toBe(2360);
    });

    it('finds a purchase by number, supplier, product, or date', () => {
        const row = {
            purchaseNumber: 'PUR-10482',
            supplierName: 'Rahim Traders',
            productText: 'Soyabean oil 5L OIL-5',
            isoDate: '2026-10-12',
            dateLabel: '12 Oct 2026',
        };
        expect(purchaseMatchesQuery(row, '10482')).toBe(true);
        expect(purchaseMatchesQuery(row, 'rahim')).toBe(true);
        expect(purchaseMatchesQuery(row, '2026-10-12')).toBe(true);
        expect(purchaseMatchesQuery(row, 'oct')).toBe(true);
        expect(purchaseMatchesQuery(row, 'sugar')).toBe(false);
    });
});
