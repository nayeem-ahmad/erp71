import { sameReturnLines, type StoredReturnLine } from './return-lines.util';

describe('sameReturnLines()', () => {
    const stored: StoredReturnLine[] = [
        { key: 'si-1', productId: 'p-1', quantity: 3, warehouseId: null, amount: 300 },
        { key: 'si-2', productId: 'p-2', quantity: 1, warehouseId: 'wh-annex', amount: 50 },
    ];

    it('takes the stored lines sent back, in any order, as unchanged', () => {
        expect(sameReturnLines(stored, [
            { key: 'si-2', quantity: 1 },
            { key: 'si-1', productId: 'p-1', quantity: 3 },
        ], 'wh-1')).toBe(true);
    });

    it('sees a different quantity, a missing line or an extra line', () => {
        expect(sameReturnLines(stored, [{ key: 'si-1', quantity: 2 }, { key: 'si-2', quantity: 1 }], 'wh-1')).toBe(false);
        expect(sameReturnLines(stored, [{ key: 'si-1', quantity: 3 }], 'wh-1')).toBe(false);
        expect(sameReturnLines(stored, [
            { key: 'si-1', quantity: 3 },
            { key: 'si-2', quantity: 1 },
            { key: 'si-3', quantity: 1 },
        ], 'wh-1')).toBe(false);
    });

    it('needs the key the edit matches on', () => {
        expect(sameReturnLines(stored, [{ quantity: 3 }, { key: 'si-2', quantity: 1 }], 'wh-1')).toBe(false);
        expect(sameReturnLines(stored, [{ key: 'si-9', quantity: 3 }, { key: 'si-2', quantity: 1 }], 'wh-1')).toBe(false);
    });

    it('reads a named warehouse against where the line sits; an unnamed one leaves it there', () => {
        // si-1 has no warehouse of its own, so it sits in the return's.
        expect(sameReturnLines(stored, [
            { key: 'si-1', quantity: 3, warehouseId: 'wh-1' },
            { key: 'si-2', quantity: 1, warehouseId: 'wh-annex' },
        ], 'wh-1')).toBe(true);
        expect(sameReturnLines(stored, [
            { key: 'si-1', quantity: 3, warehouseId: 'wh-annex' },
            { key: 'si-2', quantity: 1 },
        ], 'wh-1')).toBe(false);
        expect(sameReturnLines(stored, [
            { key: 'si-1', quantity: 3 },
            { key: 'si-2', quantity: 1, warehouseId: 'wh-1' },
        ], 'wh-1')).toBe(false);
    });

    it('compares a product or an amount only where the edit sends one', () => {
        expect(sameReturnLines(stored, [
            { key: 'si-1', productId: 'p-9', quantity: 3 },
            { key: 'si-2', quantity: 1 },
        ], 'wh-1')).toBe(false);
        expect(sameReturnLines(stored, [
            { key: 'si-1', quantity: 3, amount: 300.001 },
            { key: 'si-2', quantity: 1, amount: 50 },
        ], 'wh-1')).toBe(true);
        expect(sameReturnLines(stored, [
            { key: 'si-1', quantity: 3, amount: 330 },
            { key: 'si-2', quantity: 1 },
        ], 'wh-1')).toBe(false);
    });

    it('matches each stored line to one sent line', () => {
        const twice: StoredReturnLine[] = [
            { key: 'si-1', productId: 'p-1', quantity: 1, warehouseId: null, amount: 100 },
            { key: 'si-1', productId: 'p-1', quantity: 2, warehouseId: null, amount: 200 },
        ];
        expect(sameReturnLines(twice, [{ key: 'si-1', quantity: 2 }, { key: 'si-1', quantity: 1 }], null)).toBe(true);
        expect(sameReturnLines(twice, [{ key: 'si-1', quantity: 1 }, { key: 'si-1', quantity: 1 }], null)).toBe(false);
    });

    it('no lines on either side is no change', () => {
        expect(sameReturnLines([], [], null)).toBe(true);
    });
});
