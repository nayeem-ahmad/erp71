'use client';

import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import InventoryPage from './page';
import { removeWorkspaceItem } from '@/lib/session-store';
import { useTenantPlanFeatures } from '@/lib/use-tenant-plan-features';

jest.mock('@/lib/api', () => ({
    api: {
        getProducts: jest.fn(),
        getProductsPaged: jest.fn(),
        getProductGroups: jest.fn(),
        getProductSubgroups: jest.fn(),
        createProduct: jest.fn(),
        updateProduct: jest.fn(),
        deleteProduct: jest.fn(),
    },
    fetchWithAuth: jest.fn(),
}));

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => (
        <a href={href}>{children}</a>
    );
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/inventory/products',
    useSearchParams: () => ({ get: jest.fn() }),
}));

jest.mock('@/lib/use-tenant-plan-features', () => ({
    useTenantPlanFeatures: jest.fn(),
}));

jest.mock('../AddProductModal', () => ({
    __esModule: true,
    default: ({
        isOpen,
        onClose,
        mode,
        showMerge,
        onMergeClick,
    }: {
        isOpen: boolean;
        onClose: () => void;
        mode: string;
        showMerge?: boolean;
        onMergeClick?: () => void;
    }) =>
        isOpen ? (
            <div data-testid={`add-product-modal-${mode}`}>
                {showMerge ? (
                    <button type="button" onClick={onMergeClick}>
                        Merge into…
                    </button>
                ) : null}
                <button onClick={onClose}>Close Modal</button>
            </div>
        ) : null,
}));

jest.mock('../MergeProductModal', () => ({
    __esModule: true,
    default: ({
        isOpen,
        source,
        onClose,
        onMerged,
    }: {
        isOpen: boolean;
        source: { id: string; name: string };
        onClose: () => void;
        onMerged: (result: {
            targetId: string;
            targetName: string;
            counts: { saleLines: number; purchaseLines: number };
            combinedStock: number;
        }) => void;
    }) =>
        isOpen ? (
            <div data-testid="merge-product-modal">
                <span>{source.name}</span>
                <button
                    type="button"
                    onClick={() =>
                        onMerged({
                            targetId: 'prod-2',
                            targetName: 'Widget B',
                            counts: { saleLines: 1, purchaseLines: 0 },
                            combinedStock: 20,
                        })
                    }
                >
                    Confirm merge
                </button>
                <button type="button" onClick={onClose}>
                    Close merge
                </button>
            </div>
        ) : null,
}));

jest.mock('@/components/data-table', () => ({
    DataTable: ({
        title,
        emptyMessage,
        isLoading,
        data,
        columns = [],
    }: {
        title: string;
        emptyMessage: string;
        isLoading: boolean;
        data: any[];
        columns?: any[];
    }) => (
        <div>
            <div data-testid="data-table-title">{title}</div>
            {isLoading && <div data-testid="loading-indicator">Loading</div>}
            <div data-testid="empty-message">{emptyMessage}</div>
            <div data-testid="row-count">{data.length}</div>
            <div data-testid="row-actions">
                {data.map((row) => (
                    <div key={row.id}>
                        {columns.find((column: { id?: string }) => column.id === 'actions')?.cell?.({
                            row: { original: row },
                        })}
                    </div>
                ))}
            </div>
        </div>
    ),
    createdAtColumn: () => ({ id: 'created_at', header: 'Created' }),
    CreatedRangeFilter: () => <div data-testid="created-range-filter" />,
}));

