import { periodDelta } from './dashboard-delta';

describe('periodDelta', () => {
    it('reports a rise as a positive percentage', () => {
        expect(periodDelta(112, 100)).toEqual({ label: '▲ 12%', positive: true });
    });

    it('reports a fall as a negative percentage', () => {
        expect(periodDelta(96, 100)).toEqual({ label: '▼ 4%', positive: false });
    });

    it('reports an unchanged figure without a direction arrow', () => {
        expect(periodDelta(100, 100)).toEqual({ label: '0%', positive: true });
    });

    it('does not invent a percentage when the previous period had nothing', () => {
        expect(periodDelta(5000, 0)).toEqual({ label: '—', positive: true });
        expect(periodDelta(0, 0)).toEqual({ label: '—', positive: true });
    });

    it('measures against the size of the previous period, not its sign', () => {
        // A loss of 100 improving to a loss of 50 is a 50% improvement, not −50%.
        expect(periodDelta(-50, -100)).toEqual({ label: '▲ 50%', positive: true });
    });

    it('rounds to whole percentage points', () => {
        expect(periodDelta(100.4, 100).label).toBe('0%');
        expect(periodDelta(101.6, 100).label).toBe('▲ 2%');
    });
});
