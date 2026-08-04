'use client';

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RefereePaymentModal from './RefereePaymentModal';

const recordAdminRefereePayment = jest.fn();

jest.mock('@/lib/api', () => ({
    api: {
        recordAdminRefereePayment: (...args: unknown[]) => recordAdminRefereePayment(...args),
    },
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

// ModalShell/ModalHeader pull in their own icons, so stub the whole module rather
// than naming each one.
jest.mock('lucide-react', () => new Proxy({}, {
    get: () => () => <span data-testid="icon" />,
}));

/**
 * The backend now reconciles a payout against the commissions it clears, so an
 * amount this form invents is a 400 rather than a silent mis-payment. The cases
 * below pin the two ways that contract is honoured: an empty amount means "settle
 * exactly what is owed", and a deliberate part-payment has to say so.
 */
describe('RefereePaymentModal', () => {
    const onClose = jest.fn();
    const onSuccess = jest.fn();

    const renderModal = (defaultAmount?: number) =>
        render(
            <RefereePaymentModal
                open
                refereeId="referee-1"
                defaultAmount={defaultAmount}
                onClose={onClose}
                onSuccess={onSuccess}
            />,
        );

    beforeEach(() => {
        jest.clearAllMocks();
        recordAdminRefereePayment.mockResolvedValue({ id: 'payment-1', amount: 650 });
    });

    it('omits the amount entirely when the field is left blank', async () => {
        renderModal();

        fireEvent.click(screen.getByRole('button', { name: /record payment/i }));

        await waitFor(() => expect(recordAdminRefereePayment).toHaveBeenCalled());
        expect(recordAdminRefereePayment).toHaveBeenCalledWith(
            'referee-1',
            expect.objectContaining({ amount: undefined, allow_partial: undefined }),
        );
    });

    it('sends the prefilled balance when one was supplied', async () => {
        renderModal(650);

        fireEvent.click(screen.getByRole('button', { name: /record payment/i }));

        await waitFor(() => expect(recordAdminRefereePayment).toHaveBeenCalled());
        expect(recordAdminRefereePayment).toHaveBeenCalledWith(
            'referee-1',
            expect.objectContaining({ amount: 650 }),
        );
    });

    it('flags a deliberate part-payment', async () => {
        renderModal(650);

        fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '100' } });
        fireEvent.click(screen.getByLabelText(/this is a part payment/i));
        fireEvent.click(screen.getByRole('button', { name: /record payment/i }));

        await waitFor(() => expect(recordAdminRefereePayment).toHaveBeenCalled());
        expect(recordAdminRefereePayment).toHaveBeenCalledWith(
            'referee-1',
            expect.objectContaining({ amount: 100, allow_partial: true }),
        );
    });

    it('reports the amount the server actually recorded, not the one typed', async () => {
        recordAdminRefereePayment.mockResolvedValue({ id: 'payment-1', amount: 650 });
        renderModal();

        fireEvent.click(screen.getByRole('button', { name: /record payment/i }));

        await waitFor(() => expect(onSuccess).toHaveBeenCalled());
        expect(onSuccess).toHaveBeenCalledWith(expect.stringContaining('650.00'));
    });

    it('surfaces the reconciliation error from the server', async () => {
        recordAdminRefereePayment.mockRejectedValue(
            new Error('Payment of 1 does not match the 650 owed on the selected commission(s).'),
        );
        renderModal(650);

        fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: /record payment/i }));

        expect(await screen.findByText(/does not match the 650 owed/i)).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('still rejects a nonsensical amount before hitting the server', async () => {
        renderModal();

        fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '-5' } });
        fireEvent.click(screen.getByRole('button', { name: /record payment/i }));

        await waitFor(() =>
            expect(screen.getByText(/failed to record payment/i)).toBeInTheDocument(),
        );
        expect(recordAdminRefereePayment).not.toHaveBeenCalled();
    });
});
