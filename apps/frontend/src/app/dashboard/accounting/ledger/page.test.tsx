import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AccountingLedgerPage from './page';
import { api } from '../../../../lib/api';

const replace = jest.fn();

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({
        replace,
    }),
    usePathname: () => '/dashboard/accounting/ledger',
    useSearchParams: () => ({
        get: () => null,
    }),
}));

jest.mock('../../../../components/data-table', () => ({
    DataTable: ({ data }: { data: Array<{ id: string; voucher_number: string; narration?: string | null; running_balance: number }> }) => (
        <div>
            {data.map((row) => (
                <div key={row.id}>{row.voucher_number} {row.narration} {row.running_balance}</div>
            ))}
        </div>
    ),
}));

jest.mock('lucide-react', () => ({
    ArrowLeft: () => <span data-testid="icon-arrow-left" />,
    Calculator: () => <span data-testid="icon-calculator" />,
    Filter: () => <span data-testid="icon-filter" />,
    ReceiptText: () => <span data-testid="icon-receipt-text" />,
    Wallet: () => <span data-testid="icon-wallet" />,
}));

jest.mock('../../../../lib/api', () => ({
    api: {
        getAccounts: jest.fn(),
        getLedger: jest.fn(),
    },
}));

describe('AccountingLedgerPage — Story 30.8', () => {
    beforeEach(() => {
        replace.mockReset();
        (api.getAccounts as jest.Mock).mockResolvedValue([
            { id: 'cash-1', name: 'Cash in Hand', code: '1010', type: 'asset', category: 'cash' },
            { id: 'revenue-1', name: 'Sales Revenue', code: '4010', type: 'revenue', category: 'general' },
        ]);
        (api.getLedger as jest.Mock).mockResolvedValue({
            account: { id: 'cash-1', name: 'Cash in Hand', code: '1010', type: 'asset', category: 'cash' },
            filters: { from: '2026-03-01', to: '2026-03-31' },
            normal_balance_side: 'debit',
            opening_balance: 125,
            opening_balance_side: 'credit',
            closing_balance: 175,
            closing_balance_side: 'debit',
            totals: { debit: 300, credit: 0 },
            data: [
                {
                    id: 'detail-1',
                    voucher_id: 'voucher-1',
                    voucher_number: 'CR-00001',
                    voucher_type: 'cash_receive',
                    date: '2026-03-05T00:00:00.000Z',
                    description: 'Customer collection',
                    narration: 'Customer collection',
                    debit_amount: 300,
                    credit_amount: 0,
                    running_balance: 175,
                    running_balance_side: 'debit',
                },
            ],
        });
    });

    it('shows the no-account-selected state until an account is chosen', async () => {
        render(<AccountingLedgerPage />);

        await waitFor(() => {
            expect(api.getAccounts).toHaveBeenCalled();
            expect(screen.queryByText('Loading account options...')).not.toBeInTheDocument();
        });

        expect(screen.getByText('Select an account to review the ledger')).toBeInTheDocument();
        expect(api.getLedger).not.toHaveBeenCalled();
    });

    it('loads ledger rows, updates URL-backed filters, and renders summary balances', async () => {
        render(<AccountingLedgerPage />);

        await waitFor(() => {
            expect(api.getAccounts).toHaveBeenCalled();
            expect(screen.getByRole('option', { name: /Cash in Hand/ })).toBeInTheDocument();
        });

        fireEvent.change(screen.getByLabelText('Ledger account'), {
            target: { value: 'cash-1' },
        });

        await waitFor(() => {
            expect((screen.getByLabelText('Ledger account') as HTMLSelectElement).value).toBe('cash-1');
            expect(api.getLedger).toHaveBeenLastCalledWith('cash-1', {
                from: undefined,
                to: undefined,
            });
        });

        fireEvent.change(screen.getByLabelText('Ledger from date'), {
            target: { value: '2026-03-01' },
        });
        fireEvent.change(screen.getByLabelText('Ledger to date'), {
            target: { value: '2026-03-31' },
        });

        await waitFor(() => {
            expect(api.getLedger).toHaveBeenLastCalledWith('cash-1', {
                from: '2026-03-01',
                to: '2026-03-31',
            });
            expect(screen.getByText(/CR-00001/)).toBeInTheDocument();
            expect(screen.getByText('৳ 125.00 credit')).toBeInTheDocument();
            expect(screen.getByText('৳ 300.00 debit')).toBeInTheDocument();
            expect(screen.getByText('৳ 175.00 debit')).toBeInTheDocument();
        });

        expect(replace).toHaveBeenCalledWith('/dashboard/accounting/ledger?accountId=cash-1&from=2026-03-01&to=2026-03-31');
    });
});