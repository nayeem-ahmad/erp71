import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProfitLossPage from './page';
import { api } from '@/lib/api';
import { printStatementReport } from '@/lib/statement-printer';
import { setWorkspaceItem } from '@/lib/session-store';
import { mockBranchScope, resetToHeaderSpy } from '@/test-utils/branch-scope';

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('@/lib/api', () => ({
    api: {
        getMe: jest.fn(),
        getProfitLoss: jest.fn(),
        // The approved-only toggle resolves the tenant's setting on mount.
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

const mockStores = [
    { id: 's1', name: 'Branch A' },
    { id: 's2', name: 'Branch B' },
];

describe('ProfitLossPage — report scope', () => {
    beforeEach(() => {
        setWorkspaceItem('tenant_id', 'tenant-1');
        setWorkspaceItem('store_id', 's1');
        mockBranchScope({ branches: mockStores, headerBranchId: 's1', value: 's1', canSeeAll: true });
        (api.getMe as jest.Mock).mockResolvedValue({
            tenants: [{ id: 'tenant-1', role: 'OWNER', stores: mockStores }],
        });
        (api.getProfitLoss as jest.Mock).mockResolvedValue({
            filters: { from: '2026-01-01', to: '2026-06-30' },
            revenue: { groups: [], total: 0 },
            expenses: { groups: [], total: 0 },
            net_profit: 0,
        });
    });

    it('opens on the header branch and asks for that branch', async () => {
        render(<ProfitLossPage />);

        await waitFor(() => {
            expect(api.getProfitLoss).toHaveBeenCalledWith(
                expect.objectContaining({ scope: 'branch', storeId: 's1', from: expect.any(String), to: expect.any(String) }),
            );
        });
        // The old "This branch / All branches" radios are gone: the filter decides.
        expect(screen.queryByRole('radio', { name: 'This branch' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

        await waitFor(() => {
            expect(api.getProfitLoss).toHaveBeenCalledTimes(2);
        });
    });

    it('asks for the company under All branches, and another branch when picked', async () => {
        render(<ProfitLossPage />);
        await waitFor(() => expect(api.getProfitLoss).toHaveBeenCalled());

        fireEvent.change(screen.getByRole('combobox', { name: 'Branch' }), { target: { value: 'all' } });
        await waitFor(() => {
            expect(api.getProfitLoss).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'company' }));
        });
        expect((api.getProfitLoss as jest.Mock).mock.calls.at(-1)[0].storeId).toBeUndefined();

        fireEvent.change(screen.getByRole('combobox', { name: 'Branch' }), { target: { value: 's2' } });
        await waitFor(() => {
            expect(api.getProfitLoss).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'branch', storeId: 's2' }));
        });
    });

    it('compares branches when ticked, overriding the filter', async () => {
        localStorage.clear();
        render(<ProfitLossPage />);
        await waitFor(() => expect(api.getProfitLoss).toHaveBeenCalled());

        fireEvent.click(screen.getByRole('checkbox', { name: 'Compare branches' }));

        await waitFor(() => {
            expect(api.getProfitLoss).toHaveBeenLastCalledWith(
                expect.objectContaining({ scope: 'compare', storeIds: ['s1', 's2'], includeCompanyBucket: false }),
            );
        });
        expect(screen.queryByRole('combobox', { name: 'Branch' })).not.toBeInTheDocument();
        expect(screen.getByText('Company overhead')).toBeInTheDocument();
        expect(localStorage.getItem('report_scope')).toBe('compare');
    });

    it('offers no compare to a member who cannot see the whole company', async () => {
        mockBranchScope({ branches: mockStores, headerBranchId: 's1', value: 's1', canSeeAll: false });
        render(<ProfitLossPage />);
        await waitFor(() => expect(api.getProfitLoss).toHaveBeenCalled());

        expect(screen.queryByRole('checkbox', { name: 'Compare branches' })).not.toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'All branches' })).not.toBeInTheDocument();
    });

    it('goes back to the header branch when the server refuses the chosen one', async () => {
        (api.getProfitLoss as jest.Mock).mockImplementation(async (params: { storeId?: string }) => {
            if (params.storeId === 's2') throw Object.assign(new Error('Forbidden'), { status: 403 });
            return { filters: { from: '2026-01-01', to: '2026-06-30' }, revenue: { groups: [], total: 0 }, expenses: { groups: [], total: 0 }, net_profit: 0 };
        });
        render(<ProfitLossPage />);
        await waitFor(() => expect(api.getProfitLoss).toHaveBeenCalled());

        fireEvent.change(screen.getByRole('combobox', { name: 'Branch' }), { target: { value: 's2' } });

        await waitFor(() => expect(resetToHeaderSpy).toHaveBeenCalled());
        expect(screen.queryByText('Forbidden')).not.toBeInTheDocument();
    });
});

