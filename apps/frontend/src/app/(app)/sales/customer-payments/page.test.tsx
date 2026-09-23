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
import { useToastStore } from '@/lib/toast';

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
        getPaymentMethods: jest.fn(),
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
    payment_method: 'bKash',
};

const tenantMethods = [
    { id: 'pm-2', name: 'bKash', type: 'Mobile Wallet', account_id: 'acc-bkash', is_active: true, sort_order: 2 },
    { id: 'pm-1', name: 'Cash', type: 'Cash', is_active: true, sort_order: 1 },
    { id: 'pm-3', name: 'Old Card', type: 'Card', is_active: false, sort_order: 3 },
];

const toastMessages = () => useToastStore.getState().toasts.map((t) => `${t.type}:${t.message}`);

describe('CustomerPaymentsPage — duplicate', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getCustomerCreditPayments as jest.Mock).mockResolvedValue([payment]);
        (api.getCustomers as jest.Mock).mockResolvedValue([
            { id: 'cust-1', name: 'Alice Corp', phone: '01700000001', due_balance: 0 },
            { id: 'cust-2', name: 'Bob Traders', phone: '01700000002', due_balance: 0 },
        ]);
        (api.recordCreditPayment as jest.Mock).mockResolvedValue({ id: 'pay-2' });
        (api.getPaymentMethods as jest.Mock).mockResolvedValue(tenantMethods);
        useToastStore.setState({ toasts: [] });
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
        expect(screen.getByDisplayValue('Alice Corp (01700000001)')).toBeInTheDocument();
        expect(screen.getByLabelText(/^Amount/)).toHaveValue(250);
        expect(screen.getByLabelText('Notes')).toHaveValue('Refund for damaged goods');
        // How the money moved comes across too.
        await waitFor(() => expect(screen.getByLabelText('Payment method')).toHaveValue('bKash'));
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
                paymentMethod: 'bKash',
                accountId: 'acc-bkash',
            });
        });
        expect(api.updateCustomerCreditPayment).not.toHaveBeenCalled();
    });

    it('leaves the plain New Payment form empty', async () => {
        render(<CustomerPaymentsPage />);
        fireEvent.click(await screen.findByRole('button', { name: /new customer payment/i }));

        // The modal title repeats the header button's label, so pin the copy
        // that only a duplicate renders instead.
        expect(await screen.findByLabelText(/^Amount/)).toHaveValue(null);
        expect(screen.queryByText('Duplicate Payment')).not.toBeInTheDocument();
        expect(screen.queryByText(/Copied from/)).not.toBeInTheDocument();
    });
});

describe('CustomerPaymentsPage — payment method', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getCustomerCreditPayments as jest.Mock).mockResolvedValue([payment]);
        (api.getCustomers as jest.Mock).mockResolvedValue([
            { id: 'cust-1', name: 'Alice Corp', phone: '01700000001', due_balance: 500 },
        ]);
        (api.recordCreditPayment as jest.Mock).mockResolvedValue({ id: 'pay-2' });
        (api.updateCustomerCreditPayment as jest.Mock).mockResolvedValue({ id: 'pay-1' });
        (api.getPaymentMethods as jest.Mock).mockResolvedValue(tenantMethods);
        useToastStore.setState({ toasts: [] });
    });

    const openNew = async () => {
        render(<CustomerPaymentsPage />);
        // Wait for the list, so the form opens with the customers loaded.
        await screen.findByTitle('Duplicate');
        fireEvent.click(screen.getByRole('button', { name: /new customer payment/i }));
        await screen.findByLabelText(/^Amount/);
    };

    it('shows the method each payment was recorded with', async () => {
        // The list column is hideOnMobile, and jsdom renders the mobile
        // layout, so read it off the details view instead.
        render(<CustomerPaymentsPage />);
        fireEvent.click(await screen.findByTitle('View'));
        const row = (await screen.findByText('Payment method')).parentElement as HTMLElement;
        expect(row).toHaveTextContent('bKash');
    });

    it('defaults the picker to Cash and offers only active methods', async () => {
        await openNew();

        const picker = screen.getByLabelText('Payment method');
        await waitFor(() => expect(picker).toHaveValue('Cash'));
        const offered = Array.from((picker as HTMLSelectElement).options).map((o) => o.value);
        expect(offered).toEqual(['Cash', 'bKash']);
    });

    it('sends the chosen method with its linked account, then confirms through the global toast', async () => {
        await openNew();
        await waitFor(() => expect(screen.getByLabelText('Payment method')).toHaveValue('Cash'));

        fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '300' } });
        fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'bKash' } });
        fireEvent.click(screen.getByRole('button', { name: /record receipt/i }));

        await waitFor(() => {
            expect(api.recordCreditPayment).toHaveBeenCalledWith('cust-1', {
                amount: 300,
                direction: 'receive',
                notes: undefined,
                paymentMethod: 'bKash',
                accountId: 'acc-bkash',
            });
        });
        await waitFor(() => expect(toastMessages()).toContain('success:Transaction recorded successfully'));
        // No page-local banner: the message lives only in the global store.
        expect(screen.queryByText('Transaction recorded successfully')).not.toBeInTheDocument();
    });

    it('sends Cash when the picker is left alone', async () => {
        await openNew();
        fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '120' } });
        fireEvent.click(screen.getByRole('button', { name: /record receipt/i }));

        await waitFor(() => {
            expect(api.recordCreditPayment).toHaveBeenCalledWith('cust-1', expect.objectContaining({
                paymentMethod: 'Cash',
                accountId: undefined,
            }));
        });
    });

    it('shows an invalid amount inline instead of submitting', async () => {
        await openNew();
        fireEvent.click(screen.getByRole('button', { name: /record receipt/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid amount');
        expect(api.recordCreditPayment).not.toHaveBeenCalled();
        expect(toastMessages()).toEqual([]);
    });

    it('reports a failed save through the global toast', async () => {
        (api.recordCreditPayment as jest.Mock).mockRejectedValue(new Error('Server said no'));
        await openNew();
        fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '50' } });
        fireEvent.click(screen.getByRole('button', { name: /record receipt/i }));

        await waitFor(() => expect(toastMessages()).toContain('error:Server said no'));
    });

    it('edits keep the recorded method unless it is changed', async () => {
        render(<CustomerPaymentsPage />);
        fireEvent.click(await screen.findByTitle('Edit'));
        await waitFor(() => expect(screen.getByLabelText('Payment method')).toHaveValue('bKash'));

        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
        await waitFor(() => expect(api.updateCustomerCreditPayment).toHaveBeenCalled());
        expect((api.updateCustomerCreditPayment as jest.Mock).mock.calls[0][1]).not.toHaveProperty('paymentMethod');

        fireEvent.click(await screen.findByTitle('Edit'));
        await waitFor(() => expect(screen.getByLabelText('Payment method')).toHaveValue('bKash'));
        fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'Cash' } });
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => {
            expect(api.updateCustomerCreditPayment).toHaveBeenLastCalledWith('pay-1', expect.objectContaining({
                paymentMethod: 'Cash',
            }));
        });
        expect(toastMessages()).toContain('success:Payment updated successfully');
    });
});
