import { closedRange, precedingRange, reportPeriodFilter, reportPeriodQuery } from './report-period';

describe('report period', () => {
    it('compares a period with the span of the same length just before it', () => {
        expect(precedingRange({ from: '2026-03-01', to: '2026-03-31' })).toEqual({ from: '2026-01-29', to: '2026-02-28' });
        // One day against the day before.
        expect(precedingRange({ from: '2026-06-01', to: '2026-06-01' })).toEqual({ from: '2026-05-31', to: '2026-05-31' });
    });

    it('closes an open end: no start is the end day, no end is today', () => {
        expect(closedRange({ to: '2026-03-31' })).toEqual({ from: '2026-03-31', to: '2026-03-31' });
        expect(closedRange({ from: '2026-03-01' }).from).toBe('2026-03-01');
    });

    it('sends calendar days, either end open', () => {
        expect(reportPeriodQuery({ from: '2026-03-01T09:00', to: '2026-03-31' })).toEqual({ from: '2026-03-01', to: '2026-03-31' });
        expect(reportPeriodQuery({ to: '2026-03-31' })).toEqual({ to: '2026-03-31' });
    });

    it('goes back to the fallback when the chip is cleared', () => {
        const onChange = jest.fn();
        const filter = reportPeriodFilter({
            label: 'Period',
            value: { from: '2026-03-01', to: '2026-03-31' },
            onChange,
            fallback: () => ({ from: '2026-01-01', to: '2026-01-31' }),
        });
        if (filter.type !== 'date-range') throw new Error('expected a date-range chip');

        filter.onChange(null);
        expect(onChange).toHaveBeenLastCalledWith({ from: '2026-01-01', to: '2026-01-31' });
        filter.onChange({ from: '2026-02-01', to: '2026-02-10' });
        expect(onChange).toHaveBeenLastCalledWith({ from: '2026-02-01', to: '2026-02-10' });
    });
});
