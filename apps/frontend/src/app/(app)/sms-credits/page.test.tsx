import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { MessagingCreditSummary } from '@/lib/messaging-credits';
import MessagingCreditsPage from './page';

jest.mock('@/lib/api', () => ({
    api: { getSmsCreditSummary: jest.fn(), submitCreditTopupRequest: jest.fn() },
}));
jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/lib/api') as {
    api: { getSmsCreditSummary: jest.Mock; submitCreditTopupRequest: jest.Mock };
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { toast } = require('@/lib/toast') as { toast: { success: jest.Mock; error: jest.Mock } };

const summary = (overrides: Partial<MessagingCreditSummary> = {}): MessagingCreditSummary => ({
    tenant: { id: 'tenant-1', name: 'Rahim Store' },
    role: 'OWNER',
    can_manage_billing: true,
    sms_enabled: true,
    balances: { SMS: 120, WHATSAPP: 0, EMAIL: 15 },
    low_balance: { SMS: false, WHATSAPP: true, EMAIL: true },
    packages: [
        { id: 'sms-1', channel: 'SMS', name: 'Starter — 500 SMS', credits: 500, price: 250, currency: 'BDT', is_active: true, sort_order: 0 },
        { id: 'wa-1', channel: 'WHATSAPP', name: 'Starter — 500 WhatsApp', credits: 500, price: 500, currency: 'BDT', is_active: true, sort_order: 0 },
    ],
    transactions: [],
    requests: [],
    payment: { method: 'BKASH', account_type: 'personal', bkash_number: '0714111977', instructions: null },
    ...overrides,
});

describe('MessagingCreditsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        api.getSmsCreditSummary.mockResolvedValue(summary());
        api.submitCreditTopupRequest.mockResolvedValue({ id: 'req-1', status: 'PENDING', ticket_number: 1042 });
    });

    it('shows every channel’s balance and flags the empty one', async () => {
        render(<MessagingCreditsPage />);

        expect(await screen.findByText('SMS balance')).toBeInTheDocument();
        expect(screen.getByText('WhatsApp balance')).toBeInTheDocument();
        expect(screen.getByText('Email balance')).toBeInTheDocument();
        expect(screen.getByText(/Out of credits — WhatsApp messages are not being sent/)).toBeInTheDocument();
    });

    it('lists only the selected channel’s packages', async () => {
        render(<MessagingCreditsPage />);

        expect(await screen.findByText('Starter — 500 SMS')).toBeInTheDocument();
        expect(screen.queryByText('Starter — 500 WhatsApp')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', { name: 'WhatsApp' }));

        expect(screen.getByText('Starter — 500 WhatsApp')).toBeInTheDocument();
        expect(screen.queryByText('Starter — 500 SMS')).not.toBeInTheDocument();
    });

    it('asks for a bKash payment to the platform number and submits the TrxID', async () => {
        render(<MessagingCreditsPage />);

        fireEvent.click(await screen.findByRole('button', { name: 'Buy with bKash' }));
        const dialog = await screen.findByRole('dialog');

        expect(within(dialog).getByText('0714111977')).toBeInTheDocument();
        expect(within(dialog).getByText(/Send Money/)).toBeInTheDocument();

        fireEvent.change(within(dialog).getByLabelText(/bKash TrxID/), { target: { value: ' 9a7b3c2d1e ' } });
        fireEvent.change(within(dialog).getByLabelText(/Paid from/), { target: { value: '01711111111' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Submit payment' }));

        await waitFor(() =>
            expect(api.submitCreditTopupRequest).toHaveBeenCalledWith({
                packageId: 'sms-1',
                transactionId: '9a7b3c2d1e',
                senderNumber: '01711111111',
                note: undefined,
            }),
        );
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('#1042')));
    });

    it('does not submit without a plausible TrxID and sender number', async () => {
        render(<MessagingCreditsPage />);

        fireEvent.click(await screen.findByRole('button', { name: 'Buy with bKash' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Submit payment' }));

        expect(await within(dialog).findByText(/TrxID exactly as it appears/)).toBeInTheDocument();
        expect(within(dialog).getByText(/the bKash number you paid from/)).toBeInTheDocument();
        expect(api.submitCreditTopupRequest).not.toHaveBeenCalled();
    });

    it('keeps the buy buttons from members who cannot manage billing', async () => {
        api.getSmsCreditSummary.mockResolvedValue(summary({ can_manage_billing: false, role: 'CASHIER' }));
        render(<MessagingCreditsPage />);

        expect(await screen.findByText(/Only owners and managers can buy messaging credits/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Buy with bKash' })).not.toBeInTheDocument();
    });

    it('shows why a top-up was rejected', async () => {
        api.getSmsCreditSummary.mockResolvedValue(
            summary({
                requests: [
                    {
                        id: 'req-9',
                        channel: 'SMS',
                        package_id: 'sms-1',
                        package_name: 'Starter — 500 SMS',
                        credits: 500,
                        amount: 250,
                        currency: 'BDT',
                        method: 'BKASH',
                        transaction_id: 'ZZZ999999',
                        sender_number: '01711111111',
                        note: null,
                        status: 'REJECTED',
                        ticket_number: 77,
                        review_note: 'No such TrxID in bKash',
                        reviewed_at: '2026-10-15T10:00:00Z',
                        credits_granted: null,
                        amount_received: null,
                        created_at: '2026-10-15T09:00:00Z',
                    },
                ],
            }),
        );
        render(<MessagingCreditsPage />);

        expect(await screen.findByText('Reason: No such TrxID in bKash')).toBeInTheDocument();
        expect(screen.getByText(/Ticket #77/)).toBeInTheDocument();
    });
});
