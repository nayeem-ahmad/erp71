import { printVoucher } from '@/lib/voucher-printer';
import { mockBrowserPaper } from '@/test-utils/print-paper';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AccountingVouchersListPage from './page';
import { api } from '@/lib/api';
import { mockBranchScope } from '@/test-utils/branch-scope';

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());
jest.mock('@/lib/hooks/useSalePrintPrefs', () => require('@/test-utils/print-paper').salePrintPrefsModuleMock());
jest.mock('@/lib/voucher-printer', () => ({ printVoucher: jest.fn() }));

// A wide screen, so the chips sit in the toolbar rather than the phone's Filters sheet.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

let searchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
    usePathname: () => '/accounting/vouchers',
    useSearchParams: () => searchParams,
}));

jest.mock('@/lib/branding', () => ({
    useBranding: () => ({ businessName: 'Demo Store' }),
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('@/lib/api', () => ({
    // The print-header hook resolves the tenant's print template on mount.
    fetchWithAuth: jest.fn().mockResolvedValue(null),
    api: {
        getVouchers: jest.fn(),
        getVouchersSummary: jest.fn(),
        getVoucher: jest.fn(),
        deleteVoucher: jest.fn(),
        approveVoucher: jest.fn(),
        rejectVoucher: jest.fn(),
        bulkApproveVouchers: jest.fn(),
        bulkRejectVouchers: jest.fn(),
        getPendingVoucherCount: jest.fn().mockResolvedValue({ count: 0, approvalEnabled: false }),
        // The page resolves the caller's APPROVE_VOUCHER grant on mount.
        getMe: jest.fn().mockResolvedValue({ tenants: [{ id: 'tenant-1', role: 'ACCOUNTANT', permissions: [] }] }),
    },
}));

const getVouchers = api.getVouchers as jest.Mock;
const getVouchersSummary = api.getVouchersSummary as jest.Mock;

const voucher = (overrides: Record<string, unknown> = {}) => ({
    id: 'voucher-1',
    voucher_number: 'CP-00001',
    voucher_type: 'cash_payment',
    reference_number: 'CP-REF-01',
    date: '2026-03-21T00:00:00.000Z',
    created_at: '2026-03-21T04:00:00.000Z',
    description: 'Office rent for March',
    total_amount: 125,
    approval_status: 'APPROVED',
    ...overrides,
});

/** One page of the vouchers endpoint, as `fetchWithAuth` hands it over. */
const page = (rows: unknown[], total = rows.length) => ({
    data: rows,
    meta: { page: 1, limit: 20, total, totalPages: Math.max(1, Math.ceil(total / 20)) },
});

const approver = () =>
    (api.getMe as jest.Mock).mockResolvedValue({
        tenants: [{ id: 'tenant-1', role: 'ACCOUNTANT', permissions: ['APPROVE_VOUCHER'] }],
    });

/** Opens a toolbar chip by its label. */
const openChip = (label: string) =>
    fireEvent.click(
        screen.getAllByRole('button', { name: new RegExp(`^${label}`) })
            .find((button) => button.getAttribute('aria-haspopup') === 'dialog')!,
    );

describe('AccountingVouchersListPage', () => {
    beforeEach(() => {
        // Mock state leaks between tests otherwise — the bulk assertions below
        // check that an endpoint was NOT called, which a stale call defeats.
        jest.clearAllMocks();
        searchParams = new URLSearchParams();
        mockBranchScope();
        (api.getMe as jest.Mock).mockResolvedValue({
            tenants: [{ id: 'tenant-1', role: 'ACCOUNTANT', permissions: [] }],
        });
        (api.getPendingVoucherCount as jest.Mock).mockResolvedValue({ count: 0, approvalEnabled: false });
        getVouchers.mockResolvedValue(page([voucher()]));
        getVouchersSummary.mockResolvedValue({
            count: 12,
            totalAmount: 45000,
            pending: 3,
            approved: 8,
            rejected: 1,
            systemCount: 7,
            manualCount: 5,
        });
    });

    it('loads the header branch\'s vouchers, newest first, with the type in words and the amount at the end', async () => {
        render(<AccountingVouchersListPage />);

        expect(await screen.findByText('CP-00001')).toBeInTheDocument();
        expect(screen.getByText('Office rent for March')).toBeInTheDocument();
        expect(screen.getByText('Cash Payment')).toBeInTheDocument();
        expect(getVouchers).toHaveBeenCalledWith(
            expect.objectContaining({ storeId: 'store-1', page: 1, sortBy: 'date', sortDir: 'desc' }),
        );
    });

    it('shows the server\'s figures for every matching voucher in the strip', async () => {
        render(<AccountingVouchersListPage />);

        const strip = await screen.findByRole('region', { name: 'Voucher figures' });
        await waitFor(() => expect(within(strip).getByText('৳ 45,000')).toBeInTheDocument());
        expect(within(strip).getByText('Awaiting approval')).toBeInTheDocument();
        expect(within(strip).getByText('· 5 manual')).toBeInTheDocument();
        expect(getVouchersSummary).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'store-1' }));
    });

    it('sends the Type chip to the list and the strip alike', async () => {
        render(<AccountingVouchersListPage />);
        await screen.findByText('CP-00001');

        openChip('Type');
        fireEvent.click(screen.getByRole('checkbox', { name: 'Bank Payment' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Journal Voucher' }));

        await waitFor(() =>
            expect(getVouchers).toHaveBeenLastCalledWith(
                expect.objectContaining({ voucherType: 'bank_payment,journal', page: 1 }),
            ),
        );
        expect(getVouchersSummary).toHaveBeenLastCalledWith(
            expect.objectContaining({ voucherType: 'bank_payment,journal' }),
        );
    });

    it('searches number, reference and narration on the server', async () => {
        render(<AccountingVouchersListPage />);
        await screen.findByText('CP-00001');

        fireEvent.change(screen.getByPlaceholderText('Search number, reference or narration…'), {
            target: { value: 'rent' },
        });

        await waitFor(() =>
            expect(getVouchers).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'rent' })),
        );
    });

    it('opens as the approval queue from ?approvalStatus=PENDING', async () => {
        searchParams = new URLSearchParams('approvalStatus=PENDING');
        render(<AccountingVouchersListPage />);

        await waitFor(() =>
            expect(getVouchers).toHaveBeenCalledWith(expect.objectContaining({ approvalStatus: 'PENDING' })),
        );
        expect(getVouchersSummary).toHaveBeenCalledWith(expect.objectContaining({ approvalStatus: 'PENDING' }));
        expect(screen.getByRole('button', { name: /^Approval: Pending/ })).toBeInTheDocument();
    });

    it('goes back to page 1 of the branch picked', async () => {
        getVouchers.mockResolvedValue(page([voucher()], 40));
        render(<AccountingVouchersListPage />);
        await screen.findByText('CP-00001');

        fireEvent.change(screen.getByRole('combobox', { name: 'Branch' }), { target: { value: 'all' } });

        await waitFor(() =>
            expect(getVouchers).toHaveBeenLastCalledWith(expect.objectContaining({ storeId: 'all', page: 1 })),
        );
    });

    it('offers a duplicate action that opens the entry form prefilled from the voucher', async () => {
        // System-posted vouchers cannot be edited, but they can be copied.
        getVouchers.mockResolvedValue(page([voucher({ source: { module: 'sales', type: 'invoice', id: 'inv-1' } })]));
        render(<AccountingVouchersListPage />);

        const duplicate = await screen.findByTitle('Duplicate voucher');
        expect(duplicate).toHaveAttribute('href', '/accounting/vouchers/new?duplicate=voucher-1');
        // Edit and delete are refused for a system-posted voucher, and say why.
        expect(screen.getAllByTitle('System-posted vouchers cannot be edited or deleted.')).toHaveLength(2);
    });

    it('deletes a voucher only once the dialog is confirmed', async () => {
        (api.deleteVoucher as jest.Mock).mockResolvedValue({});
        render(<AccountingVouchersListPage />);

        fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/Delete voucher CP-00001\?/)).toBeInTheDocument();
        expect(api.deleteVoucher).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(api.deleteVoucher).toHaveBeenCalledWith('voucher-1'));
    });

    describe('print', () => {
        beforeEach(() => {
            (api.getVoucher as jest.Mock).mockResolvedValue({ ...voucher({ reference_number: null }), store_id: 's1', details: [] });
        });

        it('prints on the paper chosen in Print settings', async () => {
            mockBrowserPaper('A5');
            render(<AccountingVouchersListPage />);

            fireEvent.click(await screen.findByTitle('Print voucher'));

            await waitFor(() => expect(printVoucher).toHaveBeenCalled());
            expect((printVoucher as jest.Mock).mock.calls[0][1]).toBe('A5');
        });

        it('prints on A4 when this browser prints on a till roll', async () => {
            mockBrowserPaper('Thermal58');
            render(<AccountingVouchersListPage />);

            fireEvent.click(await screen.findByTitle('Print voucher'));

            await waitFor(() => expect(printVoucher).toHaveBeenCalled());
            expect((printVoucher as jest.Mock).mock.calls[0][1]).toBe('A4');
        });
    });

    describe('approval', () => {
        const pending = voucher({ id: 'voucher-2', voucher_number: 'JV-00007', voucher_type: 'journal', approval_status: 'PENDING' });

        it('badges an unapproved voucher', async () => {
            getVouchers.mockResolvedValue(page([pending]));
            render(<AccountingVouchersListPage />);

            await screen.findByText('JV-00007');
            expect(screen.getAllByText('Pending').some((node) => node.tagName === 'SPAN')).toBe(true);
        });

        it('asks for the rejection reason in a form, not a browser prompt', async () => {
            approver();
            getVouchers.mockResolvedValue(page([pending]));
            (api.rejectVoucher as jest.Mock).mockResolvedValue({});
            const prompt = jest.spyOn(window, 'prompt');
            render(<AccountingVouchersListPage />);

            fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
            const dialog = await screen.findByRole('dialog');
            fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Wrong account' } });
            fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));

            await waitFor(() => expect(api.rejectVoucher).toHaveBeenCalledWith('voucher-2', 'Wrong account'));
            expect(prompt).not.toHaveBeenCalled();
            prompt.mockRestore();
        });

        it('bulk-approves the selected pending vouchers', async () => {
            approver();
            getVouchers.mockResolvedValue(page([pending]));
            (api.bulkApproveVouchers as jest.Mock).mockResolvedValue({ updated: 1, skipped: 0, notFound: 0 });
            render(<AccountingVouchersListPage />);

            await screen.findByText('JV-00007');
            fireEvent.click(await screen.findByRole('checkbox', { name: /select all/i }));
            fireEvent.click(await screen.findByRole('button', { name: 'Approve selected' }));

            await waitFor(() => expect(api.bulkApproveVouchers).toHaveBeenCalledWith(['voucher-2']));
        });

        it('bulk-rejects through the reason form', async () => {
            approver();
            getVouchers.mockResolvedValue(page([pending]));
            (api.bulkRejectVouchers as jest.Mock).mockResolvedValue({ updated: 1 });
            render(<AccountingVouchersListPage />);

            await screen.findByText('JV-00007');
            fireEvent.click(await screen.findByRole('checkbox', { name: /select all/i }));
            fireEvent.click(await screen.findByRole('button', { name: 'Reject selected' }));
            const dialog = await screen.findByRole('dialog');
            fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));

            await waitFor(() => expect(api.bulkRejectVouchers).toHaveBeenCalledWith(['voucher-2'], undefined));
        });

        it('does not call the API when the selection holds nothing pending', async () => {
            approver();
            getVouchers.mockResolvedValue(page([voucher({ id: 'voucher-3', voucher_number: 'JV-00008' })]));
            render(<AccountingVouchersListPage />);

            await screen.findByText('JV-00008');
            fireEvent.click(await screen.findByRole('checkbox', { name: /select all/i }));
            fireEvent.click(await screen.findByRole('button', { name: 'Approve selected' }));

            expect(api.bulkApproveVouchers).not.toHaveBeenCalled();
        });
    });
});
