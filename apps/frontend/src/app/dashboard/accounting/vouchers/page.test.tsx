import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AccountingVouchersPage from './page';
import { api } from '../../../../lib/api';

const replace = jest.fn();

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({
        replace,
    }),
    useSearchParams: () => ({
        get: () => null,
    }),
}));

jest.mock('lucide-react', () => ({
    ArrowLeft: () => <span data-testid="icon-arrow-left" />,
    CircleCheck: () => <span data-testid="icon-circle-check" />,
    FileText: () => <span data-testid="icon-file-text" />,
    HelpCircle: () => <span data-testid="icon-help-circle" />,
    Plus: () => <span data-testid="icon-plus" />,
    Scale: () => <span data-testid="icon-scale" />,
    Trash2: () => <span data-testid="icon-trash" />,
}));

jest.mock('../../../../lib/api', () => ({
    api: {
        getAccounts: jest.fn(),
        getVoucherNumberPreview: jest.fn(),
        createVoucher: jest.fn(),
    },
}));

describe('AccountingVouchersPage — Story 30.5', () => {
    beforeEach(() => {
        replace.mockReset();
        (api.getAccounts as jest.Mock).mockResolvedValue([
            { id: 'cash-1', name: 'Cash in Hand', category: 'cash', type: 'asset' },
            { id: 'bank-1', name: 'Main Bank Account', category: 'bank', type: 'asset' },
            { id: 'expense-1', name: 'General Operating Expense', category: 'general', type: 'expense' },
            { id: 'revenue-1', name: 'Sales Revenue', category: 'general', type: 'revenue' },
        ]);
        (api.createVoucher as jest.Mock).mockResolvedValue({
            id: 'voucher-1',
            voucher_number: 'CP-00001',
        });
    });

    it('updates the preview number when the voucher type changes', async () => {
        const getVoucherNumberPreview = api.getVoucherNumberPreview as jest.Mock;
        getVoucherNumberPreview.mockImplementation(async (voucherType: string) => {
            if (voucherType === 'journal') {
                return { voucherNumber: 'JV-00001' };
            }

            return { voucherNumber: 'CP-00001' };
        });

        render(<AccountingVouchersPage />);

        await waitFor(() => {
            expect(screen.getByText('CP-00001')).toBeInTheDocument();
        });

        fireEvent.change(screen.getByLabelText('Voucher type'), {
            target: { value: 'journal' },
        });

        await waitFor(() => {
            expect(screen.getByText('JV-00001')).toBeInTheDocument();
        });
    });

    it('adds rows and blocks submission while the voucher is unbalanced', async () => {
        (api.getVoucherNumberPreview as jest.Mock).mockResolvedValue({ voucherNumber: 'CP-00001' });

        render(<AccountingVouchersPage />);

        await waitFor(() => {
            expect(screen.getByText('CP-00001')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Add Row' }));
        expect(screen.getByLabelText('Account row 3')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Account row 1'), { target: { value: 'cash-1' } });
        fireEvent.change(screen.getByLabelText('Credit row 1'), { target: { value: '100' } });
        fireEvent.change(screen.getByLabelText('Account row 2'), { target: { value: 'expense-1' } });
        fireEvent.change(screen.getByLabelText('Debit row 2'), { target: { value: '60' } });

        expect(screen.getByText('Voucher must balance before it can be saved.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Save Voucher' })).toBeDisabled();
    });

    it('submits a balanced voucher and redirects into confirmation state', async () => {
        (api.getVoucherNumberPreview as jest.Mock).mockResolvedValue({ voucherNumber: 'CP-00001' });

        render(<AccountingVouchersPage />);

        await waitFor(() => {
            expect(screen.getByText('CP-00001')).toBeInTheDocument();
        });

        fireEvent.change(screen.getByLabelText('Reference number'), { target: { value: 'CP-REF-01' } });
        fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Paid office rent' } });
        fireEvent.change(screen.getByLabelText('Account row 1'), { target: { value: 'cash-1' } });
        fireEvent.change(screen.getByLabelText('Credit row 1'), { target: { value: '125' } });
        fireEvent.change(screen.getByLabelText('Account row 2'), { target: { value: 'expense-1' } });
        fireEvent.change(screen.getByLabelText('Debit row 2'), { target: { value: '125' } });

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Save Voucher' })).toBeEnabled();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Save Voucher' }));

        await waitFor(() => {
            expect(api.createVoucher).toHaveBeenCalledWith(expect.objectContaining({
                voucherType: 'cash_payment',
                referenceNumber: 'CP-REF-01',
                description: 'Paid office rent',
            }));
            expect(replace).toHaveBeenCalledWith('/dashboard/accounting/vouchers?created=voucher-1&voucher=CP-00001');
            expect(screen.getByText('Voucher CP-00001 saved successfully')).toBeInTheDocument();
        });
    });
});