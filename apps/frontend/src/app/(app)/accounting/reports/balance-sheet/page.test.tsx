import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BalanceSheetPage from './page';
import { api } from '@/lib/api';
import { printStatementReport } from '@/lib/statement-printer';
import { setWorkspaceItem } from '@/lib/session-store';

jest.mock('@/lib/api', () => ({
    api: {
        getMe: jest.fn(),
        getBalanceSheet: jest.fn(),
        getAccountingSettings: jest.fn().mockResolvedValue({
            requireVoucherApproval: false,
            autoApproveSystemVouchers: true,
            reportsApprovedOnly: false,
        }),
    },
    fetchWithAuth: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/lib/statement-printer', () => ({
    ...jest.requireActual('@/lib/statement-printer'),
    printStatementReport: jest.fn(),
}));

const mockStores = [{ id: 's1', name: 'Branch A' }];

const RESPONSE = {
    as_of: '2026-03-31',
    is_balanced: true,
    assets: {
        groups: [{ group: { id: 'g-ca', name: 'Current Assets', code: '1100' }, rows: [{ id: 'a-cash', name: 'Cash in Hand', code: '1101', balance: 38_000 }], total: 38_000 }],
        total: 38_000,
    },
    liabilities: {
        groups: [{ group: { id: 'g-cl', name: 'Current Liabilities', code: '2100' }, rows: [], total: 10_000 }],
        total: 10_000,
    },
    equity: {
        groups: [{ group: { id: 'g-eq', name: 'Capital', code: '3100' }, rows: [], total: 20_000 }],
        net_profit: 8_000,
        total: 28_000,
    },
    total_liabilities_and_equity: 38_000,
};

describe('BalanceSheetPage — print', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        setWorkspaceItem('tenant_id', 'tenant-1');
        setWorkspaceItem('store_id', 's1');
        (api.getMe as jest.Mock).mockResolvedValue({
            tenants: [{ id: 'tenant-1', role: 'OWNER', stores: mockStores }],
        });
        (api.getBalanceSheet as jest.Mock).mockResolvedValue(RESPONSE);
    });

    it('prints all three statement sections with the as-of date and balanced status', async () => {
        render(<BalanceSheetPage />);
        await screen.findByText('Cash in Hand');

        fireEvent.click(screen.getByRole('button', { name: /print/i }));

        await waitFor(() => expect(printStatementReport).toHaveBeenCalled());

        const [meta, sections, footerRows] = (printStatementReport as jest.Mock).mock.calls[0];
        expect(meta.title).toBe('Balance Sheet');
        expect(meta.periodLabel).toBe('As of');
        expect(meta.periodValue).toBe('2026-03-31');
        expect(meta.statusNote).toBe('Balanced');

        expect(sections.map((s: { label: string; total: number }) => [s.label, s.total])).toEqual([
            ['Assets', 38_000],
            ['Liabilities', 10_000],
            ['Equity', 28_000],
        ]);
        expect(footerRows).toEqual([
            { label: 'Current Period Net Profit', amount: 8_000 },
            { label: 'Total Liabilities + Equity', amount: 38_000, strong: true },
        ]);
    });

    it('carries an out-of-balance warning onto the printed copy', async () => {
        (api.getBalanceSheet as jest.Mock).mockResolvedValue({ ...RESPONSE, is_balanced: false });

        render(<BalanceSheetPage />);
        await screen.findByText('Cash in Hand');

        fireEvent.click(screen.getByRole('button', { name: /print/i }));

        await waitFor(() => expect(printStatementReport).toHaveBeenCalled());
        expect((printStatementReport as jest.Mock).mock.calls[0][0].statusNote).toBe('Not balanced');
    });

    it('drops zero rows from the printed copy when the toolbar hides them', async () => {
        (api.getBalanceSheet as jest.Mock).mockResolvedValue({
            ...RESPONSE,
            assets: {
                groups: [{
                    group: { id: 'g-ca', name: 'Current Assets', code: '1100' },
                    rows: [
                        { id: 'a-cash', name: 'Cash in Hand', code: '1101', balance: 38_000 },
                        { id: 'a-petty', name: 'Petty Cash', code: '1102', balance: 0 },
                    ],
                    total: 38_000,
                }],
                total: 38_000,
            },
        });

        render(<BalanceSheetPage />);
        await screen.findByText('Petty Cash');

        fireEvent.click(screen.getByRole('checkbox', { name: /hide zero/i }));
        fireEvent.click(screen.getByRole('button', { name: /print/i }));

        await waitFor(() => expect(printStatementReport).toHaveBeenCalled());
        const sections = (printStatementReport as jest.Mock).mock.calls[0][1];
        const assetRowNames = sections[0].groups[0].rows.map((row: { name: string }) => row.name);
        expect(assetRowNames).toEqual(['Cash in Hand']);
    });
});
