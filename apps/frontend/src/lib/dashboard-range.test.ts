import { rangeToWindow } from './dashboard-range';

describe('rangeToWindow', () => {
    const now = new Date('2026-07-10T15:00:00.000Z');

    it('today starts at midnight of the current day', () => {
        const { from, to } = rangeToWindow('today', now);
        expect(from).toBe('2026-07-10T00:00:00.000Z');
        expect(to).toBe(now.toISOString());
    });

    it('week starts six days before today at midnight', () => {
        expect(rangeToWindow('week', now).from).toBe('2026-07-04T00:00:00.000Z');
    });

    it('month starts on the first of the month at midnight', () => {
        expect(rangeToWindow('month', now).from).toBe('2026-07-01T00:00:00.000Z');
    });
});
