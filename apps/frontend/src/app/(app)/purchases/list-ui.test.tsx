'use client';

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithQueryClient } from '@/test-utils/query-client';
import { mockBranchScope } from '@/test-utils/branch-scope';
import PurchasesPage from './list/page';
import PurchaseReturnsPage from './returns/page';
import PurchaseOrdersPage from './orders/page';
import PurchaseQuotationsPage from './quotations/page';

/**
 * The purchase-side lists carry the Sales list's layout: one filter row sent
 * to the server, a stats strip counted from the same filters, and confirm
 * dialogs rather than browser prompts.
 */

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

const push = jest.fn();
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push, replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/purchases',
    useSearchParams: () => new URLSearchParams(),
}));

jest.mock('./returns/CreatePurchaseReturnModal', () => () => null);
jest.mock('./orders/CreatePurchaseOrderModal', () => () => null);
jest.mock('./quotations/CreatePurchaseQuotationModal', () => () => null);

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
        getSuppliersPaged: jest.fn(),
        getPurchasesList: jest.fn(),
        getPurchasesListSummary: jest.fn(),
        getPurchaseReturnsList: jest.fn(),
        getPurchaseReturnsListSummary: jest.fn(),
        deletePurchaseReturn: jest.fn(),
        getPurchaseOrdersList: jest.fn(),
        getPurchaseOrdersListSummary: jest.fn(),
        getPurchaseQuotationsList: jest.fn(),
        getPurchaseQuotationsListSummary: jest.fn(),
        deletePurchaseQuotation: jest.fn(),
        convertPurchaseQuotation: jest.fn(),
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
    api.getSuppliersPaged.mockResolvedValue(page([{ id: 'sup-7', name: 'Fresh Farms' }]));
    api.getPurchasesList.mockResolvedValue(
        page([
            {
                id: 'purchase-1',
                purchase_number: 'PUR-00001',
                total_amount: '1000',
                paid_amount: '400',
                created_at: '2026-03-20T10:00:00.000Z',
                purchase_date: '2026-03-20T10:00:00.000Z',
                status: 'RECORDED',
                supplier: { name: 'Fresh Farms' },
                items: [],
            },
        ]),
    );
    api.getPurchasesListSummary.mockResolvedValue({
        count: 12,
        cancelledCount: 2,
        total: 50000,
        paid: 30000,
        due: 20000,
        average: 5000,
        returns: { count: 1, amount: 700 },
    });
    api.getPurchaseReturnsList.mockResolvedValue(
        page([
            {
                id: 'pret-1',
                return_number: 'PRET-00001',
                created_at: '2026-03-20T12:00:00.000Z',
                total_amount: 240,
                supplier: { name: 'Fresh Farms' },
                purchase: { id: 'purchase-1', purchase_number: 'PUR-00001' },
                items: [{ id: 'line-1' }],
            },
        ]),
    );
    api.getPurchaseReturnsListSummary.mockResolvedValue({ count: 3, amount: 900, refunded: 300, adjusted: 600, average: 300 });
    api.getPurchaseOrdersList.mockResolvedValue(
        page([
            {
                id: 'po-1',
                po_number: 'PO-00001',
                status: 'SENT',
                total_amount: '2500',
                expected_date: '2020-01-01T00:00:00.000Z',
                created_at: '2019-12-20T00:00:00.000Z',
                supplier: { name: 'Fresh Farms' },
                items: [{ id: 'i1', quantity: 1 }],
            },
        ]),
    );
    api.getPurchaseOrdersListSummary.mockResolvedValue({
        count: 4,
        cancelledCount: 0,
        value: 10000,
        open: { count: 2, amount: 4000 },
        received: { count: 2, amount: 6000 },
        overdue: 1,
    });
    api.getPurchaseQuotationsList.mockResolvedValue(
        page([
            {
                id: 'rfq-1',
                rfq_number: 'RFQ-00001',
                status: 'ACCEPTED',
                valid_until: null,
                total_amount: '5000',
                created_at: '2026-01-01T00:00:00Z',
                notes: null,
                supplier: { id: 's1', name: 'Fresh Farms' },
                items: [{ id: 'i1' }],
            },
        ]),
    );
    api.getPurchaseQuotationsListSummary.mockResolvedValue({
        count: 5,
        value: 9000,
        pending: 2,
        accepted: { count: 1, amount: 5000 },
        converted: 1,
        expired: 0,
    });
});

