import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import RecurringVouchersPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        listRecurringVouchers: jest.fn(),
        createRecurringVoucher: jest.fn(),
        postRecurringVoucher: jest.fn(),
        deleteRecurringVoucher: jest.fn(),
        getAccounts: jest.fn(),
    },
}));

jest.mock('@/lib/format', () => ({
    ...jest.requireActual('@/lib/format'),
    formatBDT: (v: number) => `৳${v}`,
    formatDate: (v: string) => v,
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

// A wide screen, so the chips sit in the toolbar rather than the phone's Filters sheet.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('next/navigation', () => ({
    useRouter: jest.fn(() => ({ push: jest.fn() })),
    usePathname: jest.fn(() => '/accounting/recurring-vouchers'),
    useSearchParams: jest.fn(() => ({ get: jest.fn().mockReturnValue(null) })),
    useParams: jest.fn(() => ({})),
}));

const mockTemplates = [
    {
        id: 'rv-1',
        name: 'Monthly Rent',
        description: 'Rent payment',
        voucher_type: 'journal',
        frequency: 'MONTHLY',
        next_due_date: '2026-07-01',
        last_run_date: '2026-06-01',
        is_active: true,
        lines: [
            { account: { name: 'Rent Expense' }, debit_amount: 5000, credit_amount: 0 },
            { account: { name: 'Cash' }, debit_amount: 0, credit_amount: 5000 },
        ],
    },
    {
        id: 'rv-2',
        name: 'Weekly Wallet Top-up',
        description: 'Bank to wallet',
        voucher_type: 'bank_payment',
        frequency: 'WEEKLY',
        next_due_date: '2026-06-15',
        last_run_date: null,
        is_active: true,
        lines: [
            { account: { name: 'bKash Wallet' }, debit_amount: 2000, credit_amount: 0 },
            { account: { name: 'Bank' }, debit_amount: 0, credit_amount: 2000 },
        ],
    },
];

const mockAccounts = [
    { id: 'acc-1', name: 'Cash', code: '1001' },
    { id: 'acc-2', name: 'Rent Expense', code: '6001' },
];

function getApi() {
    return require('@/lib/api').api;
}

const openChip = (label: string) =>
    fireEvent.click(
        screen.getAllByRole('button', { name: new RegExp(`^${label}`) })
            .find((button) => button.getAttribute('aria-haspopup') === 'dialog')!,
    );

describe('RecurringVouchersPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const api = getApi();
        api.listRecurringVouchers.mockResolvedValue([]);
        api.getAccounts.mockResolvedValue(mockAccounts);
        api.createRecurringVoucher.mockResolvedValue({ id: 'rv-new' });
        api.postRecurringVoucher.mockResolvedValue({ voucher: { voucher_number: 'JV-00001' } });
        api.deleteRecurringVoucher.mockResolvedValue({ success: true });
    });

    it('calls listRecurringVouchers on mount', async () => {
        const api = getApi();
        render(<RecurringVouchersPage />);
        await waitFor(() => {
            expect(api.listRecurringVouchers).toHaveBeenCalledTimes(1);
        });
    });

    it('shows empty state when no templates', async () => {
        render(<RecurringVouchersPage />);
        expect(await screen.findByText(/no recurring vouchers/i)).toBeInTheDocument();
    });

    it('lists templates with their voucher type in words', async () => {
        const api = getApi();
        api.listRecurringVouchers.mockResolvedValue(mockTemplates);
        render(<RecurringVouchersPage />);
        await waitFor(() => {
            expect(screen.getByText('Monthly Rent')).toBeInTheDocument();
            expect(screen.getByText('Weekly Wallet Top-up')).toBeInTheDocument();
            expect(screen.getByText('Journal Voucher')).toBeInTheDocument();
            expect(screen.getByText('Bank Payment')).toBeInTheDocument();
        });
    });

    it('narrows the rows and the strip together through the Type chip', async () => {
        const api = getApi();
        api.listRecurringVouchers.mockResolvedValue(mockTemplates);
        render(<RecurringVouchersPage />);
        await screen.findByText('Monthly Rent');

        const strip = screen.getByRole('region', { name: 'Recurring voucher figures' });
        expect(within(strip).getByText('৳7000')).toBeInTheDocument();

        openChip('Type');
        fireEvent.click(screen.getByRole('checkbox', { name: 'Bank Payment' }));

        await waitFor(() => expect(screen.queryByText('Monthly Rent')).not.toBeInTheDocument());
        expect(screen.getByText('Weekly Wallet Top-up')).toBeInTheDocument();
        expect(within(strip).getByText('৳2000')).toBeInTheDocument();
    });

    it('opens the create form with a voucher type selector', async () => {
        render(<RecurringVouchersPage />);
        fireEvent.click(await screen.findByRole('button', { name: /new recurring voucher/i }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByLabelText('Voucher type')).toBeInTheDocument();
        expect(within(dialog).getByPlaceholderText(/e.g. monthly rent/i)).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: /save template/i })).toBeDisabled();
    });

    it('calls postRecurringVoucher when Post Now is clicked', async () => {
        const api = getApi();
        api.listRecurringVouchers.mockResolvedValue(mockTemplates);
        render(<RecurringVouchersPage />);
        const buttons = await screen.findAllByRole('button', { name: /post now/i });
        fireEvent.click(buttons[0]);
        await waitFor(() => {
            expect(api.postRecurringVoucher).toHaveBeenCalledWith('rv-1');
        });
    });

    it('deletes a template only once the dialog is confirmed', async () => {
        const api = getApi();
        api.listRecurringVouchers.mockResolvedValue(mockTemplates);
        render(<RecurringVouchersPage />);
        const buttons = await screen.findAllByRole('button', { name: 'Delete recurring voucher' });
        fireEvent.click(buttons[0]);
        const dialog = await screen.findByRole('dialog');
        expect(api.deleteRecurringVoucher).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(api.deleteRecurringVoucher).toHaveBeenCalledWith('rv-1'));
    });

    it('shows error message when load fails', async () => {
        const api = getApi();
        api.listRecurringVouchers.mockRejectedValue(new Error('Failed to load'));
        render(<RecurringVouchersPage />);
        expect(await screen.findByText(/failed to load/i)).toBeInTheDocument();
    });
});
