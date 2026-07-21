import { render } from '@testing-library/react';
import { Sparkline } from './Sparkline';

const renderSparkline = (points: number[], positive = true) =>
    render(<Sparkline points={points} positive={positive} />).container;

describe('Sparkline', () => {
    it('renders nothing when there are fewer than two points', () => {
        expect(renderSparkline([]).querySelector('svg')).toBeNull();
        expect(renderSparkline([5]).querySelector('svg')).toBeNull();
    });

    it('draws the series as a smooth curve rather than straight segments', () => {
        const line = renderSparkline([4, 9, 2, 7]).querySelector('[data-testid="sparkline-line"]');
        expect(line?.getAttribute('d')).toContain('C');
    });

    it('fills the area under the line so direction reads at a glance', () => {
        const area = renderSparkline([4, 9, 2, 7]).querySelector('[data-testid="sparkline-area"]');
        // Closed back to the baseline, otherwise the fill leaks into the plot.
        expect(area?.getAttribute('d')).toMatch(/Z$/);
    });

    it('marks the latest value with an endpoint dot at the right edge', () => {
        const dot = renderSparkline([4, 9, 2, 7]).querySelector('[data-testid="sparkline-endpoint"]');
        expect(dot?.getAttribute('cx')).toBe('100');
    });

    it('draws a horizontal reference line at the series mean', () => {
        const reference = renderSparkline([0, 10]).querySelector('[data-testid="sparkline-reference"]');
        expect(reference).not.toBeNull();
        expect(reference!.getAttribute('y1')).toBe(reference!.getAttribute('y2'));
    });

    it('uses the accent hue when rising and the second series hue when falling', () => {
        const rising = renderSparkline([1, 5], true).querySelector('[data-testid="sparkline-line"]');
        const falling = renderSparkline([5, 1], false).querySelector('[data-testid="sparkline-line"]');
        expect(rising).toHaveClass('stroke-primary');
        expect(falling).toHaveClass('stroke-series-2');
    });
});
