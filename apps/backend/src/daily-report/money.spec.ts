import { buildTenders, round2 } from './money';

describe('buildTenders', () => {
    it('appends Credit so tenders sum to gross', () => {
        const tenders = buildTenders(1000, [
            { method: 'CASH', amount: 600 },
            { method: 'bKash', amount: 250 },
        ]);
        expect(tenders).toEqual([
            { method: 'CASH', amount: 600 },
            { method: 'bKash', amount: 250 },
            { method: 'Credit', amount: 150 },
        ]);
        expect(round2(tenders.reduce((s, t) => s + t.amount, 0))).toBe(1000);
    });

    it('omits Credit when payments cover gross', () => {
        expect(buildTenders(400, [{ method: 'CASH', amount: 400 }])).toEqual([
            { method: 'CASH', amount: 400 },
        ]);
    });
});
