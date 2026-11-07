'use client';

import { render, screen, waitFor } from '@testing-library/react';
import ReorderSuggestionsPage from './page';
import { mockBranchScope } from '@/test-utils/branch-scope';

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('@/lib/api', () => ({
    api: {
        getReorderSuggestions: jest.fn(),
        getStores: jest.fn(),
        getInventoryWarehouses: jest.fn(),
        getProductGroups: jest.fn(),
        getProductSubgroups: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/inventory/reports/reorder',
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

const mockReorderRows = [
    {
        product: {
            id: 'prod-1',
            name: 'Widget A',
            sku: 'WGT-001',
            group: { name: 'Electronics' },
            subgroup: { name: 'Gadgets' },
        },
        onHand: 3,
        inTransit: 0,
        targetStock: 20,
        suggestedQuantity: 17,
        shortageReason: 'Below reorder level',
        configSource: 'product',
        leadTimeDays: 7,
    },
    {
        product: {
            id: 'prod-2',
            name: 'Widget B',
            sku: null,
            group: null,
            subgroup: null,
        },
        onHand: 0,
        inTransit: 2,
        targetStock: null,
        suggestedQuantity: 10,
        shortageReason: 'Out of stock',
        configSource: 'default',
        leadTimeDays: null,
    },
];

describe('ReorderSuggestionsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        const { api } = require('@/lib/api');
        api.getReorderSuggestions.mockResolvedValue(mockReorderRows);
        api.getStores.mockResolvedValue([
            { id: 'store-1', name: 'Dhaka Branch' },
            { id: 'store-2', name: 'Chattogram Branch' },
        ]);
        api.getInventoryWarehouses.mockResolvedValue([
            { id: 'wh-1', name: 'Main Warehouse', is_active: true, store_id: 'store-1' },
            { id: 'wh-2', name: 'Inactive WH', is_active: false },
        ]);
        api.getProductGroups.mockResolvedValue([
            { id: 'grp-1', name: 'Electronics' },
        ]);
        api.getProductSubgroups.mockResolvedValue([
            { id: 'sub-1', name: 'Gadgets', group_id: 'grp-1' },
        ]);
    });

    it('renders the page heading', async () => {
        render(<ReorderSuggestionsPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        });
        expect(screen.getAllByText('Reorder Suggestions')[0]).toBeInTheDocument();
    });

    it('renders the subtitle', async () => {
        render(<ReorderSuggestionsPage />);
        await waitFor(() => {
            expect(screen.getByText(/Prioritize products that are below target stock/i)).toBeInTheDocument();
        });
    });

    it('calls getReorderSuggestions on mount', async () => {
        const { api } = require('@/lib/api');
        render(<ReorderSuggestionsPage />);
        await waitFor(() => {
            expect(api.getReorderSuggestions).toHaveBeenCalled();
        });
    });

    it('calls getInventoryWarehouses on mount', async () => {
        const { api } = require('@/lib/api');
        render(<ReorderSuggestionsPage />);
        await waitFor(() => {
            expect(api.getInventoryWarehouses).toHaveBeenCalled();
        });
    });

    it('renders the DataTable with correct title', async () => {
        render(<ReorderSuggestionsPage />);
        await waitFor(() => {
            expect(screen.getByTestId('data-table-title')).toHaveTextContent('Reorder Suggestions');
        });
    });

    it('renders DataTable with loaded rows', async () => {
        render(<ReorderSuggestionsPage />);
        await waitFor(() => {
            expect(screen.getByTestId('row-count')).toHaveTextContent('2');
        });
    });

    it('renders warehouse filter chip options', async () => {
        render(<ReorderSuggestionsPage />);
        await waitFor(() => {
            expect(screen.getByTestId('filter-warehouse')).toBeInTheDocument();
        });
        expect(screen.getByTestId('filter-layout')).toHaveTextContent('row');
        expect(screen.getByTestId('has-view-options')).toHaveTextContent('yes');
        expect(screen.getByTestId('stats-label')).toHaveTextContent('Report figures');
        expect(Number(screen.getByTestId('stats-count').textContent)).toBeGreaterThan(0);
    });

    it('renders group filter chip options', async () => {
        render(<ReorderSuggestionsPage />);
        await waitFor(() => {
            expect(screen.getByTestId('filter-group')).toBeInTheDocument();
            expect(screen.getByTestId('filter-group-option-grp-1')).toHaveTextContent('Electronics');
        });
    });

    it('renders subgroup filter chip options', async () => {
        render(<ReorderSuggestionsPage />);
        await waitFor(() => {
            expect(screen.getByTestId('filter-subgroup')).toBeInTheDocument();
            expect(screen.getByTestId('filter-subgroup-option-sub-1')).toHaveTextContent('Gadgets');
        });
    });

    it('only shows active warehouses in the filter', async () => {
        render(<ReorderSuggestionsPage />);
        await waitFor(() => {
            expect(screen.getByTestId('filter-warehouse-option-wh-1')).toHaveTextContent('Main Warehouse');
        });
        expect(screen.queryByTestId('filter-warehouse-option-wh-2')).not.toBeInTheDocument();
        expect(screen.queryByText('Inactive WH')).not.toBeInTheDocument();
    });

    it('shows correct empty state message', async () => {
        render(<ReorderSuggestionsPage />);
        await waitFor(() => {
            expect(screen.getByTestId('empty-message')).toHaveTextContent(
                'No reorder suggestions right now'
            );
        });
    });

    it('shows empty rows when API returns no data', async () => {
        const { api } = require('@/lib/api');
        api.getReorderSuggestions.mockResolvedValue([]);
        render(<ReorderSuggestionsPage />);
        await waitFor(() => {
            expect(screen.getByTestId('row-count')).toHaveTextContent('0');
        });
    });

    it('handles API error gracefully without crashing', async () => {
        const { api } = require('@/lib/api');
        api.getReorderSuggestions.mockRejectedValue(new Error('Network error'));
        render(<ReorderSuggestionsPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        });
    });

    it('handles filter loading error gracefully', async () => {
        const { api } = require('@/lib/api');
        api.getInventoryWarehouses.mockRejectedValue(new Error('Filter load failed'));
        render(<ReorderSuggestionsPage />);
        await waitFor(() => {
            expect(screen.getAllByText('Reorder Suggestions')[0]).toBeInTheDocument();
        });
    });
});
