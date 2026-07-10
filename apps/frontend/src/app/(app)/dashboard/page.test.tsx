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
        getSalesByCategory: jest.fn(),
        getSalesByProduct: jest.fn(),
        getSalesByCustomer: jest.fn(),
    },
}));

const EMPTY_CATEGORY = { summary: { totalRevenue: 0, categoryCount: 0 }, rows: [] };
const EMPTY_PRODUCT_REPORT = { summary: { totalRevenue: 0, totalUnitsSold: 0, productCount: 0 }, rows: [] };
const EMPTY_CUSTOMER_REPORT = { summary: { totalRevenue: 0, totalOrders: 0, customerCount: 0, avgOrderValue: 0 }, rows: [] };

describe('DashboardPage — Business Monitor v2', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        (api.getMe as jest.Mock).mockResolvedValue({
            name: 'Ada',
            tenants: [{ name: 'Northwind Retail' }],
        });
        (api.getProducts as jest.Mock).mockResolvedValue([
            { id: 'product-1', name: 'Coffee Beans', price: 15.5, stock_quantity: 2, reorder_level: 5, stocks: [{ quantity: 2 }] },
        ]);
        (api.getSales as jest.Mock).mockResolvedValue([
            { id: 'sale-1', serial_number: 'S-001', total_amount: 125, amount_paid: 0, status: 'COMPLETED', created_at: '2026-03-21T09:00:00.000Z' },
        ]);
        (api.getSalesByCategory as jest.Mock).mockResolvedValue(EMPTY_CATEGORY);
        (api.getSalesByProduct as jest.Mock).mockResolvedValue(EMPTY_PRODUCT_REPORT);
        (api.getSalesByCustomer as jest.Mock).mockResolvedValue(EMPTY_CUSTOMER_REPORT);
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
    });

    it('renders the v2 dashboard sections', async () => {
        render(<DashboardPage />);
        expect(await screen.findByText('Business health')).toBeInTheDocument();
        expect(await screen.findByText('Needs your attention')).toBeInTheDocument();
        expect(await screen.findByText('Sales by category')).toBeInTheDocument();
        expect(await screen.findByText('Top selling products')).toBeInTheDocument();
        expect(await screen.findByText('Top customers')).toBeInTheDocument();
    });

    it('renders the greeting and range toggle and fetches financial data', async () => {
        render(<DashboardPage />);

        expect(await screen.findByText(/Northwind Retail/)).toBeInTheDocument();
        // Health KPI titles
        expect(await screen.findByText('Net profit')).toBeInTheDocument();
        expect(screen.getAllByText('Sales').length).toBeGreaterThan(0);
        expect(screen.getByText('Cash in hand')).toBeInTheDocument();
        expect(screen.getByText('Receivables due')).toBeInTheDocument();
        // Range toggle labels
        expect(screen.getByText('This week')).toBeInTheDocument();
        expect(screen.getByText('Month')).toBeInTheDocument();

        await waitFor(() => {
            expect(api.getFinancialKpis).toHaveBeenCalled();
            expect(api.getFinancialTrends).toHaveBeenCalled();
            expect(api.getSalesByCategory).toHaveBeenCalled();
            expect(api.getSalesByProduct).toHaveBeenCalled();
            expect(api.getSalesByCustomer).toHaveBeenCalled();
        });
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

        expect(await screen.findByText('No accounting movement')).toBeInTheDocument();
        expect(screen.getByText('Business health')).toBeInTheDocument();
    });

    it('hides retail sections for accounting-only plans', async () => {
        (api.getMe as jest.Mock).mockResolvedValue({
            name: 'Ledger Admin',
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
            expect(screen.getByText('Business health')).toBeInTheDocument();
        });

        expect(screen.queryByText('Sales Entry')).not.toBeInTheDocument();
        expect(screen.queryByText('Needs your attention')).not.toBeInTheDocument();
        expect(screen.queryByText('Sales by category')).not.toBeInTheDocument();
        expect(screen.queryByText('Top selling products')).not.toBeInTheDocument();
        expect(screen.queryByText('Top customers')).not.toBeInTheDocument();
        expect(api.getProducts).not.toHaveBeenCalled();
        expect(api.getSales).not.toHaveBeenCalled();
        expect(api.getSalesByCategory).not.toHaveBeenCalled();
        expect(api.getSalesByProduct).not.toHaveBeenCalled();
        expect(api.getSalesByCustomer).not.toHaveBeenCalled();
    });
});
