'use client';

import { render, screen, waitFor } from '@testing-library/react';
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
});
