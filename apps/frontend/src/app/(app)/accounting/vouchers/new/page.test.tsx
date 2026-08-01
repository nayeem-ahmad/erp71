import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AccountingVouchersPage from './page';
import { api } from '@/lib/api';
import { selectAccount, selectedAccountLabel } from '@/test-utils/account-select';

const replace = jest.fn();
let mockSearchParams: Record<string, string | null> = {};

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({
        replace,
    }),
    useSearchParams: () => ({
        get: (key: string) => mockSearchParams[key] ?? null,
    }),
}));

jest.mock('lucide-react', () => ({
    ChevronLeft: () => <span data-testid="icon-chevron-left" />,
    CircleCheck: () => <span data-testid="icon-circle-check" />,
    Plus: () => <span data-testid="icon-plus" />,
    Trash2: () => <span data-testid="icon-trash" />,
    Paperclip: () => <span data-testid="icon-paperclip" />,
    Loader2: () => <span data-testid="icon-loader" />,
    FileText: () => <span data-testid="icon-file-text" />,
    ImageIcon: () => <span data-testid="icon-image" />,
    X: () => <span data-testid="icon-x" />,
    // AccountSelect's chrome.
    Check: () => <span data-testid="icon-check" />,
    ChevronDown: () => <span data-testid="icon-chevron-down" />,
    Search: () => <span data-testid="icon-search" />,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getAccounts: jest.fn(),
        getStores: jest.fn(),
        listCostCenters: jest.fn(),
        getVoucherNumberPreview: jest.fn(),
        createVoucher: jest.fn(),
        updateVoucher: jest.fn(),
        getVoucher: jest.fn(),
        getVoucherTemplate: jest.fn(),
        uploadFile: jest.fn(),
    },
}));

