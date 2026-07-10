import { render, screen } from '@testing-library/react';
import { AttentionStrip } from './AttentionStrip';

describe('AttentionStrip', () => {
    it('renders one card per attention item with a deep link', () => {
        render(
            <AttentionStrip
                allClearLabel="All caught up"
                items={[{ id: 'overdue', tone: 'red', value: '৳54k', label: '3 invoices overdue', href: '/sales', cta: 'Collect' }]}
            />,
        );
        expect(screen.getByText('3 invoices overdue')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Collect/ })).toHaveAttribute('href', '/sales');
    });

    it('renders the all-clear card when there are no items', () => {
        render(<AttentionStrip allClearLabel="All caught up" items={[]} />);
        expect(screen.getByText('All caught up')).toBeInTheDocument();
    });
});
