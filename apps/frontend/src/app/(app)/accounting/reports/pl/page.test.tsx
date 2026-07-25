import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProfitLossPage from './page';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    api: {
        getMe: jest.fn(),
        getProfitLoss: jest.fn(),
    },
}));

const mockStores = [
    { id: 's1', name: 'Branch A' },
    { id: 's2', name: 'Branch B' },
];

describe('ProfitLossPage — report scope', () => {
    beforeEach(() => {
        localStorage.setItem('tenant_id', 'tenant-1');
        localStorage.setItem('store_id', 's1');
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

    it('renders scope bar and loads report with branch scope params', async () => {
        render(<ProfitLossPage />);

        await waitFor(() => {
            expect(screen.getByText('This branch')).toBeInTheDocument();
        });

        await waitFor(() => {
            expect(api.getProfitLoss).toHaveBeenCalledWith(
                expect.objectContaining({
                    scope: expect.any(String),
                    from: expect.any(String),
                    to: expect.any(String),
                }),
            );
        });

        fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

        await waitFor(() => {
            expect(api.getProfitLoss).toHaveBeenCalledTimes(2);
        });
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
        localStorage.setItem('tenant_id', 'tenant-1');
        localStorage.setItem('store_id', 's1');
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