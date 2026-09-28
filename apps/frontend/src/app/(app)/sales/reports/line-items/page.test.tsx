import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { defaultLineItemWindow } from '@/components/reports/useLineItemFilters';
import SalesLineItemsPage from './page';

const searchParams = new Map<string, string>();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/sales/reports/line-items',
    useSearchParams: () => ({ get: (key: string) => searchParams.get(key) ?? null }),
}));

jest.mock('next/link', () => {
    const MockLink = ({ children, href, ...rest }: any) => (
        <a href={href} {...rest}>
            {children}
        </a>
    );
    MockLink.displayName = 'Link';
    return MockLink;
});

// DataTable drops hideOnMobile columns when the viewport reads as narrow.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getSalesLineItems: jest.fn(),
        getStores: jest.fn(),
        searchCustomers: jest.fn(),
        searchProductsByQuantity: jest.fn(),
    },
}));

const REPORT = {
    summary: { lineCount: 3, invoiceCount: 2, quantity: 6, amount: 2060, returnedQuantity: 1, returnedAmount: 180 },
    filters: { from: null, to: null, store: null, customer: null, product: null },
    rows: [
        {
            id: 'line-3',
            saleId: 'sale-2',
            invoiceNumber: 'S-1002',
            referenceNumber: 'INV-77',
            date: '2026-03-05T06:00:00.000Z',
            store: { id: 'store-2', name: 'Banani' },
            customer: { id: 'cust-2', name: 'Karim Ahmed', phone: null, customer_code: 'C-2' },
            product: { id: 'prod-1', name: 'Miniket Rice 5kg', sku: 'RICE-5', unit_type: 'none' },
            quantity: 1,
            unitPrice: 520,
            amount: 520,
            returnedQuantity: 0,
            returnedAmount: 0,
        },
        {
            id: 'line-2',
            saleId: 'sale-1',
            invoiceNumber: 'S-1001',
            referenceNumber: null,
            date: '2026-03-01T20:00:00.000Z',
            store: { id: 'store-1', name: 'Main' },
            customer: null,
            product: { id: 'prod-2', name: 'Soybean Oil 1L', sku: 'OIL-1', unit_type: 'none' },
            quantity: 3,
            unitPrice: 180,
            amount: 540,
            returnedQuantity: 1,
            returnedAmount: 180,
        },
    ],
    pagination: { page: 1, limit: 10, total: 3, pages: 1 },
};

function api() {
    return require('@/lib/api').api;
}

function lastQuery() {
    const calls = api().getSalesLineItems.mock.calls;
    return calls[calls.length - 1][0];
}

