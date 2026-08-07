'use client';

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PaymentsPage from './page';

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

// DataTable hides `hideOnMobile` columns (reference, notes) when this reports a
// narrow viewport. The global matchMedia mock always reports non-matching, so
// without this the reference column this suite asserts on never renders.
jest.mock('@/hooks/useMediaQuery', () => ({
    useIsMdUp: () => true,
}));

const base = {
    referee: {
        id: 'referee-1',
        name: 'Rahman Traders',
        email: 'rahman@example.com',
        referral_code: 'RAHMA1B2C3',
        deleted_at: null,
    },
    summary: {
        clicks: 0,
        conversion_rate: null,
        total_referrals: 0,
        pending: 0,
        earned: 0,
        paid: 1,
        reversed: 0,
        total_earned_amount: 200,
        total_reversed_amount: 0,
        total_paid_amount: 200,
        balance_due: 0,
        overpaid_amount: 0,
    },
    activity: [],
    commissions: [],
};

const payment = {
    id: 'payment-1',
    referee_id: 'referee-1',
    amount: 200,
    method: 'bKash',
    reference: 'TRX1',
    notes: 'July payout',
    paid_at: '2026-07-05T00:00:00.000Z',
    commissions: [
        {
            id: 'commission-1',
            referee_id: 'referee-1',
            tenant_id: 'tenant-1',
            tenant: { id: 'tenant-1', name: 'Dhaka Retail' },
            discount_pct: 10,
            commission_pct: 10,
            plan_amount: 2000,
            commission_amount: 200,
            status: 'PAID' as const,
            signed_up_at: '2026-06-01T00:00:00.000Z',
            earned_at: '2026-06-03T00:00:00.000Z',
        },
    ],
};

describe('PaymentsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getRefereePortalLedger.mockResolvedValue({ ...base, payments: [payment] });
    });

    it('lists each payout with its method and reference', async () => {
        render(<PaymentsPage />);

        await waitFor(() => expect(screen.getByText('bKash')).toBeInTheDocument());
        expect(screen.getByText('TRX1')).toBeInTheDocument();
    });

    it('opens a modal showing which commissions the payout settled', async () => {
        render(<PaymentsPage />);

        await waitFor(() => expect(screen.getByText('bKash')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /view/i }));

        await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
        expect(screen.getByText('Dhaka Retail')).toBeInTheDocument();
    });

    it('explains an unlinked payout instead of showing an empty modal', async () => {
        getRefereePortalLedger.mockResolvedValue({
            ...base,
            payments: [{ ...payment, commissions: [] }],
        });
        render(<PaymentsPage />);

        await waitFor(() => expect(screen.getByText('bKash')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /view/i }));

        await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
        expect(screen.getByRole('dialog').textContent).toContain('not linked');
    });
});
