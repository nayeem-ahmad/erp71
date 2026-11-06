'use client';
jest.mock('@/lib/i18n', () => {
  const { enMessages } = require('@/lib/localization/messages/en');

  return {
    useI18n: () => ({
      t: enMessages,
      locale: 'en',
      fmt: (template, values = {}) =>
        Object.entries(values).reduce(
          (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
          template,
        ),
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

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

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
        getQuotationsList: jest.fn(),
        getQuotationsListSummary: jest.fn(),
        searchCustomers: jest.fn(),
        deleteQuotation: jest.fn(),
        createQuotation: jest.fn(),
        shareQuotation: jest.fn(),
        revokeQuotationShare: jest.fn(),
        createSalesFromQuotations: jest.fn(),
    },
}));

jest.mock('@/lib/format', () => ({
    formatBDT: (v: number) => `BDT ${v}`,
    formatCurrency: (v: number, { currency }: { currency: string }) => `${currency} ${v}`,
    formatDate: (v: string) => `DATE:${v}`,
}));

jest.mock('@/components/data-table', () => ({
    createdAtColumn: () => ({ id: 'created_at', header: 'Created' }),
    DataTable: ({ data, columns, isLoading, emptyMessage, toolbarActions, enableRowSelection, bulkActions, filters, stats }: any) => {
        // The row actions are a column definition, so render that cell too —
        // otherwise the per-row buttons are invisible to every assertion.
        const actions = columns?.find((column: any) => column.id === 'actions');
        const total = columns?.find((column: any) => column.accessorKey === 'total_amount');
        return (
            <div
                data-testid="data-table"
                data-selectable={String(!!enableRowSelection)}
                data-filters={(filters ?? []).map((f: any) => `${f.id}${f.more ? '*' : ''}`).join(',')}
            >
                {/* The strip as its tiles read. */}
                <ul aria-label={stats?.label}>
                    {(stats?.items ?? []).map((item: any) => (
                        <li key={item.id}>{`${item.label}: ${item.value}${item.hint ? ` · ${item.hint}` : ''}`}</li>
                    ))}
                </ul>

                {/* Each bulk action as if every loaded row were selected. */}
                {bulkActions?.map((action: any) => (
                    <button key={action.label} type="button" onClick={() => action.onClick(data)}>
                        {action.label}
                    </button>
                ))}
                {isLoading && <span>Loading...</span>}
                {!isLoading && data.length === 0 && <span>{emptyMessage || 'No data'}</span>}
                {!isLoading && data.map((row: any) => (
                    <div key={row.id} data-testid={`row-${row.id}`}>
                        <span>{row.quote_number}</span>
                        <span>{row.status}</span>
                        {row.customer && <span>{row.customer.name}</span>}
                        <span data-testid={`total-${row.id}`}>
                            {total?.cell({ getValue: () => row.total_amount, row: { original: row } })}
                        </span>
                        {actions?.cell({ row: { original: row } })}
                    </div>
                ))}
                {toolbarActions && <div data-testid="toolbar">{toolbarActions}</div>}
            </div>
        );
    },
}));

const page = (items: unknown[]) => ({ items, total: items.length, page: 1, limit: 25, pages: 1 });

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
        api.getQuotationsList.mockResolvedValue(page(mockQuotes));
        api.getQuotationsListSummary.mockResolvedValue({
            count: 9,
            value: 19000,
            awaiting: 4,
            accepted: { count: 1, amount: 1500 },
            converted: 2,
            expired: 3,
        });
        api.deleteQuotation.mockResolvedValue({ deleted: true });
        api.shareQuotation.mockResolvedValue({ code: 'aB3xK9m', path: '/s/aB3xK9m' });
        api.revokeQuotationShare.mockResolvedValue({ success: true });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('shows loading state initially', () => {
        const { api } = require('@/lib/api');
        api.getQuotationsList.mockReturnValue(new Promise(() => {}));
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

    it('shows a taka quotation in taka', async () => {
        render(<QuotesPage />);
        expect(await screen.findByTestId('total-q-1')).toHaveTextContent('BDT 1500');
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
        api.getQuotationsList.mockResolvedValue(page([]));
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




    it('asks before deleting in a dialog, not the browser confirm, then refreshes rows and strip', async () => {
        const { api } = require('@/lib/api');
        const { toast } = require('@/lib/toast');
        const success = jest.spyOn(toast, 'success');
        render(<QuotesPage />);
        const row = await screen.findByTestId('row-q-1');
        await waitFor(() => expect(api.getQuotationsListSummary).toHaveBeenCalled());
        const listCalls = api.getQuotationsList.mock.calls.length;
        const summaryCalls = api.getQuotationsListSummary.mock.calls.length;

        fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
        expect(window.confirm).not.toHaveBeenCalled();
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(api.deleteQuotation).toHaveBeenCalledWith('q-1'));
        await waitFor(() => expect(success).toHaveBeenCalledWith('Quotation deleted'));
        await waitFor(() => expect(api.getQuotationsList.mock.calls.length).toBeGreaterThan(listCalls));
        expect(api.getQuotationsListSummary.mock.calls.length).toBeGreaterThan(summaryCalls);
        expect(window.alert).not.toHaveBeenCalled();
        success.mockRestore();
    });

    it('shows a foreign-currency proforma in its own currency', async () => {
        const { api } = require('@/lib/api');
        api.getQuotationsList.mockResolvedValue(
            page([{ ...mockQuotes[0], id: 'q-9', doc_kind: 'PROFORMA', currency: 'USD', exchange_rate: '120', total_amount: '100' }]),
        );
        render(<QuotesPage />);
        // Dollars stay dollars: a ৳ in front of them would misstate what the buyer owes.
        expect(await screen.findByTestId('total-q-9')).toHaveTextContent('USD 100');
    });

    describe('the filter row and the stats strip', () => {
        it('keeps the created date behind More and the rest in the row', async () => {
            render(<QuotesPage />);
            const table = await screen.findByTestId('data-table');
            expect(table).toHaveAttribute('data-filters', 'validUntil,status,customer,total,docKind,created*');
        });

        it('reads the strip from the summary of the same filters', async () => {
            render(<QuotesPage />);
            const strip = await screen.findByRole('list', { name: 'Quotations summary' });
            await within(strip).findByText('Quotations: 9');
            expect(within(strip).getByText('Accepted: BDT 1500 · 1 accepted')).toBeInTheDocument();
            expect(within(strip).getByText('Expired: 3')).toBeInTheDocument();
        });

        it('sends the branch and an empty filter set to both the list and the strip', async () => {
            const { api } = require('@/lib/api');
            render(<QuotesPage />);
            await screen.findByTestId('row-q-1');
            expect(api.getQuotationsList).toHaveBeenLastCalledWith(
                expect.objectContaining({ page: 1, sortBy: 'created_at', sortDir: 'desc', storeId: 'store-1', customerIds: [] }),
            );
            expect(api.getQuotationsListSummary).toHaveBeenLastCalledWith(expect.objectContaining({ storeId: 'store-1' }));
        });
    });

    it('shows page heading', async () => {
        render(<QuotesPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Sales Quotations' })).toBeInTheDocument();
        });
    });

    it('handles API error gracefully', async () => {
        const { api } = require('@/lib/api');
        api.getQuotationsList.mockRejectedValue(new Error('Network error'));
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

    describe('converting selected quotations to sales', () => {
        it('lets rows be selected and confirms the selection before converting', async () => {
            render(<QuotesPage />);
            await screen.findByTestId('row-q-1');

            expect(screen.getByTestId('data-table')).toHaveAttribute('data-selectable', 'true');
            fireEvent.click(screen.getByRole('button', { name: 'Convert to sales' }));

            // QUO-00002 is a walk-in quotation with no lines.
            expect(screen.getByText('1 of 2 selected can be converted')).toBeInTheDocument();
            expect(require('@/lib/api').api.createSalesFromQuotations).not.toHaveBeenCalled();
        });

        it('reloads the list once the sales exist', async () => {
            const { api } = require('@/lib/api');
            api.createSalesFromQuotations.mockResolvedValue({
                converted: [{ quotationId: 'q-1', quoteNumber: 'QUO-00001', saleId: 's-1', serialNumber: 'INV-1', totalAmount: 1500 }],
                skipped: [{ quotationId: 'q-2', quoteNumber: 'QUO-00002', reason: 'NO_CUSTOMER', status: 'SENT' }],
                failed: [],
            });
            render(<QuotesPage />);
            await screen.findByTestId('row-q-1');

            fireEvent.click(screen.getByRole('button', { name: 'Convert to sales' }));
            fireEvent.click(screen.getByRole('button', { name: /Convert 1/ }));

            await waitFor(() => expect(api.getQuotationsList).toHaveBeenCalledTimes(2));
            expect(api.createSalesFromQuotations).toHaveBeenCalledWith(['q-1', 'q-2']);
            expect(screen.getByRole('link', { name: 'INV-1' })).toHaveAttribute('href', '/sales/s-1');
        });
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
