import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
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
    ...jest.requireActual('@/lib/format'),
    formatBDT: (v: number) => `৳${v}`,
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
    usePathname: jest.fn(() => '/accounting/voucher-templates'),
    useSearchParams: jest.fn(() => ({ get: jest.fn().mockReturnValue(null) })),
    useParams: jest.fn(() => ({})),
}));

const mockTemplates = [
    {
        id: 'vt-2',
        name: 'Petty Cash',
        description: 'Small office spend',
        voucher_type: 'cash_payment',
        lines: [
            { account: { name: 'Office Supplies' }, debit_amount: 300, credit_amount: 0 },
            { account: { name: 'Cash' }, debit_amount: 0, credit_amount: 300 },
        ],
    },
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
            const links = screen.getAllByRole('link', { name: /use template/i });
            expect(links.map((link) => link.getAttribute('href'))).toContain('/accounting/vouchers/new?templateId=vt-1');
        });
    });

    it('narrows the rows and the strip together through the Type chip', async () => {
        const api = getApi();
        api.listVoucherTemplates.mockResolvedValue(mockTemplates);
        render(<VoucherTemplatesPage />);
        await screen.findByText('Office Rent');
        const strip = screen.getByRole('region', { name: 'Voucher template figures' });
        expect(within(strip).getByText('৳5300')).toBeInTheDocument();

        fireEvent.click(
            screen.getAllByRole('button', { name: /^Type/ })
                .find((button) => button.getAttribute('aria-haspopup') === 'dialog')!,
        );
        fireEvent.click(screen.getByRole('checkbox', { name: 'Bank Payment' }));

        await waitFor(() => expect(screen.queryByText('Petty Cash')).not.toBeInTheDocument());
        expect(screen.getByText('Office Rent')).toBeInTheDocument();
        expect(within(strip).getByText('৳5000')).toBeInTheDocument();
    });

    it('shows create form and disables save until two lines are picked', async () => {
        render(<VoucherTemplatesPage />);
        fireEvent.click(await screen.findByRole('button', { name: /new template/i }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByRole('button', { name: /save template/i })).toBeDisabled();
    });

    it('deletes a template once the dialog is confirmed', async () => {
        const api = getApi();
        api.listVoucherTemplates.mockResolvedValue(mockTemplates);
        render(<VoucherTemplatesPage />);
        await screen.findByText('Office Rent');
        fireEvent.click(screen.getAllByRole('button', { name: /delete template/i })[1]);
        const dialog = await screen.findByRole('dialog');
        expect(api.deleteVoucherTemplate).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
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
