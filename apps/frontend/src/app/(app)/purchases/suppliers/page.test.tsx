'use client';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SuppliersPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getSuppliers: jest.fn(),
        getSuppliersPaged: jest.fn(),
        createSupplier: jest.fn(),
        updateSupplier: jest.fn(),
        deleteSupplier: jest.fn(),
    },
}));

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

// Every list follows the branch filter; two branches, header = store-1.
jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/purchases/suppliers',
    useSearchParams: () => ({ get: jest.fn() }),
}));

describe('SuppliersPage', () => {
    beforeEach(() => {
        const { api } = require('@/lib/api');
        api.getSuppliersPaged.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, pages: 1 });
        jest.clearAllMocks();
    });

    it('renders the page heading', async () => {
        const { api } = require('@/lib/api');
        api.getSuppliersPaged.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, pages: 1 });
        render(<SuppliersPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Suppliers' })).toBeInTheDocument();
        });
    });

    it('displays loaded supplier data', async () => {
        const { api } = require('@/lib/api');
        api.getSuppliersPaged.mockResolvedValue({
            items: [
            {
                id: '1',
                name: 'Dhaka Traders Ltd',
                phone: '01711111111',
                email: 'info@dhakatraders.com',
                address: '123 Motijheel, Dhaka',
                created_at: '2025-01-01T00:00:00Z',
            },
            ],
            total: 1,
            page: 1,
            limit: 20,
            pages: 1,
        });
        render(<SuppliersPage />);
        await waitFor(() => {
            expect(screen.getByText('Dhaka Traders Ltd')).toBeInTheDocument();
        });
    });

    it('handles empty state', async () => {
        const { api } = require('@/lib/api');
        api.getSuppliersPaged.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, pages: 1 });
        render(<SuppliersPage />);
        await waitFor(() => {
            expect(screen.getByText('No suppliers yet. Add your first supplier.')).toBeInTheDocument();
        });
    });

    it('renders the New Supplier button', async () => {
        const { api } = require('@/lib/api');
        api.getSuppliersPaged.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, pages: 1 });
        render(<SuppliersPage />);
        await waitFor(() => {
            expect(screen.getByText('New Supplier')).toBeInTheDocument();
        });
    });

    describe('branches', () => {
        const { mockBranchScope } = require('@/test-utils/branch-scope');
        const supplier = {
            id: 'sup-1', name: 'Fresh Farms', phone: null, email: null, address: null,
            created_at: '2026-01-01T00:00:00Z', store_id: 'store-2',
        };

        beforeEach(() => mockBranchScope());

        it('lists the suppliers of the branch the filter shows', async () => {
            const { api } = require('@/lib/api');
            api.getSuppliersPaged.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, pages: 1 });

            render(<SuppliersPage />);

            await waitFor(() => expect(api.getSuppliersPaged).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'store-1' })));
        });

        it('adds a supplier to the header branch unless another is picked', async () => {
            const { api } = require('@/lib/api');
            api.getSuppliersPaged.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, pages: 1 });
            api.createSupplier.mockResolvedValue({ id: 'sup-9' });
            render(<SuppliersPage />);

            fireEvent.click(await screen.findByText('New Supplier'));
            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByLabelText(/Branch/)).toHaveValue('store-1');

            fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: 'Padma Traders' } });
            fireEvent.change(within(dialog).getByLabelText(/Branch/), { target: { value: 'store-2' } });
            fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

            await waitFor(() => expect(api.createSupplier).toHaveBeenCalledWith(expect.objectContaining({
                name: 'Padma Traders',
                store_id: 'store-2',
            })));
        });

        it('shows which branch each supplier belongs to, to those who see every branch', async () => {
            const { api } = require('@/lib/api');
            api.getSuppliersPaged.mockResolvedValue({ items: [supplier], total: 1, page: 1, limit: 20, pages: 1 });

            render(<SuppliersPage />);

            expect(await screen.findByText('Chattogram Branch')).toBeInTheDocument();
        });

        it('keeps the branch read-only on an edit for a member who cannot move suppliers', async () => {
            mockBranchScope({ canSeeAll: false });
            const { api } = require('@/lib/api');
            api.getSuppliersPaged.mockResolvedValue({ items: [supplier], total: 1, page: 1, limit: 20, pages: 1 });
            api.updateSupplier.mockResolvedValue({});
            render(<SuppliersPage />);

            fireEvent.click(await screen.findByTitle('Edit'));
            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByLabelText(/Branch/)).toBeDisabled();

            fireEvent.click(within(dialog).getByRole('button', { name: /save changes/i }));
            await waitFor(() => expect(api.updateSupplier).toHaveBeenCalled());
            expect(api.updateSupplier.mock.calls[0][1].store_id).toBeUndefined();
        });
    });
});
