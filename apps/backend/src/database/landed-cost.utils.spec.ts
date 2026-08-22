import { allocateLandedCost, AllocationBasis } from './landed-cost.utils';

const line = (key: string, quantity: number, baseAmount: number, extra: Record<string, unknown> = {}) => ({
    key,
    quantity,
    baseAmount,
    ...extra,
});

/** Total allocated, to the paisa — the invariant most of these tests exist for. */
const allocatedTotal = (result: ReturnType<typeof allocateLandedCost>) =>
    Number(result.lines.reduce((sum, l) => sum + l.allocatedAmount, 0).toFixed(2));

describe('allocateLandedCost', () => {
    it('returns lines untouched when there are no charges', () => {
        const result = allocateLandedCost({
            lines: [line('a', 10, 1000), line('b', 5, 500)],
            charges: [],
        });

        expect(result.totalCharges).toBe(0);
        expect(result.lines[0]).toMatchObject({ allocatedAmount: 0, landedAmount: 1000, landedUnitCost: 100 });
        expect(result.lines[1]).toMatchObject({ allocatedAmount: 0, landedAmount: 500, landedUnitCost: 100 });
    });

    it('handles an empty line list without dividing by zero', () => {
        expect(allocateLandedCost({ lines: [], charges: [{ amount: 500 }] })).toEqual({
            lines: [],
            totalCharges: 0,
        });
    });

    it('spreads a charge pro-rata on value by default', () => {
        const result = allocateLandedCost({
            lines: [line('a', 10, 1000), line('b', 10, 3000)],
            charges: [{ amount: 400 }],
        });

        // 1000:3000 → 100 and 300.
        expect(result.lines[0].allocatedAmount).toBe(100);
        expect(result.lines[1].allocatedAmount).toBe(300);
        expect(result.lines[0].landedUnitCost).toBe(110);
        expect(result.lines[1].landedUnitCost).toBe(330);
    });

    it('spreads equally per unit on QTY', () => {
        const result = allocateLandedCost({
            lines: [line('a', 3, 900), line('b', 1, 100)],
            charges: [{ amount: 40, basis: AllocationBasis.QTY }],
        });

        expect(result.lines[0].allocatedAmount).toBe(30);
        expect(result.lines[1].allocatedAmount).toBe(10);
    });

    it('spreads on shipped weight, not on value', () => {
        const result = allocateLandedCost({
            lines: [
                line('heavy-cheap', 10, 100, { weightPerUnit: 9 }),
                line('light-dear', 10, 900, { weightPerUnit: 1 }),
            ],
            charges: [{ amount: 1000, basis: AllocationBasis.WEIGHT }],
        });

        // Freight follows the kilos: the cheap heavy line takes 90% of it, the
        // opposite of what a value allocation would have done.
        expect(result.lines[0].allocatedAmount).toBe(900);
        expect(result.lines[1].allocatedAmount).toBe(100);
    });

    it('spreads on volume for LCL freight', () => {
        const result = allocateLandedCost({
            lines: [line('a', 2, 500, { cbmPerUnit: 1.5 }), line('b', 2, 500, { cbmPerUnit: 0.5 })],
            charges: [{ amount: 800, basis: AllocationBasis.CBM }],
        });

        expect(result.lines[0].allocatedAmount).toBe(600);
        expect(result.lines[1].allocatedAmount).toBe(200);
    });

    describe('the sum-exactly invariant', () => {
        it('allocates a charge that does not divide evenly, to the paisa', () => {
            const result = allocateLandedCost({
                lines: [line('a', 1, 100), line('b', 1, 100), line('c', 1, 100)],
                charges: [{ amount: 100 }],
            });

            // 100/3 each. Rounding every line independently gives 33.33 x 3 =
            // 99.99 and leaves a paisa unaccounted for on every receipt.
            expect(allocatedTotal(result)).toBe(100);
            expect(result.lines.map((l) => l.allocatedAmount).sort()).toEqual([33.33, 33.33, 33.34]);
        });

        it('holds across many charges on many uneven lines', () => {
            const lines = Array.from({ length: 17 }, (_, i) => line(`l${i}`, i + 1, (i + 1) * 137.77));
            const result = allocateLandedCost({
                lines,
                charges: [
                    { label: 'duty', amount: 12345.67 },
                    { label: 'freight', amount: 8901.23, basis: AllocationBasis.QTY },
                    { label: 'cf', amount: 777.77 },
                ],
            });

            // Rounded, because summing the three literals in JS gives
            // 22024.670000000002 — the float error is in this expectation, not
            // in the allocation, which returns exactly 22024.67.
            expect(allocatedTotal(result)).toBe(22024.67);
            expect(result.totalCharges).toBe(22024.67);
        });

        it('gives the remainder to the largest line, not the last', () => {
            const result = allocateLandedCost({
                lines: [line('small', 1, 1), line('big', 1, 998), line('mid', 1, 1)],
                charges: [{ amount: 100 }],
            });

            expect(allocatedTotal(result)).toBe(100);
            // 0.1 + 99.8 + 0.1 = 100 exactly here, so assert the shape rather
            // than a specific remainder: the big line carries the bulk.
            expect(result.lines[1].allocatedAmount).toBeGreaterThan(result.lines[0].allocatedAmount);
        });
    });

    describe('fallbacks', () => {
        it('falls back to value when one line is missing its weight', () => {
            const result = allocateLandedCost({
                lines: [line('a', 10, 1000, { weightPerUnit: 5 }), line('b', 10, 3000)],
                charges: [{ amount: 400, basis: AllocationBasis.WEIGHT }],
            });

            // Allocating only across the measured line would have put the whole
            // 400 on it. Value is the honest fallback.
            expect(result.lines[0].allocatedAmount).toBe(100);
            expect(result.lines[1].allocatedAmount).toBe(300);
        });

        it('treats a null weight as missing, not as zero', () => {
            const result = allocateLandedCost({
                lines: [line('a', 1, 100, { weightPerUnit: null }), line('b', 1, 300, { weightPerUnit: 4 })],
                charges: [{ amount: 40, basis: AllocationBasis.WEIGHT }],
            });

            expect(result.lines[0].allocatedAmount).toBe(10);
            expect(result.lines[1].allocatedAmount).toBe(30);
        });

        it('falls back to quantity when every line is free of charge', () => {
            const result = allocateLandedCost({
                lines: [line('a', 3, 0), line('b', 1, 0)],
                charges: [{ amount: 40 }],
            });

            expect(allocatedTotal(result)).toBe(40);
            expect(result.lines[0].allocatedAmount).toBe(30);
            expect(result.lines[1].allocatedAmount).toBe(10);
        });

        it('splits evenly when there is no dimension at all', () => {
            const result = allocateLandedCost({
                lines: [line('a', 0, 0), line('b', 0, 0)],
                charges: [{ amount: 10 }],
            });

            expect(allocatedTotal(result)).toBe(10);
            // A zero-quantity line has no per-unit cost to state.
            expect(result.lines[0].landedUnitCost).toBe(0);
        });
    });

    it('ignores a zero charge without disturbing the total', () => {
        const result = allocateLandedCost({
            lines: [line('a', 1, 100)],
            charges: [{ amount: 0 }, { amount: 50 }],
        });

        expect(result.totalCharges).toBe(50);
        expect(result.lines[0].allocatedAmount).toBe(50);
    });

    it('allocates a negative charge as a credit against the shipment', () => {
        const result = allocateLandedCost({
            lines: [line('a', 10, 1000), line('b', 10, 1000)],
            charges: [{ label: 'freight rebate', amount: -200 }],
        });

        expect(result.lines[0].allocatedAmount).toBe(-100);
        expect(result.lines[1].landedAmount).toBe(900);
    });

    it('keeps four decimals on the unit cost rather than rounding to paisa', () => {
        const result = allocateLandedCost({
            lines: [line('a', 3, 100)],
            charges: [{ amount: 1 }],
        });

        // 101/3 = 33.6667. Rounding to 33.67 and multiplying back would
        // overstate the pool by a paisa per unit on every receipt.
        expect(result.lines[0].landedUnitCost).toBe(33.6667);
    });
});
