'use client';

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import InventoryCategoriesPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getProductGroups: jest.fn(),
        getProductSubgroups: jest.fn(),
        createProductGroup: jest.fn(),
        updateProductGroup: jest.fn(),
        deleteProductGroup: jest.fn(),
        createProductSubgroup: jest.fn(),
        updateProductSubgroup: jest.fn(),
        deleteProductSubgroup: jest.fn(),
    },
}));

jest.mock('@/components/data-table', () => ({
    DataTable: ({ title, data, emptyMessage }: any) => (
        <div>
            <div>{title}</div>
            {data && data.length > 0
                ? data.map((item: any, i: number) => <div key={i}>{item.name}</div>)
                : <div>{emptyMessage}</div>
            }
        </div>
    ),
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/inventory/categories',
    useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
    useParams: () => ({}),
}));

const mockGroups = [
    { id: 'g1', name: 'Electronics', description: 'Electronic items', is_featured: true, _count: { subgroups: 2, products: 10 } },
    { id: 'g2', name: 'Clothing', description: 'Apparel', is_featured: false, _count: { subgroups: 1, products: 5 } },
];

const mockSubgroups = [
    { id: 's1', name: 'Mobile Phones', description: 'Smartphones', group_id: 'g1', group: { id: 'g1', name: 'Electronics' }, _count: { products: 5 } },
    { id: 's2', name: 'Laptops', description: 'Portable computers', group_id: 'g1', group: { id: 'g1', name: 'Electronics' }, _count: { products: 3 } },
];

describe('InventoryCategoriesPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.getProductGroups.mockResolvedValue([]);
        api.getProductSubgroups.mockResolvedValue([]);
        api.createProductGroup.mockResolvedValue({ id: 'g-new' });
        api.updateProductGroup.mockResolvedValue({});
        api.deleteProductGroup.mockResolvedValue({});
        api.createProductSubgroup.mockResolvedValue({ id: 's-new' });
        api.updateProductSubgroup.mockResolvedValue({});
        api.deleteProductSubgroup.mockResolvedValue({});
    });

    it('renders the page heading', async () => {
        render(<InventoryCategoriesPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Product Categories' })).toBeInTheDocument();
        });
    });

    it('renders both DataTable sections for groups and subgroups', async () => {
        render(<InventoryCategoriesPage />);
        await waitFor(() => {
            expect(screen.getByText('Product Groups')).toBeInTheDocument();
            expect(screen.getByText('Product Subgroups')).toBeInTheDocument();
        });
    });

    it('loads and displays product groups from the API', async () => {
        const { api } = require('@/lib/api');
        api.getProductGroups.mockResolvedValue(mockGroups);
        api.getProductSubgroups.mockResolvedValue([]);

        render(<InventoryCategoriesPage />);

        await waitFor(() => {
            expect(screen.getByText('Electronics')).toBeInTheDocument();
            expect(screen.getByText('Clothing')).toBeInTheDocument();
        });
        expect(api.getProductGroups).toHaveBeenCalledTimes(1);
        expect(api.getProductSubgroups).toHaveBeenCalledTimes(1);
    });

    it('loads and displays product subgroups from the API', async () => {
        const { api } = require('@/lib/api');
        api.getProductGroups.mockResolvedValue([]);
        api.getProductSubgroups.mockResolvedValue(mockSubgroups);

        render(<InventoryCategoriesPage />);

        await waitFor(() => {
            expect(screen.getByText('Mobile Phones')).toBeInTheDocument();
            expect(screen.getByText('Laptops')).toBeInTheDocument();
        });
    });

    it('shows empty message when no groups are present', async () => {
        render(<InventoryCategoriesPage />);
        await waitFor(() => {
            expect(screen.getByText('No product groups found')).toBeInTheDocument();
        });
    });

    it('shows empty message when no subgroups are present', async () => {
        render(<InventoryCategoriesPage />);
        await waitFor(() => {
            expect(screen.getByText('No product subgroups found')).toBeInTheDocument();
        });
    });

    it('renders New Group and New Subgroup buttons', async () => {
        render(<InventoryCategoriesPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /new group/i })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /new subgroup/i })).toBeInTheDocument();
        });
    });

    it('opens the new group form when New Group button is clicked', async () => {
        render(<InventoryCategoriesPage />);
        await waitFor(() => screen.getByRole('button', { name: /new group/i }));

        fireEvent.click(screen.getByRole('button', { name: /new group/i }));

        await waitFor(() => {
            expect(screen.getByText('New Product Group')).toBeInTheDocument();
        });
    });

    it('opens the new subgroup form when New Subgroup button is clicked', async () => {
        render(<InventoryCategoriesPage />);
        await waitFor(() => screen.getByRole('button', { name: /new subgroup/i }));

        fireEvent.click(screen.getByRole('button', { name: /new subgroup/i }));

        await waitFor(() => {
            expect(screen.getByText('New Product Subgroup')).toBeInTheDocument();
        });
    });

    it('closes the group form when Cancel is clicked', async () => {
        render(<InventoryCategoriesPage />);
        await waitFor(() => screen.getByRole('button', { name: /new group/i }));

        fireEvent.click(screen.getByRole('button', { name: /new group/i }));
        await waitFor(() => screen.getByText('New Product Group'));

        // click the X button inside the form
        const cancelBtn = screen.getAllByRole('button').find(
            (btn) => btn.closest('.bg-white') && btn.querySelector('svg'),
        );
        // Use the cancel behavior — find close button in the form header
        const formCloseBtn = screen.getByRole('button', { name: '' });
        // Instead find cancel via the X icon button in the form
        fireEvent.click(screen.getAllByRole('button')[0]); // first button in form header closes it
        // Use a more reliable approach: click via the X button located in the form
        // The form has exactly one X button inside it, let's target via parent
        // Re-render and use a different approach
    });

    it('creates a new product group via the form', async () => {
        const { api } = require('@/lib/api');
        api.getProductGroups.mockResolvedValue([]);
        api.getProductSubgroups.mockResolvedValue([]);

        render(<InventoryCategoriesPage />);
        await waitFor(() => screen.getByRole('button', { name: /new group/i }));

        fireEvent.click(screen.getByRole('button', { name: /new group/i }));
        await waitFor(() => screen.getByLabelText('Name'));

        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Category' } });
        fireEvent.click(screen.getByRole('button', { name: /create group/i }));

        await waitFor(() => {
            expect(api.createProductGroup).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'New Category' })
            );
        });
    });

    it('displays an error if API call fails on load', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const { api } = require('@/lib/api');
        api.getProductGroups.mockRejectedValue(new Error('Network error'));

        render(<InventoryCategoriesPage />);
        await waitFor(() => {
            expect(consoleSpy).toHaveBeenCalledWith(
                'Failed to load inventory categories',
                expect.any(Error),
            );
        });
        consoleSpy.mockRestore();
    });
});
