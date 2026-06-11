'use client';

import { render, screen, waitFor } from '@testing-library/react';
import DiscountCodesPage from './page';

jest.mock('../../../../lib/api', () => ({
    api: {
        getDiscountCodes: jest.fn(),
        createDiscountCode: jest.fn(),
        toggleDiscountCode: jest.fn(),
        deleteDiscountCode: jest.fn(),
    },
}));

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/dashboard/settings/discount-codes',
    useSearchParams: () => ({ get: jest.fn() }),
}));

describe('DiscountCodesPage', () => {
    beforeEach(() => {
        const { api } = require('../../../../lib/api');
        api.getDiscountCodes.mockResolvedValue([]);
        jest.clearAllMocks();
    });

    it('renders the page heading', async () => {
        const { api } = require('../../../../lib/api');
        api.getDiscountCodes.mockResolvedValue([]);
        render(<DiscountCodesPage />);
        await waitFor(() => {
            expect(screen.getByText('Discount Codes')).toBeInTheDocument();
        });
    });

    it('displays loaded discount codes', async () => {
        const { api } = require('../../../../lib/api');
        api.getDiscountCodes.mockResolvedValue([
            {
                id: '1',
                code: 'EID2025',
                name: 'Eid Special 2025',
                type: 'PERCENTAGE',
                value: '10',
                min_purchase: null,
                max_discount: null,
                usage_limit: null,
                used_count: 5,
                valid_from: null,
                valid_until: null,
                is_active: true,
                created_at: '2025-01-01T00:00:00Z',
            },
        ]);
        render(<DiscountCodesPage />);
        await waitFor(() => {
            expect(screen.getByText('EID2025')).toBeInTheDocument();
        });
    });

    it('shows empty state when no codes exist', async () => {
        const { api } = require('../../../../lib/api');
        api.getDiscountCodes.mockResolvedValue([]);
        render(<DiscountCodesPage />);
        await waitFor(() => {
            expect(screen.getByText('No discount codes yet')).toBeInTheDocument();
        });
    });

    it('renders the New Code button', async () => {
        const { api } = require('../../../../lib/api');
        api.getDiscountCodes.mockResolvedValue([]);
        render(<DiscountCodesPage />);
        await waitFor(() => {
            expect(screen.getByText('New Code')).toBeInTheDocument();
        });
    });
});
