'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProductTransactionHistoryPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getProductTransactionHistory: jest.fn(),
        getStores: jest.fn(),
        getInventoryWarehouses: jest.fn(),
        searchProductsByQuantity: jest.fn(),
    },
}));

const searchParams = new Map<string, string>();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/inventory/reports/product-transaction-history',
    useSearchParams: () => ({ get: (key: string) => searchParams.get(key) ?? null }),
}));

/**
 * Surfaces the rows the page hands the table, which is where the whole report
 * lives: the opening row, the order, and the running balance down the column.
 */
jest.mock('@/components/data-table', () => ({
    DataTable: ({
        data,
        emptyMessage,
        isLoading,
        serverPagination,
    }: {
        data: any[];
        emptyMessage: string;
        isLoading: boolean;
        serverPagination?: { total: number; page: number; onPageChange: (page: number) => void };
    }) => (
        <div>
            {isLoading && <div data-testid="loading-indicator">Loading</div>}
            <div data-testid="empty-message">{emptyMessage}</div>
            <div data-testid="row-count">{data.length}</div>
            <div data-testid="balances">{data.map((row) => row.balanceAfter).join('|')}</div>
            <div data-testid="row-types">{data.map((row) => row.rowType).join('|')}</div>
            <div data-testid="total">{serverPagination?.total ?? 0}</div>
            <button type="button" onClick={() => serverPagination?.onPageChange(2)}>
                next-page
            </button>
        </div>
    ),
}));

const REPORT = {
    product: { id: 'prod-1', name: 'Rice 5kg', sku: 'RICE5', unit_type: 'pcs', deleted_at: null },
    warehouse: null,
    summary: {
        openingQuantity: 40,
        totalIn: 25,
        totalOut: 15,
        netChange: 10,
        closingQuantity: 50,
        currentStockQuantity: 50,
        movementCount: 3,
        matchesStockOnHand: true,
    },
    pageOpeningQuantity: 40,
    rows: [
        {
            id: 'm1',
            occurredAt: '2026-03-02T04:00:00.000Z',
            movementType: 'PURCHASE_RECEIPT',
            direction: 'IN',
            quantityIn: 20,
            quantityOut: 0,
            balanceAfter: 60,
            warehouse: { id: 'wh-1', name: 'Dhaka Main' },
            referenceType: 'PURCHASE',
            referenceNumber: 'BILL-77',
            referenceParty: 'Rahim Traders',
            unitCost: 500,
            value: 10000,
            note: null,
        },
        {
            id: 'm2',
            occurredAt: '2026-03-04T04:00:00.000Z',
            movementType: 'SALE',
            direction: 'OUT',
            quantityIn: 0,
            quantityOut: 15,
            balanceAfter: 45,
            warehouse: { id: 'wh-1', name: 'Dhaka Main' },
            referenceType: 'SALE',
            referenceNumber: 'S-100',
            referenceParty: 'Karim',
            unitCost: 500,
            value: -7500,
            note: null,
        },
        {
            id: 'm3',
            occurredAt: '2026-03-06T04:00:00.000Z',
            movementType: 'STOCK_FOUND',
            direction: 'IN',
            quantityIn: 5,
            quantityOut: 0,
            balanceAfter: 50,
            warehouse: { id: 'wh-1', name: 'Dhaka Main' },
            referenceType: null,
            referenceNumber: null,
            referenceParty: null,
            unitCost: null,
            value: null,
            note: 'Miscount',
        },
    ],
    pagination: { page: 1, limit: 100, total: 3, pages: 1 },
};

