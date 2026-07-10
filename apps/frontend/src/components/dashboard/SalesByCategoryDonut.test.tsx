import { render, screen } from '@testing-library/react';
import { SalesByCategoryDonut } from './SalesByCategoryDonut';

const rows = [
    { categoryId: 'g1', categoryName: 'Electronics', revenue: 200, share: 40 },
    { categoryId: 'g2', categoryName: 'Lighting', revenue: 300, share: 60 },
];

describe('SalesByCategoryDonut', () => {
    it('renders a legend row per category with its share', () => {
        render(<SalesByCategoryDonut rows={rows} totalLabel="৳500" emptyLabel="No sales" />);
        expect(screen.getByText('Electronics')).toBeInTheDocument();
        expect(screen.getByText('40%')).toBeInTheDocument();
        expect(screen.getByText('৳500')).toBeInTheDocument();
    });

    it('shows the empty label when there are no rows', () => {
        render(<SalesByCategoryDonut rows={[]} totalLabel="৳0" emptyLabel="No sales" />);
        expect(screen.getByText('No sales')).toBeInTheDocument();
    });
});
