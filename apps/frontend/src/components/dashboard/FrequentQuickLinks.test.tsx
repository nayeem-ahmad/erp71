import { render, screen } from '@testing-library/react';
import FrequentQuickLinks from './FrequentQuickLinks';

describe('FrequentQuickLinks', () => {
    // Regression: commit 1f111f4 removed this quick action from the dashboard
    // while claiming it still lived there, leaving no dashboard entry point to
    // the new-sale UI once the sidebar submenu was also dropped.
    it('renders a New Sales Entry quick action linking to /sales/new', () => {
        render(<FrequentQuickLinks />);
        expect(screen.getByRole('link', { name: /sales entry/i })).toHaveAttribute(
            'href',
            '/sales/new',
        );
    });

    it('omits the retail quick actions in accounting-only mode', () => {
        render(<FrequentQuickLinks accountingOnlyMode />);
        expect(screen.queryByRole('link', { name: /sales entry/i })).toBeNull();
    });
});