describe('ProfitLossPage — detail level', () => {
    const groupedResponse = (level: string, rows: Array<{ id: string; name: string; balance: number }>) => ({
        level,
        filters: { from: '2026-01-01', to: '2026-06-30' },
        revenue: {
            groups: [{ group: { id: 'g-rev', name: 'Revenue' }, rows, total: 1700 }],
            total: 1700,
        },
        expenses: { groups: [], total: 0 },
        net_profit: 1700,
    });

    beforeEach(() => {
        localStorage.clear();
        setWorkspaceItem('tenant_id', 'tenant-1');
        setWorkspaceItem('store_id', 's1');
        mockBranchScope({ branches: mockStores, headerBranchId: 's1', value: 's1', canSeeAll: true });
        (api.getMe as jest.Mock).mockResolvedValue({
            tenants: [{ id: 'tenant-1', role: 'OWNER', stores: mockStores }],
        });
        (api.getProfitLoss as jest.Mock).mockResolvedValue(
            groupedResponse('account', [
                { id: 'a-sales', name: 'Sales Revenue', balance: 2000 },
                { id: 'a-returns', name: 'Sales Returns', balance: -300 },
            ]),
        );
    });

    it('requests the account level by default', async () => {
        render(<ProfitLossPage />);

        await waitFor(() => {
            expect(api.getProfitLoss).toHaveBeenCalledWith(
                expect.objectContaining({ level: 'account' }),
            );
        });
        expect(await screen.findByText('Sales Returns')).toBeInTheDocument();
    });

    it('reloads at subgroup level and renders the rolled-up rows', async () => {
        render(<ProfitLossPage />);
        await screen.findByText('Sales Returns');

        (api.getProfitLoss as jest.Mock).mockResolvedValue(
            groupedResponse('subgroup', [{ id: 'sg-sales', name: 'Sales', balance: 1700 }]),
        );
        fireEvent.click(screen.getByRole('radio', { name: 'Subgroup' }));

        await waitFor(() => {
            expect(api.getProfitLoss).toHaveBeenCalledWith(
                expect.objectContaining({ level: 'subgroup' }),
            );
        });
        expect(await screen.findByText('Sales')).toBeInTheDocument();
        expect(screen.queryByText('Sales Returns')).not.toBeInTheDocument();
    });

    it('shows group headers only at group level', async () => {
        (api.getProfitLoss as jest.Mock).mockResolvedValue(groupedResponse('group', []));
        localStorage.setItem('report_level', 'group');

        render(<ProfitLossPage />);

        await waitFor(() => {
            expect(api.getProfitLoss).toHaveBeenCalledWith(
                expect.objectContaining({ level: 'group' }),
            );
        });
        // The section label and the group header both read "Revenue" at this level.
        await waitFor(() => expect(screen.getAllByText('Revenue')).toHaveLength(2));
        expect(screen.queryByText('Sales Revenue')).not.toBeInTheDocument();
        expect(screen.queryByText('Sales Returns')).not.toBeInTheDocument();
    });
});
describe('ProfitLossPage — print', () => {
    const response = {
        filters: { from: '2026-01-01', to: '2026-06-30' },
        revenue: {
            groups: [{ group: { id: 'g-rev', name: 'Revenue', code: '4100' }, rows: [{ id: 'a-sales', name: 'Sales Revenue', code: '4101', balance: 2000 }], total: 2000 }],
            total: 2000,
        },
        expenses: { groups: [], total: 300 },
        net_profit: 1700,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        setWorkspaceItem('tenant_id', 'tenant-1');
        setWorkspaceItem('store_id', 's1');
        mockBranchScope({ branches: mockStores, headerBranchId: 's1', value: 's1', canSeeAll: true });
        (api.getMe as jest.Mock).mockResolvedValue({
            tenants: [{ id: 'tenant-1', role: 'OWNER', stores: mockStores }],
        });
        (api.getProfitLoss as jest.Mock).mockResolvedValue(response);
    });

    it('prints the figures on screen, with the period and branch it was run for', async () => {
        mockBranchScope({ branches: mockStores, headerBranchId: 's1', value: 'all', canSeeAll: true });
        render(<ProfitLossPage />);
        await screen.findByText('Sales Revenue');

        fireEvent.click(screen.getByRole('button', { name: /print/i }));

        await waitFor(() => expect(printStatementReport).toHaveBeenCalled());

        const [meta, sections, footerRows] = (printStatementReport as jest.Mock).mock.calls[0];
        expect(meta.title).toBe('Profit & Loss Account');
        expect(meta.periodValue).toBe('2026-01-01 — 2026-06-30');
        // "All branches" prints as the company.
        expect(meta.contextLines).toEqual(['Company', 'Level: Account']);
        // Approval is off for this tenant, so the voucher-set line is omitted.
        expect(meta.contextLines).not.toContain('All vouchers');

        expect(sections.map((s: { totalLabel: string; total: number }) => [s.totalLabel, s.total]))
            .toEqual([['Total Revenue', 2000], ['Total Expenses', 300]]);
        expect(footerRows).toEqual([{ label: 'Net Profit', amount: 1700, strong: true }]);
    });

    it('names the filtered branch on the printed copy', async () => {
        mockBranchScope({ branches: mockStores, headerBranchId: 's1', value: 'all', canSeeAll: true });
        render(<ProfitLossPage />);
        await screen.findByText('Sales Revenue');

        fireEvent.change(screen.getByRole('combobox', { name: 'Branch' }), { target: { value: 's2' } });
        await waitFor(() => {
            expect(api.getProfitLoss).toHaveBeenCalledWith(expect.objectContaining({ scope: 'branch', storeId: 's2' }));
        });
        await screen.findByText('Sales Revenue');

        fireEvent.click(screen.getByRole('button', { name: /print/i }));

        await waitFor(() => expect(printStatementReport).toHaveBeenCalled());
        const [meta] = (printStatementReport as jest.Mock).mock.calls[0];
        expect(meta.contextLines).toContain('Branch: Branch B');
    });

    it('prints a loss as a positive figure under the Net Loss label', async () => {
        (api.getProfitLoss as jest.Mock).mockResolvedValue({ ...response, net_profit: -450 });

        render(<ProfitLossPage />);
        await screen.findByText('Sales Revenue');

        fireEvent.click(screen.getByRole('button', { name: /print/i }));

        await waitFor(() => expect(printStatementReport).toHaveBeenCalled());
        const footerRows = (printStatementReport as jest.Mock).mock.calls[0][2];
        expect(footerRows).toEqual([{ label: 'Net Loss', amount: 450, strong: true }]);
    });

    it('disables print while there is nothing on screen to print', async () => {
        let resolveReport: (value: unknown) => void = () => {};
        (api.getProfitLoss as jest.Mock).mockReturnValue(new Promise((resolve) => { resolveReport = resolve; }));

        render(<ProfitLossPage />);

        await waitFor(() => expect(screen.getByRole('button', { name: /print/i })).toBeDisabled());

        resolveReport(response);
        await screen.findByText('Sales Revenue');
        expect(screen.getByRole('button', { name: /print/i })).toBeEnabled();
    });
});
