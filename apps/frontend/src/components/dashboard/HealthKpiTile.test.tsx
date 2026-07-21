import { render, screen } from '@testing-library/react';
import { HealthKpiTile } from './HealthKpiTile';

describe('HealthKpiTile', () => {
    it('renders title, value and delta', () => {
        render(<HealthKpiTile title="Sales" value="৳3.4L" delta="▲ 12%" deltaPositive points={[1, 2, 3]} />);
        expect(screen.getByText('Sales')).toBeInTheDocument();
        expect(screen.getByText('৳3.4L')).toBeInTheDocument();
        expect(screen.getByText('▲ 12%')).toBeInTheDocument();
    });

    it('applies the negative delta color when deltaPositive is false', () => {
        render(<HealthKpiTile title="Receivables" value="৳54k" delta="3 overdue" deltaPositive={false} points={[3, 2, 1]} />);
        expect(screen.getByText('3 overdue')).toHaveClass('text-danger-text');
    });

    it('names what the delta is measured against', () => {
        render(
            <HealthKpiTile
                title="Sales"
                value="৳3.4L"
                delta="▲ 12%"
                deltaPositive
                deltaContext="vs last week"
                points={[1, 2, 3]}
            />,
        );
        expect(screen.getByText('vs last week')).toBeInTheDocument();
    });

    it('tones the sparkline to match the delta direction', () => {
        const { container } = render(
            <HealthKpiTile title="Cash" value="৳2L" delta="▼ 4%" deltaPositive={false} points={[3, 2, 1]} />,
        );
        expect(container.querySelector('[data-testid="sparkline-line"]')).toHaveClass('stroke-series-2');
    });

    it('shows a note instead of a plot when there is no series to draw', () => {
        render(
            <HealthKpiTile title="Receivables" value="৳68k" delta="—" deltaPositive points={[]} note="Oldest 34 days" />,
        );
        expect(screen.getByText('Oldest 34 days')).toBeInTheDocument();
    });
});
