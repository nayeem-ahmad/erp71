import { dayStart, idealVertices, nearestIndex, stepPath, sprintWindow } from './burndown-steps';

describe('sprintWindow', () => {
    it('runs from the first day at 00:00 to the end of the last day, Dhaka time', () => {
        const { from, to } = sprintWindow('2026-08-02T00:00:00.000Z', '2026-08-03T00:00:00.000Z');
        expect(new Date(from).toISOString()).toBe('2026-08-01T18:00:00.000Z');
        expect(new Date(to).toISOString()).toBe('2026-08-03T18:00:00.000Z');
    });
});

describe('dayStart', () => {
    it('is midnight in Dhaka for the date key', () => {
        expect(new Date(dayStart('2026-08-05')).toISOString()).toBe('2026-08-04T18:00:00.000Z');
    });
});

describe('stepPath', () => {
    const x = (t: number) => t;
    const y = (v: number) => 100 - v;

    it('holds each value flat until the next point, then steps', () => {
        expect(
            stepPath(
                [
                    { t: 0, v: 10 },
                    { t: 5, v: 8 },
                    { t: 9, v: 3 },
                ],
                x,
                y,
            ),
        ).toBe('M0,90 H5 V92 H9 V97');
    });

    it('draws a lone point as a dot-length segment rather than nothing', () => {
        expect(stepPath([{ t: 4, v: 2 }], x, y)).toBe('M4,98 h0.01');
    });

    it('is empty with no points', () => {
        expect(stepPath([], x, y)).toBe('');
    });
});

describe('nearestIndex', () => {
    const times = [0, 10, 20, 40];

    it.each([
        [-5, 0],
        [4, 0],
        [6, 1],
        [14, 1],
        [29, 2],
        [31, 3],
        [99, 3],
    ])('at %s picks index %s', (t, index) => {
        expect(nearestIndex(times, t)).toBe(index);
    });

    it('returns -1 for no points', () => {
        expect(nearestIndex([], 5)).toBe(-1);
    });
});

describe('idealVertices', () => {
    it('places each day at its middle, so the line reaches zero on the last day rather than after it', () => {
        const vertices = idealVertices([
            { date: '2026-08-02', value: 10, isWorkingDay: true },
            { date: '2026-08-03', value: 0, isWorkingDay: true },
            { date: '2026-08-04', value: null, isWorkingDay: false },
        ]);
        expect(vertices).toEqual([
            { t: dayStart('2026-08-02') + 12 * 3600 * 1000, v: 10 },
            { t: dayStart('2026-08-03') + 12 * 3600 * 1000, v: 0 },
        ]);
    });
});
