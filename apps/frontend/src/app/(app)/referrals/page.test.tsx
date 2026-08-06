'use client';

import { render, screen, waitFor } from '@testing-library/react';
import RefereePortalPage from './page';

const getRefereePortalLedger = jest.fn();
const toastSuccess = jest.fn();

jest.mock('@/lib/api', () => ({
    api: { getRefereePortalLedger: () => getRefereePortalLedger() },
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: (msg: string) => toastSuccess(msg), error: jest.fn() },
}));

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('../../../lib/localization/messages/en');
    return {
        useI18n: () => ({ t: enMessages, locale: 'en' }),
        formatMessage: (template: string, values: Record<string, string | number>) =>
            Object.entries(values).reduce(
                (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
                template,
            ),
    };
});

jest.mock('lucide-react', () => new Proxy({}, { get: () => () => <span data-testid="icon" /> }));

jest.mock('@/hooks/useMediaQuery', () => ({
    useIsMdUp: () => true,
}));

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => (
        <a href={href}>{children}</a>
    );
});

const activity = [
    '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02',
    '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08',
].map((month, index) => ({
    month,
    clicks: index * 2,
    signups: index % 3 === 0 ? 1 : 0,
    earned_amount: month === '2026-07' ? 1234.5 : 0,
    paid_amount: month === '2026-07' ? 200 : 0,
}));

const ledger = {
    referee: {
        id: 'referee-1',
        name: 'Rahman Traders',
        email: 'rahman@example.com',
        referral_code: 'RAHMA1B2C3',
        deleted_at: null,
    },
    summary: {
        total_referrals: 2,
        pending: 0,
        earned: 1,
        paid: 1,
        reversed: 0,
        total_earned_amount: 1234.5,
        total_reversed_amount: 0,
        total_paid_amount: 200,
        balance_due: 1034.5,
        overpaid_amount: 0,
        clicks: 40,
        conversion_rate: 5,
    },
    commissions: [
        {
            id: 'commission-1',
            referee_id: 'referee-1',
            tenant_id: 'tenant-1',
            tenant: { id: 'tenant-1', name: 'Dhaka Retail' },
            discount_pct: 10,
            commission_pct: 10,
            plan_amount: 3999,
            commission_amount: 399.9,
            status: 'EARNED' as const,
            signed_up_at: '2026-07-01T00:00:00.000Z',
        },
    ],
    payments: [
        {
            id: 'payment-1',
            referee_id: 'referee-1',
            amount: 200,
            method: 'bKash',
            reference: 'TRX1',
            paid_at: '2026-07-05T00:00:00.000Z',
        },
    ],
    activity,
};

/**
 * The dashboard is now a summary-and-charts page: the two tables moved to
 * /referrals/signups and /referrals/payments. These assert the split held and
 * that the UI-rule fixes made when this page was first cleaned up are still in
 * place — money through formatBDT, the shared badge, the global toast store.
 */
describe('RefereePortalPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getRefereePortalLedger.mockResolvedValue(ledger);
    });

    it('keeps the share cards and the summary tiles', async () => {
        render(<RefereePortalPage />);

        await waitFor(() => expect(screen.getByText('RAHMA1B2C3')).toBeInTheDocument());
        expect(screen.getByText('Balance due')).toBeInTheDocument();
    });

    it('formats money through formatBDT rather than a hand-written taka prefix', async () => {
        const { container } = render(<RefereePortalPage />);

        await waitFor(() => expect(container.textContent).toContain('1,234.50'));
        expect(container.textContent).not.toContain('৳1234.50');
    });

    it('renders the three charts', async () => {
        render(<RefereePortalPage />);

        await waitFor(() => expect(screen.getByText('Activity over time')).toBeInTheDocument());
        expect(screen.getByText('Earnings and payouts')).toBeInTheDocument();
        expect(screen.getByText('Referral funnel')).toBeInTheDocument();
    });

    it('no longer renders the signups or payments tables', async () => {
        const { container } = render(<RefereePortalPage />);

        await waitFor(() => expect(screen.getByText('RAHMA1B2C3')).toBeInTheDocument());
        expect(container.querySelector('table')).toBeNull();
        expect(screen.queryByText('Dhaka Retail')).not.toBeInTheDocument();
    });

    it('links to the two list pages so the tables are still reachable', async () => {
        render(<RefereePortalPage />);

        await waitFor(() => expect(screen.getByText('RAHMA1B2C3')).toBeInTheDocument());
        const hrefs = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'));
        expect(hrefs).toContain('/referrals/signups');
        expect(hrefs).toContain('/referrals/payments');
    });

    it('does not render a page-local toast banner of its own', async () => {
        const { container } = render(<RefereePortalPage />);

        await waitFor(() => expect(getRefereePortalLedger).toHaveBeenCalled());
        expect(container.querySelector('.bg-emerald-50')).toBeNull();
    });
});
