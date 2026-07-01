'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PurchaseReturnDetailPage from './page';

const pushMock = jest.fn();
let searchValue = '';

jest.mock('next/navigation', () => ({
    useParams: () => ({ id: 'pret-1' }),
    useRouter: () => ({ push: pushMock }),
    useSearchParams: () => ({ get: (key: string) => (key === 'edit' ? searchValue : null) }),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getPurchaseReturn: jest.fn(),
        updatePurchaseReturn: jest.fn(),
        deletePurchaseReturn: jest.fn(),
    },
}));

describe('PurchaseReturnDetailPage — Epic 21.4', () => {
    beforeEach(() => {
        pushMock.mockReset();
        searchValue = '';
        window.alert = jest.fn();
        window.confirm = jest.fn(() => true);

        const { api } = require('@/lib/api');
        api.getPurchaseReturn.mockResolvedValue({
            id: 'pret-1',
            return_number: 'PRET-00001',
            created_at: '2026-03-20T12:00:00.000Z',
            total_amount: 24,
            status: 'RECORDED',
            reference_number: 'REF-1',
            notes: 'Initial note',
            supplier: { name: 'Fresh Farms' },
            purchase: {
                purchase_number: 'PUR-00001',
                items: [
                    {
                        id: 'item-1',
                        quantity: 5,
                        product: { name: 'Coffee Beans' },
                        returnItems: [{ return_id: 'pret-1', quantity: 2 }, { return_id: 'pret-other', quantity: 1 }],
                    },
                ],
            },
            items: [
                {
                    id: 'line-1',
                    purchase_item_id: 'item-1',
                    product_id: 'prod-1',
                    quantity: 2,
                    unit_cost: 12,
                    line_total: 24,
                    product: { name: 'Coffee Beans' },
                },
            ],
        });
        api.updatePurchaseReturn.mockResolvedValue({ id: 'pret-1' });
        api.deletePurchaseReturn.mockResolvedValue({ deleted: true });
    });

    it('renders purchase return detail data', async () => {
        render(<PurchaseReturnDetailPage />);

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'PRET-00001' })).toBeInTheDocument();
            expect(screen.getByText('PUR-00001')).toBeInTheDocument();
            expect(screen.getByText('Fresh Farms')).toBeInTheDocument();
            expect(screen.getByText('Initial note')).toBeInTheDocument();
        });
    });

    it('saves constrained edits in edit mode', async () => {
        searchValue = 'true';
        const { api } = require('@/lib/api');
        render(<PurchaseReturnDetailPage />);

        await waitFor(() => {
            expect(screen.getByDisplayValue('REF-1')).toBeInTheDocument();
            expect(screen.getByDisplayValue('2')).toBeInTheDocument();
        });

        fireEvent.change(screen.getByDisplayValue('2'), { target: { value: '3' } });
        fireEvent.change(screen.getByDisplayValue('REF-1'), { target: { value: 'REF-2' } });
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => {
            expect(api.updatePurchaseReturn).toHaveBeenCalledWith(
                'pret-1',
                expect.objectContaining({
                    referenceNumber: 'REF-2',
                    items: [{ purchaseItemId: 'item-1', quantity: 3 }],
                }),
            );
        });
        expect(pushMock).toHaveBeenCalledWith('/purchases/returns/pret-1');
    });

    it('deletes the purchase return after confirmation', async () => {
        const { api } = require('@/lib/api');
        render(<PurchaseReturnDetailPage />);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: /delete/i }));

        await waitFor(() => {
            expect(api.deletePurchaseReturn).toHaveBeenCalledWith('pret-1');
        });
        expect(pushMock).toHaveBeenCalledWith('/purchases/returns');
    });
});