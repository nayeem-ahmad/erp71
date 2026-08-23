import { dayKeyOfDate, formatMinutes, groupRowsByDay } from './day-ledger';

// `formatDuration` and `dayHeading` are exercised through the hour-log helpers
// that re-export them; these are the two the attendance ledger added.

describe('formatMinutes', () => {
    it.each([
        [0, '0m'],
        [45, '45m'],
        [60, '1h'],
        [480, '8h'],
        [503, '8h 23m'],
    ])('renders %i minutes as %s', (minutes, expected) => {
        expect(formatMinutes(minutes)).toBe(expected);
    });

    it('clamps a negative to zero rather than rendering a minus', () => {
        expect(formatMinutes(-30)).toBe('0m');
    });

    it('rounds a fractional minute rather than truncating it', () => {
        expect(formatMinutes(59.6)).toBe('1h');
    });
});

describe('groupRowsByDay', () => {
    const row = (id: string, date: string) => ({ id, date });

    it('buckets rows under their day', () => {
        const days = groupRowsByDay(
            [row('a', '2026-06-01'), row('b', '2026-06-01'), row('c', '2026-05-31')],
            (r) => dayKeyOfDate(r.date),
        );

        expect(days).toHaveLength(2);
        expect(days[0].rows.map((r) => r.id)).toEqual(['a', 'b']);
        expect(days[1].rows.map((r) => r.id)).toEqual(['c']);
    });

    it('keeps the order the days first appear in, rather than sorting them', () => {
        // A caller may have asked the server for oldest-first; re-sorting here
        // would silently override that.
        const days = groupRowsByDay(
            [row('a', '2026-05-31'), row('b', '2026-06-02'), row('c', '2026-06-01')],
            (r) => dayKeyOfDate(r.date),
        );

        expect(days.map((d) => d.key)).toEqual(['2026-05-31', '2026-06-02', '2026-06-01']);
    });

    it('reunites rows for a day that reappears later in the list', () => {
        const days = groupRowsByDay(
            [row('a', '2026-06-01'), row('b', '2026-05-31'), row('c', '2026-06-01')],
            (r) => dayKeyOfDate(r.date),
        );

        expect(days).toHaveLength(2);
        expect(days[0].rows.map((r) => r.id)).toEqual(['a', 'c']);
    });

    it('is empty for no rows', () => {
        expect(groupRowsByDay([], () => 'x')).toEqual([]);
    });
});

describe('dayKeyOfDate', () => {
    it('takes the calendar day from a date-only string and from a timestamp alike', () => {
        expect(dayKeyOfDate('2026-06-01')).toBe('2026-06-01');
        expect(dayKeyOfDate('2026-06-01T17:00:00.000Z')).toBe('2026-06-01');
    });
});
