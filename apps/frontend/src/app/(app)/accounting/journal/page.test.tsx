import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AccountingJournalPage from './page';
import { api } from '@/lib/api';
import { mockBranchScope } from '@/test-utils/branch-scope';

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

// A wide screen, so the chips sit in the toolbar rather than the phone's Filters sheet.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getVouchers: jest.fn(),
        getVouchersSummary: jest.fn(),
    },
}));

const getVouchers = api.getVouchers as jest.Mock;
const getVouchersSummary = api.getVouchersSummary as jest.Mock;

const openChip = (label: string) =>
    fireEvent.click(
        screen.getAllByRole('button', { name: new RegExp(`^${label}`) })
            .find((button) => button.getAttribute('aria-haspopup') === 'dialog')!,
    );

describe('AccountingJournalPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        getVouchers.mockResolvedValue({
            data: [
                {
                    id: 'voucher-1',
                    voucher_number: 'CP-00001',
                    voucher_type: 'cash_payment',
                    description: 'Office expense',
                    date: '2026-03-21T00:00:00.000Z',
                    total_amount: 125,
                },
            ],
            meta: { page: 1, limit: 30, total: 2, totalPages: 1 },
        });
        getVouchersSummary.mockResolvedValue({
            count: 2, totalAmount: 900, pending: 0, approved: 2, rejected: 0, systemCount: 1, manualCount: 1,
        });
    });

    it('lists the branch\'s vouchers newest first, each opening the voucher', async () => {
        render(<AccountingJournalPage />);

        const link = await screen.findByRole('link', { name: 'CP-00001' });
        expect(link).toHaveAttribute('href', '/accounting/vouchers/voucher-1');
        expect(screen.getByText('Office expense')).toBeInTheDocument();
        expect(screen.getByText('Cash Payment')).toBeInTheDocument();
        expect(getVouchers).toHaveBeenCalledWith(
            expect.objectContaining({ storeId: 'store-1', page: 1, sortBy: 'date', sortDir: 'desc' }),
        );
    });

    it('sums every matching voucher in the strip', async () => {
        render(<AccountingJournalPage />);

        const strip = await screen.findByRole('region', { name: 'Journal figures' });
        await waitFor(() => expect(within(strip).getByText('৳ 900')).toBeInTheDocument());
    });

    it('narrows by voucher type through the Type chip', async () => {
        render(<AccountingJournalPage />);
        await screen.findByText('CP-00001');

        openChip('Type');
        fireEvent.click(screen.getByRole('checkbox', { name: 'Cash Payment' }));

        await waitFor(() =>
            expect(getVouchers).toHaveBeenLastCalledWith(expect.objectContaining({ voucherType: 'cash_payment', page: 1 })),
        );
        expect(getVouchersSummary).toHaveBeenLastCalledWith(expect.objectContaining({ voucherType: 'cash_payment' }));
    });
});
