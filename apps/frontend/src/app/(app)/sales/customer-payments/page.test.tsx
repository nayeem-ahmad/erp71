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

describe('CustomerPaymentsPage — customer list loading', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getCustomerCreditPayments as jest.Mock).mockResolvedValue([payment]);
    });

    const openNewPayment = async () => {
        render(<CustomerPaymentsPage />);
        fireEvent.click(await screen.findByRole('button', { name: /new customer payment/i }));
    };

    it('says the customers are loading, not that there are none, while they load', async () => {
        // A shop with hundreds of customers takes several requests to load;
        // the form must not claim the list is empty in the meantime.
        (api.getCustomers as jest.Mock).mockReturnValue(new Promise(() => {}));

        await openNewPayment();

        expect(await screen.findByText('Loading customers…')).toBeInTheDocument();
        expect(screen.queryByText('No customers found')).not.toBeInTheDocument();
    });

    it('shows the payments even when the customer list fails to load', async () => {
        (api.getCustomers as jest.Mock).mockRejectedValue(new Error('boom'));

        render(<CustomerPaymentsPage />);

        expect(await screen.findByText('CP-00007')).toBeInTheDocument();
    });

    it('offers a retry when the customer list fails, and recovers', async () => {
        (api.getCustomers as jest.Mock)
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValue([{ id: 'cust-1', name: 'Alice Corp', phone: '01700000001', due_balance: 0 }]);

        await openNewPayment();

        expect(await screen.findByText('Could not load customers')).toBeInTheDocument();
        expect(screen.queryByText('No customers found')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(await screen.findByLabelText('Amount')).toBeInTheDocument();
        expect(screen.queryByText('Could not load customers')).not.toBeInTheDocument();
    });

    it('still says there are no customers when the shop truly has none', async () => {
        (api.getCustomers as jest.Mock).mockResolvedValue([]);

        await openNewPayment();

        expect(await screen.findByText('No customers found')).toBeInTheDocument();
    });
});
