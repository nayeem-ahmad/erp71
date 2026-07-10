import { render, screen } from '@testing-library/react';
import { RankedListPanel } from './RankedListPanel';

describe('RankedListPanel', () => {
    it('renders ranked items with name, meta and amount', () => {
        render(
            <RankedListPanel
                title="Top selling products"
                emptyLabel="Nothing yet"
                items={[{ id: 'p1', name: 'LED Bulb', meta: '180 sold', amount: '৳21.6k' }]}
            />,
        );
        expect(screen.getByText('Top selling products')).toBeInTheDocument();
        expect(screen.getByText('LED Bulb')).toBeInTheDocument();
        expect(screen.getByText('180 sold')).toBeInTheDocument();
        expect(screen.getByText('৳21.6k')).toBeInTheDocument();
        expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('renders the empty label when there are no items', () => {
        render(<RankedListPanel title="Top customers" emptyLabel="No customers yet" items={[]} />);
        expect(screen.getByText('No customers yet')).toBeInTheDocument();
    });

    it('renders a colored avatar with initials when avatarInitials is provided', () => {
        render(
            <RankedListPanel
                title="Top customers"
                emptyLabel="No customers yet"
                items={[{ id: 'c1', name: 'Shirin Islam', meta: '3 orders', amount: '৳4.2k', avatarInitials: 'SI' }]}
            />,
        );
        expect(screen.getByText('SI')).toBeInTheDocument();
    });
});
