import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TrialBalancePage from './page';
import { api } from '@/lib/api';
import { printTrialBalanceReport } from '@/lib/statement-printer';
import { setWorkspaceItem } from '@/lib/session-store';
import { mockBrowserPaper } from '@/test-utils/print-paper';
import { mockBranchScope } from '@/test-utils/branch-scope';

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());
jest.mock('@/lib/hooks/useSalePrintPrefs', () => require('@/test-utils/print-paper').salePrintPrefsModuleMock());

// A wide screen, so the chips sit in the toolbar rather than the phone's Filters sheet.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

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

const row = (id: string, name: string, code: string, debitBalance: number, closing = debitBalance, type = 'asset', creditBalance = 0) => ({
    account: { id, name, code, type, group: { name: 'Current Assets', code: '1100' } },
    debit_total: debitBalance + 12_000,
    credit_total: 12_000,
    closing_balance: closing,
    closing_balance_side: 'debit',
    debit_balance: debitBalance,
    credit_balance: creditBalance,
});

const RESPONSE = {
    as_of: '2026-03-31',
    is_balanced: true,
    rows: [row('a-cash', 'Cash in Hand', '1101', 38_000), row('a-petty', 'Petty Cash', '1102', 0, 0)],
    totals: { debit: 38_000, credit: 38_000 },
};

// The statement's own Print in the header — the only Print on the page.
const statementPrint = () => screen.getByRole('button', { name: /print/i });

const tile = (label: string) => within(screen.getByRole('region', { name: 'Trial balance summary' }))
    .getByText(label).closest('div') as HTMLElement;

