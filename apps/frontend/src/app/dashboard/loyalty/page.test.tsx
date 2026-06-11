'use client';

import { render, screen, waitFor } from '@testing-library/react';
import LoyaltyPage from './page';

jest.mock('../../../lib/api', () => ({
    fetchWithAuth: jest.fn(),
}));

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/dashboard/loyalty',
    useSearchParams: () => ({ get: jest.fn() }),
}));

describe('LoyaltyPage', () => {
    beforeEach(() => {
        const { fetchWithAuth } = require('../../../lib/api');
        fetchWithAuth.mockResolvedValue([]);
        jest.clearAllMocks();
    });

    it('renders the page heading', async () => {
        const { fetchWithAuth } = require('../../../lib/api');
        fetchWithAuth.mockResolvedValue([]);
        render(<LoyaltyPage />);
        await waitFor(() => {
            expect(screen.getByText('Loyalty Points')).toBeInTheDocument();
        });
    });

    it('displays loaded customer data', async () => {
        const { fetchWithAuth } = require('../../../lib/api');
        fetchWithAuth.mockResolvedValue([
            {
                id: '1',
                name: 'Rahim Uddin',
                phone: '01711111111',
                loyalty_points: 250,
                last_transaction_at: null,
            },
        ]);
        render(<LoyaltyPage />);
        await waitFor(() => {
            expect(screen.getByText('Rahim Uddin')).toBeInTheDocument();
        });
    });

    it('handles empty customer list', async () => {
        const { fetchWithAuth } = require('../../../lib/api');
        fetchWithAuth.mockResolvedValue([]);
        render(<LoyaltyPage />);
        await waitFor(() => {
            expect(screen.getByText('No customers found')).toBeInTheDocument();
        });
    });

    it('renders the search input', async () => {
        const { fetchWithAuth } = require('../../../lib/api');
        fetchWithAuth.mockResolvedValue([]);
        render(<LoyaltyPage />);
        await waitFor(() => {
            expect(screen.getByPlaceholderText('Search by name or phone…')).toBeInTheDocument();
        });
    });
});