describe('Purchases list', () => {
    it('shows the stats strip for the filtered bills', async () => {
        renderWithQueryClient(<PurchasesPage />);

        const strip = await screen.findByRole('region', { name: 'Purchases summary' });
        await within(strip).findByText('12');
        expect(within(strip).getByText('· 2 cancelled')).toBeInTheDocument();
        expect(within(strip).getByText('· 60%')).toBeInTheDocument();
    });

    it('filters by a supplier found through a server search, for rows and strip alike', async () => {
        const { api } = require('@/lib/api');
        renderWithQueryClient(<PurchasesPage />);
        await screen.findByText('PUR-00001');

        fireEvent.click(chip('Supplier'));
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search Supplier…' }), { target: { value: 'fre' } });
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Fresh Farms' }));

        expect(api.getSuppliersPaged).toHaveBeenCalledWith({ search: 'fre', limit: 20 });
        await waitFor(() =>
            expect(api.getPurchasesList).toHaveBeenLastCalledWith(
                expect.objectContaining({ page: 1, supplierIds: ['sup-7'], storeId: 'store-1' }),
            ),
        );
        expect(api.getPurchasesListSummary).toHaveBeenLastCalledWith(expect.objectContaining({ supplierIds: ['sup-7'] }));
    });

    it('filters by payment state from the row, and keeps Paid and Created behind More', async () => {
        const { api } = require('@/lib/api');
        renderWithQueryClient(<PurchasesPage />);
        await screen.findByText('PUR-00001');

        fireEvent.click(chip('Payment status'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Unpaid' }));
        await waitFor(() =>
            expect(api.getPurchasesList).toHaveBeenLastCalledWith(expect.objectContaining({ paymentStatus: ['UNPAID'] })),
        );

        fireEvent.click(chip(/^More/));
        const more = screen.getByRole('dialog', { name: 'More' });
        for (const name of ['Paid', 'Created']) {
            expect(within(more).getByRole('button', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
        }
    });
});

describe('Purchase returns list', () => {
    it('splits the returned value into money refunded and payable adjusted', async () => {
        renderWithQueryClient(<PurchaseReturnsPage />);

        const strip = await screen.findByRole('region', { name: 'Purchase returns summary' });
        expect(await within(strip).findByText('Refund received')).toBeInTheDocument();
        expect(within(strip).getByText('Adjusted to payable')).toBeInTheDocument();
        expect(within(strip).getByText('· 33%')).toBeInTheDocument();
    });

    it('asks before deleting a return, then refreshes rows and strip', async () => {
        const { api } = require('@/lib/api');
        const { toast } = require('@/lib/toast');
        api.deletePurchaseReturn.mockResolvedValue({});
        const confirmSpy = jest.spyOn(window, 'confirm');
        renderWithQueryClient(<PurchaseReturnsPage />);
        await screen.findByText('PRET-00001');
        const listCalls = api.getPurchaseReturnsList.mock.calls.length;

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(api.deletePurchaseReturn).toHaveBeenCalledWith('pret-1'));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Purchase return deleted'));
        await waitFor(() => expect(api.getPurchaseReturnsList.mock.calls.length).toBeGreaterThan(listCalls));
        expect(confirmSpy).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
    });
});

describe('Purchase orders list', () => {
    it('filters the status on the server, and can invert it', async () => {
        const { api } = require('@/lib/api');
        renderWithQueryClient(<PurchaseOrdersPage />);
        await screen.findByText('PO-00001');

        fireEvent.click(chip('Status'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Received' }));

        await waitFor(() =>
            expect(api.getPurchaseOrdersList).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'RECEIVED' })),
        );
        expect(api.getPurchaseOrdersListSummary).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'RECEIVED' }));
    });

    it('shows open, received and overdue orders in the strip', async () => {
        renderWithQueryClient(<PurchaseOrdersPage />);

        const strip = await screen.findByRole('region', { name: 'Purchase orders summary' });
        expect(await within(strip).findByText('· 2 open')).toBeInTheDocument();
        expect(within(strip).getByText('· 2 received')).toBeInTheDocument();
        expect(within(strip).getByText('Overdue')).toBeInTheDocument();
    });
});

describe('Purchase quotations list', () => {
    it('converts a quotation after a confirm dialog and opens the new order', async () => {
        const { api } = require('@/lib/api');
        const { toast } = require('@/lib/toast');
        api.convertPurchaseQuotation.mockResolvedValue({ id: 'po-9', po_number: 'PO-00009' });
        renderWithQueryClient(<PurchaseQuotationsPage />);
        await screen.findByText('RFQ-00001');

        fireEvent.click(screen.getByRole('button', { name: 'Convert to PO' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Convert RFQ-00001 to a Purchase Order?')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Convert to PO' }));

        await waitFor(() => expect(api.convertPurchaseQuotation).toHaveBeenCalledWith('rfq-1'));
        expect(toast.success).toHaveBeenCalledWith('Created Purchase Order PO-00009');
        expect(push).toHaveBeenCalledWith('/purchases/orders/po-9');
    });

    it('names statuses in words and filters them on the server', async () => {
        const { api } = require('@/lib/api');
        renderWithQueryClient(<PurchaseQuotationsPage />);
        await screen.findByText('RFQ-00001');
        expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0);

        fireEvent.click(chip('Status'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Draft' }));

        await waitFor(() =>
            expect(api.getPurchaseQuotationsList).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'DRAFT' })),
        );
    });
});
