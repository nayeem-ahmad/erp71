'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import InventoryValuationPage from './page';
import { mockBranchScope } from '@/test-utils/branch-scope';

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('@/lib/api', () => ({
    api: {
        getInventoryValuation: jest.fn(),
        getStores: jest.fn(),
        getInventoryWarehouses: jest.fn(),
        getProductGroups: jest.fn(),
        getProductSubgroups: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/inventory/reports/valuation',
    useSearchParams: () => ({ get: jest.fn() }),
}));

jest.mock('@/components/data-table', () => ({
    DataTable: ({ title, emptyMessage, isLoading, data, filters, stats, filterLayout, viewOptions }: any) => (
        <div>
            <div data-testid="data-table-title">{title}</div>
            {isLoading && <div data-testid="loading-indicator">Loading</div>}
            <div data-testid="empty-message">{emptyMessage}</div>
            <div data-testid="row-count">{data?.length ?? 0}</div>
            <div data-testid="filter-layout">{filterLayout ?? ''}</div>
            <div data-testid="has-view-options">{viewOptions ? 'yes' : 'no'}</div>
            <div data-testid="stats-label">{stats?.label ?? ''}</div>
            <div data-testid="stats-count">{stats?.items?.length ?? 0}</div>
            {(stats?.items ?? []).map((item: any) => (
                <div key={item.id} data-testid={`stat-${item.id}`}>{item.label}</div>
            ))}
            {(filters ?? []).map((filter: any) => (
                <div key={filter.id} data-testid={`filter-${filter.id}`}>
                    <span data-testid={`filter-${filter.id}-label`}>{filter.label ?? filter.id}</span>
                    {(filter.options ?? []).map((opt: any) => (
                        <span key={opt.value} data-testid={`filter-${filter.id}-option-${opt.value}`}>{opt.label}</span>
                    ))}
                    {filter.type === 'toggle' ? (
                        <span data-testid={`filter-${filter.id}-pressed`}>{String(Boolean(filter.pressed))}</span>
                    ) : null}
                    {filter.type === 'date-range' ? <span data-testid={`filter-${filter.id}-type`}>date-range</span> : null}
                    {filter.required ? <span data-testid={`filter-${filter.id}-required`}>required</span> : null}
                    {filter.loadOptions ? <span data-testid={`filter-${filter.id}-searchable`}>searchable</span> : null}
                </div>
            ))}
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
        mockBranchScope();
        const { api } = require('@/lib/api');
        api.getInventoryValuation.mockResolvedValue(mockValuationData);
        api.getStores.mockResolvedValue([
            { id: 'store-1', name: 'Dhaka Branch' },
            { id: 'store-2', name: 'Chattogram Branch' },
        ]);
        api.getInventoryWarehouses.mockResolvedValue([
            { id: 'wh-1', name: 'Main Warehouse', is_active: true, store_id: 'store-1' },
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
        const { api } = require('@/lib/api');
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(api.getInventoryValuation).toHaveBeenCalled();
        });
    });

    it('calls getInventoryWarehouses on mount', async () => {
        const { api } = require('@/lib/api');
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(api.getInventoryWarehouses).toHaveBeenCalled();
        });
    });

    it('calls getProductGroups on mount', async () => {
        const { api } = require('@/lib/api');
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

    it('renders summary KPI stats on the list', async () => {
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(screen.getByTestId('stats-label')).toHaveTextContent('Report figures');
            expect(screen.getByTestId('stats-count')).toHaveTextContent('4');
        });
        expect(screen.getByTestId('stat-totalValue')).toHaveTextContent('Total Stock Value');
        expect(screen.getByTestId('stat-totalQuantity')).toHaveTextContent('Total Quantity');
        expect(screen.getByTestId('stat-productsWithStock')).toHaveTextContent('Products With Stock');
        expect(screen.getByTestId('stat-averageUnitValue')).toHaveTextContent('Average Unit Value');
        expect(screen.getByTestId('filter-layout')).toHaveTextContent('row');
        expect(screen.getByTestId('has-view-options')).toHaveTextContent('yes');
    });

    it('renders warehouse filter chip options', async () => {
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(screen.getByTestId('filter-warehouse')).toBeInTheDocument();
        });
    });

    it('renders group filter chip options', async () => {
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(screen.getByTestId('filter-group')).toBeInTheDocument();
        });
    });

    it('renders subgroup filter chip options', async () => {
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(screen.getByTestId('filter-subgroup')).toBeInTheDocument();
        });
    });

    it('populates warehouse filter from API', async () => {
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(screen.getByTestId('filter-warehouse-option-wh-1')).toHaveTextContent('Main Warehouse');
        });
    });

    it('populates group filter from API', async () => {
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(screen.getByTestId('filter-group-option-grp-1')).toHaveTextContent('Electronics');
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
        const { api } = require('@/lib/api');
        api.getInventoryValuation.mockRejectedValue(new Error('Network error'));
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        });
    });

    it('shows empty rows when API returns no data', async () => {
        const { api } = require('@/lib/api');
        api.getInventoryValuation.mockResolvedValue({ summary: null, rows: [] });
        render(<InventoryValuationPage />);
        await waitFor(() => {
            expect(screen.getByTestId('row-count')).toHaveTextContent('0');
        });
    });

    it('asks for the header branch, and the chosen one after a change', async () => {
        const { api } = require('@/lib/api');
        render(<InventoryValuationPage />);
        await waitFor(() =>
            expect(api.getInventoryValuation).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'store-1' })),
        );

        fireEvent.change(screen.getByRole('combobox', { name: 'Branch' }), { target: { value: 'all' } });

        await waitFor(() =>
            expect(api.getInventoryValuation).toHaveBeenLastCalledWith(expect.objectContaining({ storeId: 'all' })),
        );
    });
});
