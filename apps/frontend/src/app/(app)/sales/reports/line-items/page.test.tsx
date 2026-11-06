import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { defaultLineItemWindow } from '@/components/reports/useLineItemFilters';
import SalesLineItemsPage from './page';
import { mockBranchScope } from '@/test-utils/branch-scope';

const searchParams = new Map<string, string>();

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

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

/** A filter chip's button, not the column header of the same name. */
function chip(name: RegExp) {
    return screen.getAllByRole('button', { name }).find((button) => button.getAttribute('aria-haspopup') === 'dialog')!;
}

function tile(label: string) {
    return within(screen.getByRole('region', { name: 'Report figures' })).getByText(label).nextElementSibling?.textContent;
}

describe('SalesLineItemsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        searchParams.clear();
        api().getSalesLineItems.mockResolvedValue(REPORT);
        api().searchCustomers.mockResolvedValue([{ id: 'cust-1', name: 'Rahim Uddin', phone: '01711000001' }]);
        api().searchProductsByQuantity.mockResolvedValue([{ id: 'prod-1', name: 'Miniket Rice 5kg', sku: 'RICE-5' }]);
    });

    it('opens on the last 30 days, newest first, with nothing else narrowed', async () => {
        render(<SalesLineItemsPage />);

        await waitFor(() => expect(api().getSalesLineItems).toHaveBeenCalled());
        expect(lastQuery()).toEqual(
            expect.objectContaining({ ...defaultLineItemWindow(), page: 1, sortBy: 'date', sortDir: 'desc' }),
        );
        expect(lastQuery().customerId).toBeUndefined();
        expect(lastQuery().productId).toBeUndefined();
        expect(screen.getByRole('heading', { level: 1, name: 'Sales Line Items' })).toBeInTheDocument();
    });

    it('lists each line with a link to its invoice, the customer, and what came back', async () => {
        render(<SalesLineItemsPage />);

        const invoice = await screen.findByRole('link', { name: 'S-1002' });
        expect(invoice).toHaveAttribute('href', '/sales/sale-2');
        expect(screen.getByText('INV-77')).toBeInTheDocument();
        expect(screen.getByText('Karim Ahmed')).toBeInTheDocument();
        // A sale with no customer on it was a walk-in.
        expect(screen.getByRole('cell', { name: 'Walk-in' })).toBeInTheDocument();
        expect(screen.getByText('Soybean Oil 1L')).toBeInTheDocument();
    });

    it('states totals over every matching line in the strip, returns included', async () => {
        render(<SalesLineItemsPage />);

        await screen.findByRole('link', { name: 'S-1002' });
        expect(tile('Lines')).toBe('3');
        expect(tile('Invoices')).toBe('2');
        expect(tile('Quantity')).toBe('6');
        expect(tile('Amount')).toBe('৳ 2,060');
        expect(tile('Returned')).toContain('৳ 180');
        expect(tile('Returned')).toContain('1 units');
    });

    it('narrows by customers picked from the chip search, on the server, from page 1', async () => {
        render(<SalesLineItemsPage />);
        await screen.findByRole('link', { name: 'S-1002' });

        fireEvent.click(chip(/^Customer/));
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search Customer…' }), { target: { value: 'rah' } });
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Rahim Uddin' }));

        await waitFor(() => expect(lastQuery()).toEqual(expect.objectContaining({ customerId: 'cust-1', page: 1 })));
        expect(api().searchCustomers).toHaveBeenCalledWith('rah', 20, 'store-1');
    });

    it('asks for walk-in sales as none', async () => {
        render(<SalesLineItemsPage />);
        await screen.findByRole('link', { name: 'S-1002' });

        fireEvent.click(chip(/^Customer/));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Walk-in' }));

        await waitFor(() => expect(lastQuery()).toEqual(expect.objectContaining({ customerId: 'none' })));
    });

    it('narrows by products picked from the chip search', async () => {
        render(<SalesLineItemsPage />);
        await screen.findByRole('link', { name: 'S-1002' });

        fireEvent.click(chip(/^Product/));
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search Product…' }), { target: { value: 'rice' } });
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Miniket Rice 5kg (RICE-5)' }));

        await waitFor(() => expect(lastQuery()).toEqual(expect.objectContaining({ productId: 'prod-1' })));
    });

    it('sends a unit price condition to the server', async () => {
        render(<SalesLineItemsPage />);
        await screen.findByRole('link', { name: 'S-1002' });

        fireEvent.click(chip(/^Unit Price/));
        const panel = screen.getByRole('dialog', { name: 'Unit Price' });
        fireEvent.change(within(panel).getByRole('combobox', { name: 'Unit Price' }), { target: { value: 'gt' } });
        const amount = within(panel).getByRole('textbox', { name: /^Unit Price \(/ });
        fireEvent.change(amount, { target: { value: '100' } });
        fireEvent.keyDown(amount, { key: 'Enter' });

        await waitFor(() => expect(lastQuery()).toEqual(expect.objectContaining({ unitPrice: 'gt:100', page: 1 })));
    });

    it('searches free text once typing pauses', async () => {
        render(<SalesLineItemsPage />);
        await waitFor(() => expect(api().getSalesLineItems).toHaveBeenCalled());

        fireEvent.change(screen.getByPlaceholderText('Invoice #, reference, product or customer…'), { target: { value: '  inv-77 ' } });

        await waitFor(() => expect(lastQuery()).toEqual(expect.objectContaining({ search: 'inv-77' })));
    });

    it('opens on a customer and product linked from elsewhere, and names them on the chips', async () => {
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
        expect(chip(/^Product/)).toHaveTextContent('Miniket Rice 5kg');
    });

    it('hides the branch filter in a one-branch shop', async () => {
        mockBranchScope({ hidden: true, branches: [{ id: 'store-1', name: 'Main' }] });
        render(<SalesLineItemsPage />);
        await waitFor(() => expect(api().getSalesLineItems).toHaveBeenCalled());
        expect(screen.queryByRole('combobox', { name: 'Branch' })).not.toBeInTheDocument();
    });

    it('opens on the header branch and follows the branch filter', async () => {
        render(<SalesLineItemsPage />);
        await waitFor(() => expect(lastQuery()).toEqual(expect.objectContaining({ storeId: 'store-1' })));

        fireEvent.change(screen.getByRole('combobox', { name: 'Branch' }), { target: { value: 'store-2' } });

        await waitFor(() => expect(lastQuery()).toEqual(expect.objectContaining({ storeId: 'store-2', page: 1 })));
    });

    it('sorts on the server when a column header is clicked', async () => {
        render(<SalesLineItemsPage />);
        await screen.findByRole('link', { name: 'S-1002' });

        const header = screen.getAllByRole('button', { name: 'Unit Price' }).find((button) => !button.getAttribute('aria-haspopup'))!;
        fireEvent.click(header);

        await waitFor(() => expect(lastQuery()).toEqual(expect.objectContaining({ sortBy: 'unitPrice', page: 1 })));
    });

    it('says a read failed rather than showing an empty report', async () => {
        api().getSalesLineItems.mockRejectedValue(new Error('offline'));

        render(<SalesLineItemsPage />);

        expect(await screen.findByText('Sale lines could not be loaded: offline')).toBeInTheDocument();
    });
});
