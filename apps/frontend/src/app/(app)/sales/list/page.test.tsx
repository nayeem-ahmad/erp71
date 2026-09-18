'use client';
jest.mock('@/lib/i18n', () => {
  const { enMessages } = require('@/lib/localization/messages/en');

  return {
    useI18n: () => ({
      t: enMessages,
      locale: 'en',
    }),
    formatMessage: (template, values = {}) =>
      Object.entries(values).reduce(
        (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
        template,
      ),
  };
}, { virtual: true });

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SalesListPage from './page';

jest.mock('next/link', () => {
    // Forwards the rest of the props: the row menus put `role="menuitem"` on
    // their links, and a mock that keeps only `href` makes them unfindable by
    // role even though the real Link renders them.
    const MockLink = ({ children, href, ...rest }: any) => (
        <a href={href} {...rest}>{children}</a>
    );
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('@/lib/api', () => ({
    api: {
        getSalesList: jest.fn(),
        getSalesSettings: jest.fn().mockResolvedValue({ pos_enabled: true }),
        // The Cancel action is permission-gated, and `useTenantPlanFeatures`
        // resolves those through /auth/me on mount. No membership → no
        // CANCEL_ENTRY → the action is hidden, which is the default here.
        getMe: jest.fn().mockResolvedValue({ tenants: [] }),
        cancelSale: jest.fn(),
        // Printing a row fetches the full sale, because the list payload
        // carries no line items.
        getSale: jest.fn().mockResolvedValue({
            id: 'sale-1',
            serial_number: 'SL-00001',
            created_at: '2026-03-20T10:00:00.000Z',
            total_amount: '55.00',
            amount_paid: '55.00',
            items: [{ quantity: 1, price_at_sale: '55.00', product: { name: 'Widget' } }],
            payments: [{ payment_method: 'CASH', amount: '55.00' }],
            customer: { name: 'Alice Smith' },
        }),
    },
}));

// The printers open a popup and write a document into it; the assertions here
// are about which document was asked for, not what it renders.
jest.mock('@/lib/sale-print-actions', () => ({
    ...jest.requireActual('@/lib/sale-print-actions'),
    printSaleInvoice: jest.fn(),
    printSaleChallan: jest.fn(),
    printSaleReceipt: jest.fn(),
}));

// DataTable hides hideOnMobile columns (Created) when matchMedia reports a
// narrow viewport. The global mock always reports non-matching.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

const mockSales = [
    {
        id: 'sale-1',
        serial_number: 'SL-00001',
        created_at: '2026-03-20T10:00:00.000Z',
        sale_date: '2026-01-05T12:00:00.000Z',
        items: [{ id: 'item-1' }, { id: 'item-2' }],
        total_amount: '55.00',
        amount_paid: '55.00',
        status: 'COMPLETED',
        payments: [{ payment_method: 'CASH', amount: '55.00' }],
        customer: { name: 'Alice Smith' },
    },
    {
        id: 'sale-2',
        serial_number: 'SL-00002',
        created_at: '2026-03-21T11:00:00.000Z',
        items: [{ id: 'item-3' }],
        total_amount: '20.00',
        amount_paid: '20.00',
        status: 'REFUNDED',
        payments: [{ payment_method: 'BKASH', amount: '20.00' }],
        customer: undefined,
    },
];

describe('SalesListPage — Sales Transaction List', () => {
    beforeEach(() => {
        const { api } = require('@/lib/api');
        // The list pages against the server, so the mock returns one page plus
        // the real total rather than a bare array.
        api.getSalesList.mockResolvedValue({
            items: mockSales,
            total: mockSales.length,
            page: 1,
            limit: 20,
            pages: 1,
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('renders the Sales page heading', async () => {
        render(<SalesListPage />);
        expect(screen.getByRole('heading', { level: 1, name: 'Sales' })).toBeInTheDocument();
    });

    it('displays sales loaded from the API', async () => {
        render(<SalesListPage />);
        await waitFor(() => {
            expect(screen.getByText('SL-00001')).toBeInTheDocument();
            expect(screen.getByText('SL-00002')).toBeInTheDocument();
        });
    });

    it('shows customer name for sales with a customer', async () => {
        render(<SalesListPage />);
        await waitFor(() => {
            expect(screen.getByText('Alice Smith')).toBeInTheDocument();
        });
    });

    it('shows Walk-in for sales with no customer', async () => {
        render(<SalesListPage />);
        await waitFor(() => {
            expect(screen.getByText('Walk-in')).toBeInTheDocument();
        });
    });

    it('displays item count for each sale', async () => {
        render(<SalesListPage />);
        await waitFor(() => {
            expect(screen.getByText('2 items')).toBeInTheDocument();
            expect(screen.getByText('1 items')).toBeInTheDocument();
        });
    });

    it('displays formatted total amounts', async () => {
        render(<SalesListPage />);
        await waitFor(() => {
            expect(screen.getAllByText('৳ 55.00').length).toBeGreaterThan(0);
            expect(screen.getAllByText('৳ 20.00').length).toBeGreaterThan(0);
        });
    });

    it('renders COMPLETED status badge', async () => {
        render(<SalesListPage />);
        await waitFor(() => {
            expect(screen.getByText('Completed')).toBeInTheDocument();
        });
    });

    it('renders REFUNDED status badge', async () => {
        render(<SalesListPage />);
        await waitFor(() => {
            expect(screen.getByText('Refunded')).toBeInTheDocument();
        });
    });

    it('shows payment method tags', async () => {
        render(<SalesListPage />);
        await waitFor(() => {
            expect(screen.getByText('CASH')).toBeInTheDocument();
            expect(screen.getByText('BKASH')).toBeInTheDocument();
        });
    });

    it('renders view action link to sale detail page', async () => {
        render(<SalesListPage />);
        await waitFor(() => {
            const link = screen.getAllByRole('link').find(
                (l) => l.getAttribute('href') === '/sales/sale-1',
            );
            expect(link).toBeDefined();
        });
    });

    it('prints the invoice from the row instead of opening the invoice page', async () => {
        const { api } = require('@/lib/api');
        const { printSaleInvoice } = require('@/lib/sale-print-actions');

        render(<SalesListPage />);
        await waitFor(() => expect(screen.getByText('SL-00001')).toBeInTheDocument());

        // The old behaviour was a link to /sales/:id/invoice. Printing in place
        // is the whole point of the change, so the link must be gone.
        const hrefs = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
        expect(hrefs).not.toContain('/sales/sale-1/invoice');

        fireEvent.click(screen.getAllByTitle('Print Invoice')[0]);

        // A row carries no line items, so the sale is fetched before printing.
        await waitFor(() => expect(api.getSale).toHaveBeenCalledWith('sale-1'));
        await waitFor(() => expect(printSaleInvoice).toHaveBeenCalled());
    });

    it('offers the other sale documents under the print menu', async () => {
        const { printSaleChallan } = require('@/lib/sale-print-actions');

        render(<SalesListPage />);
        await waitFor(() => expect(screen.getByText('SL-00001')).toBeInTheDocument());

        fireEvent.click(screen.getAllByTitle('Print options')[0]);

        const challan = await screen.findByRole('menuitem', { name: /delivery challan/i });
        fireEvent.click(challan);

        await waitFor(() => expect(printSaleChallan).toHaveBeenCalled());
    });

    it('keeps the statutory and on-screen documents reachable from the print menu', async () => {
        render(<SalesListPage />);
        await waitFor(() => expect(screen.getByText('SL-00001')).toBeInTheDocument());

        fireEvent.click(screen.getAllByTitle('Print options')[0]);

        const mushak = await screen.findByRole('menuitem', { name: /mushak/i });
        expect(mushak).toHaveAttribute('href', '/sales/sale-1/mushak');
        expect(screen.getByRole('menuitem', { name: /open invoice page/i }))
            .toHaveAttribute('href', '/sales/sale-1/invoice');
    });

    it('renders a duplicate action pointing the entry form at the sale', async () => {
        render(<SalesListPage />);
        await waitFor(() => expect(screen.getByText('SL-00001')).toBeInTheDocument());

        // Duplicate moved into the row overflow menu so the column could carry
        // the print options without running past its width.
        fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[0]);

        const link = await screen.findByRole('menuitem', { name: /duplicate/i });
        expect(link).toHaveAttribute('href', '/sales/new?duplicate=sale-1');
    });

    it('shows empty state when no sales exist', async () => {
        const { api } = require('@/lib/api');
        api.getSalesList.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, pages: 0 });

        render(<SalesListPage />);
        await waitFor(() => {
            expect(screen.queryByText('SL-00001')).not.toBeInTheDocument();
        });
    });

    it('requests a page from the server on mount', async () => {
        const { api } = require('@/lib/api');
        render(<SalesListPage />);
        await waitFor(() => {
            expect(api.getSalesList).toHaveBeenCalledTimes(1);
        });
    });

    it('shows sale_date as Sale date and created_at as Created', async () => {
        render(<SalesListPage />);
        await waitFor(() => expect(screen.getByText('SL-00001')).toBeInTheDocument());
        expect(screen.getByRole('columnheader', { name: /sale date/i })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: /^created$/i })).toBeInTheDocument();
        expect(screen.getByText('05/01/2026')).toBeInTheDocument();
        expect(screen.getByText('20/03/2026')).toBeInTheDocument();
    });

    it('sends createdFrom/createdTo when a Created range is chosen', async () => {
        const { api } = require('@/lib/api');
        render(<SalesListPage />);
        await waitFor(() => expect(api.getSalesList).toHaveBeenCalled());
        api.getSalesList.mockClear();

        fireEvent.click(screen.getByRole('button', { name: /created · any time/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Today' }));

        await waitFor(() => {
            expect(api.getSalesList).toHaveBeenCalledWith(
                expect.objectContaining({
                    createdFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
                    createdTo: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
                }),
            );
        });
    });

    it('shows a New Sales Entry action linking to /sales/new (not POS)', async () => {
        render(<SalesListPage />);
        const link = await screen.findByRole('link', { name: /new sales entry/i });
        expect(link).toHaveAttribute('href', '/sales/new');
        expect(screen.queryByRole('link', { name: /^POS$/i })).toBeNull();
    });

    describe('cancelling an entry', () => {
        /**
         * Cancel moved into the row overflow menu when the print options took
         * its place in the column, so reaching it means opening the kebab
         * first. Returns the menu item, or null when the row does not offer it.
         */
        const openRowMenu = async () => {
            const triggers = await screen.findAllByRole('button', { name: 'More actions' });
            fireEvent.click(triggers[0]);
            return screen.queryByRole('menuitem', { name: /cancel entry/i });
        };

        /**
         * The permission grants arrive from /auth/me after the first paint, so
         * the row must be given a chance to re-render with Cancel in it before
         * the menu is opened — clicking the trigger twice would just toggle the
         * panel shut again.
         */
        const openRowMenuWithCancel = async () => {
            // /auth/me settles after the first paint, and the panel renders
            // from whatever `canCancel` was when it opened. Flushing the
            // microtask queue lets the grants land before the menu opens —
            // clicking the trigger again would only toggle the panel shut.
            await waitFor(() => expect(screen.getByText('SL-00001')).toBeInTheDocument());
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 0));
            });

            const item = await openRowMenu();
            expect(item).not.toBeNull();
            return item!;
        };

        const asTenantAdmin = () => {
            const { api } = require('@/lib/api');
            api.getMe.mockResolvedValue({
                tenants: [{ id: 'tenant-1', role: 'MANAGER', permissions: ['CANCEL_ENTRY'] }],
            });
        };

        it('hides the Cancel action from someone without CANCEL_ENTRY', async () => {
            render(<SalesListPage />);
            await waitFor(() => expect(screen.getByText('SL-00001')).toBeInTheDocument());

            expect(await openRowMenu()).toBeNull();
        });

        it('shows it to the workspace owner, who bypasses permission checks server-side', async () => {
            const { api } = require('@/lib/api');
            api.getMe.mockResolvedValue({ tenants: [{ id: 'tenant-1', role: 'OWNER', permissions: [] }] });

            render(<SalesListPage />);
            await waitFor(() => expect(screen.getByText('SL-00001')).toBeInTheDocument());

            await openRowMenuWithCancel();
        });

        it('collects a note and posts it with the cancellation', async () => {
            const { api } = require('@/lib/api');
            asTenantAdmin();
            api.cancelSale.mockResolvedValue({ id: 'sale-1', status: 'CANCELLED' });

            render(<SalesListPage />);
            await waitFor(() => expect(screen.getByText('SL-00001')).toBeInTheDocument());
            fireEvent.click(await openRowMenuWithCancel());

            fireEvent.change(screen.getByLabelText(/reason for cancelling/i), {
                target: { value: 'Duplicate of SL-00002' },
            });
            // The dialog's confirm shares its label with the row action, so
            // reach for the one inside the dialog.
            const dialog = screen.getByRole('dialog');
            fireEvent.click(within(dialog).getByRole('button', { name: /cancel entry/i }));

            await waitFor(() =>
                expect(api.cancelSale).toHaveBeenCalledWith('sale-1', 'Duplicate of SL-00002'),
            );
        });

        it('does not call the API when the note is left empty', async () => {
            const { api } = require('@/lib/api');
            asTenantAdmin();

            render(<SalesListPage />);
            await waitFor(() => expect(screen.getByText('SL-00001')).toBeInTheDocument());
            fireEvent.click(await openRowMenuWithCancel());

            const dialog = screen.getByRole('dialog');
            fireEvent.click(within(dialog).getByRole('button', { name: /cancel entry/i }));

            expect(
                await within(dialog).findByText(/a reason is required/i),
            ).toBeInTheDocument();
            expect(api.cancelSale).not.toHaveBeenCalled();
        });

        it('offers no Cancel or Edit action on an already-cancelled sale', async () => {
            const { api } = require('@/lib/api');
            asTenantAdmin();
            api.getSalesList.mockResolvedValue({
                items: [{ ...mockSales[0], status: 'CANCELLED' }],
                total: 1,
                page: 1,
                limit: 20,
                pages: 1,
            });

            render(<SalesListPage />);
            await waitFor(() => expect(screen.getByText('SL-00001')).toBeInTheDocument());

            expect(await openRowMenu()).toBeNull();
            expect(screen.queryByRole('link', { name: /^edit$/i })).toBeNull();
        });
    });
});
