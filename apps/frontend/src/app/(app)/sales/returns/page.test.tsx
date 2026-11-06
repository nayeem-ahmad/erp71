'use client';

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithQueryClient } from '@/test-utils/query-client';
import { mockBranchScope } from '@/test-utils/branch-scope';
import { mockBrowserPaper, printedPaper } from '@/test-utils/print-paper';
import ReturnsPage from './page';

/**
 * The sales-returns list carries the Sales list's layout: one filter row sent
 * to the server, a stats strip counted from the same filters, and a confirm
 * dialog rather than a browser prompt.
 */

jest.mock('@/lib/hooks/useSalePrintPrefs', () => require('@/test-utils/print-paper').salePrintPrefsModuleMock());
jest.mock('@/lib/print', () => require('@/test-utils/print-paper').printModuleSpy());
jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/sales/returns',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({}),
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
        getReturnsList: jest.fn(),
        getReturnsListSummary: jest.fn(),
        deleteReturn: jest.fn(),
        searchCustomers: jest.fn(),
    },
}));

const page = (items: unknown[]) => ({ items, total: items.length, page: 1, limit: 20, pages: 1 });

const mockReturns = [
    {
        id: 'ret-1',
        return_number: 'RET-00001',
        status: 'COMPLETED',
        total_refund: '750',
        reason: 'Defective item',
        created_at: '2026-01-10T10:00:00Z',
        items: [{ id: 'ri-1', quantity: 1, refund_amount: 750, product: { name: 'Kettle' } }],
        sale: { serial_number: 'SALE-001', customer: { id: 'cust-1', name: 'Rahim Traders' } },
        posting_status: null,
        voucher_number: null,
    },
    {
        id: 'ret-2',
        return_number: 'RET-00002',
        status: 'COMPLETED',
        total_refund: '300',
        reason: null,
        created_at: '2026-01-11T10:00:00Z',
        items: [],
        sale: { serial_number: 'SALE-002', customer: null },
        posting_status: 'POSTED',
        voucher_number: 'VOU-001',
    },
];

/** A filter chip on the toolbar row — a button that opens its own popover. */
function chip(name: string | RegExp): HTMLElement {
    const found = screen
        .getAllByRole('button', { name })
        .find((button) => button.getAttribute('aria-haspopup') === 'dialog');
    if (!found) throw new Error(`No filter chip named ${String(name)}`);
    return found;
}

