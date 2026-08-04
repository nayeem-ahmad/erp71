import React from 'react';
import { render, screen } from '@testing-library/react';
import InventoryDashboard from './InventoryDashboard';
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
        getInventoryDashboardOverview: jest.fn(),
        getInventoryDashboardTrends: jest.fn(),
    },
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));

const overview = (patch: Record<string, unknown> = {}) => ({
    filters: { from: '2026-07-01', to: '2026-07-31' },
    stock: {
        total_value: 125_000,
        total_units: 640,
        active_skus: 82,
        out_of_stock: 3,
        below_reorder: 7,
        negative_stock: 1,
        unconfigured_policy: 0,
    },
    movement: { in_units: 300, out_units: 180, movements_logged: 44, products_touched: 21 },
    shrinkage: { events: 2, units: 9, value: 1_200 },
    stock_takes: { open: 1, posted_in_period: 4 },
    transfers: { in_transit_units: 25 },
    aging: [
        { key: 'days_0_30', units: 400, value: 80_000 },
        { key: 'days_31_60', units: 140, value: 30_000 },
        { key: 'days_61_90', units: 60, value: 10_000 },
        { key: 'days_91_180', units: 30, value: 4_000 },
        { key: 'days_180_plus', units: 10, value: 1_000 },
    ],
    low_stock: [
        { id: 'p1', name: 'Rice 5kg', sku: 'RICE-5', on_hand: 0, reorder_level: 10, shortfall: 10 },
    ],
    top_value: [{ id: 'p2', name: 'Cooking oil', sku: 'OIL-1', units: 100, value: 40_000 }],
    categories: [{ id: 'g1', name: 'Groceries', units: 500, value: 100_000 }],
    can_value: true,
    ...patch,
});

const identity = { greeting: 'Good morning 👋', tenantName: 'Shelf Co', renewalEnd: null };

describe('InventoryDashboard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getInventoryDashboardOverview as jest.Mock).mockResolvedValue(overview());
        (api.getInventoryDashboardTrends as jest.Mock).mockResolvedValue({ points: [] });
    });

    it('leads with what is out of stock, below reorder and negative', async () => {
        render(<InventoryDashboard {...identity} />);

        expect(await screen.findByText('3 products out of stock')).toBeInTheDocument();
        expect(screen.getByText('7 products below reorder level')).toBeInTheDocument();
        expect(screen.getByText('1 products at negative stock')).toBeInTheDocument();
        expect(screen.getByText('25 units in transit')).toBeInTheDocument();
    });

    it('says the shelves are in order rather than showing an empty strip', async () => {
        (api.getInventoryDashboardOverview as jest.Mock).mockResolvedValue(overview({
            stock: {
                total_value: 0,
                total_units: 0,
                active_skus: 0,
                out_of_stock: 0,
                below_reorder: 0,
                negative_stock: 0,
                unconfigured_policy: 0,
            },
            stock_takes: { open: 0, posted_in_period: 0 },
            transfers: { in_transit_units: 0 },
        }));

        render(<InventoryDashboard {...identity} />);

        expect(await screen.findByText('Your shelves are in order 🎉')).toBeInTheDocument();
    });

    it('shows stock value with the units and SKUs behind it', async () => {
        render(<InventoryDashboard {...identity} />);

        expect(await screen.findByText('Stock value')).toBeInTheDocument();
        expect(screen.getByText('640 units · 82 SKUs')).toBeInTheDocument();
        expect(screen.getByText('44 movements logged')).toBeInTheDocument();
    });

    it('hides the valuation panels and says why when the plan has no inventory reports', async () => {
        (api.getInventoryDashboardOverview as jest.Mock).mockResolvedValue(overview({
            stock: { ...overview().stock, total_value: null },
            aging: null,
            top_value: [],
            categories: [],
            can_value: false,
        }));

        render(<InventoryDashboard {...identity} />);

        expect(await screen.findByText('Upgrade for stock valuation')).toBeInTheDocument();
        expect(screen.queryByText('How long stock has been sitting')).not.toBeInTheDocument();
        expect(screen.queryByText('Where the money is sitting')).not.toBeInTheDocument();
        // The half every plan gets is still on the page.
        expect(screen.getByText('Reorder first')).toBeInTheDocument();
        expect(screen.getByText('Rice 5kg')).toBeInTheDocument();
    });

    it('reads shrinkage as a bad thing going up', async () => {
        (api.getInventoryDashboardOverview as jest.Mock)
            .mockResolvedValueOnce(overview())
            .mockResolvedValueOnce(overview({ shrinkage: { events: 1, units: 4, value: 600 } }));

        render(<InventoryDashboard {...identity} />);

        // Doubled shrinkage: an upward arrow, styled as the loss it is.
        const delta = await screen.findByText('▲ 100%');
        expect(delta).toHaveClass('text-danger-text');
    });

    it('ages stock into ordinal buckets with a share of the total', async () => {
        render(<InventoryDashboard {...identity} />);

        expect(await screen.findByText('How long stock has been sitting')).toBeInTheDocument();
        expect(screen.getByText('0-30 days')).toBeInTheDocument();
        expect(screen.getByText('Over 180 days')).toBeInTheDocument();
        expect(screen.getByText('400 · 63%')).toBeInTheDocument();
    });

    it('drops the greeting when embedded under the inventory hub header', async () => {
        const { rerender } = render(<InventoryDashboard {...identity} />);
        expect(await screen.findByText('Good morning 👋')).toBeInTheDocument();

        rerender(<InventoryDashboard {...identity} variant="embedded" />);
        expect(screen.queryByText('Good morning 👋')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Month' })).toBeInTheDocument();
    });

    it('surfaces an error when the overview itself fails', async () => {
        (api.getInventoryDashboardOverview as jest.Mock).mockRejectedValue(new Error('Inventory is down'));

        render(<InventoryDashboard {...identity} />);

        expect(await screen.findByText('Inventory is down')).toBeInTheDocument();
    });
});