describe('TrialBalancePage — print', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope({ branches: mockStores, headerBranchId: 's1', value: 's1', hidden: mockStores.length <= 1 });
        localStorage.clear();
        setWorkspaceItem('tenant_id', 'tenant-1');
        setWorkspaceItem('store_id', 's1');
        (api.getMe as jest.Mock).mockResolvedValue({
            tenants: [{ id: 'tenant-1', role: 'OWNER', stores: mockStores }],
        });
        (api.getTrialBalance as jest.Mock).mockResolvedValue(RESPONSE);
    });

    it('prints on the paper chosen in Print settings', async () => {
        mockBrowserPaper('A5');
        render(<TrialBalancePage />);
        await screen.findByText('Cash in Hand');

        fireEvent.click(statementPrint());

        await waitFor(() => expect(printTrialBalanceReport).toHaveBeenCalled());
        expect((printTrialBalanceReport as jest.Mock).mock.calls[0][4]).toBe('A5');
    });

    it('prints on A4 when this browser prints on a till roll', async () => {
        mockBrowserPaper('Thermal80');
        render(<TrialBalancePage />);
        await screen.findByText('Cash in Hand');

        fireEvent.click(statementPrint());

        await waitFor(() => expect(printTrialBalanceReport).toHaveBeenCalled());
        expect((printTrialBalanceReport as jest.Mock).mock.calls[0][4]).toBe('A4');
    });

    it('prints every column, the server totals, and the balanced status', async () => {
        render(<TrialBalancePage />);
        await screen.findByText('Cash in Hand');

        fireEvent.click(statementPrint());

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

        fireEvent.click(statementPrint());

        await waitFor(() => expect(printTrialBalanceReport).toHaveBeenCalled());
        expect((printTrialBalanceReport as jest.Mock).mock.calls[0][0].contextLines)
            .toContain('Approved vouchers only');
    });

    it('prints the rows the table shows, not the ones hide-zero filtered out', async () => {
        render(<TrialBalancePage />);
        await screen.findByText('Petty Cash');

        fireEvent.click(screen.getByRole('button', { name: /hide zero/i }));
        fireEvent.click(statementPrint());

        await waitFor(() => expect(printTrialBalanceReport).toHaveBeenCalled());
        const [, rows, totals] = (printTrialBalanceReport as jest.Mock).mock.calls[0];
        expect(rows.map((r: { name: string }) => r.name)).toEqual(['Cash in Hand']);
        // The footer stays the server's total — hiding a nil row must not change it.
        expect(totals).toEqual({ debit: 38_000, credit: 38_000 });
    });

    it('narrows by account type, and the strip sums only those rows while the difference stays the whole trial\'s', async () => {
        (api.getTrialBalance as jest.Mock).mockResolvedValue({
            ...RESPONSE,
            rows: [
                row('a-cash', 'Cash in Hand', '1101', 38_000),
                row('r-sales', 'Sales Revenue', '4101', 0, -38_000, 'revenue', 38_000),
            ],
        });
        render(<TrialBalancePage />);
        await screen.findByText('Sales Revenue');

        expect(tile('Total debit')).toHaveTextContent(/৳\s?38,000/);
        expect(tile('Total credit')).toHaveTextContent(/৳\s?38,000/);
        expect(tile('Difference')).toHaveTextContent(/৳\s?0.*Balanced/);
        expect(tile('Accounts')).toHaveTextContent('2');

        fireEvent.click(screen.getByRole('button', { name: /^Account type/ }));
        fireEvent.click(await screen.findByRole('checkbox', { name: 'revenue' }));

        await waitFor(() => expect(screen.queryByText('Cash in Hand')).not.toBeInTheDocument());
        expect(tile('Total debit')).toHaveTextContent(/৳\s?0/);
        expect(tile('Total credit')).toHaveTextContent(/৳\s?38,000/);
        expect(tile('Accounts')).toHaveTextContent('1');
        expect(tile('Difference')).toHaveTextContent(/Balanced/);
    });

    it('ties a totals row under the table: server balances, gross over every row, narrowed by a search', async () => {
        render(<TrialBalancePage />);
        await screen.findByText('Petty Cash');

        const footer = () => screen.getByRole('rowheader', { name: 'Totals' }).closest('tr') as HTMLElement;
        const cell = (columnId: string) => footer().querySelector(`[data-column-id="${columnId}"]`) as HTMLElement;
        expect(cell('debit_total')).toHaveTextContent(/৳\s?62,000/);
        expect(cell('credit_total')).toHaveTextContent(/৳\s?24,000/);
        expect(cell('debit_balance')).toHaveTextContent(/৳\s?38,000/);
        expect(cell('credit_balance')).toHaveTextContent(/৳\s?38,000/);
        expect(cell('debit_balance')).toHaveClass('text-end', 'tabular-nums');

        // Hide-zero leaves the totals standing — the rows it drops net out.
        fireEvent.click(screen.getByRole('button', { name: /hide zero/i }));
        await waitFor(() => expect(screen.queryByText('Petty Cash')).not.toBeInTheDocument());
        expect(cell('debit_total')).toHaveTextContent(/৳\s?62,000/);
        expect(cell('credit_balance')).toHaveTextContent(/৳\s?38,000/);

        // A search narrows them to the rows shown, as the printed copy does.
        fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'Cash in' } });
        await waitFor(() => expect(cell('debit_total')).toHaveTextContent(/৳\s?50,000/));
        expect(cell('credit_total')).toHaveTextContent(/৳\s?12,000/);
        expect(cell('credit_balance')).toHaveTextContent(/৳\s?0/);
    });

    it('asks for the day picked on the as-of chip, and falls back to today when it is cleared', async () => {
        render(<TrialBalancePage />);
        await screen.findByText('Cash in Hand');
        const today = new Date().toISOString().slice(0, 10);
        expect(api.getTrialBalance).toHaveBeenLastCalledWith(expect.objectContaining({ asOfDate: today }));

        fireEvent.click(screen.getByRole('button', { name: /^As of/ }));
        fireEvent.click(screen.getByRole('button', { name: 'End of last year' }));
        const lastYearEnd = `${Number(today.slice(0, 4)) - 1}-12-31`;
        await waitFor(() => expect(api.getTrialBalance).toHaveBeenLastCalledWith(expect.objectContaining({ asOfDate: lastYearEnd })));
        expect(screen.getByRole('button', { name: /^As of: 31 Dec \d{4}/ })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Remove filter As of' }));
        await waitFor(() => expect(api.getTrialBalance).toHaveBeenLastCalledWith(expect.objectContaining({ asOfDate: today })));
    });

    it('warns when the trial does not balance', async () => {
        (api.getTrialBalance as jest.Mock).mockResolvedValue({
            ...RESPONSE,
            is_balanced: false,
            totals: { debit: 38_000, credit: 37_500 },
        });
        render(<TrialBalancePage />);
        await screen.findByText('Cash in Hand');

        expect(tile('Difference')).toHaveTextContent(/৳\s?500.*Not balanced/);
    });
});
