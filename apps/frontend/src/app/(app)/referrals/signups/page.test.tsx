'use client';

import { render, screen, waitFor } from '@testing-library/react';
import SignupsPage from './page';

const getRefereePortalLedger = jest.fn();

jest.mock('@/lib/api', () => ({
    api: { getRefereePortalLedger: () => getRefereePortalLedger() },
}));

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('../../../../lib/localization/messages/en');
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

const ledger = {
    referee: {
        id: 'referee-1',
        name: 'Rahman Traders',
        email: 'rahman@example.com',
        referral_code: 'RAHMA1B2C3',
        deleted_at: null,
    },
    summary: {
        clicks: 40,
        conversion_rate: 5,
        total_referrals: 2,
        pending: 1,
        earned: 1,
        paid: 0,
        reversed: 0,
        total_earned_amount: 399.9,
        total_reversed_amount: 0,
        total_paid_amount: 0,
        balance_due: 399.9,
        overpaid_amount: 0,
    },
    activity: [],
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
            earned_at: '2026-07-03T00:00:00.000Z',
        },
        {
            id: 'commission-2',
            referee_id: 'referee-1',
            tenant_id: 'tenant-2',
            tenant: { id: 'tenant-2', name: 'Chittagong Mart' },
            discount_pct: 10,
            commission_pct: 10,
            plan_amount: null,
            commission_amount: null,
            status: 'PENDING' as const,
            signed_up_at: '2026-07-10T00:00:00.000Z',
            earned_at: null,
        },
    ],
    payments: [],
};

describe('SignupsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getRefereePortalLedger.mockResolvedValue(ledger);
    });

    it('lists the referred businesses with their commission detail', async () => {
        render(<SignupsPage />);

        await waitFor(() => expect(screen.getByText('Dhaka Retail')).toBeInTheDocument());
        expect(screen.getByText('Chittagong Mart')).toBeInTheDocument();
    });

    it('formats money through formatBDT rather than a hand-written taka prefix', async () => {
        const { container } = render(<SignupsPage />);

        await waitFor(() => expect(container.textContent).toContain('399.90'));
        expect(container.textContent).not.toContain('৳399.90');
    });

    it('renders an em dash for a pending commission rather than a bare null', async () => {
        const { container } = render(<SignupsPage />);

        await waitFor(() => expect(screen.getByText('Chittagong Mart')).toBeInTheDocument());
        expect(container.textContent).toContain('—');
        expect(container.textContent).not.toContain('null');
    });

    it('carries the commission note that moved off the dashboard', async () => {
        const { container } = render(<SignupsPage />);

        await waitFor(() => expect(screen.getByText('Dhaka Retail')).toBeInTheDocument());
        expect(container.textContent).toContain('Renewals are not commissioned');
    });
});
