'use client';

import { render, screen, waitFor } from '@testing-library/react';
import ReorderSuggestionsPage from './page';

jest.mock('../../../../../lib/api', () => ({
    api: {
        getReorderSuggestions: jest.fn(),
        getInventoryWarehouses: jest.fn(),
        getProductGroups: jest.fn(),
        getProductSubgroups: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/dashboard/inventory/reports/reorder',
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
        const { api } = require('../../../../../lib/api');
        api.getReorderSuggestions.mockResolvedValue(mockReorderRows);
        api.getInventoryWarehouses.mockResolvedValue([
            { id: 'wh-1', name: 'Main Warehouse', is_active: true },
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
        const { api } = require('../../../../../lib/api');
        render(<ReorderSuggestionsPage />);
        await waitFor(() => {
            expect(api.getReorderSuggestions).toHaveBeenCalled();
        });
    });

    it('calls getInventoryWarehouses on mount', async () => {
        const { api } = require('../../../../../lib/api');
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

    it('renders warehouse filter dropdown', async () => {
        render(<ReorderSuggestionsPage />);
        await waitFor(() => {
            expect(screen.getByText('All Warehouses')).toBeInTheDocument();
        });
    });

    it('renders group filter dropdown', async () => {
        render(<ReorderSuggestionsPage />);
        await waitFor(() => {
            expect(screen.getByText('All Groups')).toBeInTheDocument();
        });
    });

    it('renders subgroup filter dropdown', async () => {
        render(<ReorderSuggestionsPage />);
        await waitFor(() => {
            expect(screen.getByText('All Subgroups')).toBeInTheDocument();
        });
    });

    it('only shows active warehouses in the dropdown', async () => {
        render(<ReorderSuggestionsPage />);
        await waitFor(() => {
            expect(screen.getByText('Main Warehouse')).toBeInTheDocument();
            expect(screen.queryByText('Inactive WH')).not.toBeInTheDocument();
        });
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
        const { api } = require('../../../../../lib/api');
        api.getReorderSuggestions.mockResolvedValue([]);
        render(<ReorderSuggestionsPage />);
        await waitFor(() => {
            expect(screen.getByTestId('row-count')).toHaveTextContent('0');
        });
    });

    it('handles API error gracefully without crashing', async () => {
        const { api } = require('../../../../../lib/api');
        api.getReorderSuggestions.mockRejectedValue(new Error('Network error'));
        render(<ReorderSuggestionsPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        });
    });

    it('handles filter loading error gracefully', async () => {
        const { api } = require('../../../../../lib/api');
        api.getInventoryWarehouses.mockRejectedValue(new Error('Filter load failed'));
        render(<ReorderSuggestionsPage />);
        await waitFor(() => {
            expect(screen.getAllByText('Reorder Suggestions')[0]).toBeInTheDocument();
        });
    });
});
