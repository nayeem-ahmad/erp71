import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ActivationStatus } from '@/lib/api';
import ActivationPanel from './ActivationPanel';

jest.mock('@/lib/api', () => ({
    api: { submitActivationRequest: jest.fn() },
}));
jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/lib/api') as { api: { submitActivationRequest: jest.Mock } };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { toast } = require('@/lib/toast') as { toast: { success: jest.Mock; error: jest.Mock } };

const baseStatus = (overrides: Partial<ActivationStatus> = {}): ActivationStatus => ({
    pending_activation: true,
    can_submit: true,
    subscription_status: 'PAST_DUE',
    plan: { code: 'STANDARD', name: 'Growth' },
    billing_cycle: 'MONTHLY',
    amount_due: 3599,
    setup_fee: 500,
    currency: 'BDT',
    instructions: {
        methods: ['BKASH'],
        bkash_number: '01711000000',
        nagad_number: null,
        bank_details: null,
        support_phone: '+8801711000000',
        support_whatsapp: null,
        sla_hours: 12,
        extra_instructions: null,
    },
    latest_request: null,
    ...overrides,
});

describe('ActivationPanel', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        api.submitActivationRequest.mockResolvedValue({ status: 'PENDING' });
    });

    it('shows what is owed and where to send it', () => {
        render(<ActivationPanel status={baseStatus()} onSubmitted={jest.fn()} />);

        expect(screen.getByText('Growth')).toBeInTheDocument();
        expect(screen.getByText('01711000000')).toBeInTheDocument();
        // A one-time setup fee has to be called out: it is the difference between
        // the price the customer was quoted and the figure on this screen.
        expect(screen.getByText(/one-time setup fee/i)).toBeInTheDocument();
        // Always a way to reach a human — the point of the screen is that a
        // customer never hits a dead end here.
        expect(screen.getByRole('link', { name: /\+8801711000000/ })).toHaveAttribute(
            'href',
            'tel:+8801711000000',
        );
    });

    it('prefills the amount with what is actually owed', () => {
        render(<ActivationPanel status={baseStatus()} onSubmitted={jest.fn()} />);

        expect(screen.getByLabelText(/amount sent/i)).toHaveValue('3599');
    });

    it('refuses to submit without a transaction ID, inline rather than by alert', async () => {
        render(<ActivationPanel status={baseStatus()} onSubmitted={jest.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: /submit payment details/i }));

        expect(await screen.findByText(/enter the transaction id/i)).toBeInTheDocument();
        expect(api.submitActivationRequest).not.toHaveBeenCalled();
    });

    it('submits the payment and refreshes the panel', async () => {
        const onSubmitted = jest.fn();
        render(<ActivationPanel status={baseStatus()} onSubmitted={onSubmitted} />);

        fireEvent.change(screen.getByLabelText(/transaction id/i), { target: { value: '8n7a2kd9' } });
        fireEvent.change(screen.getByLabelText(/your number/i), { target: { value: '01812345678' } });
        fireEvent.click(screen.getByRole('button', { name: /submit payment details/i }));

        await waitFor(() => expect(api.submitActivationRequest).toHaveBeenCalledWith({
            method: 'BKASH',
            transactionId: '8n7a2kd9',
            senderNumber: '01812345678',
            amount: 3599,
            note: undefined,
        }));
        await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
        expect(toast.success).toHaveBeenCalled();
    });

    it('replaces the form with a waiting message once a payment is queued', () => {
        render(
            <ActivationPanel
                status={baseStatus({
                    latest_request: {
                        id: 'req-1',
                        method: 'BKASH',
                        transaction_id: '8N7A2KD9',
                        sender_number: '01812345678',
                        amount: 3599,
                        note: null,
                        status: 'PENDING',
                        plan_code: 'STANDARD',
                        billing_cycle: 'MONTHLY',
                        review_note: null,
                        reviewed_at: null,
                        created_at: new Date().toISOString(),
                    },
                })}
                onSubmitted={jest.fn()}
            />,
        );

        expect(screen.getByText(/8N7A2KD9/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /submit payment details/i })).not.toBeInTheDocument();
    });

    it('shows the admin reason verbatim after a rejection, and lets them try again', () => {
        render(
            <ActivationPanel
                status={baseStatus({
                    latest_request: {
                        id: 'req-1',
                        method: 'BKASH',
                        transaction_id: '8N7A2KD9',
                        sender_number: null,
                        amount: 3599,
                        note: null,
                        status: 'REJECTED',
                        plan_code: 'STANDARD',
                        billing_cycle: 'MONTHLY',
                        review_note: 'No payment found for that TrxID.',
                        reviewed_at: new Date().toISOString(),
                        created_at: new Date().toISOString(),
                    },
                })}
                onSubmitted={jest.fn()}
            />,
        );

        expect(screen.getByText('No payment found for that TrxID.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /submit payment details/i })).toBeInTheDocument();
    });

    it('explains the wait to a member who cannot pay, instead of showing them a form', () => {
        render(<ActivationPanel status={baseStatus({ can_submit: false })} onSubmitted={jest.fn()} />);

        expect(screen.getByText(/only an owner or a manager/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /submit payment details/i })).not.toBeInTheDocument();
    });

    it('falls back to "contact us" when no payment details are configured', () => {
        render(
            <ActivationPanel
                status={baseStatus({
                    instructions: {
                        ...baseStatus().instructions,
                        methods: [],
                        bkash_number: null,
                    },
                })}
                onSubmitted={jest.fn()}
            />,
        );

        expect(screen.getByText(/not published yet/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /submit payment details/i })).not.toBeInTheDocument();
    });
});
