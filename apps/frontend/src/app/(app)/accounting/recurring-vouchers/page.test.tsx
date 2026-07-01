import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
    formatBDT: (v: number) => `৳${v}`,
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
        lines: [],
    },
];

const mockAccounts = [
    { id: 'acc-1', name: 'Cash', code: '1001' },
    { id: 'acc-2', name: 'Rent Expense', code: '6001' },
];

function getApi() {
    return require('@/lib/api').api;
}

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
        await waitFor(() => {
            expect(screen.getByText(/no recurring vouchers/i)).toBeInTheDocument();
        });
    });

    it('shows templates with their voucher type badge', async () => {
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

    it('shows create form with a voucher type selector', async () => {
        render(<RecurringVouchersPage />);
        await waitFor(() => screen.getByRole('button', { name: /new recurring voucher/i }));
        fireEvent.click(screen.getByRole('button', { name: /new recurring voucher/i }));
        await waitFor(() => {
            expect(screen.getByText('Voucher Type')).toBeInTheDocument();
            expect(screen.getByPlaceholderText(/e.g. monthly rent/i)).toBeInTheDocument();
        });
    });

    it('calls postRecurringVoucher when Post Now is clicked', async () => {
        const api = getApi();
        api.listRecurringVouchers.mockResolvedValue(mockTemplates);
        render(<RecurringVouchersPage />);
        await waitFor(() => screen.getAllByRole('button', { name: /post now/i }));
        fireEvent.click(screen.getAllByRole('button', { name: /post now/i })[0]);
        await waitFor(() => {
            expect(api.postRecurringVoucher).toHaveBeenCalledWith('rv-1');
        });
    });

    it('shows error message when load fails', async () => {
        const api = getApi();
        api.listRecurringVouchers.mockRejectedValue(new Error('Failed to load'));
        render(<RecurringVouchersPage />);
        await waitFor(() => {
            expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
        });
    });
});
