'use client';

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithQueryClient } from '@/test-utils/query-client';
import { mockBranchScope } from '@/test-utils/branch-scope';
import OrdersPage from './page';

/**
 * The sales-orders list carries the Sales list's layout: one filter row sent
 * to the server, and a stats strip counted from the same filters.
 */

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/sales/orders',
    useSearchParams: () => new URLSearchParams(),
}));

jest.mock('./StorefrontOrdersPanel', () => () => null);

// Desktop width: the one-row filter toolbar (the phone gets a sheet instead).
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock('@/lib/api', () => ({
    api: {
        getMe: jest.fn().mockResolvedValue({ tenants: [] }),
        getSalesSettings: jest.fn().mockResolvedValue({}),
        searchCustomers: jest.fn().mockResolvedValue([]),
        getOrdersList: jest.fn(),
        getOrdersListSummary: jest.fn(),
        deleteOrder: jest.fn(),
        updateOrderStatus: jest.fn(),
    },
}));

const page = (items: unknown[]) => ({ items, total: items.length, page: 1, limit: 25, pages: 1 });

/** A filter chip on the toolbar row — a button that opens its own popover. */
function chip(name: string | RegExp): HTMLElement {
    const found = screen
        .getAllByRole('button', { name })
        .find((button) => button.getAttribute('aria-haspopup') === 'dialog');
    if (!found) throw new Error(`No filter chip named ${String(name)}`);
    return found;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockBranchScope();
    const { api } = require('@/lib/api');
    api.getOrdersList.mockResolvedValue(
        page([
            {
                id: 'so-1',
                order_number: 'SO-00001',
                status: 'CONFIRMED',
                payment_status: 'PARTIAL',
                total_amount: '2500',
                amount_paid: '500',
                // Promised long ago and still open: the date shows in amber.
                delivery_date: '2020-01-01T00:00:00.000Z',
                created_at: '2019-12-20T00:00:00.000Z',
                customer: { name: 'Karim Traders' },
                store_id: 'store-1',
                items: [],
                deposits: [],
            },
        ]),
    );
    api.getOrdersListSummary.mockResolvedValue({
        count: 4,
        cancelledCount: 0,
        value: 10000,
        advance: 2500,
        open: { count: 2, amount: 4000 },
        delivered: { count: 2, amount: 6000 },
        overdue: 1,
    });
});

describe('Sales orders list', () => {
    it('shows advance, open, delivered and overdue orders in the strip', async () => {
        renderWithQueryClient(<OrdersPage />);

        const strip = await screen.findByRole('region', { name: 'Sales orders summary' });
        expect(await within(strip).findByText('· 2 open')).toBeInTheDocument();
        expect(within(strip).getByText('· 2 delivered')).toBeInTheDocument();
        expect(within(strip).getByText('· 25%')).toBeInTheDocument();
        expect(within(strip).getByText('Overdue')).toBeInTheDocument();
    });

    it('flags an open order past its delivery date', async () => {
        renderWithQueryClient(<OrdersPage />);
        await screen.findByText('SO-00001');
        const late = screen.getAllByText((_, node) => node?.tagName === 'SPAN' && node.className.includes('text-amber-700'));
        expect(late.length).toBeGreaterThan(0);
    });

    it('filters payment state and status on the server, for rows and strip alike', async () => {
        const { api } = require('@/lib/api');
        renderWithQueryClient(<OrdersPage />);
        await screen.findByText('SO-00001');

        fireEvent.click(chip('Payment'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Unpaid' }));
        await waitFor(() =>
            expect(api.getOrdersList).toHaveBeenLastCalledWith(
                expect.objectContaining({ page: 1, paymentStatus: ['UNPAID'], storeId: 'store-1' }),
            ),
        );
        expect(api.getOrdersListSummary).toHaveBeenLastCalledWith(expect.objectContaining({ paymentStatus: ['UNPAID'] }));

        fireEvent.click(chip('Status'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Processing' }));
        await waitFor(() =>
            expect(api.getOrdersList).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'PROCESSING' })),
        );
    });

    it('keeps Created behind More', async () => {
        renderWithQueryClient(<OrdersPage />);
        await screen.findByText('SO-00001');

        fireEvent.click(chip(/^More/));
        const more = screen.getByRole('dialog', { name: 'More' });
        expect(within(more).getByRole('button', { name: /^Created/ })).toBeInTheDocument();
    });
});
