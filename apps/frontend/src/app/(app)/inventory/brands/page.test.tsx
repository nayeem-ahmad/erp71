'use client';

import { render, screen, waitFor } from '@testing-library/react';
import BrandsPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getBrands: jest.fn(),
        createBrand: jest.fn(),
        updateBrand: jest.fn(),
        deleteBrand: jest.fn(),
    },
}));

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => (
        <a href={href}>{children}</a>
    );
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/inventory/brands',
    useSearchParams: () => ({ get: jest.fn() }),
}));

const mockBrands = [
    {
        id: 'brand-1',
        name: 'Samsung',
        description: 'Electronics brand',
        logo_url: null,
        website_url: 'https://samsung.com',
        created_at: '2024-01-01T00:00:00.000Z',
    },
    {
        id: 'brand-2',
        name: 'Apple',
        description: null,
        logo_url: null,
        website_url: null,
        created_at: '2024-01-02T00:00:00.000Z',
    },
];

describe('BrandsPage', () => {
    beforeEach(() => {
        const { api } = require('@/lib/api');
        api.getBrands.mockResolvedValue(mockBrands);
        api.createBrand.mockResolvedValue({});
        api.updateBrand.mockResolvedValue({});
        api.deleteBrand.mockResolvedValue({});
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('renders the Brands heading', async () => {
        render(<BrandsPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Brands' })).toBeInTheDocument();
        });
    });

    it('displays brands loaded from the API', async () => {
        render(<BrandsPage />);
        await waitFor(() => {
            expect(screen.getByText('Samsung')).toBeInTheDocument();
            expect(screen.getByText('Apple')).toBeInTheDocument();
        });
    });

    it('displays brand description when available', async () => {
        render(<BrandsPage />);
        await waitFor(() => {
            expect(screen.getByText('Electronics brand')).toBeInTheDocument();
        });
    });

    it('displays website URL when available', async () => {
        render(<BrandsPage />);
        await waitFor(() => {
            expect(screen.getByText('https://samsung.com')).toBeInTheDocument();
        });
    });

    it('renders the New Brand button', async () => {
        render(<BrandsPage />);
        await waitFor(() => {
            expect(screen.getByText('New Brand')).toBeInTheDocument();
        });
    });

    it('shows empty state when no brands exist', async () => {
        const { api } = require('@/lib/api');
        api.getBrands.mockResolvedValue([]);
        render(<BrandsPage />);
        await waitFor(() => {
            expect(screen.queryByText('Samsung')).not.toBeInTheDocument();
        });
    });

    it('calls getBrands on mount', async () => {
        const { api } = require('@/lib/api');
        render(<BrandsPage />);
        await waitFor(() => {
            expect(api.getBrands).toHaveBeenCalledTimes(1);
        });
    });
});