describe('ReturnsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        const { api } = require('@/lib/api');
        api.getReturnsList.mockResolvedValue(page(mockReturns));
        api.getReturnsListSummary.mockResolvedValue({ count: 4, amount: 1000, refunded: 400, adjusted: 600, average: 250 });
        api.deleteReturn.mockResolvedValue({ deleted: true });
        api.searchCustomers.mockResolvedValue([{ id: 'cust-1', name: 'Rahim Traders' }]);
    });

    it('renders the server page: receipt, customer or walk-in, and the status in words', async () => {
        renderWithQueryClient(<ReturnsPage />);

        expect(await screen.findByText('RET-00001')).toBeInTheDocument();
        expect(screen.getByText('RET-00002')).toBeInTheDocument();
        expect(screen.getByText('SALE-001')).toBeInTheDocument();
        expect(screen.getByText('Rahim Traders')).toBeInTheDocument();
        expect(screen.getAllByText('Walk-in').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
        expect(screen.queryByText('COMPLETED')).not.toBeInTheDocument();
    });

    it('asks the server for the newest returns of the header branch', async () => {
        const { api } = require('@/lib/api');
        renderWithQueryClient(<ReturnsPage />);
        await screen.findByText('RET-00001');

        expect(api.getReturnsList).toHaveBeenCalledWith(
            expect.objectContaining({ page: 1, sortBy: 'created_at', sortDir: 'desc', storeId: 'store-1' }),
        );
        expect(api.getReturnsListSummary).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'store-1' }));
    });

    it('splits the returned value into money refunded and due adjusted', async () => {
        renderWithQueryClient(<ReturnsPage />);

        const strip = await screen.findByRole('region', { name: 'Sales returns summary' });
        expect(await within(strip).findByText('4')).toBeInTheDocument();
        expect(within(strip).getByText('Refunded')).toBeInTheDocument();
        expect(within(strip).getByText('Adjusted to due')).toBeInTheDocument();
        expect(within(strip).getByText('· 40%')).toBeInTheDocument();
    });

    it('filters by a customer found through a server search, for rows and strip alike', async () => {
        const { api } = require('@/lib/api');
        renderWithQueryClient(<ReturnsPage />);
        await screen.findByText('RET-00001');

        fireEvent.click(chip('Customer'));
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search Customer…' }), { target: { value: 'rah' } });
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Rahim Traders' }));

        await waitFor(() =>
            expect(api.getReturnsList).toHaveBeenLastCalledWith(
                expect.objectContaining({ page: 1, customerIds: ['cust-1'], storeId: 'store-1' }),
            ),
        );
        expect(api.searchCustomers).toHaveBeenCalledWith('rah', 20, 'store-1');
        expect(api.getReturnsListSummary).toHaveBeenLastCalledWith(expect.objectContaining({ customerIds: ['cust-1'] }));
    });

    it('offers walk-in returns on the Customer chip before anything is typed', async () => {
        const { api } = require('@/lib/api');
        renderWithQueryClient(<ReturnsPage />);
        await screen.findByText('RET-00001');

        fireEvent.click(chip('Customer'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Walk-in' }));

        await waitFor(() =>
            expect(api.getReturnsList).toHaveBeenLastCalledWith(expect.objectContaining({ customerIds: ['none'] })),
        );
    });

    it('asks before deleting a return, then refreshes rows and strip', async () => {
        const { api } = require('@/lib/api');
        const { toast } = require('@/lib/toast');
        const confirmSpy = jest.spyOn(window, 'confirm');
        renderWithQueryClient(<ReturnsPage />);
        const row = (await screen.findByText('RET-00001')).closest('tr') as HTMLElement;
        const listCalls = api.getReturnsList.mock.calls.length;
        const summaryCalls = api.getReturnsListSummary.mock.calls.length;

        fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Are you sure you want to delete this return?')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(api.deleteReturn).toHaveBeenCalledWith('ret-1'));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Return deleted'));
        await waitFor(() => expect(api.getReturnsList.mock.calls.length).toBeGreaterThan(listCalls));
        await waitFor(() => expect(api.getReturnsListSummary.mock.calls.length).toBeGreaterThan(summaryCalls));
        expect(confirmSpy).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
    });

    it('says so in a toast when the delete fails', async () => {
        const { api } = require('@/lib/api');
        const { toast } = require('@/lib/toast');
        api.deleteReturn.mockRejectedValue(new Error('Locked period'));
        renderWithQueryClient(<ReturnsPage />);
        const row = (await screen.findByText('RET-00001')).closest('tr') as HTMLElement;

        fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Locked period'));
    });

    it('links to the /sales/returns/new entry page from the header', async () => {
        renderWithQueryClient(<ReturnsPage />);
        const link = await screen.findByRole('link', { name: /process return/i });
        expect(link).toHaveAttribute('href', '/sales/returns/new');
    });

    it('still renders the table when the API fails', async () => {
        const { api } = require('@/lib/api');
        api.getReturnsList.mockRejectedValue(new Error('Server error'));
        renderWithQueryClient(<ReturnsPage />);
        expect(await screen.findByText('No returns found')).toBeInTheDocument();
    });

    describe('printing on the browser’s paper', () => {
        let openSpy: jest.SpyInstance;
        beforeEach(() => {
            openSpy = jest.spyOn(window, 'open').mockReturnValue(null);
        });
        afterEach(() => openSpy.mockRestore());

        it.each([
            ['A5', 'A5'],
            ['Letter', 'Letter'],
            ['Thermal80', 'A4'],
        ] as const)('prints a return chosen as %s on %s, with that paper’s letterhead', async (chosen, printed) => {
            mockBrowserPaper(chosen);
            renderWithQueryClient(<ReturnsPage />);
            const row = (await screen.findByText('RET-00001')).closest('tr') as HTMLElement;
            fireEvent.click(within(row).getByRole('button', { name: 'Print' }));
            await waitFor(() => expect(printedPaper()).toEqual({ page: printed, letterhead: printed }));
        });
    });
});
