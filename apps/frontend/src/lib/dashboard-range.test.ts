import {
    previousDateWindow,
    previousWindow,
    rangeToDateWindow,
    rangeToWindow,
} from './dashboard-range';

describe('rangeToWindow', () => {
    const now = new Date('2026-07-10T15:00:00.000Z');

    it('today starts at midnight of the current day, Dhaka local', () => {
        const { from, to } = rangeToWindow('today', now);
        expect(from).toBe('2026-07-09T18:00:00.000Z');
        expect(to).toBe(now.toISOString());
    });

    it('week starts six days before today at midnight, Dhaka local', () => {
        expect(rangeToWindow('week', now).from).toBe('2026-07-03T18:00:00.000Z');
    });

    it('month starts on the first of the month at midnight, Dhaka local', () => {
        expect(rangeToWindow('month', now).from).toBe('2026-06-30T18:00:00.000Z');
    });
});

describe('previousWindow', () => {
    it('returns the equally long window ending where the current one starts', () => {
        const previous = previousWindow({ from: '2026-07-08T00:00:00.000Z', to: '2026-07-10T00:00:00.000Z' });
        expect(previous.to).toBe('2026-07-08T00:00:00.000Z');
        expect(previous.from).toBe('2026-07-06T00:00:00.000Z');
    });

    it('keeps the two windows the same length so the comparison is fair', () => {
        const current = rangeToWindow('week', new Date('2026-07-10T15:00:00.000Z'));
        const previous = previousWindow(current);
        const lengthOf = (w: { from: string; to: string }) => Date.parse(w.to) - Date.parse(w.from);
        expect(lengthOf(previous)).toBe(lengthOf(current));
    });
});

describe('rangeToDateWindow', () => {
    // 21:00 in Dhaka on the 10th — the hour where a UTC-based date would report
    // the 10th for the instant but the 9th for the local midnight bound.
    const evening = new Date('2026-07-10T15:00:00.000Z');

    it('keeps a single-day range inside one calendar day', () => {
        expect(rangeToDateWindow('today', evening)).toEqual({ from: '2026-07-10', to: '2026-07-10' });
    });

    it('spans seven days for the week range, inclusive of both ends', () => {
        expect(rangeToDateWindow('week', evening)).toEqual({ from: '2026-07-04', to: '2026-07-10' });
    });

    it('starts the month range on the first', () => {
        expect(rangeToDateWindow('month', evening)).toEqual({ from: '2026-07-01', to: '2026-07-10' });
    });
});

describe('previousDateWindow', () => {
    it('ends the day before the current window starts', () => {
        expect(previousDateWindow({ from: '2026-07-04', to: '2026-07-10' }))
            .toEqual({ from: '2026-06-27', to: '2026-07-03' });
    });

    it('maps a single day to the day before it', () => {
        expect(previousDateWindow({ from: '2026-07-10', to: '2026-07-10' }))
            .toEqual({ from: '2026-07-09', to: '2026-07-09' });
    });

    it('spans the same number of days as the window it precedes', () => {
        const current = rangeToDateWindow('month', new Date('2026-07-10T15:00:00.000Z'));
        const previous = previousDateWindow(current);
        const days = (w: { from: string; to: string }) =>
            (Date.parse(`${w.to}T00:00:00Z`) - Date.parse(`${w.from}T00:00:00Z`)) / 86_400_000;
        expect(days(previous)).toBe(days(current));
    });
});
