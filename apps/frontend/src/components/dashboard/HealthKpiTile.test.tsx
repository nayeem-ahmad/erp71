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
        expect(screen.getByText('3 overdue')).toHaveClass('text-[#dc2626]');
    });
});