describe('AccountingVouchersPage — Story 30.5', () => {
    beforeEach(() => {
        replace.mockReset();
        mockSearchParams = {};
        (api.getStores as jest.Mock).mockResolvedValue([{ id: 'store-1', name: 'Main Branch' }]);
        (api.listCostCenters as jest.Mock).mockResolvedValue([]);
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

    it('blocks submission until narration is provided', async () => {
        (api.getVoucherNumberPreview as jest.Mock).mockResolvedValue({ voucherNumber: 'CP-00001' });

        render(<AccountingVouchersPage />);

        await waitFor(() => {
            expect(screen.getByText('CP-00001')).toBeInTheDocument();
        });

        fireEvent.change(screen.getByLabelText('Description'), { target: { value: '   ' } });
        selectAccount('Account row 1', 'Cash in Hand');
        fireEvent.change(screen.getByLabelText('Credit row 1'), { target: { value: '100' } });
        selectAccount('Account row 2', 'General Operating Expense');
        fireEvent.change(screen.getByLabelText('Debit row 2'), { target: { value: '100' } });

        await waitFor(() => {
            expect(screen.getByText('Narration is required before the voucher can be saved.')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Save Voucher' })).toBeDisabled();
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

        fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Partial cash payment' } });
        selectAccount('Account row 1', 'Cash in Hand');
        fireEvent.change(screen.getByLabelText('Credit row 1'), { target: { value: '100' } });
        selectAccount('Account row 2', 'General Operating Expense');
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
        selectAccount('Account row 1', 'Cash in Hand');
        fireEvent.change(screen.getByLabelText('Credit row 1'), { target: { value: '125' } });
        selectAccount('Account row 2', 'General Operating Expense');
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
            expect(replace).toHaveBeenCalledWith('/accounting/vouchers?voucher=CP-00001');
        });
    });

    it('prefills voucher type and lines from a voucher template', async () => {
        mockSearchParams = { templateId: 'vt-1' };
        (api.getVoucherNumberPreview as jest.Mock).mockResolvedValue({ voucherNumber: 'JV-00001' });
        (api.getVoucherTemplate as jest.Mock).mockResolvedValue({
            id: 'vt-1',
            name: 'Office Rent',
            description: 'Monthly office rent',
            voucher_type: 'journal',
            lines: [
                { account_id: 'expense-1', debit_amount: 100, credit_amount: 0, comment: null },
                { account_id: 'cash-1', debit_amount: 0, credit_amount: 100, comment: null },
            ],
        });

        render(<AccountingVouchersPage />);

        await waitFor(() => {
            expect(api.getVoucherTemplate).toHaveBeenCalledWith('vt-1');
        });

        await waitFor(() => {
            expect(screen.getByLabelText('Description')).toHaveValue('Monthly office rent');
            expect(selectedAccountLabel('Account row 1')).toBe('General Operating Expense');
            expect(screen.getByLabelText('Debit row 1')).toHaveValue(100);
            expect(selectedAccountLabel('Account row 2')).toBe('Cash in Hand');
            expect(screen.getByLabelText('Credit row 2')).toHaveValue(100);
        });
    });

    describe('edit mode', () => {
        const editedVoucher = {
            id: 'voucher-9',
            voucher_number: 'CP-00009',
            voucher_type: 'cash_payment',
            description: 'Paid office rent',
            reference_number: 'CP-REF-09',
            date: '2026-07-01T00:00:00.000Z',
            store_id: 'store-2',
            attribution: 'BRANCH',
            source: { module: null, type: null, id: null },
            attachments: [],
            details: [
                // The API stores no line order, so the cash leg can come back second.
                { id: 'd1', account_id: 'expense-1', debit_amount: '250.00', credit_amount: '0.00', comment: 'Rent' },
                { id: 'd2', account_id: 'cash-1', debit_amount: '0.00', credit_amount: '250.00', comment: null },
            ],
        };

        beforeEach(() => {
            mockSearchParams = { edit: 'voucher-9' };
            (api.getVoucher as jest.Mock).mockResolvedValue(editedVoucher);
            (api.updateVoucher as jest.Mock).mockResolvedValue({ id: 'voucher-9', voucher_number: 'CP-00009' });
            (api.getStores as jest.Mock).mockResolvedValue([
                { id: 'store-1', name: 'Main Branch' },
                { id: 'store-2', name: 'Uttara Branch' },
            ]);
        });

        it('keeps the line accounts when the voucher resolves before the account list', async () => {
            let releaseAccounts: (accounts: unknown) => void = () => {};
            (api.getAccounts as jest.Mock).mockReturnValue(new Promise((resolve) => {
                releaseAccounts = resolve;
            }));

            render(<AccountingVouchersPage />);

            // Hydrate the rows first: the accounts request is still in flight, which
            // is the ordering that used to blank every account the voucher supplied.
            await waitFor(() => {
                expect(screen.getByLabelText('Description')).toHaveValue('Paid office rent');
            });

            releaseAccounts([
                { id: 'cash-1', name: 'Cash in Hand', category: 'cash', type: 'asset' },
                { id: 'expense-1', name: 'General Operating Expense', category: 'general', type: 'expense' },
            ]);

            await waitFor(() => {
                expect(selectedAccountLabel('Account row 2')).toBe('Cash in Hand');
            });

            expect(selectedAccountLabel('Account row 1')).toBe('General Operating Expense');
            expect(screen.queryByText('Select an account for this row.')).not.toBeInTheDocument();
        });

        it('restores the branch the voucher was posted against', async () => {
            render(<AccountingVouchersPage />);

            await waitFor(() => {
                expect(screen.getByLabelText('Branch')).toHaveValue('store-2');
            });
        });

        it('saves the edited voucher without re-selecting accounts', async () => {
            render(<AccountingVouchersPage />);

            await waitFor(() => {
                expect(screen.getByLabelText('Branch')).toHaveValue('store-2');
                expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
            });

            fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

            await waitFor(() => {
                expect(api.updateVoucher).toHaveBeenCalledWith('voucher-9', expect.objectContaining({
                    voucherType: 'cash_payment',
                    storeId: 'store-2',
                    details: [
                        expect.objectContaining({ accountId: 'expense-1', debitAmount: 250, creditAmount: 0 }),
                        expect.objectContaining({ accountId: 'cash-1', debitAmount: 0, creditAmount: 250 }),
                    ],
                }));
            });
        });
    });

    it('flags a cash voucher that has no cash line, wherever it sits', async () => {
        (api.getVoucherNumberPreview as jest.Mock).mockResolvedValue({ voucherNumber: 'CP-00001' });

        render(<AccountingVouchersPage />);

        await waitFor(() => {
            expect(screen.getByText('CP-00001')).toBeInTheDocument();
        });

        fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Rent accrual' } });
        selectAccount('Account row 1', 'General Operating Expense');
        fireEvent.change(screen.getByLabelText('Debit row 1'), { target: { value: '100' } });
        selectAccount('Account row 2', 'Sales Revenue');
        fireEvent.change(screen.getByLabelText('Credit row 2'), { target: { value: '100' } });

        await waitFor(() => {
            expect(screen.getByText('Cash vouchers require at least one cash account line.')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Save Voucher' })).toBeDisabled();
        });

        // The cash leg is accepted on any row, not just the first.
        selectAccount('Account row 2', 'Cash in Hand');

        await waitFor(() => {
            expect(screen.queryByText('Cash vouchers require at least one cash account line.')).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Save Voucher' })).toBeEnabled();
        });
    });

    it('renders the attachments section on the voucher entry workbench', async () => {
        (api.getVoucherNumberPreview as jest.Mock).mockResolvedValue({ voucherNumber: 'CP-00001' });

        render(<AccountingVouchersPage />);

        await waitFor(() => {
            expect(screen.getByText('Attachments')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Add file' })).toBeInTheDocument();
        });
    });
});