'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PurchasesPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getPurchases: jest.fn(),
        getProducts: jest.fn(),
        getSuppliers: jest.fn(),
        createPurchase: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useSearchParams: () => ({ get: jest.fn(() => null) }),
}));

describe('PurchasesPage — Epic 20: Core Purchase Transactions', () => {
    beforeEach(() => {
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
        api.getProducts.mockResolvedValue([
            { id: 'prod-1', name: 'Coffee Beans', sku: 'CB-001', price: 10 },
        ]);
        api.getSuppliers.mockResolvedValue([{ id: 'sup-1', name: 'Fresh Farms' }]);
        api.createPurchase.mockResolvedValue({ id: 'purchase-2' });
        localStorage.setItem('store_id', 'store-1');
    });

    it('renders purchases loaded from the API', async () => {
        render(<PurchasesPage />);

        await waitFor(() => {
            expect(screen.getByText('PUR-00001')).toBeInTheDocument();
            expect(screen.getByText('Fresh Farms')).toBeInTheDocument();
        });
    });

    it('opens the purchase modal and posts a purchase', async () => {
        const { api } = require('@/lib/api');
        render(<PurchasesPage />);

        fireEvent.click(screen.getByRole('button', { name: /record purchase/i }));

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Record Purchase' })).toBeInTheDocument();
        });

        fireEvent.change(screen.getByPlaceholderText(/search products by name or sku/i), {
            target: { value: 'coffee' },
        });

        await waitFor(() => {
            expect(screen.getAllByText('Coffee Beans').length).toBeGreaterThan(0);
        });

        fireEvent.click(screen.getAllByText('Coffee Beans')[0]);
        fireEvent.click(screen.getByRole('button', { name: /post purchase/i }));

        await waitFor(() => {
            expect(api.createPurchase).toHaveBeenCalledWith(
                expect.objectContaining({
                    storeId: 'store-1',
                    items: [
                        expect.objectContaining({ productId: 'prod-1', quantity: 1, unitCost: 10 }),
                    ],
                }),
            );
        });
    });

    it('supports inline supplier creation in the modal', async () => {
        const { api } = require('@/lib/api');
        render(<PurchasesPage />);

        fireEvent.click(screen.getByRole('button', { name: /record purchase/i }));
        fireEvent.click(await screen.findByRole('button', { name: /new supplier/i }));

        const nameInput = screen.getByPlaceholderText('Supplier name');
        fireEvent.change(nameInput, { target: { value: 'New Source' } });
        fireEvent.change(screen.getByPlaceholderText(/search products by name or sku/i), {
            target: { value: 'coffee' },
        });

        await waitFor(() => {
            expect(screen.getAllByText('Coffee Beans').length).toBeGreaterThan(0);
        });

        fireEvent.click(screen.getAllByText('Coffee Beans')[0]);
        fireEvent.click(screen.getByRole('button', { name: /post purchase/i }));

        await waitFor(() => {
            expect(api.createPurchase).toHaveBeenCalledWith(
                expect.objectContaining({
                    newSupplier: expect.objectContaining({ name: 'New Source' }),
                }),
            );
        });
    });
});