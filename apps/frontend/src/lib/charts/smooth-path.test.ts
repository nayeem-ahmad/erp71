import { monotoneCubicPath } from './smooth-path';

const yValuesOf = (d: string): number[] => {
    const numbers = d.match(/-?\d+(\.\d+)?/g) ?? [];
    // Path data is a flat "x y x y ..." stream once the commands are stripped.
    return numbers.map(Number).filter((_, index) => index % 2 === 1);
};

describe('monotoneCubicPath', () => {
    it('returns an empty string when there are no points', () => {
        expect(monotoneCubicPath([])).toBe('');
    });

    it('emits a straight segment for two points', () => {
        const d = monotoneCubicPath([{ x: 0, y: 10 }, { x: 10, y: 20 }]);
        expect(d).toBe('M 0 10 L 10 20');
    });

    it('emits cubic segments for three or more points', () => {
        const d = monotoneCubicPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 5 }]);
        expect(d).toContain('C');
    });

    it('never overshoots the data range on a V-shaped series', () => {
        // A plain cardinal spline bulges past the turning point here, which on a
        // cash-flow chart would draw a dip that isn't in the data.
        const points = [{ x: 0, y: 40 }, { x: 10, y: 10 }, { x: 20, y: 40 }, { x: 30, y: 60 }];
        const ys = yValuesOf(monotoneCubicPath(points));
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(10);
        expect(Math.max(...ys)).toBeLessThanOrEqual(60);
    });

    it('keeps a monotonically rising series monotonic', () => {
        const points = [{ x: 0, y: 0 }, { x: 10, y: 1 }, { x: 20, y: 30 }, { x: 30, y: 31 }];
        const ys = yValuesOf(monotoneCubicPath(points));
        const sorted = [...ys].sort((a, b) => a - b);
        expect(ys).toEqual(sorted);
    });
});
