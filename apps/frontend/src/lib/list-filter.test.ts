import { calendarDayOf, inDateRange, matchesAnyOf, matchesNumberCondition, matchesSearch } from './list-filter';

jest.mock('@/lib/format', () => ({ getActiveTimeZone: () => 'Asia/Dhaka' }));

describe('list-filter', () => {
    it('matches any of the chosen values, or none of them when excluding', () => {
        expect(matchesAnyOf([], 'A')).toBe(true);
        expect(matchesAnyOf(['A', 'B'], 'A')).toBe(true);
        expect(matchesAnyOf(['A', 'B'], 'C')).toBe(false);
        expect(matchesAnyOf(['A'], 'A', true)).toBe(false);
        expect(matchesAnyOf(['A'], 'C', true)).toBe(true);
        expect(matchesAnyOf([''], null)).toBe(true);
    });

    it('applies every number condition', () => {
        expect(matchesNumberCondition(5, null)).toBe(true);
        expect(matchesNumberCondition(5, { op: 'gt', value: 4 })).toBe(true);
        expect(matchesNumberCondition(5, { op: 'lt', value: 5 })).toBe(false);
        expect(matchesNumberCondition(5, { op: 'eq', value: 5 })).toBe(true);
        expect(matchesNumberCondition(5, { op: 'between', value: 1, to: 5 })).toBe(true);
        expect(matchesNumberCondition(6, { op: 'between', value: 1, to: 5 })).toBe(false);
    });

    it('reads a UTC-midnight date as written and a timestamp on the workspace clock', () => {
        expect(calendarDayOf('2026-03-01')).toBe('2026-03-01');
        expect(calendarDayOf('2026-03-01T00:00:00.000Z')).toBe('2026-03-01');
        // 20:00 UTC is 02:00 the next day in Dhaka.
        expect(calendarDayOf('2026-03-01T20:00:00.000Z')).toBe('2026-03-02');
        expect(calendarDayOf(null)).toBeNull();
        expect(calendarDayOf('not a date')).toBeNull();
    });

    it('keeps rows inside a date range, by whole days', () => {
        const range = { from: '2026-03-01', to: '2026-03-31' };
        expect(inDateRange('2026-03-15T00:00:00.000Z', range)).toBe(true);
        expect(inDateRange('2026-04-01T00:00:00.000Z', range)).toBe(false);
        expect(inDateRange('2026-02-28', { from: '2026-03-01' })).toBe(false);
        expect(inDateRange('2026-03-31', { to: '2026-03-31T10:00' })).toBe(true);
        expect(inDateRange(null, range)).toBe(false);
        expect(inDateRange(null, null)).toBe(true);
    });

    it('needs every typed word somewhere in the row', () => {
        expect(matchesSearch('', 'anything')).toBe(true);
        expect(matchesSearch('rahim sales', 'Rahim Uddin', 'Sales')).toBe(true);
        expect(matchesSearch('rahim hr', 'Rahim Uddin', 'Sales')).toBe(false);
        expect(matchesSearch('017', null, '01711000000')).toBe(true);
    });
});
