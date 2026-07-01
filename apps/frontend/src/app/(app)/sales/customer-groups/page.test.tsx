'use client';

import { render, screen, waitFor } from '@testing-library/react';
import CustomerGroupsPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getCustomerGroups: jest.fn(),
        createCustomerGroup: jest.fn(),
        updateCustomerGroup: jest.fn(),
        deleteCustomerGroup: jest.fn(),
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
    usePathname: () => '/sales/customer-groups',
    useSearchParams: () => ({ get: jest.fn() }),
}));

const mockGroups = [
    {
        id: 'grp-1',
        name: 'Wholesale',
        description: 'Bulk buyers',
        default_discount_pct: '10',
        _count: { customers: 5 },
    },
    {
        id: 'grp-2',
        name: 'Retail',
        description: null,
        default_discount_pct: null,
        _count: { customers: 12 },
    },
];

describe('CustomerGroupsPage', () => {
    beforeEach(() => {
        const { api } = require('@/lib/api');
        api.getCustomerGroups.mockResolvedValue(mockGroups);
        api.createCustomerGroup.mockResolvedValue({});
        api.updateCustomerGroup.mockResolvedValue({});
        api.deleteCustomerGroup.mockResolvedValue({});
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('renders the Customer Groups heading', async () => {
        render(<CustomerGroupsPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Customer Groups' })).toBeInTheDocument();
        });
    });

    it('displays customer groups loaded from the API', async () => {
        render(<CustomerGroupsPage />);
        await waitFor(() => {
            expect(screen.getByText('Wholesale')).toBeInTheDocument();
            expect(screen.getByText('Retail')).toBeInTheDocument();
        });
    });

    it('displays group description when available', async () => {
        render(<CustomerGroupsPage />);
        await waitFor(() => {
            expect(screen.getByText('Bulk buyers')).toBeInTheDocument();
        });
    });

    it('renders the New Group button', async () => {
        render(<CustomerGroupsPage />);
        await waitFor(() => {
            expect(screen.getByText('New Group')).toBeInTheDocument();
        });
    });

    it('shows empty state when no groups exist', async () => {
        const { api } = require('@/lib/api');
        api.getCustomerGroups.mockResolvedValue([]);
        render(<CustomerGroupsPage />);
        await waitFor(() => {
            expect(screen.queryByText('Wholesale')).not.toBeInTheDocument();
        });
    });

    it('calls getCustomerGroups on mount', async () => {
        const { api } = require('@/lib/api');
        render(<CustomerGroupsPage />);
        await waitFor(() => {
            expect(api.getCustomerGroups).toHaveBeenCalledTimes(1);
        });
    });

    it('displays discount percentage for groups that have one', async () => {
        render(<CustomerGroupsPage />);
        await waitFor(() => {
            expect(screen.getByText('10%')).toBeInTheDocument();
        });
    });
});
