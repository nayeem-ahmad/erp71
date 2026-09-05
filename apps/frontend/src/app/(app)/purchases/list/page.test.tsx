'use client';

import { render, screen, waitFor } from '@testing-library/react';
import PurchasesPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getPurchases: jest.fn(),
    },
}));

const replace = jest.fn();
let searchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace }),
    useSearchParams: () => searchParams,
}));

describe('PurchasesPage — Epic 20: Core Purchase Transactions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        searchParams = new URLSearchParams();
        const { api } = require('@/lib/api');
        api.getPurchases.mockResolvedValue([
            {
                id: 'purchase-1',
                purchase_number: 'PUR-00001',
                total_amount: 42,
                created_at: '2026-03-20T10:00:00.000Z',
                supplier: { name: 'Fresh Farms' },
                items: [
                    { id: 'item-1', quantity: 2, unit_cost: 10, product: { name: 'Coffee Beans' } },
                ],
            },
        ]);
    });

    it('renders purchases loaded from the API', async () => {
        render(<PurchasesPage />);

        await waitFor(() => {
            expect(screen.getByText('PUR-00001')).toBeInTheDocument();
            expect(screen.getByText('Fresh Farms')).toBeInTheDocument();
        });
    });

    it('sends Record Purchase to the entry page', async () => {
        render(<PurchasesPage />);

        const action = await screen.findByRole('link', { name: /record purchase/i });
        expect(action).toHaveAttribute('href', '/purchases/new');
    });

    it('renders a duplicate action pointing the entry form at the purchase', async () => {
        render(<PurchasesPage />);

        const link = await screen.findByTitle('Duplicate purchase');
        expect(link).toHaveAttribute('href', '/purchases/new?duplicate=purchase-1');
    });

    it('forwards the legacy ?new=1 deep link to the entry page', async () => {
        searchParams = new URLSearchParams('new=1');
        render(<PurchasesPage />);

        await waitFor(() => expect(replace).toHaveBeenCalledWith('/purchases/new'));
    });
});
