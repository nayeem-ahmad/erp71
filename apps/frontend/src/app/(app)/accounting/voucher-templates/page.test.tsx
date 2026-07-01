import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import VoucherTemplatesPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        listVoucherTemplates: jest.fn(),
        createVoucherTemplate: jest.fn(),
        deleteVoucherTemplate: jest.fn(),
        getAccounts: jest.fn(),
    },
}));

jest.mock('@/lib/format', () => ({
    formatBDT: (v: number) => `৳${v}`,
}));

jest.mock('next/navigation', () => ({
    useRouter: jest.fn(() => ({ push: jest.fn() })),
    usePathname: jest.fn(() => '/accounting/voucher-templates'),
    useSearchParams: jest.fn(() => ({ get: jest.fn().mockReturnValue(null) })),
    useParams: jest.fn(() => ({})),
}));

const mockTemplates = [
    {
        id: 'vt-1',
        name: 'Office Rent',
        description: 'Monthly office rent payment',
        voucher_type: 'bank_payment',
        lines: [
            { account: { name: 'Rent Expense' }, debit_amount: 5000, credit_amount: 0 },
            { account: { name: 'Bank' }, debit_amount: 0, credit_amount: 5000 },
        ],
    },
];

const mockAccounts = [
    { id: 'acc-1', name: 'Bank', code: '1002' },
    { id: 'acc-2', name: 'Rent Expense', code: '6001' },
];

function getApi() {
    return require('@/lib/api').api;
}

describe('VoucherTemplatesPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const api = getApi();
        api.listVoucherTemplates.mockResolvedValue([]);
        api.getAccounts.mockResolvedValue(mockAccounts);
        api.createVoucherTemplate.mockResolvedValue({ id: 'vt-new' });
        api.deleteVoucherTemplate.mockResolvedValue({ success: true });
    });

    it('calls listVoucherTemplates on mount', async () => {
        const api = getApi();
        render(<VoucherTemplatesPage />);
        await waitFor(() => {
            expect(api.listVoucherTemplates).toHaveBeenCalledTimes(1);
        });
    });

    it('shows empty state when no templates', async () => {
        render(<VoucherTemplatesPage />);
        await waitFor(() => {
            expect(screen.getByText(/no voucher templates/i)).toBeInTheDocument();
        });
    });

    it('shows templates with a "Use Template" link to the New Voucher page', async () => {
        const api = getApi();
        api.listVoucherTemplates.mockResolvedValue(mockTemplates);
        render(<VoucherTemplatesPage />);
        await waitFor(() => {
            expect(screen.getByText('Office Rent')).toBeInTheDocument();
            const link = screen.getByRole('link', { name: /use template/i });
            expect(link).toHaveAttribute('href', '/accounting/vouchers/new?templateId=vt-1');
        });
    });

    it('shows create form and disables save until two lines are picked', async () => {
        render(<VoucherTemplatesPage />);
        await waitFor(() => screen.getByRole('button', { name: /new template/i }));
        fireEvent.click(screen.getByRole('button', { name: /new template/i }));
        await waitFor(() => {
            const saveBtn = screen.getByRole('button', { name: /save template/i });
            expect(saveBtn).toBeDisabled();
        });
    });

    it('calls deleteVoucherTemplate when the delete button is clicked', async () => {
        const api = getApi();
        api.listVoucherTemplates.mockResolvedValue(mockTemplates);
        render(<VoucherTemplatesPage />);
        await waitFor(() => screen.getByText('Office Rent'));
        fireEvent.click(screen.getByRole('button', { name: /delete template/i }));
        await waitFor(() => {
            expect(api.deleteVoucherTemplate).toHaveBeenCalledWith('vt-1');
        });
    });

    it('shows error message when load fails', async () => {
        const api = getApi();
        api.listVoucherTemplates.mockRejectedValue(new Error('Failed to load'));
        render(<VoucherTemplatesPage />);
        await waitFor(() => {
            expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
        });
    });
});
