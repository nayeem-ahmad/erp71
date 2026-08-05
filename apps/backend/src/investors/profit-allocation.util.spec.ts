import { allocateProfit, monthBounds, roundAmount } from './profit-allocation.util';

const investor = (id: string, sharePct: number, lossCarryForward = 0) => ({
    investorId: id,
    sharePct,
    lossCarryForward,
});

describe('allocateProfit', () => {
    it('splits profit by each investor’s percentage', () => {
        const lines = allocateProfit(100_000, [investor('a', 20), investor('b', 5)]);

        expect(lines.map((line) => line.amount)).toEqual([20_000, 5_000]);
        expect(lines.every((line) => line.lossApplied === 0)).toBe(true);
    });

    it('leaves the owner’s share behind — investors only take what they agreed', () => {
        const lines = allocateProfit(100_000, [investor('a', 30)]);

        expect(lines[0].amount).toBe(30_000);
    });

    it('gives the rounding residual to the largest share so the total is exact', () => {
        // Rounded independently these come to 333.34 + 333.33 + 333.33 = 1,000.00,
        // a paisa short of the 1,000.01 the three of them are collectively owed.
        const lines = allocateProfit(1_000.01, [
            investor('a', 33.34),
            investor('b', 33.33),
            investor('c', 33.33),
        ]);

        expect(roundAmount(lines.reduce((sum, line) => sum + line.amount, 0))).toBe(1_000.01);
        // The largest slice absorbs the residual rather than it being dropped.
        expect(lines[0].amount).toBeGreaterThan(lines[1].amount);
    });

    it('sums to the full profit when the percentages total 100', () => {
        const lines = allocateProfit(10_000, [
            investor('a', 33.33),
            investor('b', 33.33),
            investor('c', 33.34),
        ]);

        expect(roundAmount(lines.reduce((sum, line) => sum + line.amount, 0))).toBe(10_000);
    });

    it('accrues nothing in a loss month and banks the loss instead', () => {
        const lines = allocateProfit(-50_000, [investor('a', 20)]);

        expect(lines[0].amount).toBe(0);
        expect(lines[0].grossShare).toBe(-10_000);
        expect(lines[0].lossApplied).toBe(10_000);
        expect(lines[0].lossCarryForwardAfter).toBe(10_000);
    });

    it('never invoices an investor for a loss', () => {
        const lines = allocateProfit(-50_000, [investor('a', 20)]);

        expect(lines[0].amount).toBeGreaterThanOrEqual(0);
    });

    it('pays down a carried loss before declaring cash', () => {
        // 20% of 30,000 = 6,000, all of which clears part of a 10,000 carry.
        const lines = allocateProfit(30_000, [investor('a', 20, 10_000)]);

        expect(lines[0].amount).toBe(0);
        expect(lines[0].lossApplied).toBe(-6_000);
        expect(lines[0].lossCarryForwardAfter).toBe(4_000);
    });

    it('accrues only the surplus once the carried loss is cleared', () => {
        // 20% of 100,000 = 20,000, less a 4,000 carry.
        const lines = allocateProfit(100_000, [investor('a', 20, 4_000)]);

        expect(lines[0].amount).toBe(16_000);
        expect(lines[0].lossApplied).toBe(-4_000);
        expect(lines[0].lossCarryForwardAfter).toBe(0);
    });

    it('carries losses per investor, not pooled', () => {
        const lines = allocateProfit(100_000, [investor('a', 10, 5_000), investor('b', 10)]);

        expect(lines[0].amount).toBe(5_000);
        expect(lines[1].amount).toBe(10_000);
        expect(lines[1].lossCarryForwardAfter).toBe(0);
    });

    it('handles a zero-profit month without moving anything', () => {
        const lines = allocateProfit(0, [investor('a', 25, 1_000)]);

        expect(lines[0].amount).toBe(0);
        expect(lines[0].lossApplied).toBe(0);
        expect(lines[0].lossCarryForwardAfter).toBe(1_000);
    });

    it('returns nothing when there are no investors', () => {
        expect(allocateProfit(100_000, [])).toEqual([]);
    });
});

describe('monthBounds', () => {
    it('covers the whole month', () => {
        expect(monthBounds(2026, 2)).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
        expect(monthBounds(2026, 7)).toMatchObject({ from: '2026-07-01', to: '2026-07-31' });
    });

    it('gets February right in a leap year', () => {
        expect(monthBounds(2028, 2).to).toBe('2028-02-29');
    });

    it('rolls December over correctly', () => {
        expect(monthBounds(2026, 12)).toMatchObject({ from: '2026-12-01', to: '2026-12-31' });
    });
});
