'use client';

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PayoutsPage from './page';

const getRefereePortalLedger = jest.fn();
const getRefereePayoutProfile = jest.fn();
const getRefereePayoutRequests = jest.fn();
const updateRefereePayoutProfile = jest.fn();
const createRefereePayoutRequest = jest.fn();

jest.mock('@/lib/api', () => ({
    api: {
        getRefereePortalLedger: () => getRefereePortalLedger(),
        getRefereePayoutProfile: () => getRefereePayoutProfile(),
        getRefereePayoutRequests: () => getRefereePayoutRequests(),
        updateRefereePayoutProfile: (data: unknown) => updateRefereePayoutProfile(data),
        createRefereePayoutRequest: (data: unknown) => createRefereePayoutRequest(data),
        cancelRefereePayoutRequest: jest.fn(),
    },
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
jest.mock('@/hooks/useMediaQuery', () => ({ useIsMdUp: () => true }));

const ledger = (balanceDue: number) => ({
    referee: {
        id: 'referee-1',
        name: 'Rahman Traders',
        email: 'rahman@example.com',
        referral_code: 'RAHMA1B2C3',
        signup_discount: 15,
        deleted_at: null,
    },
    summary: {
        clicks: 10,
        conversion_rate: 10,
        total_referrals: 1,
        pending: 0,
        earned: 1,
        paid: 0,
        reversed: 0,
        total_earned_amount: balanceDue,
        total_reversed_amount: 0,
        total_paid_amount: 0,
        balance_due: balanceDue,
        overpaid_amount: 0,
    },
    activity: [],
    commissions: [],
    payments: [],
});

const profile = (overrides: Record<string, unknown> = {}) => ({
    payout_method: 'BKASH',
    payout_account_name: 'Rahman',
    payout_account_number: '01712345678',
    payout_bank_name: null,
    payout_branch: null,
    payout_updated_at: '2026-09-01T00:00:00.000Z',
    is_complete: true,
    min_payout_amount: 1000,
    ...overrides,
});

describe('RefereePayoutsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getRefereePortalLedger.mockResolvedValue(ledger(5000));
        getRefereePayoutProfile.mockResolvedValue(profile());
        getRefereePayoutRequests.mockResolvedValue([]);
    });

    it('shows the balance and the platform minimum', async () => {
        render(<PayoutsPage />);
        // formatBDT puts a non-breaking space after the symbol; match on the digits.
        await waitFor(() => expect(screen.getByText(/5,000\.00/)).toBeInTheDocument());
        expect(screen.getByText(/Minimum payout:.*1,000\.00/)).toBeInTheDocument();
    });

    /**
     * The server refuses each of these too. Saying so here is only so the partner
     * is told why rather than handed a 400 after filling the form in.
     */
    it('asks for payout details before anything else', async () => {
        getRefereePayoutProfile.mockResolvedValue(
            profile({ is_complete: false, payout_method: null, payout_account_number: null }),
        );
        render(<PayoutsPage />);
        await waitFor(() =>
            expect(
                screen.getByText('Add your payout details before you can request a payout.'),
            ).toBeInTheDocument(),
        );
        expect(screen.queryByRole('button', { name: 'Request payout' })).not.toBeInTheDocument();
    });

    it('blocks a second request while one is in flight', async () => {
        getRefereePayoutRequests.mockResolvedValue([
            { id: 'req-1', status: 'PENDING', amount: 3000, method: 'BKASH', account_number: '01712345678', requested_at: '2026-09-01T00:00:00.000Z', reviewed_at: null, note: null, decision_note: null, account_name: null, bank_name: null, branch: null, referee_id: 'referee-1', payment_id: null },
        ]);
        render(<PayoutsPage />);
        await waitFor(() =>
            expect(screen.getByText(/request in progress/i)).toBeInTheDocument(),
        );
    });

    it('says so when the balance is under the minimum', async () => {
        getRefereePortalLedger.mockResolvedValue(ledger(400));
        render(<PayoutsPage />);
        await waitFor(() =>
            expect(screen.getByText(/balance is below the.*1,000\.00 minimum/)).toBeInTheDocument(),
        );
    });

    /** Blank means "all of it", which is what the button means every time but one. */
    it('sends no amount when the field is left empty', async () => {
        createRefereePayoutRequest.mockResolvedValue({ id: 'req-1' });
        render(<PayoutsPage />);
        await waitFor(() => screen.getByRole('button', { name: 'Request payout' }));

        fireEvent.click(screen.getByRole('button', { name: 'Request payout' }));

        await waitFor(() =>
            expect(createRefereePayoutRequest).toHaveBeenCalledWith({
                amount: undefined,
                note: undefined,
            }),
        );
    });

    describe('payout profile', () => {
        it('hides bank fields for a wallet and shows them for a bank', async () => {
            render(<PayoutsPage />);
            await waitFor(() => screen.getByText('Payout details'));

            expect(screen.queryByText('Bank name')).not.toBeInTheDocument();
            expect(screen.getByText('Wallet number')).toBeInTheDocument();

            fireEvent.change(screen.getByDisplayValue('bKash'), { target: { value: 'BANK' } });

            expect(screen.getByText('Bank name')).toBeInTheDocument();
            expect(screen.getByText('Account number')).toBeInTheDocument();
        });

        /**
         * A wallet number on a bank row is meaningless and vice versa; the server
         * clears the other side, and the form must not send it back.
         */
        it('omits bank fields when saving a wallet', async () => {
            updateRefereePayoutProfile.mockResolvedValue(profile());
            render(<PayoutsPage />);
            await waitFor(() => screen.getByText('Payout details'));

            fireEvent.click(screen.getByRole('button', { name: 'Save payout details' }));

            await waitFor(() =>
                expect(updateRefereePayoutProfile).toHaveBeenCalledWith(
                    expect.objectContaining({
                        payout_method: 'BKASH',
                        payout_bank_name: undefined,
                        payout_branch: undefined,
                    }),
                ),
            );
        });
    });
});
