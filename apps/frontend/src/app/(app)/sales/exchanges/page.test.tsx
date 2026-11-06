'use client';

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithQueryClient } from '@/test-utils/query-client';
import { mockBranchScope } from '@/test-utils/branch-scope';
import ExchangesPage from './page';

/**
 * The exchanges list carries the Sales list's layout: one filter row sent to
 * the server and a stats strip counted from the same filters.
 */

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

const push = jest.fn();
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push, replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/sales/exchanges',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({}),
}));

// Desktop width: the one-row filter toolbar (the phone gets a sheet instead).
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getMe: jest.fn().mockResolvedValue({ tenants: [] }),
        getSalesSettings: jest.fn().mockResolvedValue({}),
        getExchangesList: jest.fn(),
        getExchangesListSummary: jest.fn(),
        searchCustomers: jest.fn(),
    },
}));

const page = (items: unknown[]) => ({ items, total: items.length, page: 1, limit: 20, pages: 1 });

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
    api.getExchangesList.mockResolvedValue(
        page([
            {
                id: 'ex-1',
                exchange_number: 'EXC-00001',
                created_at: '2026-03-20T10:00:00.000Z',
                returned_total: '500',
                replacement_total: '650',
                difference: '150',
                settlement_mode: 'bkash',
                status: 'COMPLETED',
                sale: { id: 'sale-1', serial_number: 'INV-0042', customer: { name: 'Karim Store' } },
            },
            {
                id: 'ex-2',
                exchange_number: 'EXC-00002',
                created_at: '2026-03-21T10:00:00.000Z',
                returned_total: '300',
                replacement_total: '300',
                difference: '0',
                settlement_mode: 'cash',
                status: 'CANCELLED',
                sale: { id: 'sale-2', serial_number: 'INV-0043', customer: null },
            },
        ]),
    );
    api.getExchangesListSummary.mockResolvedValue({
        count: 7,
        cancelledCount: 1,
        returned: 5000,
        replacement: 5600,
        charged: { count: 4, amount: 900 },
        refunded: { count: 2, amount: 300 },
    });
    api.searchCustomers.mockResolvedValue([{ id: 'cust-9', name: 'Karim Store' }]);
});

describe('ExchangesPage', () => {
    it('renders the server page with statuses and settlement in words', async () => {
        renderWithQueryClient(<ExchangesPage />);

        expect(await screen.findByText('EXC-00001')).toBeInTheDocument();
        const first = screen.getByText('EXC-00001').closest('tr') as HTMLElement;
        expect(within(first).getByText('INV-0042')).toHaveAttribute('href', '/sales/sale-1');
        expect(within(first).getByText('Karim Store')).toBeInTheDocument();
        expect(within(first).getByText('bKash')).toBeInTheDocument();
        expect(within(first).getByText('Completed')).toBeInTheDocument();
        const second = screen.getByText('EXC-00002').closest('tr') as HTMLElement;
        expect(within(second).getByText('Walk-in')).toBeInTheDocument();
        expect(within(second).getByText('Cancelled')).toBeInTheDocument();
    });

    it('asks the server for the newest exchanges of the header branch', async () => {
        const { api } = require('@/lib/api');
        renderWithQueryClient(<ExchangesPage />);
        await screen.findByText('EXC-00001');

        expect(api.getExchangesList).toHaveBeenCalledWith(
            expect.objectContaining({ page: 1, sortBy: 'created_at', sortDir: 'desc', storeId: 'store-1' }),
        );
        expect(api.getExchangesListSummary).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'store-1' }));
    });

    it('shows goods back and out, and the difference paid each way, in the strip', async () => {
        renderWithQueryClient(<ExchangesPage />);

        const strip = await screen.findByRole('region', { name: 'Exchanges summary' });
        expect(await within(strip).findByText('7')).toBeInTheDocument();
        expect(within(strip).getByText('· 1 cancelled')).toBeInTheDocument();
        expect(within(strip).getByText('Goods back')).toBeInTheDocument();
        expect(within(strip).getByText('Goods out')).toBeInTheDocument();
        expect(within(strip).getByText('· 4 exchanges')).toBeInTheDocument();
        expect(within(strip).getByText('· 2 exchanges')).toBeInTheDocument();
    });

    it('filters the status on the server, for rows and strip alike', async () => {
        const { api } = require('@/lib/api');
        renderWithQueryClient(<ExchangesPage />);
        await screen.findByText('EXC-00001');

        fireEvent.click(chip('Status'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Cancelled' }));

        await waitFor(() =>
            expect(api.getExchangesList).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, status: 'CANCELLED' })),
        );
        expect(api.getExchangesListSummary).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'CANCELLED' }));
    });

    it('filters by a customer found through a server search', async () => {
        const { api } = require('@/lib/api');
        renderWithQueryClient(<ExchangesPage />);
        await screen.findByText('EXC-00001');

        fireEvent.click(chip('Customer'));
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search Customer…' }), { target: { value: 'kar' } });
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Karim Store' }));

        await waitFor(() =>
            expect(api.getExchangesList).toHaveBeenLastCalledWith(expect.objectContaining({ customerIds: ['cust-9'] })),
        );
        expect(api.getExchangesListSummary).toHaveBeenLastCalledWith(expect.objectContaining({ customerIds: ['cust-9'] }));
    });

    it('keeps the settlement chip behind More and sends the chosen modes', async () => {
        const { api } = require('@/lib/api');
        renderWithQueryClient(<ExchangesPage />);
        await screen.findByText('EXC-00001');

        fireEvent.click(chip(/^More/));
        const more = screen.getByRole('dialog', { name: 'More' });
        fireEvent.click(within(more).getByRole('button', { name: /^Settled/ }));
        fireEvent.click(await screen.findByRole('checkbox', { name: 'bKash' }));

        await waitFor(() =>
            expect(api.getExchangesList).toHaveBeenLastCalledWith(expect.objectContaining({ settlementModes: ['bkash'] })),
        );
    });

    it('opens an exchange from its row', async () => {
        renderWithQueryClient(<ExchangesPage />);
        fireEvent.click(await screen.findByText('Karim Store'));
        expect(push).toHaveBeenCalledWith('/sales/exchanges/ex-1');
    });

    it('links to the new exchange page from the header', async () => {
        renderWithQueryClient(<ExchangesPage />);
        expect(await screen.findByRole('link', { name: /new exchange/i })).toHaveAttribute('href', '/sales/exchanges/new');
    });
});
