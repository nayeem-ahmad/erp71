import { render, screen, fireEvent } from '@testing-library/react';
import { DashboardHeader } from './DashboardHeader';

describe('DashboardHeader', () => {
    it('renders greeting and calls onRangeChange when a range button is clicked', () => {
        const onRangeChange = jest.fn();
        render(
            <DashboardHeader
                greeting="Good afternoon, Karim 👋"
                tenantName="Rahim Electronics"
                subtitle="Here's how your shop is doing"
                range="week"
                onRangeChange={onRangeChange}
                labels={{ today: 'Today', week: 'This week', month: 'Month' }}
            />,
        );
        expect(screen.getByText('Good afternoon, Karim 👋')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Month' }));
        expect(onRangeChange).toHaveBeenCalledWith('month');
    });
});
