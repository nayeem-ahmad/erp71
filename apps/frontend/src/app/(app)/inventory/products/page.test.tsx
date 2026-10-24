'use client';

import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react';
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

const toastSuccess = jest.fn();
const toastError = jest.fn();
jest.mock('@/lib/toast', () => ({
    toast: {
        success: (...args: unknown[]) => toastSuccess(...args),
        error: (...args: unknown[]) => toastError(...args),
        info: jest.fn(),
    },
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

// What the page hands the table — its toolbar filters, search, View options.
let mockTableProps: any = null;
jest.mock('@/components/data-table', () => ({
    DataTable: (props: {
        title: string;
        emptyMessage: string;
        isLoading: boolean;
        data: any[];
        columns?: any[];
        serverPagination?: { onColumnFiltersChange?: (filters: { id: string; value: string }[]) => void };
    }) => {
        mockTableProps = props;
        const { title, emptyMessage, isLoading, data, columns = [], serverPagination } = props;
        return (
        <div>
            <div data-testid="data-table-title">{title}</div>
            {serverPagination?.onColumnFiltersChange && (
                <button type="button" onClick={() => serverPagination.onColumnFiltersChange!([{ id: 'sku', value: 'RICE' }])}>
                    filter-sku
                </button>
            )}
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
        );
    },
    createdAtColumn: () => ({ id: 'created_at', header: 'Created' }),
}));

/** A toolbar filter the page handed the table, by id. */
const tableFilter = (id: string) => mockTableProps.filters.find((filter: { id: string }) => filter.id === id);

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

    // The table's advanced filters go to the server, so their matches are paged
    // together rather than left wherever they fell in the unfiltered list.
    it('sends the table column filters to the server, from page 1', async () => {
        const { api } = require('@/lib/api');
        render(<InventoryPage />);

        fireEvent.click(await screen.findByRole('button', { name: 'filter-sku' }));

        await waitFor(() =>
            expect(api.getProductsPaged).toHaveBeenLastCalledWith(
                expect.objectContaining({ page: 1, filters: { sku: 'RICE' } }),
            ),
        );
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

    it('puts the status, group, subgroup, uncategorized and created filters in the table toolbar', async () => {
        render(<InventoryPage />);
        await screen.findByTestId('data-table-title');

        expect(mockTableProps.filters.map((filter: { id: string }) => filter.id)).toEqual([
            'stockStatus', 'group', 'subgroup', 'uncategorized', 'created',
        ]);
        expect(tableFilter('uncategorized')).toEqual(expect.objectContaining({
            type: 'toggle',
            label: 'Show only uncategorized',
        }));
        expect(mockTableProps.viewOptions).toBe(true);
        expect(mockTableProps.showSearch).toBeUndefined();
    });

    it('sends a toolbar filter to the server, from page 1', async () => {
        const { api } = require('@/lib/api');
        render(<InventoryPage />);
        await screen.findByTestId('data-table-title');

        act(() => tableFilter('stockStatus').onChange('LOW'));

        await waitFor(() =>
            expect(api.getProductsPaged).toHaveBeenLastCalledWith(
                expect.objectContaining({ page: 1, stockStatus: 'LOW' }),
            ),
        );
    });

    it('searches the server from the table box', async () => {
        const { api } = require('@/lib/api');
        render(<InventoryPage />);
        await screen.findByTestId('data-table-title');

        act(() => mockTableProps.onSearchChange('rice'));

        await waitFor(() =>
            expect(api.getProductsPaged).toHaveBeenLastCalledWith(
                expect.objectContaining({ page: 1, search: 'rice' }),
            ),
        );
    });

    it('lets "uncategorized" and a group release each other', async () => {
        render(<InventoryPage />);
        await waitFor(() => expect(tableFilter('group').options).toEqual([{ value: 'grp-1', label: 'Electronics' }]));

        act(() => tableFilter('group').onChange('grp-1'));
        act(() => tableFilter('uncategorized').onChange(true));
        expect(tableFilter('group').value).toBeNull();
        expect(tableFilter('uncategorized').pressed).toBe(true);

        act(() => tableFilter('group').onChange('grp-1'));
        expect(tableFilter('uncategorized').pressed).toBe(false);
    });

    it('right-aligns the price, the stock and its value', async () => {
        render(<InventoryPage />);
        await screen.findByTestId('data-table-title');

        const align = (id: string) =>
            mockTableProps.columns.find((column: any) => (column.id ?? column.accessorKey) === id)?.meta?.align;
        expect(align('price')).toBe('end');
        expect(align('stock')).toBe('end');
        expect(align('stock_value')).toBe('end');
    });

    it('asks in a dialog before deleting a product, then toasts', async () => {
        const { api } = require('@/lib/api');
        api.deleteProduct.mockResolvedValue(undefined);
        const confirmSpy = jest.spyOn(window, 'confirm').mockImplementation(() => true);
        try {
            render(<InventoryPage />);
            await waitFor(() => expect(screen.getByTestId('row-count')).toHaveTextContent('2'));

            fireEvent.click(screen.getAllByTitle('Delete')[0]);
            expect(confirmSpy).not.toHaveBeenCalled();
            expect(api.deleteProduct).not.toHaveBeenCalled();

            fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

            await waitFor(() => expect(api.deleteProduct).toHaveBeenCalledWith('prod-1'));
            await waitFor(() => expect(screen.getByTestId('row-count')).toHaveTextContent('1'));
            expect(toastSuccess).toHaveBeenCalled();
        } finally {
            confirmSpy.mockRestore();
        }
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
            expect(tableFilter('group').options).toEqual([{ value: 'grp-1', label: 'Electronics' }]);
        });
        expect(tableFilter('subgroup').options).toEqual([{ value: 'sub-1', label: 'Gadgets' }]);
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
        expect(toastSuccess).toHaveBeenCalledWith('Merged into Widget B');
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
