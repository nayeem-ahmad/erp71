'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StockOnHandPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getStockOnHand: jest.fn(),
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
        { id: 'wh-1', name: 'Dhaka Main', code: 'WH-DHK', quantity: 30, stockValue: 16350 },
        { id: 'wh-2', name: 'Chattogram', code: 'WH-CTG', quantity: 20, stockValue: 10900 },
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
        api.getInventoryWarehouses.mockResolvedValue([
            { id: 'wh-1', name: 'Dhaka Main', is_active: true },
            { id: 'wh-2', name: 'Chattogram', is_active: true },
            { id: 'wh-3', name: 'Closed Depot', is_active: false },
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

    it('lists only active warehouses in the filter', async () => {
        render(<StockOnHandPage />);
        await waitFor(() => expect(screen.getByText('Dhaka Main')).toBeInTheDocument());
        expect(screen.queryByText('Closed Depot')).not.toBeInTheDocument();
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
});
