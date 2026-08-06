import { render, screen } from '@testing-library/react';
import ActivityChart from './ActivityChart';
import type { ReferralActivityPoint } from '@/components/admin/referrals/types';

const labels = {
    clicks: 'Link clicks',
    signups: 'Signups',
    empty: 'No activity in the last 12 months.',
    emptyHint: 'Share your referral link to start seeing traffic here.',
};

const point = (month: string, clicks: number, signups: number): ReferralActivityPoint => ({
    month,
    clicks,
    signups,
    earned_amount: 0,
    paid_amount: 0,
});

const months = ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02',
    '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];

describe('ActivityChart', () => {
    it('renders both panels with a legend, so identity is never colour-alone', () => {
        const points = months.map((m, i) => point(m, i * 3, i % 2));
        render(<ActivityChart points={points} labels={labels} />);

        expect(screen.getByText('Link clicks')).toBeInTheDocument();
        expect(screen.getByText('Signups')).toBeInTheDocument();
        expect(screen.getByTestId('activity-clicks-line')).toBeInTheDocument();
        expect(screen.getAllByTestId('activity-signup-bar').length).toBeGreaterThan(0);
    });

    it('shows an empty state when every bucket is zero', () => {
        render(<ActivityChart points={months.map((m) => point(m, 0, 0))} labels={labels} />);

        expect(screen.getByText('No activity in the last 12 months.')).toBeInTheDocument();
        expect(screen.queryByTestId('activity-clicks-line')).not.toBeInTheDocument();
    });

    it('shows the empty state rather than crashing on an empty array', () => {
        render(<ActivityChart points={[]} labels={labels} />);

        expect(screen.getByText('No activity in the last 12 months.')).toBeInTheDocument();
    });
});
