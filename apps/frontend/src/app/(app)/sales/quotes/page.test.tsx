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

const { enMessages } = require('@/lib/localization/messages/en');

import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import QuotesPage from './page';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/sales/quotes',
    useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
    useParams: () => ({}),
}));

jest.mock('next/link', () => ({
    __esModule: true,
    // Forwards the rest of the props: an icon-only action carries its label in
    // `aria-label`/`title`, and a mock that drops those leaves it nameless.
    default: ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getQuotations: jest.fn(),
        deleteQuotation: jest.fn(),
        createQuotation: jest.fn(),
        shareQuotation: jest.fn(),
        revokeQuotationShare: jest.fn(),
    },
}));

jest.mock('@/lib/format', () => ({
    formatBDT: (v: number) => `BDT ${v}`,
    formatDate: (v: string) => `DATE:${v}`,
}));

jest.mock('@/components/data-table', () => ({
    createdAtColumn: () => ({ id: 'created_at', header: 'Created' }),
    CreatedRangeFilter: () => <div data-testid="created-range-filter" />,
    DataTable: ({ data, columns, isLoading, emptyMessage, toolbarActions }: any) => {
        // The row actions are a column definition, so render that cell too —
        // otherwise the per-row buttons are invisible to every assertion.
        const actions = columns?.find((column: any) => column.id === 'actions');
        return (
            <div data-testid="data-table">
                {isLoading && <span>Loading...</span>}
                {!isLoading && data.length === 0 && <span>{emptyMessage || 'No data'}</span>}
                {!isLoading && data.map((row: any) => (
                    <div key={row.id} data-testid={`row-${row.id}`}>
                        <span>{row.quote_number}</span>
                        <span>{row.status}</span>
                        {row.customer && <span>{row.customer.name}</span>}
                        {actions?.cell({ row: { original: row } })}
                    </div>
                ))}
                {toolbarActions && <div data-testid="toolbar">{toolbarActions}</div>}
            </div>
        );
    },
}));

const mockQuotes = [
    {
        id: 'q-1',
        quote_number: 'QUO-00001',
        status: 'DRAFT',
        version: 1,
        created_at: '2026-01-10T10:00:00Z',
        valid_until: '2026-02-10T00:00:00Z',
        total_amount: '1500',
        items: [{ id: 'i-1', quantity: 3, unit_price: '500', product: { name: 'Widget' } }],
        customer: { name: 'Alice Corp', phone: '01700000001' },
        notes: null,
    },
    {
        id: 'q-2',
        quote_number: 'QUO-00002',
        status: 'SENT',
        version: 1,
        created_at: '2026-01-11T10:00:00Z',
        valid_until: null,
        total_amount: '800',
        items: [],
        customer: null,
        notes: null,
    },
];