describe('SalesLineItemsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        searchParams.clear();
        api().getSalesLineItems.mockResolvedValue(REPORT);
        api().getStores.mockResolvedValue([{ id: 'store-1', name: 'Main' }]);
        api().searchCustomers.mockResolvedValue([{ id: 'cust-1', name: 'Rahim Uddin', phone: '01711000001' }]);
        api().searchProductsByQuantity.mockResolvedValue([{ id: 'prod-1', name: 'Miniket Rice 5kg', sku: 'RICE-5' }]);
    });

    it('opens on the last 30 days, newest first', async () => {
        render(<SalesLineItemsPage />);

        await waitFor(() => expect(api().getSalesLineItems).toHaveBeenCalled());
        expect(lastQuery()).toEqual(
            expect.objectContaining({ ...defaultLineItemWindow(), page: 1, sortBy: 'date', sortDir: 'desc' }),
        );
        expect(lastQuery().customerId).toBeUndefined();
        expect(screen.getByRole('heading', { level: 1, name: 'Sales Line Items' })).toBeInTheDocument();
    });

    it('lists each line with a link to its invoice, the customer, and what came back', async () => {
        render(<SalesLineItemsPage />);

        const invoice = await screen.findByRole('link', { name: 'S-1002' });
        expect(invoice).toHaveAttribute('href', '/sales/sale-2');
        expect(screen.getByText('INV-77')).toBeInTheDocument();
        expect(screen.getByText('Karim Ahmed')).toBeInTheDocument();
        // A sale with no customer on it was a walk-in.
        expect(screen.getByText('Walk-in')).toBeInTheDocument();
        expect(screen.getByText('Soybean Oil 1L')).toBeInTheDocument();
    });

    it('states totals over every matching line, returns included', async () => {
        render(<SalesLineItemsPage />);

        await screen.findByRole('link', { name: 'S-1002' });
        expect(screen.getByText('Invoices').nextElementSibling).toHaveTextContent('2');
        expect(screen.getByText('Quantity').nextElementSibling).toHaveTextContent('6');
        expect(screen.getByText('Returned: 1')).toBeInTheDocument();
        expect(screen.getByText(/Returned: ৳\s?180\.00/)).toBeInTheDocument();
    });

    it('narrows by a customer picked from the search', async () => {
        render(<SalesLineItemsPage />);
        await waitFor(() => expect(api().getSalesLineItems).toHaveBeenCalled());

        fireEvent.focus(screen.getByLabelText('Filter by customer'));
        fireEvent.click(await screen.findByText('Rahim Uddin'));

        await waitFor(() => expect(lastQuery()).toEqual(expect.objectContaining({ customerId: 'cust-1', page: 1 })));
    });

    it('narrows by a product picked from the search', async () => {
        render(<SalesLineItemsPage />);
        await waitFor(() => expect(api().getSalesLineItems).toHaveBeenCalled());

        fireEvent.focus(screen.getByLabelText('Filter by product'));
        fireEvent.click(await screen.findByRole('option', { name: /Miniket Rice 5kg/ }));

        await waitFor(() => expect(lastQuery()).toEqual(expect.objectContaining({ productId: 'prod-1' })));
    });

    it('searches free text once typing pauses', async () => {
        render(<SalesLineItemsPage />);
        await waitFor(() => expect(api().getSalesLineItems).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText('Search'), { target: { value: '  inv-77 ' } });

        await waitFor(() => expect(lastQuery()).toEqual(expect.objectContaining({ search: 'inv-77' })));
    });

    it('opens on a customer and product linked from elsewhere, and names them', async () => {
        searchParams.set('customerId', 'cust-9');
        searchParams.set('productId', 'prod-1');
        api().getSalesLineItems.mockResolvedValue({
            ...REPORT,
            filters: {
                ...REPORT.filters,
                customer: { id: 'cust-9', name: 'Linked Customer', phone: '01700000009', customer_code: 'C-9' },
                product: { id: 'prod-1', name: 'Miniket Rice 5kg', sku: 'RICE-5' },
            },
        });

        render(<SalesLineItemsPage />);

        await waitFor(() =>
            expect(api().getSalesLineItems).toHaveBeenCalledWith(
                expect.objectContaining({ customerId: 'cust-9', productId: 'prod-1' }),
            ),
        );
        expect(await screen.findByText('Linked Customer')).toBeInTheDocument();
        expect(screen.getByText('01700000009')).toBeInTheDocument();
    });

    it('offers a branch filter only when there is more than one branch', async () => {
        const { unmount } = render(<SalesLineItemsPage />);
        await waitFor(() => expect(api().getStores).toHaveBeenCalled());
        expect(screen.queryByLabelText('Branch')).not.toBeInTheDocument();
        unmount();

        api().getStores.mockResolvedValue([
            { id: 'store-1', name: 'Main' },
            { id: 'store-2', name: 'Banani' },
        ]);
        render(<SalesLineItemsPage />);

        fireEvent.change(await screen.findByLabelText('Branch'), { target: { value: 'store-2' } });

        await waitFor(() => expect(lastQuery()).toEqual(expect.objectContaining({ storeId: 'store-2', page: 1 })));
    });

    it('sorts on the server when a column header is clicked', async () => {
        render(<SalesLineItemsPage />);
        await screen.findByRole('link', { name: 'S-1002' });

        fireEvent.click(screen.getByRole('button', { name: 'Unit Price' }));

        await waitFor(() => expect(lastQuery()).toEqual(expect.objectContaining({ sortBy: 'unitPrice', page: 1 })));
    });

    it('says a read failed rather than showing an empty report', async () => {
        api().getSalesLineItems.mockRejectedValue(new Error('offline'));

        render(<SalesLineItemsPage />);

        expect(await screen.findByText('Sale lines could not be loaded: offline')).toBeInTheDocument();
    });

    it('clears back to the opening window', async () => {
        render(<SalesLineItemsPage />);
        await waitFor(() => expect(api().getSalesLineItems).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText('From'), { target: { value: '2025-01-01' } });
        fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'rice' } });
        await waitFor(() =>
            expect(lastQuery()).toEqual(expect.objectContaining({ from: '2025-01-01', search: 'rice' })),
        );

        fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

        await waitFor(() => expect(lastQuery()).toEqual(expect.objectContaining(defaultLineItemWindow())));
        expect(lastQuery().search).toBeUndefined();
    });
});
