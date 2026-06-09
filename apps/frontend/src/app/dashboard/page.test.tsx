import { render, screen, waitFor } from '@testing-library/react';
import DashboardPage from './page';
import { api } from '../../lib/api';

jest.mock('lucide-react', () => ({
    Package: () => <span data-testid="icon-package" />,
    TrendingUp: () => <span data-testid="icon-trending-up" />,
    TrendingDown: () => <span data-testid="icon-trending-down" />,
    Clock: () => <span data-testid="icon-clock" />,
    MoreVertical: () => <span data-testid="icon-more-vertical" />,
    Landmark: () => <span data-testid="icon-landmark" />,
    Wallet: () => <span data-testid="icon-wallet" />,
    ReceiptText: () => <span data-testid="icon-receipt-text" />,
    CircleAlert: () => <span data-testid="icon-circle-alert" />,
}));

jest.mock('../../lib/api', () => ({
    api: {
        getMe: jest.fn(),
        getProducts: jest.fn(),
        getSales: jest.fn(),
        getFinancialKpis: jest.fn(),
        getFinancialTrends: jest.fn(),
    },
}));

describe('DashboardPage — Story 34.3', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        (api.getMe as jest.Mock).mockResolvedValue({
            tenants: [{ name: 'Northwind Retail' }],
        });
        (api.getProducts as jest.Mock).mockResolvedValue([
            { id: 'product-1', name: 'Coffee Beans', price: 15.5, stocks: [{ quantity: 12 }] },
        ]);
        (api.getSales as jest.Mock).mockResolvedValue([
            { id: 'sale-1', serial_number: 'S-001', total_amount: 125, created_at: '2026-03-21T09:00:00.000Z' },
        ]);
    });

    it('renders financial KPI tiles from the accounting API', async () => {
        (api.getFinancialKpis as jest.Mock).mockResolvedValue({
            filters: { from: '2026-03-01', to: '2026-03-31' },
            kpis: {
                cash_inflow: 300,
                cash_outflow: 125,
                net_cash_movement: 175,
                gross_revenue: 300,
                operating_expense: 125,
                accounts_receivable: 90,
                accounts_payable: 20,
                tax_liability: 15,
            },
        });
        (api.getFinancialTrends as jest.Mock).mockResolvedValue({
            filters: { from: '2026-03-01', to: '2026-03-31' },
            granularity: 'day',
            has_activity: true,
            points: [
                {
                    date: '2026-03-01',
                    cash_inflow: 0,
                    cash_outflow: 125,
                    net_cash_movement: -125,
                    gross_revenue: 0,
                    operating_expense: 125,
                    net_profit: -125,
                },
                {
                    date: '2026-03-05',
                    cash_inflow: 300,
                    cash_outflow: 0,
                    net_cash_movement: 300,
                    gross_revenue: 300,
                    operating_expense: 0,
                    net_profit: 300,
                },
            ],
            comparison: {
                net_profit: 175,
                gross_margin: null,
                gross_margin_status: 'unavailable',
                gross_margin_reason: 'Sale-time cost basis is not tracked in the current data model.',
            },
        });

        render(<DashboardPage />);

        await waitFor(() => {
            expect(screen.getByText('Accounting KPIs')).toBeInTheDocument();
            expect(screen.getByText('Cash Flow Movement')).toBeInTheDocument();
            expect(screen.getByText('Net Profit vs Gross Margin')).toBeInTheDocument();
            expect(screen.getAllByText('175.00').length).toBeGreaterThan(0);
            expect(screen.getAllByText('300.00').length).toBeGreaterThan(0);
            expect(screen.getAllByText('125.00').length).toBeGreaterThan(0);
            expect(screen.getByText('90.00')).toBeInTheDocument();
            expect(screen.getByText('20.00')).toBeInTheDocument();
            expect(screen.getByText('15.00')).toBeInTheDocument();
            expect(screen.getByText('Unavailable')).toBeInTheDocument();
        });

        expect(screen.getByText('Northwind Retail • Last updated: Today')).toBeInTheDocument();
        expect(screen.getByText('Sale S-001')).toBeInTheDocument();
        expect(api.getFinancialKpis).toHaveBeenCalled();
        expect(api.getFinancialTrends).toHaveBeenCalled();
    });

    it('shows chart empty-state handling without breaking the dashboard', async () => {
        (api.getFinancialKpis as jest.Mock).mockResolvedValue({
            filters: { from: '2026-03-01', to: '2026-03-31' },
            kpis: {
                cash_inflow: 0,
                cash_outflow: 0,
                net_cash_movement: 0,
                gross_revenue: 0,
                operating_expense: 0,
                accounts_receivable: null,
                accounts_payable: null,
                tax_liability: null,
            },
        });
        (api.getFinancialTrends as jest.Mock).mockResolvedValue({
            filters: { from: '2026-03-01', to: '2026-03-31' },
            granularity: 'day',
            has_activity: false,
            points: [
                {
                    date: '2026-03-01',
                    cash_inflow: 0,
                    cash_outflow: 0,
                    net_cash_movement: 0,
                    gross_revenue: 0,
                    operating_expense: 0,
                    net_profit: 0,
                },
            ],
            comparison: {
                net_profit: 0,
                gross_margin: null,
                gross_margin_status: 'unavailable',
                gross_margin_reason: 'Sale-time cost basis is not tracked in the current data model.',
            },
        });

        render(<DashboardPage />);

        await waitFor(() => {
            expect(screen.getByText('No accounting movement')).toBeInTheDocument();
            expect(screen.getByText('Unavailable')).toBeInTheDocument();
        });

        expect(screen.getByText('Dashboard Overview')).toBeInTheDocument();
        expect(screen.getByText('Inventory Overview')).toBeInTheDocument();
    });
});