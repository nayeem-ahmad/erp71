import { monthRangeFromDates } from './month-range';

describe('monthRangeFromDates', () => {
    it('takes the whole month at each end of a day range', () => {
        expect(monthRangeFromDates({ from: '2026-06-15', to: '2026-08-03' })).toEqual({
            fromYear: 2026, fromMonth: 6, toYear: 2026, toMonth: 8,
        });
    });

    it('spans a year boundary', () => {
        expect(monthRangeFromDates({ from: '2025-11-01', to: '2026-02-28T10:00' })).toEqual({
            fromYear: 2025, fromMonth: 11, toYear: 2026, toMonth: 2,
        });
    });

    it('runs an open end to this month and an open start from the end month', () => {
        const now = new Date();
        const range = monthRangeFromDates({ from: '2026-01-10' });
        expect(range).toMatchObject({ fromYear: 2026, fromMonth: 1, toYear: now.getFullYear(), toMonth: now.getMonth() + 1 });
        expect(monthRangeFromDates({ to: '2026-04-30' })).toEqual({ fromYear: 2026, fromMonth: 4, toYear: 2026, toMonth: 4 });
    });
});
