'use client';

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithQueryClient } from '@/test-utils/query-client';
import { mockBranchScope } from '@/test-utils/branch-scope';
import QuotesPage from './page';

/**
 * The quotations list carries the Sales list's layout: one filter row sent to
 * the server, and a stats strip counted from the same filters.
 */

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/sales/quotes',
    useSearchParams: () => new URLSearchParams(),
}));

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
        searchCustomers: jest.fn(),
        getQuotationsList: jest.fn(),
        getQuotationsListSummary: jest.fn(),
        deleteQuotation: jest.fn(),
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
    api.searchCustomers.mockResolvedValue([{ id: 'cust-7', name: 'Karim Traders' }]);
    api.getQuotationsList.mockResolvedValue(
        page([
            {
                id: 'q-1',
                quote_number: 'QUO-00001',
                version: 1,
                doc_kind: 'QUOTE',
                currency: 'BDT',
                status: 'SENT',
                // Long past, and still live: the date shows in amber.
                valid_until: '2020-01-01T00:00:00.000Z',
                total_amount: '1500',
                created_at: '2019-12-20T00:00:00.000Z',
                customer: { name: 'Karim Traders', phone: '01700000001' },
                items: [{ id: 'i1' }],
            },
        ]),
    );
    api.getQuotationsListSummary.mockResolvedValue({
        count: 9,
        value: 19000,
        awaiting: 4,
        accepted: { count: 1, amount: 1500 },
        converted: 2,
        expired: 3,
    });
});

describe('Sales quotations list', () => {
    it('shows the strip for the filtered quotations, with lapsed ones flagged', async () => {
        renderWithQueryClient(<QuotesPage />);

        const strip = await screen.findByRole('region', { name: 'Quotations summary' });
        await within(strip).findByText('Quoted value');
        expect(within(strip).getByText('· 1 accepted')).toBeInTheDocument();
        expect(within(strip).getByText('Expired')).toBeInTheDocument();
        // Statuses in words, not the stored code.
        expect(await screen.findAllByText('Sent')).not.toHaveLength(0);
    });

    it('filters the status on the server, for rows and strip alike, and can invert it', async () => {
        const { api } = require('@/lib/api');
        renderWithQueryClient(<QuotesPage />);
        await screen.findByText('QUO-00001');

        fireEvent.click(chip('Status'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Revised' }));

        await waitFor(() =>
            expect(api.getQuotationsList).toHaveBeenLastCalledWith(
                expect.objectContaining({ page: 1, status: 'REVISED', storeId: 'store-1' }),
            ),
        );
        expect(api.getQuotationsListSummary).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'REVISED' }));
    });

    it('filters by a customer found through a server search', async () => {
        const { api } = require('@/lib/api');
        renderWithQueryClient(<QuotesPage />);
        await screen.findByText('QUO-00001');

        fireEvent.click(chip('Customer'));
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search Customer…' }), { target: { value: 'kar' } });
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Karim Traders' }));

        await waitFor(() =>
            expect(api.getQuotationsList).toHaveBeenLastCalledWith(expect.objectContaining({ customerIds: ['cust-7'] })),
        );
        expect(api.getQuotationsListSummary).toHaveBeenLastCalledWith(expect.objectContaining({ customerIds: ['cust-7'] }));
    });

    it('keeps Created behind More', async () => {
        renderWithQueryClient(<QuotesPage />);
        await screen.findByText('QUO-00001');

        fireEvent.click(chip(/^More/));
        const more = screen.getByRole('dialog', { name: 'More' });
        expect(within(more).getByRole('button', { name: /^Created/ })).toBeInTheDocument();
    });
});
