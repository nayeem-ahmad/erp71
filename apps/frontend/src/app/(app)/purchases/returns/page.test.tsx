'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PurchaseReturnsPage from './page';
import CreatePurchaseReturnModal from './CreatePurchaseReturnModal';

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('@/lib/api', () => ({
    api: {
        getPurchaseReturns: jest.fn(),
        getPurchases: jest.fn(),
        createPurchaseReturn: jest.fn(),
        getInventoryWarehouses: jest.fn(),
        getInventorySettings: jest.fn(),
        getPaymentLayout: jest.fn(),
        getPaymentMethods: jest.fn(),
    },
}));

/** A method row as the layout route returns it. */
const method = (over: { id: string; name: string; type: string; sort_order: number }) => ({
    account_id: null,
    is_active: true,
    show_on_entry: true,
    all_branches: true,
    store_ids: [],
    ...over,
});
const CASH = method({ id: 'pm-cash', name: 'Cash', type: 'Cash', sort_order: 1 });
const BKASH = method({ id: 'pm-bkash', name: 'bKash', type: 'Mobile Wallet', sort_order: 2 });

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
        jest.clearAllMocks();
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
        api.getPaymentLayout.mockResolvedValue({ customised: false, visible: [CASH, BKASH], available: [CASH, BKASH] });
        api.getPaymentMethods.mockResolvedValue([CASH, BKASH]);
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

    it('purchase return modal submits payments and shows the payable chip', async () => {
        const { api } = require('@/lib/api');
        const [purchase] = await api.getPurchases();
        api.getPurchases.mockResolvedValue([
            { ...purchase, supplier_id: 'sup-1', supplier: { name: 'Fresh Farms', due_balance: '500.00' } },
        ]);

        render(<PurchaseReturnsPage />);
        fireEvent.click(screen.getByRole('button', { name: /new return/i }));
        fireEvent.click(await screen.findByRole('button', { name: /pur-00001/i }));
        await waitFor(() => expect(screen.getByText('Returnable Purchase Lines')).toBeInTheDocument());

        fireEvent.change(screen.getByDisplayValue('0'), { target: { value: '2' } });

        // With a supplier nothing is received by default: the whole ৳24 comes
        // off what is payable, which is today's behaviour.
        expect(await screen.findByText(/^Adjusted against payable ৳\s*24\.00$/)).toBeInTheDocument();
        const bkash = screen.getByLabelText(/bKash/) as HTMLInputElement;
        expect(bkash.value).toBe('');

        // Take ৳10 back from the supplier on bKash; the other ৳14 stays against the payable.
        fireEvent.change(bkash, { target: { value: '10' } });
        expect(screen.getByText(/^Adjusted against payable ৳\s*14\.00$/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /create purchase return/i }));

        await waitFor(() => expect(api.createPurchaseReturn).toHaveBeenCalledTimes(1));
        const sent = api.createPurchaseReturn.mock.calls[0][0];
        // Exactly the DTO's fields: the server rejects a `label` or an `accountId`.
        expect(sent.payments).toEqual([{ paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-bkash', amount: 10 }]);
        expect(Object.keys(sent.payments[0]).sort()).toEqual(['amount', 'paymentMethod', 'paymentMethodId']);
    });

    it('reopening the modal on the same purchase starts from a fresh pre-fill', async () => {
        const { api } = require('@/lib/api');
        const [purchase] = await api.getPurchases();
        api.getPurchases.mockResolvedValue([
            { ...purchase, supplier_id: 'sup-1', supplier: { name: 'Fresh Farms', due_balance: '500.00' } },
        ]);
        const props = { onClose: jest.fn(), onSuccess: jest.fn(), initialPurchaseId: 'purchase-1' };

        const { rerender } = render(<CreatePurchaseReturnModal isOpen {...props} />);
        await waitFor(() => expect(screen.getByText('Returnable Purchase Lines')).toBeInTheDocument());
        fireEvent.change(screen.getByDisplayValue('0'), { target: { value: '2' } });
        const first = (await screen.findByLabelText(/bKash/)) as HTMLInputElement;
        fireEvent.change(first, { target: { value: '10' } });
        expect(first.value).toBe('10');

        // Cancelled, then opened again from the same row.
        rerender(<CreatePurchaseReturnModal isOpen={false} {...props} />);
        rerender(<CreatePurchaseReturnModal isOpen {...props} />);
        await waitFor(() => expect(screen.getByText('Returnable Purchase Lines')).toBeInTheDocument());
        fireEvent.change(screen.getByDisplayValue('0'), { target: { value: '2' } });

        // Nothing received: the ৳10 typed last time is gone from the strip and the payload.
        expect(await screen.findByText(/^Adjusted against payable ৳\s*24\.00$/)).toBeInTheDocument();
        expect((screen.getByLabelText(/bKash/) as HTMLInputElement).value).toBe('');
        await waitFor(() => expect(screen.getByRole('button', { name: /create purchase return/i })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: /create purchase return/i }));
        await waitFor(() => expect(api.createPurchaseReturn).toHaveBeenCalledTimes(1));
        expect(api.createPurchaseReturn.mock.calls[0][0].payments).toEqual([]);
    });

    it('with no supplier the whole total is received in the first method, and cannot be less', async () => {
        const { api } = require('@/lib/api');
        const [purchase] = await api.getPurchases();
        api.getPurchases.mockResolvedValue([{ ...purchase, supplier: null }]);

        render(<PurchaseReturnsPage />);
        fireEvent.click(screen.getByRole('button', { name: /new return/i }));
        fireEvent.click(await screen.findByRole('button', { name: /pur-00001/i }));
        await waitFor(() => expect(screen.getByText('Returnable Purchase Lines')).toBeInTheDocument());
        fireEvent.change(screen.getByDisplayValue('0'), { target: { value: '2' } });

        const cash = (await screen.findByLabelText(/Cash/)) as HTMLInputElement;
        await waitFor(() => expect(cash.value).toBe('24'));

        fireEvent.change(cash, { target: { value: '10' } });
        expect(
            await screen.findAllByText("Receive the full amount, or pick the supplier's purchase"),
        ).not.toHaveLength(0);
        expect(screen.getByRole('button', { name: /create purchase return/i })).toBeDisabled();
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