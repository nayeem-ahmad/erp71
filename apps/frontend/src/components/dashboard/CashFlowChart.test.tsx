import { fireEvent, render, screen } from '@testing-library/react';
import { CashFlowChart, type CashFlowPoint } from './CashFlowChart';

const labels = {
    inflow: 'Money in',
    outflow: 'Money out',
    net: 'Net',
    empty: 'No accounting movement',
    emptyHint: 'Nothing moved in this period',
};

const day = (date: string, cash_inflow: number, cash_outflow: number): CashFlowPoint => ({
    date,
    cash_inflow,
    cash_outflow,
});

const points: CashFlowPoint[] = [
    day('2026-07-08', 42000, 37000),
    day('2026-07-09', 58000, 29000),
    day('2026-07-10', 31000, 44000),
    day('2026-07-11', 67000, 33000),
];

const renderChart = (data: CashFlowPoint[]) =>
    render(<CashFlowChart points={data} locale="en-US" labels={labels} />);

describe('CashFlowChart', () => {
    it('shows the empty message when there are no points', () => {
        renderChart([]);
        expect(screen.getByText('No accounting movement')).toBeInTheDocument();
    });

    it('shows the empty message when every day is zero', () => {
        renderChart([day('2026-07-08', 0, 0), day('2026-07-09', 0, 0)]);
        expect(screen.getByText('No accounting movement')).toBeInTheDocument();
    });

    it('draws an inflow, outflow and net series', () => {
        const { container } = renderChart(points);
        expect(container.querySelector('[data-testid="cashflow-inflow"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="cashflow-outflow"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="cashflow-net"]')).not.toBeNull();
    });

    it('draws the series as smooth curves', () => {
        const { container } = renderChart(points);
        expect(container.querySelector('[data-testid="cashflow-net"]')?.getAttribute('d')).toContain('C');
    });

    it('always plots a zero line, since net can go negative', () => {
        const { container } = renderChart(points);
        expect(container.querySelector('[data-testid="cashflow-zero"]')).not.toBeNull();
    });

    it('keeps the y-axis wide enough to hold a negative net day', () => {
        // Day 3 nets −13,000; if the scale started at zero the curve would clip.
        const { container } = renderChart(points);
        const ticks = Array.from(container.querySelectorAll('[data-testid="cashflow-tick"]')).map(
            (tick) => Number(tick.getAttribute('data-value')),
        );
        expect(Math.min(...ticks)).toBeLessThanOrEqual(-13000);
    });

    it('labels at most four dates however many days are in range', () => {
        const thirtyDays = Array.from({ length: 30 }, (_, i) =>
            day(`2026-07-${String(i + 1).padStart(2, '0')}`, 1000 * (i + 1), 500 * (i + 1)),
        );
        const { container } = renderChart(thirtyDays);
        expect(container.querySelectorAll('[data-testid="cashflow-date"]').length).toBeLessThanOrEqual(4);
    });

    it('reveals the day figures on hover', () => {
        const { container } = renderChart(points);
        const hits = container.querySelectorAll('[data-testid="cashflow-hit"]');
        fireEvent.mouseEnter(hits[2]);

        const tooltip = screen.getByTestId('cashflow-tooltip');
        expect(tooltip).toHaveTextContent('৳ 31,000');
        expect(tooltip).toHaveTextContent('৳ 44,000');
        // Net is derived, and negative on this day.
        expect(tooltip).toHaveTextContent('৳ -13,000');
    });

    it('hides the tooltip when the pointer leaves the plot', () => {
        const { container } = renderChart(points);
        const hits = container.querySelectorAll('[data-testid="cashflow-hit"]');
        fireEvent.mouseEnter(hits[1]);
        expect(screen.queryByTestId('cashflow-tooltip')).not.toBeNull();

        fireEvent.mouseLeave(container.querySelector('[data-testid="cashflow-plot"]')!);
        expect(screen.queryByTestId('cashflow-tooltip')).toBeNull();
    });
});
