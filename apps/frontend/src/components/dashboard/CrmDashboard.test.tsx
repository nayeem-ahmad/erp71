import React from 'react';
import { render, screen } from '@testing-library/react';
import CrmDashboard from './CrmDashboard';
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
        getCrmDashboardOverview: jest.fn(),
        getCrmDashboardTrends: jest.fn(),
    },
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));

const overview = (patch: Record<string, unknown> = {}) => ({
    filters: { from: '2026-07-01', to: '2026-07-31' },
    pipeline: {
        counts: { NEW: 12, CONTACTED: 8, QUALIFIED: 4, CONVERTED: 6, LOST: 2 },
        open: 24,
        created_in_period: 20,
        converted_in_period: 6,
        lost_in_period: 2,
        conversion_rate_pct: 75,
        avg_days_to_convert: 9.5,
        unassigned: 3,
        stale: 5,
        stale_after_days: 14,
    },
    follow_ups: { due_today: 2, overdue: 4, total_pending: 11, completed_in_period: 18 },
    activity: {
        logged_in_period: 42,
        leads_touched: 17,
        by_type: [{ code: 'CALL', name: 'Phone call', count: 30 }],
    },
    sources: [{ id: 'src-1', name: 'Referral', leads: 9, converted: 3, conversion_rate_pct: 33.3 }],
    owners: [{ user_id: 'u1', name: 'Rahim Uddin', open_leads: 7, converted_in_period: 2, overdue_follow_ups: 1 }],
    campaigns: {
        sent_in_period: 2,
        delivered: 180,
        failed: 0,
        attributed_revenue: 45_000,
        attributed_orders: 7,
        recent: [{
            id: 'c1',
            name: 'Eid promo',
            status: 'COMPLETED',
            channel: 'SMS',
            recipient_count: 200,
            delivered_count: 180,
            failed_count: 0,
        }],
    },
    ...patch,
});

const identity = { greeting: 'Good morning 👋', tenantName: 'Pipeline Co', renewalEnd: null };

describe('CrmDashboard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getCrmDashboardOverview as jest.Mock).mockResolvedValue(overview());
        (api.getCrmDashboardTrends as jest.Mock).mockResolvedValue({ points: [] });
    });

    it('renders the pipeline KPIs once the overview lands', async () => {
        render(<CrmDashboard {...identity} />);

        expect(await screen.findByText('75%')).toBeInTheDocument();
        expect(screen.getByText('New leads')).toBeInTheDocument();
        expect(screen.getByText('6 won · 2 lost')).toBeInTheDocument();
        expect(screen.getByText('17 leads touched')).toBeInTheDocument();
    });

    it('raises overdue follow-ups, stale and unowned leads for attention', async () => {
        render(<CrmDashboard {...identity} />);

        expect(await screen.findByText('4 follow-ups overdue')).toBeInTheDocument();
        expect(screen.getByText('2 follow-ups due today')).toBeInTheDocument();
        expect(screen.getByText('5 leads untouched for 14 days')).toBeInTheDocument();
        expect(screen.getByText('3 leads with no owner')).toBeInTheDocument();
    });

    it('says nothing needs attention rather than showing an empty strip', async () => {
        (api.getCrmDashboardOverview as jest.Mock).mockResolvedValue(overview({
            pipeline: { ...overview().pipeline, unassigned: 0, stale: 0 },
            follow_ups: { due_today: 0, overdue: 0, total_pending: 0, completed_in_period: 0 },
        }));

        render(<CrmDashboard {...identity} />);

        expect(await screen.findByText('Your pipeline is under control 🎉')).toBeInTheDocument();
    });

    it('flags failed campaign sends only when some failed', async () => {
        (api.getCrmDashboardOverview as jest.Mock).mockResolvedValue(overview({
            campaigns: { ...overview().campaigns, failed: 12 },
        }));

        render(<CrmDashboard {...identity} />);

        expect(await screen.findByText('12 campaign messages failed')).toBeInTheDocument();
    });

    it('shows a dash rather than a fabricated rate when nothing closed', async () => {
        (api.getCrmDashboardOverview as jest.Mock).mockResolvedValue(overview({
            pipeline: {
                ...overview().pipeline,
                conversion_rate_pct: null,
                converted_in_period: 0,
                lost_in_period: 0,
            },
        }));

        render(<CrmDashboard {...identity} />);

        expect(await screen.findByText('0 won · 0 lost')).toBeInTheDocument();
        // The rate tile itself reads "—"; the delta rows do too, since there is
        // nothing to compare against either.
        expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });

    it('keeps painting when the comparison window and trends fail', async () => {
        (api.getCrmDashboardOverview as jest.Mock)
            .mockResolvedValueOnce(overview())
            .mockRejectedValueOnce(new Error('nope'));
        (api.getCrmDashboardTrends as jest.Mock).mockRejectedValue(new Error('nope'));

        render(<CrmDashboard {...identity} />);

        expect(await screen.findByText('75%')).toBeInTheDocument();
        expect(screen.queryByText('CRM figures are unavailable right now.')).not.toBeInTheDocument();
    });

    it('surfaces an error when the overview itself fails', async () => {
        (api.getCrmDashboardOverview as jest.Mock).mockRejectedValue(new Error('CRM is down'));

        render(<CrmDashboard {...identity} />);

        expect(await screen.findByText('CRM is down')).toBeInTheDocument();
    });

    it('drops the greeting when embedded under the CRM hub header', async () => {
        const { rerender } = render(<CrmDashboard {...identity} />);
        expect(await screen.findByText('Good morning 👋')).toBeInTheDocument();

        rerender(<CrmDashboard {...identity} variant="embedded" />);
        expect(screen.queryByText('Good morning 👋')).not.toBeInTheDocument();
        // The range switcher survives the move — it is the one control the
        // surrounding page header does not already provide.
        expect(screen.getByRole('button', { name: 'Month' })).toBeInTheDocument();
    });
});
