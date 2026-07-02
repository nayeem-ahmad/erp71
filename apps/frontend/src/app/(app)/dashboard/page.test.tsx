import { render, screen, waitFor } from '@testing-library/react';
import DashboardPage from './page';
import { api } from '@/lib/api';

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

jest.mock('next/image', () => ({
    __esModule: true,
    default: ({ alt, ...props }: { alt: string; [key: string]: unknown }) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={alt} {...props} />
    ),
}));

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
    ChevronRight: () => <span data-testid="icon-chevron-right" />,
    ShoppingCart: () => <span data-testid="icon-shopping-cart" />,
    Truck: () => <span data-testid="icon-truck" />,
    BookOpen: () => <span data-testid="icon-book-open" />,
    Receipt: () => <span data-testid="icon-receipt" />,
    FileText: () => <span data-testid="icon-file-text" />,
    ClipboardList: () => <span data-testid="icon-clipboard-list" />,
    HandCoins: () => <span data-testid="icon-hand-coins" />,
}));

jest.mock('@/lib/api', () => ({
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
            expect(screen.getAllByText('Business Monitor').length).toBeGreaterThan(0);
            expect(screen.getByText('Sales Entry')).toBeInTheDocument();
            expect(screen.getByText('Accounting KPIs')).toBeInTheDocument();
            expect(screen.getByText('Cash Flow Movement')).toBeInTheDocument();
            expect(screen.getByText('Net Profit')).toBeInTheDocument();
            expect(screen.queryByText('Net Profit vs Gross Margin')).not.toBeInTheDocument();
            expect(screen.queryByText('Tax Liability')).not.toBeInTheDocument();
            expect(screen.getAllByText('175.00').length).toBeGreaterThan(0);
            expect(screen.getAllByText('300.00').length).toBeGreaterThan(0);
            expect(screen.getAllByText('125.00').length).toBeGreaterThan(0);
            expect(screen.getByText('90.00')).toBeInTheDocument();
            expect(screen.getByText('20.00')).toBeInTheDocument();
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
            expect(screen.getByText('Net Profit')).toBeInTheDocument();
        });

        expect(screen.getAllByText('Business Monitor').length).toBeGreaterThan(0);
        expect(screen.getByText('Inventory Overview')).toBeInTheDocument();
    });

    it('shows accounting quick links and hides retail panels for accounting-only plans', async () => {
        (api.getMe as jest.Mock).mockResolvedValue({
            tenants: [{
                name: 'Ledger Co',
                subscription: {
                    plan: {
                        code: 'ACCOUNTING',
                        features_json: { accountingOnly: true, premiumAccounting: true },
                    },
                },
            }],
        });
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
            points: [],
            comparison: {
                net_profit: 0,
                gross_margin: null,
                gross_margin_status: 'unavailable',
                gross_margin_reason: 'Sale-time cost basis is not tracked in the current data model.',
            },
        });

        render(<DashboardPage />);

        await waitFor(() => {
            expect(screen.getByText('Voucher Entry')).toBeInTheDocument();
            expect(screen.getByText('Profit & Loss')).toBeInTheDocument();
            expect(screen.getByText('Accounting KPIs')).toBeInTheDocument();
        });

        expect(screen.queryByText('Sales Entry')).not.toBeInTheDocument();
        expect(screen.queryByText('Customer Payment')).not.toBeInTheDocument();
        expect(screen.queryByText('Supplier Payment')).not.toBeInTheDocument();
        expect(screen.queryByText('Total Sales')).not.toBeInTheDocument();
        expect(screen.queryByText('Inventory Overview')).not.toBeInTheDocument();
        expect(api.getProducts).not.toHaveBeenCalled();
        expect(api.getSales).not.toHaveBeenCalled();
    });
});