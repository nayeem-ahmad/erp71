import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AccountingLedgerPage from './page';
import { api } from '@/lib/api';
import { createdRangeFromPreset } from '@/lib/created-range';
import { mockBranchScope } from '@/test-utils/branch-scope';

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

// A wide screen, so the chips sit in the toolbar rather than the phone's Filters sheet.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

const replace = jest.fn();

jest.mock('next/link', () => {
    return ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
        <a href={href} className={className}>{children}</a>
    );
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({
        replace,
    }),
    usePathname: () => '/accounting/ledger',
    useSearchParams: () => ({
        get: () => null,
    }),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getAccounts: jest.fn(),
        getLedger: jest.fn(),
        // The approved-only toggle resolves the tenant's setting on mount.
        getAccountingSettings: jest.fn().mockResolvedValue({
            requireVoucherApproval: false,
            autoApproveSystemVouchers: true,
            reportsApprovedOnly: false,
        }),
    },
}));

const line = (overrides: Record<string, unknown>) => ({
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
    ...overrides,
});

const thisMonth = createdRangeFromPreset('thisMonth');

function strip() {
    return within(screen.getByRole('region', { name: 'Ledger summary' }));
}

function tile(label: string) {
    return strip().getByText(label).closest('div') as HTMLElement;
}

async function pickAccount(name: RegExp) {
    fireEvent.click(screen.getByRole('button', { name: /^Account/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name }));
}

describe('AccountingLedgerPage', () => {
    beforeEach(() => {
        mockBranchScope();
        replace.mockReset();
        (api.getLedger as jest.Mock).mockReset();
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
            totals: { debit: 340, credit: 40 },
            data: [
                line({}),
                line({
                    id: 'detail-2',
                    voucher_id: 'voucher-2',
                    voucher_number: 'CP-00002',
                    voucher_type: 'cash_payment',
                    narration: 'Office rent',
                    debit_amount: 0,
                    credit_amount: 40,
                    running_balance: 135,
                }),
            ],
        });
    });

    it('asks for an account before loading a ledger', async () => {
        render(<AccountingLedgerPage />);

        await waitFor(() => expect(api.getAccounts).toHaveBeenCalled());

        expect(await screen.findByText('Select an account to review the ledger')).toBeInTheDocument();
        expect(api.getLedger).not.toHaveBeenCalled();
    });

    it('loads the picked account for this month, keeps the URL in step, and fills the strip', async () => {
        render(<AccountingLedgerPage />);
        await waitFor(() => expect(api.getAccounts).toHaveBeenCalled());

        await pickAccount(/1010 — Cash in Hand/);

        await waitFor(() => {
            expect(api.getLedger).toHaveBeenLastCalledWith('cash-1', {
                from: thisMonth.from,
                to: thisMonth.to,
                approvedOnly: false,
                storeId: 'store-1',
            });
        });
        expect(await screen.findByText('CR-00001')).toBeInTheDocument();
        expect(replace).toHaveBeenLastCalledWith(
            `/accounting/ledger?accountId=cash-1&from=${thisMonth.from}&to=${thisMonth.to}`,
        );

        expect(tile('Opening balance')).toHaveTextContent(/৳\s?125.*Credit/);
        expect(tile('Period movement')).toHaveTextContent(/৳\s?300.*Debit/);
        expect(tile('Closing balance')).toHaveTextContent(/৳\s?175.*Debit/);
        expect(tile('Total debit')).toHaveTextContent(/৳\s?300/);
        expect(tile('Total credit')).toHaveTextContent(/৳\s?40/);
        expect(tile('Entries')).toHaveTextContent('2');
    });

    it('narrows the lines by side, and the strip sums only those lines', async () => {
        render(<AccountingLedgerPage />);
        await waitFor(() => expect(api.getAccounts).toHaveBeenCalled());
        await pickAccount(/1010 — Cash in Hand/);
        expect(await screen.findByText('CP-00002')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /^Side/ }));
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Credit' }));

        await waitFor(() => expect(screen.queryByText('CR-00001')).not.toBeInTheDocument());
        expect(screen.getByText('CP-00002')).toBeInTheDocument();
        expect(tile('Total debit')).toHaveTextContent(/৳\s?0/);
        expect(tile('Total credit')).toHaveTextContent(/৳\s?40/);
        expect(tile('Entries')).toHaveTextContent('1');
        // The balances are the account's, whatever lines the chips show.
        expect(tile('Closing balance')).toHaveTextContent(/৳\s?175/);
        // Narrowing lines asks nothing more of the server.
        expect(api.getLedger).toHaveBeenCalledTimes(1);
    });
});
