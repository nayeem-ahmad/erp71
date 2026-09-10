'use client';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PurchasesPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getPurchases: jest.fn(),
        // The Cancel action is permission-gated, and `useTenantPlanFeatures`
        // resolves those through /auth/me on mount. No membership → no
        // CANCEL_ENTRY → the action is hidden, which is the default here.
        getMe: jest.fn().mockResolvedValue({ tenants: [] }),
        cancelPurchase: jest.fn(),
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

    describe('cancelling an entry', () => {
        const asTenantAdmin = () => {
            const { api } = require('@/lib/api');
            api.getMe.mockResolvedValue({
                tenants: [{ id: 'tenant-1', role: 'MANAGER', permissions: ['CANCEL_ENTRY'] }],
            });
        };

        it('shows a purchase with no status column value as Recorded', async () => {
            render(<PurchasesPage />);

            await waitFor(() => expect(screen.getByText('PUR-00001')).toBeInTheDocument());
            // Rows written before the column existed come back without it; the
            // list must not render a blank badge for them.
            expect(screen.getByText('Recorded')).toBeInTheDocument();
        });

        it('hides the Cancel action from someone without CANCEL_ENTRY', async () => {
            render(<PurchasesPage />);
            await waitFor(() => expect(screen.getByText('PUR-00001')).toBeInTheDocument());

            expect(screen.queryByRole('button', { name: /cancel entry/i })).toBeNull();
        });

        it('collects a note and posts it with the cancellation', async () => {
            const { api } = require('@/lib/api');
            asTenantAdmin();
            api.cancelPurchase.mockResolvedValue({ id: 'purchase-1', status: 'CANCELLED' });

            render(<PurchasesPage />);
            const actions = await screen.findAllByRole('button', { name: /cancel entry/i });
            fireEvent.click(actions[0]);

            fireEvent.change(screen.getByLabelText(/reason for cancelling/i), {
                target: { value: 'Supplier never shipped' },
            });
            const dialog = screen.getByRole('dialog');
            fireEvent.click(within(dialog).getByRole('button', { name: /cancel entry/i }));

            await waitFor(() =>
                expect(api.cancelPurchase).toHaveBeenCalledWith('purchase-1', 'Supplier never shipped'),
            );
        });

        it('marks a cancelled purchase and offers no second cancellation', async () => {
            const { api } = require('@/lib/api');
            asTenantAdmin();
            api.getPurchases.mockResolvedValue([
                {
                    id: 'purchase-1',
                    purchase_number: 'PUR-00001',
                    total_amount: 42,
                    created_at: '2026-03-20T10:00:00.000Z',
                    status: 'CANCELLED',
                    cancellation_note: 'Supplier never shipped',
                    supplier: { name: 'Fresh Farms' },
                    items: [],
                },
            ]);

            render(<PurchasesPage />);
            await waitFor(() => expect(screen.getByText('PUR-00001')).toBeInTheDocument());

            expect(screen.getByText('Cancelled')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: /cancel entry/i })).toBeNull();
        });
    });
});
