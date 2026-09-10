'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PurchaseReturnsPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getPurchaseReturns: jest.fn(),
        getPurchases: jest.fn(),
        createPurchaseReturn: jest.fn(),
        getInventoryWarehouses: jest.fn(),
        getInventorySettings: jest.fn(),
    },
}));

const MAIN_WAREHOUSE = {
    id: 'wh-main',
    name: 'Main Store',
    code: 'WH-MAIN',
    store_id: 'store-1',
    is_default: true,
    is_active: true,
};
const ANNEX_WAREHOUSE = {
    id: 'wh-annex',
    name: 'Annex',
    code: 'WH-ANNEX',
    store_id: 'store-1',
    is_default: false,
    is_active: true,
};

describe('PurchaseReturnsPage — Epic 21: Purchase Returns List & Creation UI', () => {
    beforeEach(() => {
        const { api } = require('@/lib/api');
        api.getPurchaseReturns.mockResolvedValue([
            {
                id: 'pret-1',
                return_number: 'PRET-00001',
                created_at: '2026-03-20T12:00:00.000Z',
                total_amount: 24,
                supplier: { name: 'Fresh Farms' },
                purchase: { id: 'purchase-1', purchase_number: 'PUR-00001' },
                items: [{ id: 'line-1' }],
            },
        ]);
        api.getPurchases.mockResolvedValue([
            {
                id: 'purchase-1',
                purchase_number: 'PUR-00001',
                created_at: '2026-03-19T10:00:00.000Z',
                total_amount: 80,
                store_id: 'store-1',
                supplier: { name: 'Fresh Farms' },
                items: [
                    {
                        id: 'item-1',
                        quantity: 5,
                        unit_cost: 12,
                        product_id: 'prod-1',
                        product: { name: 'Coffee Beans', sku: 'CB-001' },
                        returnItems: [{ id: 'old-return', quantity: 1 }],
                    },
                ],
            },
        ]);
        api.createPurchaseReturn.mockResolvedValue({ id: 'pret-2' });
        api.getInventoryWarehouses.mockResolvedValue([MAIN_WAREHOUSE]);
        api.getInventorySettings.mockResolvedValue({});
    });

    it('renders purchase returns loaded from the API', async () => {
        render(<PurchaseReturnsPage />);

        await waitFor(() => {
            expect(screen.getByText('PRET-00001')).toBeInTheDocument();
            expect(screen.getByText('PUR-00001')).toBeInTheDocument();
            expect(screen.getByText('Fresh Farms')).toBeInTheDocument();
        });
    });

    it('creates a purchase return from a selected purchase', async () => {
        const { api } = require('@/lib/api');

        render(<PurchaseReturnsPage />);

        fireEvent.click(screen.getByRole('button', { name: /new return/i }));

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'New Purchase Return' })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: /pur-00001/i }));

        await waitFor(() => {
            expect(screen.getByText('Returnable Purchase Lines')).toBeInTheDocument();
        });

        fireEvent.change(screen.getByDisplayValue('0'), { target: { value: '2' } });
        fireEvent.click(screen.getByRole('button', { name: /create purchase return/i }));

        await waitFor(() => {
            expect(api.createPurchaseReturn).toHaveBeenCalledWith(
                expect.objectContaining({
                    storeId: 'store-1',
                    purchaseId: 'purchase-1',
                    items: [{ purchaseItemId: 'item-1', quantity: 2, warehouseId: undefined }],
                }),
            );
        });
        // One warehouse, so no control at all and nothing sent for it.
        expect(api.createPurchaseReturn.mock.calls[0][0].warehouseId).toBeUndefined();
        expect(screen.queryByLabelText('Warehouse')).not.toBeInTheDocument();
    });

    it('returns the goods out of the warehouse the purchase received them into', async () => {
        const { api } = require('@/lib/api');
        api.getInventoryWarehouses.mockResolvedValue([MAIN_WAREHOUSE, ANNEX_WAREHOUSE]);
        const [purchase] = await api.getPurchases();
        api.getPurchases.mockResolvedValue([{ ...purchase, warehouse_id: 'wh-annex' }]);

        render(<PurchaseReturnsPage />);

        fireEvent.click(screen.getByRole('button', { name: /new return/i }));
        fireEvent.click(await screen.findByRole('button', { name: /pur-00001/i }));
        await waitFor(() => {
            expect(screen.getByText('Returnable Purchase Lines')).toBeInTheDocument();
        });

        // Defaulted from the purchase, not from the branch default.
        await waitFor(() => {
            expect((screen.getByLabelText('Warehouse') as HTMLSelectElement).value).toBe('wh-annex');
        });

        fireEvent.change(screen.getByDisplayValue('0'), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText('Warehouse — Coffee Beans'), {
            target: { value: 'wh-main' },
        });
        fireEvent.click(screen.getByRole('button', { name: /create purchase return/i }));

        await waitFor(() => {
            expect(api.createPurchaseReturn).toHaveBeenCalledWith(
                expect.objectContaining({
                    warehouseId: 'wh-annex',
                    items: [{ purchaseItemId: 'item-1', quantity: 2, warehouseId: 'wh-main' }],
                }),
            );
        });
    });
});