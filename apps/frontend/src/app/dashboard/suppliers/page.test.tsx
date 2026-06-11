'use client';

import { render, screen, waitFor } from '@testing-library/react';
import SuppliersPage from './page';

jest.mock('../../../lib/api', () => ({
    api: {
        getSuppliers: jest.fn(),
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
    usePathname: () => '/dashboard/suppliers',
    useSearchParams: () => ({ get: jest.fn() }),
}));

describe('SuppliersPage', () => {
    beforeEach(() => {
        const { api } = require('../../../lib/api');
        api.getSuppliers.mockResolvedValue([]);
        jest.clearAllMocks();
    });

    it('renders the page heading', async () => {
        const { api } = require('../../../lib/api');
        api.getSuppliers.mockResolvedValue([]);
        render(<SuppliersPage />);
        await waitFor(() => {
            expect(screen.getByText('Suppliers')).toBeInTheDocument();
        });
    });

    it('displays loaded supplier data', async () => {
        const { api } = require('../../../lib/api');
        api.getSuppliers.mockResolvedValue([
            {
                id: '1',
                name: 'Dhaka Traders Ltd',
                phone: '01711111111',
                email: 'info@dhakatraders.com',
                address: '123 Motijheel, Dhaka',
                created_at: '2025-01-01T00:00:00Z',
            },
        ]);
        render(<SuppliersPage />);
        await waitFor(() => {
            expect(screen.getByText('Dhaka Traders Ltd')).toBeInTheDocument();
        });
    });

    it('handles empty state', async () => {
        const { api } = require('../../../lib/api');
        api.getSuppliers.mockResolvedValue([]);
        render(<SuppliersPage />);
        await waitFor(() => {
            expect(screen.getByText('No suppliers yet. Add your first supplier.')).toBeInTheDocument();
        });
    });

    it('renders the New Supplier button', async () => {
        const { api } = require('../../../lib/api');
        api.getSuppliers.mockResolvedValue([]);
        render(<SuppliersPage />);
        await waitFor(() => {
            expect(screen.getByText('New Supplier')).toBeInTheDocument();
        });
    });
});
