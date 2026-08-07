import { buildActivity, activityWindowStart, ACTIVITY_MONTHS } from './referral-activity';

/**
 * The activity buckets drive the partner-facing charts. A silent mistake here
 * does not corrupt money, but it does tell a partner their promotion is not
 * working when it is — so the cases below pin the boundaries: which date field
 * each series buckets on, that empty months stay present, and that a reversed
 * commission never counts as earned.
 */
describe('buildActivity', () => {
    const now = new Date('2026-08-06T10:00:00');

    const empty = { clicks: [], signups: [], payments: [] };

    it('always returns twelve buckets, oldest first, ending with the current month', () => {
        const result = buildActivity(empty, now);

        expect(result).toHaveLength(ACTIVITY_MONTHS);
        expect(result[0].month).toBe('2025-09');
        expect(result[ACTIVITY_MONTHS - 1].month).toBe('2026-08');
    });

    it('keeps months with no activity present and zeroed rather than closing the gap', () => {
        const result = buildActivity(
            { ...empty, clicks: [{ occurred_at: new Date('2026-08-01T00:00:00') }] },
            now,
        );

        expect(result.find((p) => p.month === '2026-08')?.clicks).toBe(1);
        expect(result.find((p) => p.month === '2026-07')).toEqual({
            month: '2026-07',
            clicks: 0,
            signups: 0,
            earned_amount: 0,
            paid_amount: 0,
        });
    });

    it('buckets each series on its own date field', () => {
        const result = buildActivity(
            {
                clicks: [{ occurred_at: new Date('2026-06-15T00:00:00') }],
                signups: [{
                    signed_up_at: new Date('2026-06-20T00:00:00'),
                    earned_at: new Date('2026-07-02T00:00:00'),
                    status: 'EARNED',
                    commission_amount: 400,
                }],
                payments: [{ paid_at: new Date('2026-08-01T00:00:00'), amount: 400 }],
            },
            now,
        );

        const at = (month: string) => result.find((p) => p.month === month)!;
        expect(at('2026-06').clicks).toBe(1);
        expect(at('2026-06').signups).toBe(1);
        // Earned lands in its earned_at month, not its signed_up_at month.
        expect(at('2026-06').earned_amount).toBe(0);
        expect(at('2026-07').earned_amount).toBe(400);
        expect(at('2026-08').paid_amount).toBe(400);
    });

    it('counts a PAID commission toward earned at its earned_at, not its paid_at', () => {
        const result = buildActivity(
            {
                ...empty,
                signups: [{
                    signed_up_at: new Date('2026-05-01T00:00:00'),
                    earned_at: new Date('2026-05-10T00:00:00'),
                    status: 'PAID',
                    commission_amount: 250,
                }],
            },
            now,
        );

        expect(result.find((p) => p.month === '2026-05')?.earned_amount).toBe(250);
    });

    it('leaves a REVERSED commission out of earned entirely', () => {
        const result = buildActivity(
            {
                ...empty,
                signups: [{
                    signed_up_at: new Date('2026-05-01T00:00:00'),
                    earned_at: new Date('2026-05-10T00:00:00'),
                    status: 'REVERSED',
                    commission_amount: 250,
                }],
            },
            now,
        );

        expect(result.find((p) => p.month === '2026-05')?.earned_amount).toBe(0);
        // The signup itself still happened, so it is still counted.
        expect(result.find((p) => p.month === '2026-05')?.signups).toBe(1);
    });

    it('ignores rows older than the window instead of folding them into the first bucket', () => {
        const result = buildActivity(
            { ...empty, clicks: [{ occurred_at: new Date('2024-01-01T00:00:00') }] },
            now,
        );

        expect(result.every((p) => p.clicks === 0)).toBe(true);
    });

    it('rounds money to two decimals so float sums do not drift', () => {
        const result = buildActivity(
            {
                ...empty,
                payments: [
                    { paid_at: new Date('2026-08-01T00:00:00'), amount: 0.1 },
                    { paid_at: new Date('2026-08-02T00:00:00'), amount: 0.2 },
                ],
            },
            now,
        );

        expect(result.find((p) => p.month === '2026-08')?.paid_amount).toBe(0.3);
    });
});

describe('activityWindowStart', () => {
    it('returns midnight on the first day of the earliest bucket', () => {
        const start = activityWindowStart(new Date('2026-08-06T10:00:00'));

        expect(start.getFullYear()).toBe(2025);
        expect(start.getMonth()).toBe(8); // September, zero-indexed
        expect(start.getDate()).toBe(1);
        expect(start.getHours()).toBe(0);
    });
});
