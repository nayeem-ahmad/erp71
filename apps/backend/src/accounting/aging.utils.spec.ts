import { ageBalance, addToAgingBucket, emptyAgingBuckets, type AgingEntry } from './aging.utils';

const AS_OF = new Date('2026-09-18T12:00:00.000Z');

/** A date `days` before the as-of instant, so ages read directly off the call. */
function daysAgo(days: number): Date {
    return new Date(AS_OF.getTime() - days * 24 * 60 * 60 * 1000);
}

function charge(days: number, amount: number): AgingEntry {
    return { date: daysAgo(days), delta: amount };
}

function receipt(days: number, amount: number): AgingEntry {
    return { date: daysAgo(days), delta: -amount };
}

describe('ageBalance', () => {
    it('ages a single unpaid charge into the bucket its age falls in', () => {
        expect(ageBalance([charge(10, 1000)], AS_OF).buckets).toEqual({
            current: 1000,
            overdue_31_60: 0,
            overdue_61_90: 0,
            overdue_90_plus: 0,
        });

        expect(ageBalance([charge(45, 1000)], AS_OF).buckets.overdue_31_60).toBe(1000);
        expect(ageBalance([charge(75, 1000)], AS_OF).buckets.overdue_61_90).toBe(1000);
        expect(ageBalance([charge(200, 1000)], AS_OF).buckets.overdue_90_plus).toBe(1000);
    });

    it('uses the same bucket boundaries the reports have always shown', () => {
        expect(ageBalance([charge(30, 100)], AS_OF).buckets.current).toBe(100);
        expect(ageBalance([charge(31, 100)], AS_OF).buckets.overdue_31_60).toBe(100);
        expect(ageBalance([charge(60, 100)], AS_OF).buckets.overdue_31_60).toBe(100);
        expect(ageBalance([charge(61, 100)], AS_OF).buckets.overdue_61_90).toBe(100);
        expect(ageBalance([charge(90, 100)], AS_OF).buckets.overdue_61_90).toBe(100);
        expect(ageBalance([charge(91, 100)], AS_OF).buckets.overdue_90_plus).toBe(100);
    });

    // The bug this ager exists for: a customer who bought on credit all year and
    // paid every taka of it was showing the whole year's sales as outstanding.
    it('reports nothing outstanding once every charge has been paid', () => {
        const result = ageBalance(
            [
                charge(300, 40_000),
                charge(200, 30_000),
                charge(100, 30_000),
                receipt(90, 100_000),
            ],
            AS_OF,
        );

        expect(result.outstanding).toBe(0);
        expect(result.buckets).toEqual(emptyAgingBuckets());
        expect(result.unapplied_credit).toBe(0);
    });

    it('applies a receipt to the oldest charge first, leaving the newest open', () => {
        const result = ageBalance(
            [charge(200, 5000), charge(10, 3000), receipt(5, 5000)],
            AS_OF,
        );

        // The 200-day-old debt is settled; only the recent one survives.
        expect(result.buckets.overdue_90_plus).toBe(0);
        expect(result.buckets.current).toBe(3000);
        expect(result.outstanding).toBe(3000);
    });

    it('carries a part-payment into the bucket of the charge it partly settled', () => {
        const result = ageBalance([charge(120, 1000), receipt(5, 400)], AS_OF);

        expect(result.buckets.overdue_90_plus).toBe(600);
        expect(result.outstanding).toBe(600);
    });

    it('spills a receipt across consecutive charges oldest-first', () => {
        const result = ageBalance(
            [charge(120, 1000), charge(45, 1000), charge(5, 1000), receipt(1, 1500)],
            AS_OF,
        );

        expect(result.buckets).toEqual({
            current: 1000,
            overdue_31_60: 500,
            overdue_61_90: 0,
            overdue_90_plus: 0,
        });
        expect(result.outstanding).toBe(1500);
    });

    it('never reports a negative bucket when the party has overpaid', () => {
        const result = ageBalance([charge(40, 1000), receipt(5, 2500)], AS_OF);

        expect(result.buckets).toEqual(emptyAgingBuckets());
        expect(result.outstanding).toBe(0);
        expect(result.unapplied_credit).toBe(1500);
    });

    it('settles a later charge from credit received before it', () => {
        // An advance, then a sale against it: the sale is covered, nothing ages.
        const result = ageBalance([receipt(60, 1000), charge(10, 800)], AS_OF);

        expect(result.outstanding).toBe(0);
        expect(result.unapplied_credit).toBe(200);
    });

    it('ages only the part of a charge an earlier advance did not cover', () => {
        const result = ageBalance([receipt(60, 300), charge(10, 800)], AS_OF);

        expect(result.buckets.current).toBe(500);
        expect(result.unapplied_credit).toBe(0);
    });

    it('sorts entries by date, so a caller may merge two queries in any order', () => {
        const shuffled = [receipt(5, 5000), charge(10, 3000), charge(200, 5000)];
        const ordered = [charge(200, 5000), charge(10, 3000), receipt(5, 5000)];

        expect(ageBalance(shuffled, AS_OF)).toEqual(ageBalance(ordered, AS_OF));
    });

    it('treats a settlement dated before any charge as credit, not as a negative age', () => {
        const result = ageBalance([receipt(300, 1000)], AS_OF);

        expect(result.buckets).toEqual(emptyAgingBuckets());
        expect(result.unapplied_credit).toBe(1000);
    });

    it('ignores rounding dust rather than leaving a one-paisa charge open forever', () => {
        const result = ageBalance([charge(120, 1000), receipt(5, 999.998)], AS_OF);

        expect(result.outstanding).toBe(0);
        expect(result.buckets.overdue_90_plus).toBe(0);
    });

    it('rounds buckets to paisa so thirds of a taka do not print as 333.33333', () => {
        const result = ageBalance([charge(10, 1000), receipt(5, 1000 / 3)], AS_OF);

        expect(result.buckets.current).toBe(666.67);
        expect(result.outstanding).toBe(666.67);
    });

    it('returns empty buckets for a party with no history at all', () => {
        const result = ageBalance([], AS_OF);

        expect(result.buckets).toEqual(emptyAgingBuckets());
        expect(result.outstanding).toBe(0);
        expect(result.unapplied_credit).toBe(0);
    });

    it('keeps the buckets summing to outstanding across a mixed history', () => {
        const result = ageBalance(
            [
                charge(365, 12_000),
                receipt(300, 4000),
                charge(200, 7000),
                charge(80, 5500),
                receipt(70, 9000),
                charge(20, 2500),
                receipt(3, 1000),
            ],
            AS_OF,
        );

        const summed =
            result.buckets.current
            + result.buckets.overdue_31_60
            + result.buckets.overdue_61_90
            + result.buckets.overdue_90_plus;

        expect(Math.round(summed * 100) / 100).toBe(result.outstanding);
        // Charges 27,000 less receipts 14,000.
        expect(result.outstanding).toBe(13_000);
    });
});

describe('addToAgingBucket', () => {
    it('accumulates rather than overwriting, so repeated calls add up', () => {
        const buckets = emptyAgingBuckets();
        addToAgingBucket(buckets, 5, 100);
        addToAgingBucket(buckets, 12, 250);
        addToAgingBucket(buckets, 95, 400);

        expect(buckets).toEqual({
            current: 350,
            overdue_31_60: 0,
            overdue_61_90: 0,
            overdue_90_plus: 400,
        });
    });

    it('puts a charge dated in the future in the current bucket', () => {
        const buckets = emptyAgingBuckets();
        addToAgingBucket(buckets, -5, 100);

        expect(buckets.current).toBe(100);
    });
});
