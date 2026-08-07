import { render, screen } from '@testing-library/react';
import EarningsChart from './EarningsChart';
import type { ReferralActivityPoint } from '@/components/admin/referrals/types';

const labels = {
    earned: 'Commission earned',
    paid: 'Paid out',
    empty: 'No earnings yet.',
    emptyHint: 'Commission appears here once a referred business subscribes.',
};

const point = (month: string, earned: number, paid: number): ReferralActivityPoint => ({
    month,
    clicks: 0,
    signups: 0,
    earned_amount: earned,
    paid_amount: paid,
});

describe('EarningsChart', () => {
    it('renders a paired column per month with a legend', () => {
        render(
            <EarningsChart
                points={[point('2026-07', 400, 0), point('2026-08', 0, 400)]}
                locale="en"
                labels={labels}
            />,
        );

        expect(screen.getByText('Commission earned')).toBeInTheDocument();
        expect(screen.getByText('Paid out')).toBeInTheDocument();
        expect(screen.getAllByTestId('earnings-bar').length).toBe(4);
    });

    it('shows an empty state when no month has money in it', () => {
        render(
            <EarningsChart points={[point('2026-07', 0, 0)]} locale="en" labels={labels} />,
        );

        expect(screen.getByText('No earnings yet.')).toBeInTheDocument();
    });
});
