import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TrialBalancePage from './page';
import { api } from '@/lib/api';
import { printTrialBalanceReport } from '@/lib/statement-printer';
import { setWorkspaceItem } from '@/lib/session-store';

jest.mock('@/lib/api', () => ({
    api: {
        getMe: jest.fn(),
        getTrialBalance: jest.fn(),
        getAccountingSettings: jest.fn().mockResolvedValue({
            requireVoucherApproval: true,
            autoApproveSystemVouchers: true,
            reportsApprovedOnly: true,
        }),
    },
    fetchWithAuth: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/lib/statement-printer', () => ({
    ...jest.requireActual('@/lib/statement-printer'),
    printTrialBalanceReport: jest.fn(),
}));

const mockStores = [{ id: 's1', name: 'Branch A' }];

const row = (id: string, name: string, code: string, debitBalance: number, closing = debitBalance) => ({
    account: { id, name, code, type: 'asset', group: { name: 'Current Assets', code: '1100' } },
    debit_total: debitBalance + 12_000,
    credit_total: 12_000,
    closing_balance: closing,
    closing_balance_side: 'debit',
    debit_balance: debitBalance,
    credit_balance: 0,
});

const RESPONSE = {
    as_of: '2026-03-31',
    is_balanced: true,
    rows: [row('a-cash', 'Cash in Hand', '1101', 38_000), row('a-petty', 'Petty Cash', '1102', 0, 0)],
    totals: { debit: 38_000, credit: 38_000 },
};

describe('TrialBalancePage — print', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        setWorkspaceItem('tenant_id', 'tenant-1');
        setWorkspaceItem('store_id', 's1');
        (api.getMe as jest.Mock).mockResolvedValue({
            tenants: [{ id: 'tenant-1', role: 'OWNER', stores: mockStores }],
        });
        (api.getTrialBalance as jest.Mock).mockResolvedValue(RESPONSE);
    });

    it('prints every column, the server totals, and the balanced status', async () => {
        render(<TrialBalancePage />);
        await screen.findByText('Cash in Hand');

        fireEvent.click(screen.getByRole('button', { name: /print/i }));

        await waitFor(() => expect(printTrialBalanceReport).toHaveBeenCalled());

        const [meta, rows, totals] = (printTrialBalanceReport as jest.Mock).mock.calls[0];
        expect(meta.title).toBe('Trial Balance');
        expect(meta.periodValue).toBe('2026-03-31');
        expect(meta.statusNote).toBe('Balanced');
        expect(totals).toEqual({ debit: 38_000, credit: 38_000 });
        expect(rows[0]).toMatchObject({
            code: '1101',
            name: 'Cash in Hand',
            group: 'Current Assets',
            debitBalance: 38_000,
            creditBalance: 0,
        });
    });

    it('states which voucher set the figures came from when approval is on', async () => {
        render(<TrialBalancePage />);
        await screen.findByText('Cash in Hand');

        fireEvent.click(screen.getByRole('button', { name: /print/i }));

        await waitFor(() => expect(printTrialBalanceReport).toHaveBeenCalled());
        expect((printTrialBalanceReport as jest.Mock).mock.calls[0][0].contextLines)
            .toContain('Approved vouchers only');
    });

    it('prints the rows the table shows, not the ones hide-zero filtered out', async () => {
        render(<TrialBalancePage />);
        await screen.findByText('Petty Cash');

        fireEvent.click(screen.getByRole('checkbox', { name: /hide zero/i }));
        fireEvent.click(screen.getByRole('button', { name: /print/i }));

        await waitFor(() => expect(printTrialBalanceReport).toHaveBeenCalled());
        const [, rows, totals] = (printTrialBalanceReport as jest.Mock).mock.calls[0];
        expect(rows.map((r: { name: string }) => r.name)).toEqual(['Cash in Hand']);
        // The footer stays the server's total — hiding a nil row must not change it.
        expect(totals).toEqual({ debit: 38_000, credit: 38_000 });
    });
});
