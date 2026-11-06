import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CashbookPage from './page';
import { api } from '@/lib/api';
import { createdRangeFromPreset } from '@/lib/created-range';
import { mockBranchScope } from '@/test-utils/branch-scope';

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

// A wide screen, so the chips sit in the toolbar rather than the phone's Filters sheet.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getCashbook: jest.fn(),
        getAccountingSettings: jest.fn().mockResolvedValue({
            requireVoucherApproval: false,
            autoApproveSystemVouchers: true,
            reportsApprovedOnly: false,
        }),
    },
}));

const bookRow = (overrides: Record<string, unknown>) => ({
    id: 'row-1',
    voucher_number: 'CR-00001',
    voucher_type: 'cash_receive',
    date: '2026-03-05T00:00:00.000Z',
    description: 'Customer collection',
    reference_number: null,
    account_name: 'Cash in Hand',
    receipts: 500,
    payments: 0,
    running_balance: 600,
    running_balance_side: 'debit',
    ...overrides,
});

const BOOK = {
    filters: { from: '2026-03-01', to: '2026-03-31' },
    accounts: [
        { id: 'cash-1', name: 'Cash in Hand', code: '1010' },
        { id: 'cash-2', name: 'Petty Cash', code: '1020' },
    ],
    opening_balance: 100,
    opening_balance_side: 'debit',
    closing_balance: 480,
    closing_balance_side: 'debit',
    totals: { receipts: 500, payments: 120 },
    rows: [
        bookRow({}),
        bookRow({
            id: 'row-2',
            voucher_number: 'CP-00002',
            voucher_type: 'cash_payment',
            description: 'Shop rent',
            receipts: 0,
            payments: 120,
            running_balance: 480,
        }),
    ],
};

const tile = (label: string) => within(screen.getByRole('region', { name: 'Cashbook summary' }))
    .getByText(label).closest('div') as HTMLElement;

describe('CashbookPage', () => {
    beforeEach(() => {
        mockBranchScope();
        (api.getCashbook as jest.Mock).mockReset().mockResolvedValue(BOOK);
    });

    it('opens on this month for every cash account, and the account chip asks for one', async () => {
        const thisMonth = createdRangeFromPreset('thisMonth');
        render(<CashbookPage />);

        await waitFor(() => expect(api.getCashbook).toHaveBeenCalledWith({
            approvedOnly: false,
            from: thisMonth.from,
            to: thisMonth.to,
            accountId: undefined,
            storeId: 'store-1',
        }));
        await screen.findByText('CR-00001');

        fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'cash-2' } });

        await waitFor(() => expect(api.getCashbook).toHaveBeenLastCalledWith(
            expect.objectContaining({ accountId: 'cash-2' }),
        ));
    });

    it('narrows to payments, and the strip sums only those rows', async () => {
        render(<CashbookPage />);
        await screen.findByText('CP-00002');

        expect(tile('Opening balance')).toHaveTextContent(/৳\s?100.*Debit/);
        expect(tile('Total receipts')).toHaveTextContent(/৳\s?500/);
        expect(tile('Total payments')).toHaveTextContent(/৳\s?120/);

        fireEvent.click(screen.getByRole('button', { name: /^Receipt or payment/ }));
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Payments' }));

        await waitFor(() => expect(screen.queryByText('CR-00001')).not.toBeInTheDocument());
        expect(tile('Total receipts')).toHaveTextContent(/৳\s?0/);
        expect(tile('Total payments')).toHaveTextContent(/৳\s?120/);
        expect(tile('Entries')).toHaveTextContent('1');
        expect(tile('Closing balance')).toHaveTextContent(/৳\s?480/);
        expect(api.getCashbook).toHaveBeenCalledTimes(1);
    });
});
