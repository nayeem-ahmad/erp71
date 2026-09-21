'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StockOnHandPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getStockOnHand: jest.fn(),
        getStores: jest.fn(),
        getInventoryWarehouses: jest.fn(),
        getProductGroups: jest.fn(),
        getProductSubgroups: jest.fn(),
        getBrands: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/inventory/reports/stock-on-hand',
    useSearchParams: () => ({ get: jest.fn() }),
}));

// Surfaces the resolved column headers so the per-warehouse columns can be
// asserted — the whole point of this report.
jest.mock('@/components/data-table', () => ({
    DataTable: ({
        title,
        emptyMessage,
        isLoading,
        data,
        columns,
    }: {
        title: string;
        emptyMessage: string;
        isLoading: boolean;
        data: any[];
        columns: any[];
    }) => (
        <div>
            <div data-testid="data-table-title">{title}</div>
            {isLoading && <div data-testid="loading-indicator">Loading</div>}
            <div data-testid="empty-message">{emptyMessage}</div>
            <div data-testid="row-count">{data.length}</div>
            <div data-testid="column-headers">{columns.map((column) => column.header).join('|')}</div>
        </div>
    ),
}));

const mockReport = {
    summary: {
        valuationBasis: 'WEIGHTED_AVERAGE_PURCHASE_COST',
        totalQuantity: 50,
        totalStockValue: 27250,
        productCount: 2,
        uncostedProductCount: 0,
        uncostedQuantity: 0,
    },
    warehouses: [
        { id: 'wh-1', name: 'Dhaka Main', code: 'WH-DHK', is_active: true, quantity: 30, stockValue: 16350 },
        { id: 'wh-2', name: 'Chattogram', code: 'WH-CTG', is_active: true, quantity: 20, stockValue: 10900 },
    ],
    rows: [
        {
            product: { id: 'p1', name: 'Rice 5kg', sku: 'RICE5', brand: null, group: { id: 'g1', name: 'Grocery' }, subgroup: null },
            quantityByWarehouse: { 'wh-1': 30, 'wh-2': 20 },
            totalQuantity: 50,
            averageUnitCost: 545,
            costBasis: 'WEIGHTED_AVERAGE',
            totalStockValue: 27250,
        },
        {
            product: { id: 'p2', name: 'Salt', sku: 'SALT', brand: null, group: null, subgroup: null },
            quantityByWarehouse: { 'wh-1': 0, 'wh-2': 5 },
            totalQuantity: 5,
            averageUnitCost: null,
            costBasis: 'UNCOSTED',
            totalStockValue: 0,
        },
    ],
};

