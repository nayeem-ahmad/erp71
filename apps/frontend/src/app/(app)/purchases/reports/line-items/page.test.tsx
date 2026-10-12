import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { defaultLineItemWindow } from '@/components/reports/useLineItemFilters';
import PurchaseLineItemsPage from './page';
import { mockBranchScope } from '@/test-utils/branch-scope';

const searchParams = new Map<string, string>();

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/purchases/reports/line-items',
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

jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getPurchaseLineItems: jest.fn(),
        getSuppliersPaged: jest.fn(),
        searchProductsByQuantity: jest.fn(),
    },
}));

const REPORT = {
    summary: { lineCount: 2, billCount: 2, quantity: 25, amount: 7700, returnedQuantity: 2, returnedAmount: 900 },
    filters: { from: null, to: null, store: null, supplier: null, product: null },
    rows: [
        {
            id: 'pline-1',
            purchaseId: 'pur-1',
            purchaseNumber: 'P-1',
            referenceNumber: 'BILL-9',
            date: '2026-03-03T05:00:00.000Z',
            store: { id: 'store-1', name: 'Main' },
            supplier: { id: 'sup-1', name: 'Rahman Traders', phone: '01811000001' },
            product: { id: 'prod-1', name: 'Miniket Rice 5kg', sku: 'RICE-5', unit_type: 'none' },
            quantity: 10,
            unitCost: 450,
            amount: 4500,
            returnedQuantity: 2,
            returnedAmount: 900,
        },
        {
            id: 'pline-2',
            purchaseId: 'pur-2',
            purchaseNumber: 'P-2',
            referenceNumber: null,
            date: '2026-03-08T05:00:00.000Z',
            store: { id: 'store-1', name: 'Main' },
            supplier: null,
            product: { id: 'prod-2', name: 'Soybean Oil 1L', sku: 'OIL-1', unit_type: 'none' },
            quantity: 20,
            unitCost: 160,
            amount: 3200,
            returnedQuantity: 0,
            returnedAmount: 0,
        },
    ],
    pagination: { page: 1, limit: 10, total: 2, pages: 1 },
};

function api() {
    return require('@/lib/api').api;
}

function lastQuery() {
    const calls = api().getPurchaseLineItems.mock.calls;
    return calls[calls.length - 1][0];
}

describe('PurchaseLineItemsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        searchParams.clear();
        api().getPurchaseLineItems.mockResolvedValue(REPORT);
        api().getSuppliersPaged.mockResolvedValue({
            items: [{ id: 'sup-1', name: 'Rahman Traders', phone: '01811000001' }],
            total: 1,
            page: 1,
            limit: 20,
            pages: 1,
        });
        api().searchProductsByQuantity.mockResolvedValue([]);
    });

    it('opens on the last 30 days, newest first', async () => {
        render(<PurchaseLineItemsPage />);

        await waitFor(() => expect(api().getPurchaseLineItems).toHaveBeenCalled());
        expect(lastQuery()).toEqual(
            expect.objectContaining({ ...defaultLineItemWindow(), page: 1, sortBy: 'date', sortDir: 'desc' }),
        );
        expect(screen.getByRole('heading', { level: 1, name: 'Purchase Line Items' })).toBeInTheDocument();
    });

    it('links each line to its bill and shows the supplier’s own bill number', async () => {
        render(<PurchaseLineItemsPage />);

        const bill = await screen.findByRole('link', { name: 'P-1' });
        expect(bill).toHaveAttribute('href', '/purchases/pur-1/invoice');
        expect(screen.getByText('BILL-9')).toBeInTheDocument();
        expect(screen.getByText('Rahman Traders')).toBeInTheDocument();
        expect(screen.getByText('No supplier')).toBeInTheDocument();
        expect(screen.getByText('Bills').nextElementSibling).toHaveTextContent('2');
        expect(screen.getByText('Returned: 2')).toBeInTheDocument();
    });

    it('narrows by a supplier found on the server', async () => {
        render(<PurchaseLineItemsPage />);
        await waitFor(() => expect(api().getPurchaseLineItems).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText('Filter by supplier'), { target: { value: 'rahman' } });
        await waitFor(() =>
            expect(api().getSuppliersPaged).toHaveBeenCalledWith({ search: 'rahman', limit: 20 }),
        );
        fireEvent.click(await screen.findByRole('option', { name: /Rahman Traders/ }));

        await waitFor(() => expect(lastQuery()).toEqual(expect.objectContaining({ supplierId: 'sup-1', page: 1 })));
    });

    it('sorts on the stored line total', async () => {
        render(<PurchaseLineItemsPage />);
        await screen.findByRole('link', { name: 'P-1' });

        fireEvent.click(screen.getByRole('button', { name: 'Amount' }));

        await waitFor(() => expect(lastQuery()).toEqual(expect.objectContaining({ sortBy: 'amount' })));
    });

    it('opens on a deep-linked supplier', async () => {
        searchParams.set('supplierId', 'sup-1');

        render(<PurchaseLineItemsPage />);

        await waitFor(() =>
            expect(api().getPurchaseLineItems).toHaveBeenCalledWith(expect.objectContaining({ supplierId: 'sup-1' })),
        );
    });
});
