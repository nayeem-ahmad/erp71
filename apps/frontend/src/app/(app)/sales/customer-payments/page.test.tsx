jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');

    return {
        useI18n: () => ({ t: enMessages, locale: 'en' }),
        formatMessage: (template: string, values: Record<string, unknown> = {}) =>
            Object.entries(values).reduce(
                (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
                template,
            ),
    };
}, { virtual: true });

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CustomerPaymentsPage from './page';
import { api } from '@/lib/api';

jest.mock('next/navigation', () => ({
    useSearchParams: () => ({ get: () => null }),
}));

jest.mock('@/lib/branding', () => ({
    useBranding: () => ({ businessName: 'Demo Store' }),
}));

jest.mock('@/lib/api', () => ({
    // The print-header hook resolves the tenant's print template on mount.
    fetchWithAuth: jest.fn().mockResolvedValue(null),
    api: {
        getCustomerCreditPayments: jest.fn(),
        getCustomers: jest.fn(),
        recordCreditPayment: jest.fn(),
        updateCustomerCreditPayment: jest.fn(),
        deleteCustomerCreditPayment: jest.fn(),
    },
}));

const payment = {
    id: 'pay-1',
    type: 'PAYOUT',
    payment_number: 'CP-00007',
    amount: '250.00',
    notes: 'Refund for damaged goods',
    created_at: '2026-03-20T10:00:00.000Z',
    customer: { id: 'cust-1', name: 'Alice Corp', phone: '01700000001' },
    creator: { id: 'user-1', name: 'Test User' },
};

describe('CustomerPaymentsPage — duplicate', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getCustomerCreditPayments as jest.Mock).mockResolvedValue([payment]);
        (api.getCustomers as jest.Mock).mockResolvedValue([
            { id: 'cust-1', name: 'Alice Corp', phone: '01700000001', due_balance: 0 },
            { id: 'cust-2', name: 'Bob Traders', phone: '01700000002', due_balance: 0 },
        ]);
        (api.recordCreditPayment as jest.Mock).mockResolvedValue({ id: 'pay-2' });
    });

    const openDuplicate = async () => {
        render(<CustomerPaymentsPage />);
        fireEvent.click(await screen.findByTitle('Duplicate'));
    };

    it('opens the create form prefilled from the payment it copied', async () => {
        await openDuplicate();

        expect(await screen.findByText('Duplicate Payment')).toBeInTheDocument();
        expect(screen.getByText(/Copied from CP-00007/)).toBeInTheDocument();

        // Direction, customer, amount and notes all come across.
        expect(screen.getByDisplayValue('Pay to customer')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Alice Corp')).toBeInTheDocument();
        expect(screen.getByLabelText('Amount')).toHaveValue(250);
        expect(screen.getByLabelText('Notes')).toHaveValue('Refund for damaged goods');
    });

    it('records a new payment rather than updating the source', async () => {
        await openDuplicate();
        await screen.findByText('Duplicate Payment');

        fireEvent.click(screen.getByRole('button', { name: /record payout/i }));

        await waitFor(() => {
            expect(api.recordCreditPayment).toHaveBeenCalledWith('cust-1', {
                amount: 250,
                direction: 'pay',
                notes: 'Refund for damaged goods',
            });
        });
        expect(api.updateCustomerCreditPayment).not.toHaveBeenCalled();
    });

    it('leaves the plain New Payment form empty', async () => {
        render(<CustomerPaymentsPage />);
        fireEvent.click(await screen.findByRole('button', { name: /new customer payment/i }));

        // The modal title repeats the header button's label, so pin the copy
        // that only a duplicate renders instead.
        expect(await screen.findByLabelText('Amount')).toHaveValue(null);
        expect(screen.queryByText('Duplicate Payment')).not.toBeInTheDocument();
        expect(screen.queryByText(/Copied from/)).not.toBeInTheDocument();
    });
});

describe('CustomerPaymentsPage — discount', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getCustomerCreditPayments as jest.Mock).mockResolvedValue([]);
        (api.getCustomers as jest.Mock).mockResolvedValue([
            { id: 'cust-1', name: 'Alice Corp', phone: '01700000001', due_balance: 10003 },
        ]);
        (api.recordCreditPayment as jest.Mock).mockResolvedValue({ id: 'pay-2' });
    });

    const openNewPayment = async () => {
        render(<CustomerPaymentsPage />);
        // The form defaults to the first customer, so wait for them to load.
        await screen.findByText('No customer payments in this period');
        fireEvent.click(screen.getByRole('button', { name: /new customer payment/i }));
        await screen.findByLabelText('Amount');
    };

    it('discounts the remainder in one click and sends it with the receipt', async () => {
        await openNewPayment();

        fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10000' } });
        fireEvent.click(screen.getByRole('button', { name: 'Discount the remainder' }));
        expect(screen.getByLabelText('Discount allowed')).toHaveValue(3);

        fireEvent.click(screen.getByRole('button', { name: /record receipt/i }));

        await waitFor(() => {
            expect(api.recordCreditPayment).toHaveBeenCalledWith('cust-1', expect.objectContaining({
                amount: 10000,
                discount: 3,
                direction: 'receive',
            }));
        });
    });

    it('blocks a discount larger than what the payment leaves due', async () => {
        await openNewPayment();

        fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10000' } });
        fireEvent.change(screen.getByLabelText('Discount allowed'), { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: /record receipt/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/still due after this payment/);
        expect(api.recordCreditPayment).not.toHaveBeenCalled();
    });

    it('offers no discount on a payout', async () => {
        await openNewPayment();

        fireEvent.change(screen.getByDisplayValue('Receive from customer'), { target: { value: 'pay' } });

        expect(screen.queryByLabelText('Discount allowed')).not.toBeInTheDocument();
    });
});
