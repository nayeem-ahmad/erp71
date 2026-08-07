import { render, screen } from '@testing-library/react';
import FunnelChart from './FunnelChart';
import { buildFunnel } from './funnel-model';

const labels = {
    clicks: 'Link clicks',
    signups: 'Signups',
    earned: 'Earned',
    paid: 'Paid',
    dropOff: '{pct}% drop-off',
    empty: 'No activity yet.',
};

describe('FunnelChart', () => {
    it('direct-labels every stage with its count', () => {
        render(<FunnelChart stages={buildFunnel({ clicks: 100, signups: 10, earned: 4, paid: 2 })} labels={labels} />);

        expect(screen.getByText('Link clicks')).toBeInTheDocument();
        expect(screen.getByText('100')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('prints drop-off between stages', () => {
        render(<FunnelChart stages={buildFunnel({ clicks: 100, signups: 10, earned: 4, paid: 2 })} labels={labels} />);

        expect(screen.getByText('90% drop-off')).toBeInTheDocument();
    });

    it('shows an empty state rather than four zero-width bars', () => {
        render(<FunnelChart stages={buildFunnel({ clicks: 0, signups: 0, earned: 0, paid: 0 })} labels={labels} />);

        expect(screen.getByText('No activity yet.')).toBeInTheDocument();
        expect(screen.queryByText('NaN')).not.toBeInTheDocument();
    });
});
