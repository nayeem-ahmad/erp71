import React from 'react';
import { render, screen } from '@testing-library/react';
import SalesDashboard from './SalesDashboard';
import { api } from '@/lib/api';

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');
    const actual = jest.requireActual('@/lib/i18n');
    return {
        useI18n: () => ({ t: enMessages, locale: 'en' }),
        formatMessage: actual.formatMessage,
    };
});

jest.mock('@/lib/api', () => ({
    api: {
        getSalesDashboardOverview: jest.fn(),
        getSalesDashboardTrends: jest.fn(),
    },
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));

const overview = (patch: Record<string, unknown> = {}) => ({
    filters: { from: '2026-07-01', to: '2026-07-31' },
    sales: { gross: 400_000, returns: 12_000, net: 388_000, count: 80, returns_count: 4, avg_ticket: 5_000 },
    margin: { gross_profit: 96_000, margin_pct: 24, costed_items: 120, uncosted_items: 0, units: 310 },
    receivables: { outstanding: 45_000, customers_owing: 9 },
    fulfilment: {
        open_orders: 6,
        overdue_orders: 2,
        pending_deliveries: 3,
        open_quotes: 5,
        expiring_quotes: 1,
    },
    products: [{ id: 'p1', name: 'Rice 5kg', units: 120, revenue: 60_000 }],
    categories: [
        { id: 'g1', name: 'Grains', units: 200, revenue: 90_000 },
        { id: null, name: 'Ungrouped', units: 10, revenue: 10_000 },
    ],
    customers: [{ id: 'c1', name: 'Karim', revenue: 30_000, orders: 6, owed: 1_200 }],
    recent: [{
        id: 's1',
        serial_number: 'SL-0001',
        customer_name: 'Karim',
        total: 5_000,
        due: 1_200,
        sale_date: '2026-07-30T10:00:00.000Z',
    }],
    ...patch,
});

const identity = { greeting: 'Good morning 👋', tenantName: 'Shop Co', renewalEnd: null };

describe('SalesDashboard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getSalesDashboardOverview as jest.Mock).mockResolvedValue(overview());
        (api.getSalesDashboardTrends as jest.Mock).mockResolvedValue({ points: [] });
    });

    it('raises what is owed, late and undelivered for attention', async () => {
        render(<SalesDashboard {...identity} />);

        expect(await screen.findByText('৳ 45,000.00 owed by 9 customers')).toBeInTheDocument();
        expect(screen.getByText('2 orders past their delivery date')).toBeInTheDocument();
        expect(screen.getByText('3 deliveries not yet out')).toBeInTheDocument();
        expect(screen.getByText('1 quotes expiring this week')).toBeInTheDocument();
    });

    it('says nothing is waiting rather than showing an empty strip', async () => {
        (api.getSalesDashboardOverview as jest.Mock).mockResolvedValue(overview({
            receivables: { outstanding: 0, customers_owing: 0 },
            fulfilment: {
                open_orders: 0,
                overdue_orders: 0,
                pending_deliveries: 0,
                open_quotes: 0,
                expiring_quotes: 0,
            },
        }));

        render(<SalesDashboard {...identity} />);

        expect(await screen.findByText('Nothing is waiting on you 🎉')).toBeInTheDocument();
    });

    it('shows returns beside net sales rather than hiding them inside it', async () => {
        render(<SalesDashboard {...identity} />);

        expect(await screen.findByText('Net sales')).toBeInTheDocument();
        expect(screen.getByText('4 returns · ৳ 12,000.00')).toBeInTheDocument();
    });

    it('says how many lines the margin could not cost, rather than averaging over the rest silently', async () => {
        (api.getSalesDashboardOverview as jest.Mock).mockResolvedValue(overview({
            margin: { gross_profit: 40_000, margin_pct: 20, costed_items: 60, uncosted_items: 14, units: 310 },
        }));

        render(<SalesDashboard {...identity} />);

        expect(await screen.findByText('14 lines have no cost recorded')).toBeInTheDocument();
    });

    it('reports no margin at all when nothing carried a cost', async () => {
        (api.getSalesDashboardOverview as jest.Mock).mockResolvedValue(overview({
            margin: { gross_profit: null, margin_pct: null, costed_items: 0, uncosted_items: 40, units: 310 },
        }));

        render(<SalesDashboard {...identity} />);

        expect(await screen.findByText('No cost recorded on any line')).toBeInTheDocument();
    });

    it('shows a dash rather than a fabricated average ticket when nothing sold', async () => {
        (api.getSalesDashboardOverview as jest.Mock).mockResolvedValue(overview({
            sales: { gross: 0, returns: 0, net: 0, count: 0, returns_count: 0, avg_ticket: null },
        }));

        render(<SalesDashboard {...identity} />);

        expect(await screen.findByText('Average ticket')).toBeInTheDocument();
        expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });

    it('flags the unpaid balance on a recent sale', async () => {
        render(<SalesDashboard {...identity} />);

        expect(await screen.findByText('৳ 1,200.00 due')).toBeInTheDocument();
    });

    it('names a walk-in sale in the recent list', async () => {
        (api.getSalesDashboardOverview as jest.Mock).mockResolvedValue(overview({
            recent: [{
                id: 's2',
                serial_number: 'SL-0002',
                customer_name: null,
                total: 300,
                due: 0,
                sale_date: '2026-07-30T10:00:00.000Z',
            }],
        }));

        render(<SalesDashboard {...identity} />);

        expect(await screen.findByText('Walk-in')).toBeInTheDocument();
    });

    it('drops the greeting when embedded under the sales hub header', async () => {
        const { rerender } = render(<SalesDashboard {...identity} />);
        expect(await screen.findByText('Good morning 👋')).toBeInTheDocument();

        rerender(<SalesDashboard {...identity} variant="embedded" />);
        expect(screen.queryByText('Good morning 👋')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Month' })).toBeInTheDocument();
    });

    it('surfaces an error when the overview itself fails', async () => {
        (api.getSalesDashboardOverview as jest.Mock).mockRejectedValue(new Error('Sales are down'));

        render(<SalesDashboard {...identity} />);

        expect(await screen.findByText('Sales are down')).toBeInTheDocument();
    });
});
