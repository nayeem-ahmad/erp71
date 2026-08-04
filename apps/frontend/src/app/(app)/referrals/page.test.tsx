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
        useI18n: () => ({ t: enMessages }),
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
};

/**
 * The portal page carried three CLAUDE.md UI-rule violations: money formatted by
 * hand instead of through formatBDT, a page-local toast rather than the global
 * store, and a hand-rolled status pill using font-black/uppercase/tracking-widest.
 * These assert the replacements, so a revert is caught rather than re-reviewed.
 */
describe('RefereePortalPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getRefereePortalLedger.mockResolvedValue(ledger);
    });

    it('formats money through formatBDT rather than a hand-written taka prefix', async () => {
        const { container } = render(<RefereePortalPage />);

        await waitFor(() => expect(getRefereePortalLedger).toHaveBeenCalled());

        // formatBDT renders grouped thousands; the old `৳${n.toFixed(2)}` did not.
        await waitFor(() => expect(container.textContent).toContain('1,234.50'));
        expect(container.textContent).not.toContain('৳1234.50');
    });

    it('renders the commission status through the shared badge, not a bespoke pill', async () => {
        const { container } = render(<RefereePortalPage />);

        await waitFor(() => expect(getRefereePortalLedger).toHaveBeenCalled());
        await waitFor(() => expect(screen.getAllByText('Earned').length).toBeGreaterThan(0));

        // The hand-rolled pill was `font-black uppercase tracking-widest`, all three
        // of which CLAUDE.md bans in app code. Scoped to body cells on purpose: the
        // shared DataTable's own <th> still carries those classes, which is a
        // separate, app-wide violation and not this page's to fix.
        const cells = Array.from(container.querySelectorAll('td'));
        expect(cells.length).toBeGreaterThan(0);
        for (const cell of cells) {
            expect(cell.querySelector('.font-black')).toBeNull();
            expect(cell.querySelector('.tracking-widest')).toBeNull();
        }
    });

    it('does not render a page-local toast banner of its own', async () => {
        const { container } = render(<RefereePortalPage />);

        await waitFor(() => expect(getRefereePortalLedger).toHaveBeenCalled());
        expect(container.querySelector('.bg-emerald-50')).toBeNull();
    });
});