describe('ProductTransactionHistoryPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        searchParams.clear();
        const { api } = require('@/lib/api');
        api.getProductTransactionHistory.mockResolvedValue(REPORT);
        api.getStores.mockResolvedValue([{ id: 'store-1', name: 'Dhaka Branch' }]);
        api.getInventoryWarehouses.mockResolvedValue([
            { id: 'wh-1', name: 'Dhaka Main', store_id: 'store-1', store: { id: 'store-1', name: 'Dhaka Branch' } },
        ]);
        api.searchProductsByQuantity.mockResolvedValue([{ id: 'prod-1', name: 'Rice 5kg', sku: 'RICE5' }]);
    });

    it('asks for nothing until a product is picked', async () => {
        render(<ProductTransactionHistoryPage />);

        await waitFor(() => expect(require('@/lib/api').api.getStores).toHaveBeenCalled());
        expect(require('@/lib/api').api.getProductTransactionHistory).not.toHaveBeenCalled();
        expect(screen.getByText('Pick a product to see its transaction history.')).toBeInTheDocument();
    });

    it('opens on the opening quantity and runs the balance down the page', async () => {
        searchParams.set('productId', 'prod-1');
        render(<ProductTransactionHistoryPage />);

        await waitFor(() => expect(screen.getByTestId('row-count')).toHaveTextContent('4'));
        // The opening row leads, then the three movements in date order.
        expect(screen.getByTestId('row-types')).toHaveTextContent('opening|movement|movement|movement');
        expect(screen.getByTestId('balances')).toHaveTextContent('40|60|45|50');
        expect(screen.getByTestId('total')).toHaveTextContent('3');
    });

    it('states the opening, in, out and closing quantities', async () => {
        searchParams.set('productId', 'prod-1');
        render(<ProductTransactionHistoryPage />);

        await waitFor(() => expect(screen.getByText('Opening Qty')).toBeInTheDocument());
        expect(screen.getByText('40')).toBeInTheDocument();
        expect(screen.getByText('25')).toBeInTheDocument();
        expect(screen.getByText('15')).toBeInTheDocument();
        expect(screen.getByText('50')).toBeInTheDocument();
    });

    it('carries the previous pages balance onto page two', async () => {
        searchParams.set('productId', 'prod-1');
        const { api } = require('@/lib/api');
        render(<ProductTransactionHistoryPage />);

        await waitFor(() => expect(api.getProductTransactionHistory).toHaveBeenCalledTimes(1));
        api.getProductTransactionHistory.mockResolvedValue({
            ...REPORT,
            pageOpeningQuantity: 50,
            rows: [{ ...REPORT.rows[0], id: 'm4', balanceAfter: 70 }],
            pagination: { page: 2, limit: 100, total: 4, pages: 2 },
        });

        fireEvent.click(screen.getByText('next-page'));

        await waitFor(() => expect(screen.getByTestId('balances')).toHaveTextContent('50|70'));
        expect(api.getProductTransactionHistory).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    });

    it('sends the warehouse, branch and date filters and restarts at page one', async () => {
        searchParams.set('productId', 'prod-1');
        const { api } = require('@/lib/api');
        render(<ProductTransactionHistoryPage />);

        await waitFor(() => expect(api.getProductTransactionHistory).toHaveBeenCalled());
        fireEvent.click(screen.getByText('next-page'));
        await waitFor(() => expect(api.getProductTransactionHistory).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));

        fireEvent.change(screen.getByLabelText('Warehouse'), { target: { value: 'wh-1' } });

        await waitFor(() =>
            expect(api.getProductTransactionHistory).toHaveBeenLastCalledWith(
                expect.objectContaining({ productId: 'prod-1', warehouseId: 'wh-1', page: 1 }),
            ),
        );
    });

    it('warns when the ledger does not explain the quantity the warehouse holds', async () => {
        searchParams.set('productId', 'prod-1');
        const { api } = require('@/lib/api');
        api.getProductTransactionHistory.mockResolvedValue({
            ...REPORT,
            summary: { ...REPORT.summary, currentStockQuantity: 62, matchesStockOnHand: false },
        });

        render(<ProductTransactionHistoryPage />);

        await waitFor(() =>
            expect(screen.getByText(/This card closes at 50 but the warehouse holds 62/)).toBeInTheDocument(),
        );
    });

    it('says a read failed rather than showing an empty card', async () => {
        searchParams.set('productId', 'prod-1');
        const { api } = require('@/lib/api');
        api.getProductTransactionHistory.mockRejectedValue(new Error('offline'));

        render(<ProductTransactionHistoryPage />);

        await waitFor(() => expect(screen.getByText(/Transaction history could not be loaded: offline/)).toBeInTheDocument());
        expect(screen.getByTestId('empty-message')).toHaveTextContent('Transaction history could not be loaded');
    });

    it('lets a product be searched for and picked', async () => {
        const { api } = require('@/lib/api');
        render(<ProductTransactionHistoryPage />);

        fireEvent.focus(screen.getByLabelText('Select a product'));
        await waitFor(() => expect(api.searchProductsByQuantity).toHaveBeenCalled());

        fireEvent.click(await screen.findByText('Rice 5kg'));

        await waitFor(() =>
            expect(api.getProductTransactionHistory).toHaveBeenCalledWith(expect.objectContaining({ productId: 'prod-1' })),
        );
    });
});
