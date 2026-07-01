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