import React from 'react';
import { render, screen } from '@testing-library/react';
import PurchaseDashboard from './PurchaseDashboard';
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
        getPurchaseDashboardOverview: jest.fn(),
        getPurchaseDashboardTrends: jest.fn(),
    },
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));

const overview = (patch: Record<string, unknown> = {}) => ({
    filters: { from: '2026-07-01', to: '2026-07-31' },
    spend: { total: 240_000, purchases: 12, avg_value: 20_000, returns_value: 6_000, returns_count: 2 },
    payables: { outstanding: 84_500, unpaid_purchases: 5, partial_purchases: 2 },
    orders: { awaiting_receipt: 4, draft: 2, overdue_expected: 1, received_in_period: 9 },
    quotations: { open: 6, expiring: 2, expired: 1 },
    suppliers: [
        { id: 's1', name: 'Alpha Traders', spend: 120_000, purchases: 6, outstanding: 40_000 },
    ],
    products: [{ id: 'p1', name: 'Cooking oil', units: 300, spend: 90_000 }],
    recent: [{
        id: 'pu1',
        purchase_number: 'PUR-0001',
        supplier_name: 'Alpha Traders',
        total: 15_000,
        payment_status: 'PARTIAL',
        created_at: '2026-07-30T10:00:00.000Z',
    }],
    ...patch,
});

const identity = { greeting: 'Good morning 👋', tenantName: 'Buyer Co', renewalEnd: null };

describe('PurchaseDashboard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getPurchaseDashboardOverview as jest.Mock).mockResolvedValue(overview());
        (api.getPurchaseDashboardTrends as jest.Mock).mockResolvedValue({ points: [] });
    });

    it('raises what is owed, late and expiring for attention', async () => {
        render(<PurchaseDashboard {...identity} />);

        expect(await screen.findByText('1 orders past their expected date')).toBeInTheDocument();
        expect(screen.getByText('4 orders awaiting receipt')).toBeInTheDocument();
        expect(screen.getByText('2 quotations expiring this week')).toBeInTheDocument();
        expect(screen.getByText('1 quotations already expired')).toBeInTheDocument();
    });

    it('says nothing is waiting rather than showing an empty strip', async () => {
        (api.getPurchaseDashboardOverview as jest.Mock).mockResolvedValue(overview({
            payables: { outstanding: 0, unpaid_purchases: 0, partial_purchases: 0 },
            orders: { awaiting_receipt: 0, draft: 0, overdue_expected: 0, received_in_period: 0 },
            quotations: { open: 0, expiring: 0, expired: 0 },
        }));

        render(<PurchaseDashboard {...identity} />);

        expect(await screen.findByText('Nothing is waiting on you 🎉')).toBeInTheDocument();
    });

    it('shows returns beside spend rather than netted into it', async () => {
        render(<PurchaseDashboard {...identity} />);

        expect(await screen.findByText('Purchase value')).toBeInTheDocument();
        expect(screen.getByText('2 returns · ৳ 6,000.00')).toBeInTheDocument();
    });

    it('shows a dash rather than a fabricated average when nothing was bought', async () => {
        (api.getPurchaseDashboardOverview as jest.Mock).mockResolvedValue(overview({
            spend: { total: 0, purchases: 0, avg_value: null, returns_value: 0, returns_count: 0 },
        }));

        render(<PurchaseDashboard {...identity} />);

        expect(await screen.findByText('Average bill')).toBeInTheDocument();
        expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });

    it('ranks suppliers by spend and shows what is still owed each', async () => {
        render(<PurchaseDashboard {...identity} />);

        // Named twice — once in the ranking, once in the recent list below it.
        expect(await screen.findAllByText('Alpha Traders')).toHaveLength(2);
        expect(screen.getByText('6 purchases · ৳ 40,000.00 owed')).toBeInTheDocument();
    });

    it('names a supplier-less purchase in the recent list', async () => {
        (api.getPurchaseDashboardOverview as jest.Mock).mockResolvedValue(overview({
            recent: [{
                id: 'pu2',
                purchase_number: 'PUR-0002',
                supplier_name: null,
                total: 500,
                payment_status: 'PAID',
                created_at: '2026-07-30T10:00:00.000Z',
            }],
        }));

        render(<PurchaseDashboard {...identity} />);

        expect(await screen.findByText('No supplier')).toBeInTheDocument();
    });

    it('drops the greeting when embedded under the purchases hub header', async () => {
        const { rerender } = render(<PurchaseDashboard {...identity} />);
        expect(await screen.findByText('Good morning 👋')).toBeInTheDocument();

        rerender(<PurchaseDashboard {...identity} variant="embedded" />);
        expect(screen.queryByText('Good morning 👋')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Month' })).toBeInTheDocument();
    });

    it('surfaces an error when the overview itself fails', async () => {
        (api.getPurchaseDashboardOverview as jest.Mock).mockRejectedValue(new Error('Purchases are down'));

        render(<PurchaseDashboard {...identity} />);

        expect(await screen.findByText('Purchases are down')).toBeInTheDocument();
    });
});
