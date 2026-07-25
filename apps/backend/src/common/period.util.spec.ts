import {
    addDays,
    addYears,
    bucketLabel,
    bucketStart,
    daysInRange,
    isValidDate,
    percentChange,
    resolveComparisonRange,
    toDhakaParts,
} from './period.util';

describe('daysInRange', () => {
    it('counts both ends of the range', () => {
        expect(daysInRange({ from: '2026-07-01', to: '2026-07-01' })).toBe(1);
        expect(daysInRange({ from: '2026-07-01', to: '2026-07-31' })).toBe(31);
    });

    it('returns zero for an unparseable range instead of NaN', () => {
        expect(daysInRange({ from: 'yesterday', to: '2026-07-31' })).toBe(0);
    });
});

describe('addDays / addYears', () => {
    it('crosses month and year boundaries', () => {
        expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
        expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    });

    /**
     * A leap day has no counterpart in a common year. Rolling into 1 March
     * silently moves a comparison window by a day; clamping to the 28th keeps
     * "same date last year" meaning what it says.
     */
    it('clamps 29 February back to the 28th rather than rolling into March', () => {
        expect(addYears('2024-02-29', 1)).toBe('2025-02-28');
        expect(addYears('2024-02-29', -1)).toBe('2023-02-28');
    });

    it('leaves ordinary dates untouched', () => {
        expect(addYears('2026-07-25', -1)).toBe('2025-07-25');
    });
});

describe('resolveComparisonRange', () => {
    /**
     * The prior period is the equally long block of days *immediately before*
     * the range — not the previous calendar month. A 31-day July therefore
     * compares against 31 days ending 30 June, which straddles May and June.
     * That is deliberate: comparing 31 days against a 28-day February would
     * make the totals incomparable, which is worse than a window that reads
     * oddly. Callers wanting a calendar month pass its dates explicitly, and
     * every report echoes back the window it actually used.
     */
    it('places the previous period immediately before the range, at equal length', () => {
        expect(resolveComparisonRange({ from: '2026-07-01', to: '2026-07-31' }, 'previous_period')).toEqual({
            from: '2026-05-31',
            to: '2026-06-30',
        });
    });

    it('keeps the comparison the same length as the range', () => {
        const range = { from: '2026-02-01', to: '2026-02-28' };
        const previous = resolveComparisonRange(range, 'previous_period')!;
        expect(daysInRange(previous)).toBe(daysInRange(range));
        expect(previous.to).toBe('2026-01-31');
    });

    it('handles a single-day range', () => {
        expect(resolveComparisonRange({ from: '2026-07-25', to: '2026-07-25' }, 'previous_period')).toEqual({
            from: '2026-07-24',
            to: '2026-07-24',
        });
    });

    it('uses the same calendar dates one year earlier for previous_year', () => {
        expect(resolveComparisonRange({ from: '2026-07-01', to: '2026-07-31' }, 'previous_year')).toEqual({
            from: '2025-07-01',
            to: '2025-07-31',
        });
    });

    it('returns null rather than a garbage range when the input is unparseable', () => {
        expect(resolveComparisonRange({ from: 'last month', to: '2026-07-31' }, 'previous_period')).toBeNull();
    });
});

describe('bucketStart', () => {
    it('leaves days alone and truncates months to the first', () => {
        expect(bucketStart('2026-07-25', 'day')).toBe('2026-07-25');
        expect(bucketStart('2026-07-25', 'month')).toBe('2026-07-01');
    });

    it('snaps weeks back to the preceding Monday', () => {
        // 2026-07-25 is a Saturday.
        expect(bucketStart('2026-07-25', 'week')).toBe('2026-07-20');
        // A Monday is already its own bucket start.
        expect(bucketStart('2026-07-20', 'week')).toBe('2026-07-20');
        // A Sunday belongs to the week that started six days earlier.
        expect(bucketStart('2026-07-26', 'week')).toBe('2026-07-20');
    });

    it('labels a month bucket without its day component', () => {
        expect(bucketLabel('2026-07-01', 'month')).toBe('2026-07');
        expect(bucketLabel('2026-07-20', 'week')).toBe('2026-07-20');
    });
});

describe('percentChange', () => {
    it('reports growth and decline', () => {
        expect(percentChange(150, 100)).toBe(50);
        expect(percentChange(50, 100)).toBe(-50);
    });

    /**
     * "Revenue grew by Infinity percent" is not renderable. Null forces the
     * caller to phrase growth from zero in words instead.
     */
    it('returns null when the base is zero instead of Infinity', () => {
        expect(percentChange(500, 0)).toBeNull();
    });

    it('measures against the magnitude of a negative base', () => {
        expect(percentChange(-50, -100)).toBe(50);
    });
});

describe('toDhakaParts', () => {
    /**
     * Dhaka is UTC+6. A sale at 22:00 UTC is 04:00 the next morning locally —
     * reporting it in the UTC hour would put it in the wrong day entirely.
     */
    it('shifts an instant into Dhaka wall-clock time', () => {
        expect(toDhakaParts(new Date('2026-07-25T22:00:00Z'))).toEqual({
            hour: 4,
            weekday: 0, // Sunday
            date: '2026-07-26',
        });
    });

    it('keeps a mid-day instant on the same date', () => {
        const parts = toDhakaParts(new Date('2026-07-25T06:30:00Z'));
        expect(parts.hour).toBe(12);
        expect(parts.date).toBe('2026-07-25');
    });
});

describe('isValidDate', () => {
    it('accepts YYYY-MM-DD and rejects everything else', () => {
        expect(isValidDate('2026-07-25')).toBe(true);
        expect(isValidDate('25/07/2026')).toBe(false);
        expect(isValidDate(undefined)).toBe(false);
    });
});