jest.mock('@/components/ProductImage', () => ({
    __esModule: true,
    default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

const mockProducts = [
    {
        id: 'prod-1',
        name: 'Widget A',
        sku: 'WGT-001',
        price: '100',
        stocks: [{ quantity: 15 }],
        group: { id: 'grp-1', name: 'Electronics' },
        subgroup: { id: 'sub-1', name: 'Gadgets' },
    },
    {
        id: 'prod-2',
        name: 'Widget B',
        sku: 'WGT-002',
        price: '50',
        stocks: [{ quantity: 5 }],
        group: null,
        subgroup: null,
    },
];

const mockPlan = useTenantPlanFeatures as jest.Mock;

function setPlan(role: string, permissions: string[]) {
    mockPlan.mockReturnValue({
        planCode: 'pro',
        features: {},
        dashboardPreference: 'AUTO',
        permissions,
        role,
        ready: true,
    });
}

describe('InventoryPage', () => {
    let listedProducts: typeof mockProducts;

    beforeEach(() => {
        jest.clearAllMocks();
        listedProducts = [...mockProducts];
        setPlan('OWNER', []);
        const { api } = require('@/lib/api');
        api.getProductsPaged.mockImplementation(() =>
            Promise.resolve({
                items: listedProducts,
                total: listedProducts.length,
                page: 1,
                limit: 20,
                pages: 1,
            }),
        );
        api.getProductGroups.mockResolvedValue([{ id: 'grp-1', name: 'Electronics' }]);
        api.getProductSubgroups.mockResolvedValue([
            { id: 'sub-1', name: 'Gadgets', group_id: 'grp-1' },
        ]);
        // Clear localStorage subscription plan
        removeWorkspaceItem('subscription_plan_code');
    });

    it('renders the page heading', async () => {
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        });
        expect(screen.getByRole('heading', { name: 'Products' })).toBeInTheDocument();
    });

    it('calls getProductsPaged on mount', async () => {
        const { api } = require('@/lib/api');
        render(<InventoryPage />);
        await waitFor(() => {
            expect(api.getProductsPaged).toHaveBeenCalled();
        });
    });

    it('calls getProductGroups and getProductSubgroups on mount', async () => {
        const { api } = require('@/lib/api');
        render(<InventoryPage />);
        await waitFor(() => {
            expect(api.getProductGroups).toHaveBeenCalled();
            expect(api.getProductSubgroups).toHaveBeenCalled();
        });
    });

    it('renders the DataTable with correct title', async () => {
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByTestId('data-table-title')).toHaveTextContent('Products');
        });
    });

    it('renders Add Product button', async () => {
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getAllByRole('button', { name: /add product/i }).length).toBeGreaterThan(0);
        });
    });

    it('renders Import CSV button', async () => {
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /import csv/i })).toBeInTheDocument();
        });
    });

    it('opens add product modal when Add Product is clicked', async () => {
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getAllByRole('button', { name: /add product/i }).length).toBeGreaterThan(0);
        });
        fireEvent.click(screen.getAllByRole('button', { name: /add product/i })[0]);
        expect(screen.getByTestId('add-product-modal-create')).toBeInTheDocument();
    });

    it('renders group filter dropdown', async () => {
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByText('Group Filter')).toBeInTheDocument();
            expect(screen.getByText('All Groups')).toBeInTheDocument();
        });
    });

    it('renders subgroup filter dropdown', async () => {
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByText('Subgroup Filter')).toBeInTheDocument();
            expect(screen.getByText('All Subgroups')).toBeInTheDocument();
        });
    });

    it('renders uncategorized checkbox', async () => {
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByLabelText(/show only uncategorized/i)).toBeInTheDocument();
        });
    });

    it('renders DataTable with loaded products', async () => {
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByTestId('row-count')).toHaveTextContent('2');
        });
    });

    it('renders empty message when no products', async () => {
        const { api } = require('@/lib/api');
        api.getProductsPaged.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, pages: 1 });
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByTestId('empty-message')).toHaveTextContent('No products found');
        });
    });

    it('handles API error gracefully', async () => {
        const { api } = require('@/lib/api');
        api.getProducts.mockRejectedValue(new Error('Network error'));
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        });
    });

    it('populates group filter options from API', async () => {
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByText('Electronics')).toBeInTheDocument();
        });
    });

    it('hides Merge into… for a cashier who only has EDIT_PRODUCTS', async () => {
        setPlan('CASHIER', ['EDIT_PRODUCTS']);
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByTestId('row-count')).toHaveTextContent('2');
        });
        expect(screen.queryByTitle('Merge into…')).not.toBeInTheDocument();
    });

    it('shows Merge into… for an owner after products load', async () => {
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByTestId('row-count')).toHaveTextContent('2');
        });
        expect(screen.getAllByTitle('Merge into…').length).toBeGreaterThan(0);
    });

    it('shows Merge into… for a member with MANAGE_USERS', async () => {
        setPlan('MANAGER', ['MANAGE_USERS']);
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByTestId('row-count')).toHaveTextContent('2');
        });
        expect(screen.getAllByTitle('Merge into…').length).toBeGreaterThan(0);
    });

    it('removes the source row and toasts after a merge', async () => {
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByTestId('row-count')).toHaveTextContent('2');
        });
        fireEvent.click(screen.getAllByTitle('Merge into…')[0]);
        expect(screen.getByTestId('merge-product-modal')).toBeInTheDocument();
        listedProducts = [mockProducts[1]];
        fireEvent.click(screen.getByRole('button', { name: 'Confirm merge' }));
        await waitFor(() => {
            expect(screen.getByTestId('row-count')).toHaveTextContent('1');
        });
        expect(screen.getByText('Merged into Widget B')).toBeInTheDocument();
    });

    it('opens Merge into… from the edit modal for an owner', async () => {
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByTestId('row-count')).toHaveTextContent('2');
        });
        fireEvent.click(screen.getAllByTitle('Edit product')[0]);
        const editModal = screen.getByTestId('add-product-modal-edit');
        fireEvent.click(within(editModal).getByRole('button', { name: 'Merge into…' }));
        expect(screen.queryByTestId('add-product-modal-edit')).not.toBeInTheDocument();
        expect(screen.getByTestId('merge-product-modal')).toBeInTheDocument();
        expect(within(screen.getByTestId('merge-product-modal')).getByText('Widget A')).toBeInTheDocument();
    });

    it('does not offer Merge into… in the edit modal for a cashier', async () => {
        setPlan('CASHIER', ['EDIT_PRODUCTS']);
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByTestId('row-count')).toHaveTextContent('2');
        });
        fireEvent.click(screen.getAllByTitle('Edit product')[0]);
        expect(screen.getByTestId('add-product-modal-edit')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Merge into…' })).not.toBeInTheDocument();
    });
});