describe('StockOnHandPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.getStockOnHand.mockResolvedValue(mockReport);
        api.getStores.mockResolvedValue([
            { id: 'store-1', name: 'Dhaka Branch' },
            { id: 'store-2', name: 'Chattogram Branch' },
        ]);
        api.getInventoryWarehouses.mockResolvedValue([
            { id: 'wh-1', name: 'Dhaka Main', is_active: true, store_id: 'store-1' },
            { id: 'wh-2', name: 'Chattogram', is_active: true, store_id: 'store-2' },
            { id: 'wh-3', name: 'Closed Depot', is_active: false, store_id: 'store-2' },
        ]);
        api.getProductGroups.mockResolvedValue([{ id: 'g1', name: 'Grocery' }]);
        api.getProductSubgroups.mockResolvedValue([{ id: 's1', name: 'Rice', group_id: 'g1' }]);
        api.getBrands.mockResolvedValue([{ id: 'b1', name: 'Pran' }]);
    });

    it('renders the page heading', async () => {
        render(<StockOnHandPage />);
        await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
        expect(screen.getAllByText('Stock on Hand')[0]).toBeInTheDocument();
    });

    it('loads the report and its filter options on mount', async () => {
        const { api } = require('@/lib/api');
        render(<StockOnHandPage />);
        await waitFor(() => {
            expect(api.getStockOnHand).toHaveBeenCalled();
            expect(api.getInventoryWarehouses).toHaveBeenCalled();
            expect(api.getProductGroups).toHaveBeenCalled();
            expect(api.getBrands).toHaveBeenCalled();
        });
    });

    it('renders one column per warehouse alongside the totals', async () => {
        render(<StockOnHandPage />);
        await waitFor(() => {
            const headers = screen.getByTestId('column-headers').textContent ?? '';
            expect(headers).toContain('Dhaka Main');
            expect(headers).toContain('Chattogram');
            expect(headers).toContain('Total Qty');
            expect(headers).toContain('Stock Value');
        });
    });

    it('renders summary KPI cards', async () => {
        render(<StockOnHandPage />);
        await waitFor(() => expect(screen.getByText('Total Stock Value')).toBeInTheDocument());
        expect(screen.getByText('Total Quantity')).toBeInTheDocument();
        expect(screen.getByText('Products In Stock')).toBeInTheDocument();
    });

    it('leaves a closed warehouse out of the filter once the report stops counting it', async () => {
        render(<StockOnHandPage />);
        await waitFor(() => expect(screen.getByText('Dhaka Main')).toBeInTheDocument());
        // wh-3 is closed and holds nothing, so it has no column in mockReport.
        expect(screen.queryByText('Closed Depot')).not.toBeInTheDocument();
    });

    /**
     * Closing a warehouse stops new documents posting into it; it does not empty
     * its shelves. While the report still has a column for one, the picker has
     * to be able to reach it — a column nobody can filter down to is a column
     * half missing.
     */
    it('offers a closed warehouse that still holds stock, and says it is closed', async () => {
        const { api } = require('@/lib/api');
        api.getStockOnHand.mockResolvedValue({
            ...mockReport,
            warehouses: [
                ...mockReport.warehouses,
                { id: 'wh-3', name: 'Closed Depot', code: 'WH-CLS', is_active: false, quantity: 12, stockValue: 0 },
            ],
        });

        render(<StockOnHandPage />);

        await waitFor(() => expect(screen.getByTestId('column-headers')).toHaveTextContent('Closed Depot (closed)'));
        expect(screen.getByRole('option', { name: 'Closed Depot' })).toBeInTheDocument();
    });

    /**
     * A read that failed is not an empty shop, and the two used to look
     * identical: the error went to the console and the table just said there was
     * no stock.
     */
    it('says the report could not be loaded rather than showing it as empty', async () => {
        const { api } = require('@/lib/api');
        api.getStockOnHand.mockRejectedValue(new Error('Request failed'));

        render(<StockOnHandPage />);

        await waitFor(() => expect(screen.getByText(/Stock on hand could not be loaded: Request failed/)).toBeInTheDocument());
        expect(screen.getByTestId('empty-message')).toHaveTextContent('Stock on hand could not be loaded');
    });

    it('says there is no warehouse to report on rather than blaming the filters', async () => {
        const { api } = require('@/lib/api');
        api.getStockOnHand.mockResolvedValue({
            summary: { totalQuantity: 0, totalStockValue: 0, productCount: 0, uncostedProductCount: 0, uncostedQuantity: 0 },
            warehouses: [],
            rows: [],
        });

        render(<StockOnHandPage />);

        await waitFor(() => expect(screen.getByTestId('empty-message')).toHaveTextContent('No warehouses to report on'));
    });

    it('refetches scoped to the selected warehouse', async () => {
        const { api } = require('@/lib/api');
        render(<StockOnHandPage />);
        await waitFor(() => expect(api.getStockOnHand).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText('All Warehouses'), { target: { value: 'wh-2' } });

        await waitFor(() =>
            expect(api.getStockOnHand).toHaveBeenCalledWith(expect.objectContaining({ warehouseId: 'wh-2' })),
        );
    });

    it('refetches with includeZeroStock when the checkbox is ticked', async () => {
        const { api } = require('@/lib/api');
        render(<StockOnHandPage />);
        await waitFor(() => expect(api.getStockOnHand).toHaveBeenCalled());

        fireEvent.click(screen.getByLabelText('Include zero-stock products'));

        await waitFor(() =>
            expect(api.getStockOnHand).toHaveBeenCalledWith(expect.objectContaining({ includeZeroStock: true })),
        );
    });

    it('warns when some stock has no cost on file, so the total is not read as complete', async () => {
        const { api } = require('@/lib/api');
        api.getStockOnHand.mockResolvedValue({
            ...mockReport,
            summary: { ...mockReport.summary, uncostedProductCount: 1, uncostedQuantity: 5 },
        });

        render(<StockOnHandPage />);

        await waitFor(() => expect(screen.getByText(/have no purchase cost on file/i)).toBeInTheDocument());
    });

    it('omits the uncosted warning when every product is costed', async () => {
        render(<StockOnHandPage />);
        await waitFor(() => expect(screen.getByTestId('row-count')).toHaveTextContent('2'));
        expect(screen.queryByText(/have no purchase cost on file/i)).not.toBeInTheDocument();
    });

    it('states the valuation basis on the page', async () => {
        render(<StockOnHandPage />);
        await waitFor(() =>
            expect(screen.getByText(/weighted average purchase cost, net of purchase returns/i)).toBeInTheDocument(),
        );
    });

    it('refetches scoped to the selected branch', async () => {
        const { api } = require('@/lib/api');
        render(<StockOnHandPage />);
        await waitFor(() => expect(api.getStockOnHand).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText('All Branches'), { target: { value: 'store-2' } });

        await waitFor(() =>
            expect(api.getStockOnHand).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'store-2' })),
        );
    });

    it('narrows the warehouse picker to the chosen branch', async () => {
        render(<StockOnHandPage />);
        await waitFor(() => expect(screen.getByText('Dhaka Main')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('All Branches'), { target: { value: 'store-2' } });

        // wh-1 belongs to store-1, so it leaves the picker; wh-2 is store-2's own.
        await waitFor(() => expect(screen.queryByText('Dhaka Main')).not.toBeInTheDocument());
        expect(screen.getByText('Chattogram')).toBeInTheDocument();
    });

    /**
     * The two filters are AND-ed server-side, so a warehouse left selected from
     * the previous branch would report nothing at all rather than that branch.
     */
    it('clears a warehouse from another branch when the branch changes', async () => {
        const { api } = require('@/lib/api');
        render(<StockOnHandPage />);
        await waitFor(() => expect(api.getStockOnHand).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText('All Warehouses'), { target: { value: 'wh-1' } });
        await waitFor(() =>
            expect(api.getStockOnHand).toHaveBeenCalledWith(expect.objectContaining({ warehouseId: 'wh-1' })),
        );

        fireEvent.change(screen.getByLabelText('All Branches'), { target: { value: 'store-2' } });

        await waitFor(() =>
            expect(api.getStockOnHand).toHaveBeenLastCalledWith(
                expect.objectContaining({ storeId: 'store-2', warehouseId: undefined }),
            ),
        );
    });
});
