import { previousWindow, rangeToWindow } from './dashboard-range';

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
