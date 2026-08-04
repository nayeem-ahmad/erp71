import React from 'react';
import { render, screen } from '@testing-library/react';
import AdminDashboard from './AdminDashboard';
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
        getAdminDashboardOverview: jest.fn(),
        getAdminDashboardTrends: jest.fn(),
    },
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));

const overview = (patch: Record<string, unknown> = {}) => ({
    filters: { from: '2026-07-01', to: '2026-07-31' },
    tenants: { total: 128, new_in_period: 9, users: 340, new_users_in_period: 22 },
    subscriptions: {
        active: 90,
        trialing: 14,
        past_due: 5,
        cancelled: 19,
        expiring_trials: 3,
        lapsed: 2,
    },
    revenue: { billed_in_period: 260_000, payments: 74, mrr_ceiling: 310_000 },
    support: { open_threads: 6, awaiting_reply: 2 },
    top_tenants: [{ id: 't1', name: 'Beta Store', plan: 'PREMIUM', revenue: 24_000, payments: 3 }],
    recent_signups: [
        { id: 't9', name: 'New Shop', plan: 'BASIC', status: 'TRIALING', created_at: '2026-07-30T00:00:00.000Z' },
    ],
    plans: [{ id: 'p1', code: 'STANDARD', name: 'Standard', tenants: 48 }],
    ...patch,
});

const identity = { greeting: 'Good morning 👋', tenantName: 'ERP71', renewalEnd: null };

describe('AdminDashboard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getAdminDashboardOverview as jest.Mock).mockResolvedValue(overview());
        (api.getAdminDashboardTrends as jest.Mock).mockResolvedValue({ points: [] });
    });

    it('raises past-due, lapsed and unanswered support for attention', async () => {
        render(<AdminDashboard {...identity} />);

        expect(await screen.findByText('5 subscriptions past due')).toBeInTheDocument();
        expect(screen.getByText('2 subscriptions past their period end')).toBeInTheDocument();
        expect(screen.getByText('2 support threads awaiting your reply')).toBeInTheDocument();
        expect(screen.getByText('3 trials ending this week')).toBeInTheDocument();
    });

    it('says the platform is clean rather than showing an empty strip', async () => {
        (api.getAdminDashboardOverview as jest.Mock).mockResolvedValue(overview({
            subscriptions: {
                active: 90, trialing: 0, past_due: 0, cancelled: 0, expiring_trials: 0, lapsed: 0,
            },
            support: { open_threads: 0, awaiting_reply: 0 },
        }));

        render(<AdminDashboard {...identity} />);

        expect(await screen.findByText('The platform is running clean 🎉')).toBeInTheDocument();
    });

    it('shows tenant count without a period delta, since that would read as growth net of nothing', async () => {
        render(<AdminDashboard {...identity} />);

        expect(await screen.findByText('Live tenants')).toBeInTheDocument();
        expect(screen.getByText('128')).toBeInTheDocument();
        expect(screen.getByText('340 users · 22 new')).toBeInTheDocument();
    });

    it('labels the run rate as a ceiling and says discounts are not applied', async () => {
        render(<AdminDashboard {...identity} />);

        expect(await screen.findByText('Run rate (ceiling)')).toBeInTheDocument();
        expect(screen.getByText('List prices, before discounts')).toBeInTheDocument();
    });

    it('ranks tenants by revenue with their plan alongside', async () => {
        render(<AdminDashboard {...identity} />);

        expect(await screen.findByText('Beta Store')).toBeInTheDocument();
        expect(screen.getByText('PREMIUM · 3 payments')).toBeInTheDocument();
    });

    it('names a tenant with no subscription rather than leaving the row blank', async () => {
        (api.getAdminDashboardOverview as jest.Mock).mockResolvedValue(overview({
            recent_signups: [
                { id: 't9', name: 'Bare Shop', plan: null, status: null, created_at: '2026-07-30T00:00:00.000Z' },
            ],
        }));

        render(<AdminDashboard {...identity} />);

        expect(await screen.findByText('No subscription')).toBeInTheDocument();
    });

    it('drops the greeting when embedded under the admin page header', async () => {
        const { rerender } = render(<AdminDashboard {...identity} />);
        expect(await screen.findByText('Good morning 👋')).toBeInTheDocument();

        rerender(<AdminDashboard {...identity} variant="embedded" />);
        expect(screen.queryByText('Good morning 👋')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Month' })).toBeInTheDocument();
    });

    it('surfaces an error when the overview itself fails', async () => {
        (api.getAdminDashboardOverview as jest.Mock).mockRejectedValue(new Error('Platform is down'));

        render(<AdminDashboard {...identity} />);

        expect(await screen.findByText('Platform is down')).toBeInTheDocument();
    });
});