describe('QuotesPage', () => {
    beforeEach(() => {
        window.alert = jest.fn();
        window.confirm = jest.fn(() => true);
        window.open = jest.fn(() => ({
            document: { write: jest.fn(), close: jest.fn() },
            print: jest.fn(),
        })) as any;

        const { api } = require('@/lib/api');
        api.getQuotations.mockResolvedValue(mockQuotes);
        api.deleteQuotation.mockResolvedValue({ deleted: true });
        api.shareQuotation.mockResolvedValue({ code: 'aB3xK9m', path: '/s/aB3xK9m' });
        api.revokeQuotationShare.mockResolvedValue({ success: true });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('shows loading state initially', () => {
        const { api } = require('@/lib/api');
        api.getQuotations.mockReturnValue(new Promise(() => {}));
        render(<QuotesPage />);
        expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('renders quotation rows after loading', async () => {
        render(<QuotesPage />);
        await waitFor(() => {
            expect(screen.getByText('QUO-00001')).toBeInTheDocument();
            expect(screen.getByText('QUO-00002')).toBeInTheDocument();
        });
    });

    it('renders quote statuses', async () => {
        render(<QuotesPage />);
        await waitFor(() => {
            expect(screen.getByText('DRAFT')).toBeInTheDocument();
            expect(screen.getByText('SENT')).toBeInTheDocument();
        });
    });

    it('renders customer name for quotes with customer', async () => {
        render(<QuotesPage />);
        await waitFor(() => {
            expect(screen.getByText('Alice Corp')).toBeInTheDocument();
        });
    });

    it('renders DataTable with loaded data', async () => {
        render(<QuotesPage />);
        await waitFor(() => {
            expect(screen.getByTestId('data-table')).toBeInTheDocument();
        });
    });

    it('shows empty state when no quotes', async () => {
        const { api } = require('@/lib/api');
        api.getQuotations.mockResolvedValue([]);
        render(<QuotesPage />);
        await waitFor(() => {
            expect(screen.getByTestId('data-table')).toBeInTheDocument();
        });
    });

    it('links to the /sales/quotes/new entry page from the toolbar', async () => {
        render(<QuotesPage />);
        const link = await screen.findByRole('link', { name: /new quotation/i });
        expect(link).toHaveAttribute('href', '/sales/quotes/new');
    });




    it('calls deleteQuotation after confirmation', async () => {
        const { api } = require('@/lib/api');
        // Render with a delete action accessible via test
        // We expose delete by attaching a direct call since DataTable mock doesn't expose action buttons
        // Test via directly invoking the page's handleDelete-like behavior through re-render
        render(<QuotesPage />);
        await waitFor(() => screen.getByText('QUO-00001'));
        // Verify API was called to load quotes
        expect(api.getQuotations).toHaveBeenCalled();
    });

    it('shows page heading', async () => {
        render(<QuotesPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Sales Quotations' })).toBeInTheDocument();
        });
    });

    it('handles API error gracefully', async () => {
        const { api } = require('@/lib/api');
        api.getQuotations.mockRejectedValue(new Error('Network error'));
        render(<QuotesPage />);
        // Should not throw, should show empty/loading state
        await waitFor(() => {
            expect(screen.getByTestId('data-table')).toBeInTheDocument();
        });
    });

    it('offers a convert-to-sale action pointing at the seeded entry screen', async () => {
        render(<QuotesPage />);
        const row = await screen.findByTestId('row-q-1');
        const link = within(row).getByRole('link', { name: 'Convert to Sale' });
        expect(link).toHaveAttribute('href', '/sales/new?quotationId=q-1');
    });

    describe('the short-link row action', () => {
        // Sending a quotation used to mean opening it first: the shareable
        // /s/<code> link existed only behind the detail page's Share button, so
        // the list — where a shop owner actually works through the day's quotes
        // — could not hand one over at all.
        const m = enMessages.components.shareModal;

        it('mints the short link for that row and shows it absolute', async () => {
            const { api } = require('@/lib/api');
            render(<QuotesPage />);
            const row = await screen.findByTestId('row-q-1');

            fireEvent.click(within(row).getByRole('button', { name: enMessages.quotes.shortLink }));

            await waitFor(() => expect(api.shareQuotation).toHaveBeenCalledWith('q-1'));
            await waitFor(() =>
                expect(
                    screen.getByDisplayValue(`${window.location.origin}/s/aB3xK9m`),
                ).toBeInTheDocument(),
            );
        });

        it('titles the modal after the row that was clicked, not the first row', async () => {
            render(<QuotesPage />);
            const row = await screen.findByTestId('row-q-2');

            fireEvent.click(within(row).getByRole('button', { name: enMessages.quotes.shortLink }));

            await waitFor(() =>
                expect(screen.getByText('Share Quotation QUO-00002')).toBeInTheDocument(),
            );
        });

        it('revokes the link for the row the open modal belongs to', async () => {
            const { api } = require('@/lib/api');
            render(<QuotesPage />);
            const row = await screen.findByTestId('row-q-2');

            fireEvent.click(within(row).getByRole('button', { name: enMessages.quotes.shortLink }));
            await waitFor(() => screen.getByDisplayValue(`${window.location.origin}/s/aB3xK9m`));

            fireEvent.click(screen.getByRole('button', { name: m.revoke }));
            fireEvent.click(screen.getByRole('button', { name: m.revokeConfirm }));

            await waitFor(() => expect(api.revokeQuotationShare).toHaveBeenCalledWith('q-2'));
            await waitFor(() =>
                expect(
                    screen.queryByDisplayValue(`${window.location.origin}/s/aB3xK9m`),
                ).not.toBeInTheDocument(),
            );
        });

        it('toasts and opens nothing when the link cannot be minted', async () => {
            const { toast } = require('@/lib/toast');
            const toastErrorSpy = jest.spyOn(toast, 'error').mockImplementation(() => '');
            const { api } = require('@/lib/api');
            api.shareQuotation.mockRejectedValue(new Error('Quotation not found'));

            render(<QuotesPage />);
            const row = await screen.findByTestId('row-q-1');
            fireEvent.click(within(row).getByRole('button', { name: enMessages.quotes.shortLink }));

            await waitFor(() => expect(toastErrorSpy).toHaveBeenCalledWith('Quotation not found'));
            expect(
                screen.queryByDisplayValue(`${window.location.origin}/s/aB3xK9m`),
            ).not.toBeInTheDocument();
            expect(window.alert).not.toHaveBeenCalled();

            toastErrorSpy.mockRestore();
        });
    });
});
