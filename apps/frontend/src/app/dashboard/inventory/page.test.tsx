'use client';

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import InventoryPage from './page';

jest.mock('../../../lib/api', () => ({
    api: {
        getProducts: jest.fn(),
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
    usePathname: () => '/dashboard/inventory',
    useSearchParams: () => ({ get: jest.fn() }),
}));

jest.mock('./AddProductModal', () => ({
    __esModule: true,
    default: ({ isOpen, onClose, mode }: { isOpen: boolean; onClose: () => void; mode: string }) =>
        isOpen ? (
            <div data-testid={`add-product-modal-${mode}`}>
                <button onClick={onClose}>Close Modal</button>
            </div>
        ) : null,
}));

jest.mock('../purchases/CreatePurchaseModal', () => ({
    __esModule: true,
    default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
        isOpen ? (
            <div data-testid="create-purchase-modal">
                <button onClick={onClose}>Close Purchase Modal</button>
            </div>
        ) : null,
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

describe('InventoryPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('../../../lib/api');
        api.getProducts.mockResolvedValue(mockProducts);
        api.getProductGroups.mockResolvedValue([{ id: 'grp-1', name: 'Electronics' }]);
        api.getProductSubgroups.mockResolvedValue([
            { id: 'sub-1', name: 'Gadgets', group_id: 'grp-1' },
        ]);
        // Clear localStorage subscription plan
        localStorage.removeItem('subscription_plan_code');
    });

    it('renders the page heading', async () => {
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        });
        expect(screen.getByRole('heading', { name: 'Products' })).toBeInTheDocument();
    });

    it('calls getProducts on mount', async () => {
        const { api } = require('../../../lib/api');
        render(<InventoryPage />);
        await waitFor(() => {
            expect(api.getProducts).toHaveBeenCalled();
        });
    });

    it('calls getProductGroups and getProductSubgroups on mount', async () => {
        const { api } = require('../../../lib/api');
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

    it('renders navigation links', async () => {
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByText('Stock Ledger')).toBeInTheDocument();
            expect(screen.getByText('Settings')).toBeInTheDocument();
            expect(screen.getByText('Manage Categories')).toBeInTheDocument();
            expect(screen.getByText('Transfers')).toBeInTheDocument();
            expect(screen.getByText('Shrinkage')).toBeInTheDocument();
            expect(screen.getByText('Stock Takes')).toBeInTheDocument();
        });
    });

    it('renders Add Product button', async () => {
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /add product/i })).toBeInTheDocument();
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
            expect(screen.getByRole('button', { name: /add product/i })).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: /add product/i }));
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

    it('shows upgrade link for users without advanced plan', async () => {
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByText('Upgrade for Advanced Reports')).toBeInTheDocument();
        });
    });

    it('shows advanced report links for STANDARD plan users', async () => {
        localStorage.setItem('subscription_plan_code', 'STANDARD');
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByText('Reorder Report')).toBeInTheDocument();
            expect(screen.getByText('Shrinkage Report')).toBeInTheDocument();
        });
        localStorage.removeItem('subscription_plan_code');
    });

    it('shows advanced report links for PREMIUM plan users', async () => {
        localStorage.setItem('subscription_plan_code', 'PREMIUM');
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByText('Reorder Report')).toBeInTheDocument();
        });
        localStorage.removeItem('subscription_plan_code');
    });

    it('renders DataTable with loaded products', async () => {
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByTestId('row-count')).toHaveTextContent('2');
        });
    });

    it('renders empty message when no products', async () => {
        const { api } = require('../../../lib/api');
        api.getProducts.mockResolvedValue([]);
        render(<InventoryPage />);
        await waitFor(() => {
            expect(screen.getByTestId('empty-message')).toHaveTextContent('No products found');
        });
    });

    it('handles API error gracefully', async () => {
        const { api } = require('../../../lib/api');
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
});
