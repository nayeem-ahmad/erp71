import { addMonths, calculatePeriodEnd, elapsedPeriods, normalizeBillingCycle } from './billing-cycle.util';

describe('billing-cycle.util', () => {
    describe('normalizeBillingCycle', () => {
        it('treats anything that is not YEARLY as MONTHLY', () => {
            expect(normalizeBillingCycle('YEARLY')).toBe('YEARLY');
            expect(normalizeBillingCycle('MONTHLY')).toBe('MONTHLY');
            expect(normalizeBillingCycle(undefined)).toBe('MONTHLY');
            expect(normalizeBillingCycle(null)).toBe('MONTHLY');
            expect(normalizeBillingCycle('nonsense')).toBe('MONTHLY');
        });
    });

    describe('addMonths', () => {
        it('advances by a calendar month', () => {
            expect(addMonths(new Date('2026-01-15T00:00:00Z'), 1).toISOString())
                .toBe('2026-02-15T00:00:00.000Z');
        });

        it('clamps to the last day when the target month is shorter', () => {
            // The naive `setMonth` answer here is 3 March, which bills a tenant
            // for a month they are not in.
            expect(addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString())
                .toBe('2026-02-28T00:00:00.000Z');
        });

        it('handles a leap February', () => {
            expect(addMonths(new Date('2028-01-31T00:00:00Z'), 1).toISOString())
                .toBe('2028-02-29T00:00:00.000Z');
        });

        it('rolls over the year boundary', () => {
            expect(addMonths(new Date('2026-12-10T00:00:00Z'), 1).toISOString())
                .toBe('2027-01-10T00:00:00.000Z');
        });

        it('clamps cumulatively when stepped one month at a time', () => {
            // Documents why `elapsedPeriods` offsets from a fixed anchor instead
            // of stepping: Jan 31 -> Feb 28 -> Mar 28 loses the month end for good.
            let date = new Date('2026-01-31T00:00:00Z');
            for (let i = 0; i < 12; i += 1) date = addMonths(date, 1);
            expect(date.toISOString()).toBe('2027-01-28T00:00:00.000Z');
        });

        it('keeps the month end when offset from a fixed anchor', () => {
            const anchor = new Date('2026-01-31T00:00:00Z');
            expect(addMonths(anchor, 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
            expect(addMonths(anchor, 2).toISOString()).toBe('2026-03-31T00:00:00.000Z');
            expect(addMonths(anchor, 12).toISOString()).toBe('2027-01-31T00:00:00.000Z');
        });
    });

    describe('calculatePeriodEnd', () => {
        it('adds one month for a monthly cycle', () => {
            expect(calculatePeriodEnd(new Date('2026-03-01T00:00:00Z'), 'MONTHLY').toISOString())
                .toBe('2026-04-01T00:00:00.000Z');
        });

        it('adds twelve months for a yearly cycle', () => {
            expect(calculatePeriodEnd(new Date('2026-03-01T00:00:00Z'), 'YEARLY').toISOString())
                .toBe('2027-03-01T00:00:00.000Z');
        });
    });

    describe('elapsedPeriods', () => {
        it('returns nothing when the period is still running', () => {
            const periods = elapsedPeriods(
                new Date('2026-10-01T00:00:00Z'),
                'MONTHLY',
                new Date('2026-09-07T00:00:00Z'),
            );
            expect(periods).toEqual([]);
        });

        it('returns one period for a single missed renewal', () => {
            const periods = elapsedPeriods(
                new Date('2026-08-01T00:00:00Z'),
                'MONTHLY',
                new Date('2026-08-15T00:00:00Z'),
            );
            expect(periods).toHaveLength(1);
            expect(periods[0].periodEnd.toISOString()).toBe('2026-09-01T00:00:00.000Z');
        });

        it('returns one period per elapsed cycle when renewals were missed for months', () => {
            // The shape of the frozen-period bug: a tenant created in March whose
            // period never advanced owes every month since, not one month.
            const periods = elapsedPeriods(
                new Date('2026-03-10T00:00:00Z'),
                'MONTHLY',
                new Date('2026-09-07T00:00:00Z'),
            );
            expect(periods).toHaveLength(6);
            expect(periods[0].periodStart.toISOString()).toBe('2026-03-10T00:00:00.000Z');
            expect(periods[5].periodEnd.toISOString()).toBe('2026-09-10T00:00:00.000Z');
        });

        it('leaves the final period ending in the future', () => {
            const now = new Date('2026-09-07T00:00:00Z');
            const periods = elapsedPeriods(new Date('2026-03-10T00:00:00Z'), 'MONTHLY', now);
            expect(periods[periods.length - 1].periodEnd.getTime()).toBeGreaterThan(now.getTime());
        });

        it('keeps a month-end subscription on the month end across a catch-up', () => {
            const periods = elapsedPeriods(
                new Date('2026-01-31T00:00:00Z'),
                'MONTHLY',
                new Date('2026-04-15T00:00:00Z'),
            );
            expect(periods.map((p) => p.periodStart.toISOString())).toEqual([
                '2026-01-31T00:00:00.000Z',
                '2026-02-28T00:00:00.000Z',
                '2026-03-31T00:00:00.000Z',
            ]);
        });

        it('bounds the walk so a corrupt date cannot post unbounded charges', () => {
            const periods = elapsedPeriods(
                new Date('1990-01-01T00:00:00Z'),
                'MONTHLY',
                new Date('2026-09-07T00:00:00Z'),
                24,
            );
            expect(periods).toHaveLength(24);
        });
    });
});
