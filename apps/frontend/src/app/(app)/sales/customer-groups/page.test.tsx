'use client';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CustomerGroupsPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getCustomerGroups: jest.fn(),
        createCustomerGroup: jest.fn(),
        updateCustomerGroup: jest.fn(),
        deleteCustomerGroup: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// Desktop width: the one-row filter toolbar (the phone gets a sheet instead).
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

/** A filter chip on the toolbar row — a button that opens its own popover. */
function chip(name: string | RegExp): HTMLElement {
    const found = screen
        .getAllByRole('button', { name })
        .find((button) => button.getAttribute('aria-haspopup') === 'dialog');
    if (!found) throw new Error(`No filter chip named ${String(name)}`);
    return found;
}

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
        price_list_id: 'pl-1',
        priceList: { id: 'pl-1', name: 'Wholesale Prices' },
        _count: { customers: 5 },
    },
    {
        id: 'grp-2',
        name: 'Retail',
        description: null,
        default_discount_pct: null,
        _count: { customers: 12 },
    },
    {
        id: 'grp-3',
        name: 'Dormant',
        description: null,
        default_discount_pct: null,
        _count: { customers: 0 },
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

    it('counts the groups, their customers, price lists and discounts in the strip', async () => {
        render(<CustomerGroupsPage />);
        const strip = await screen.findByRole('region', { name: 'Customer group figures' });
        await waitFor(() => expect(within(strip).getByText('3')).toBeInTheDocument());
        expect(within(strip).getByText('17')).toBeInTheDocument();
        // One group has a price list, one a discount.
        expect(within(strip).getAllByText('1')).toHaveLength(2);
    });

    it('narrows rows and strip to the groups with no price list', async () => {
        render(<CustomerGroupsPage />);
        await screen.findByText('Wholesale');

        fireEvent.click(chip('Price List'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'No price list' }));

        await waitFor(() => expect(screen.queryByText('Wholesale')).not.toBeInTheDocument());
        expect(screen.getByText('Retail')).toBeInTheDocument();
        const strip = screen.getByRole('region', { name: 'Customer group figures' });
        expect(within(strip).getByText('2')).toBeInTheDocument();
    });

    it('keeps delete off a group that still has customers', async () => {
        render(<CustomerGroupsPage />);
        const row = (await screen.findByText('Wholesale')).closest('tr')!;
        expect(within(row).getByRole('button', { name: 'Has customers — reassign them first' })).toHaveAttribute(
            'aria-disabled',
            'true',
        );
    });

    it('asks in a dialog before deleting, never window.confirm', async () => {
        const { api } = require('@/lib/api');
        const { toast } = require('@/lib/toast');
        const confirmSpy = jest.spyOn(window, 'confirm');
        render(<CustomerGroupsPage />);
        const row = (await screen.findByText('Dormant')).closest('tr')!;

        fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Delete Dormant?')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(api.deleteCustomerGroup).toHaveBeenCalledWith('grp-3'));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Group deleted'));
        expect(api.getCustomerGroups).toHaveBeenCalledTimes(2);
        expect(confirmSpy).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
    });
});
