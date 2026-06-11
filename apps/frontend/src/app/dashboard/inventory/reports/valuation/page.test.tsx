'use client';

import { render, screen, waitFor } from '@testing-library/react';
import InventoryValuationPage from './page';

jest.mock('../../../../../lib/api', () => ({
    api: {
        getInventoryValuation: jest.fn(),
        getInventoryWarehouses: jest.fn(),
        getProductGroups: jest.fn(),
        getProductSubgroups: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/dashboard/inventory/reports/valuation',
    useSearchParams: () => ({ get: jest.fn() }),
}));

jest.mock('@/components/data-table', () => ({
    DataTable: ({
        title,
        emptyMessage,
        isLoading,
        data,
    }: {
        title: string;
        emptyMessage: string;
        isLoading: boolean;
        data: any[];
    }) => (
        <div>
            <div data-testid="data-table-title">{title}</div>
            {isLoading && <div data-testid="loading-indicator">Loading</div>}
            <div data-testid="empty-message">{emptyMessage}</div>
            <div data-testid="row-count">{data.length}</div>
        </div>
    ),
}));

const mockValuationData = {
    summary: {
        totalStockValue: 250000,
        totalQuantity: 500,
        productCount: 10,
        averageUnitValue: 500,
    },
    rows: [
        {
            product: {
                id: 'prod-1',
                name: 'Widget A',
                group: { name: 'Electronics' },
                subgroup: { name: 'Gadgets' },
            },
            quantity: 50,
            unitValue: 2000,
            stockValue: 100000,
        },
        {
            product: {
                id: 'prod-2',
                name: 'Widget B',
                group: null,
                subgroup: null,
            },
            quantity: 100,
            unitValue: 1500,
            stockValue: 150000,
        },
    ],
};

describe('InventoryValuationPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('../../../../../lib/api');
        api.getInventoryValuation.mockResolvedValue(mockValuationData);
        api.getInventoryWarehouses.mockResolvedValue([
            { id: 'wh-1', name: 'Main Warehouse', is_active: true },
        ]);
        api.getProductGroups.mockResolvedValue([
            { id: 'grp-1', name: 'Electronics' },
        ]);
        api.getProductSubgroups.mockResolvedValue([
            { id: 'sub-1', name: 'Gadgets', group_id: 'grp-1' },
        ]);
    });

    it('renders the page heading', async () => {
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        });
        expect(screen.getAllByText('Inventory Valuation')[0]).toBeInTheDocument();
    });

    it('renders the subtitle', async () => {
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(screen.getByText(/Measure on-hand stock value/i)).toBeInTheDocument();
        });
    });

    it('calls getInventoryValuation on mount', async () => {
        const { api } = require('../../../../../lib/api');
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(api.getInventoryValuation).toHaveBeenCalled();
        });
    });

    it('calls getInventoryWarehouses on mount', async () => {
        const { api } = require('../../../../../lib/api');
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(api.getInventoryWarehouses).toHaveBeenCalled();
        });
    });

    it('calls getProductGroups on mount', async () => {
        const { api } = require('../../../../../lib/api');
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(api.getProductGroups).toHaveBeenCalled();
        });
    });

    it('renders the DataTable with correct title', async () => {
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(screen.getByTestId('data-table-title')).toHaveTextContent('Inventory Valuation');
        });
    });

    it('renders summary KPI cards', async () => {
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(screen.getByText('Total Stock Value')).toBeInTheDocument();
            expect(screen.getByText('Total Quantity')).toBeInTheDocument();
            expect(screen.getByText('Products With Stock')).toBeInTheDocument();
            expect(screen.getByText('Average Unit Value')).toBeInTheDocument();
        });
    });

    it('renders warehouse filter dropdown', async () => {
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(screen.getByText('All Warehouses')).toBeInTheDocument();
        });
    });

    it('renders group filter dropdown', async () => {
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(screen.getByText('All Groups')).toBeInTheDocument();
        });
    });

    it('renders subgroup filter dropdown', async () => {
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(screen.getByText('All Subgroups')).toBeInTheDocument();
        });
    });

    it('populates warehouse dropdown from API', async () => {
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(screen.getByText('Main Warehouse')).toBeInTheDocument();
        });
    });

    it('populates group dropdown from API', async () => {
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(screen.getByText('Electronics')).toBeInTheDocument();
        });
    });

    it('renders DataTable with loaded rows', async () => {
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(screen.getByTestId('row-count')).toHaveTextContent('2');
        });
    });

    it('shows empty state message', async () => {
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(screen.getByTestId('empty-message')).toHaveTextContent(
                'No inventory valuation data available'
            );
        });
    });

    it('handles API error gracefully', async () => {
        const { api } = require('../../../../../lib/api');
        api.getInventoryValuation.mockRejectedValue(new Error('Network error'));
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        });
    });

    it('shows empty rows when API returns no data', async () => {
        const { api } = require('../../../../../lib/api');
        api.getInventoryValuation.mockResolvedValue({ summary: null, rows: [] });
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(screen.getByTestId('row-count')).toHaveTextContent('0');
        });
    });
});
