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
import SupplierPaymentsPage from './page';
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
        getSupplierCreditPayments: jest.fn(),
        getSuppliers: jest.fn(),
        getSupplierBillingSummary: jest.fn(),
        recordSupplierCreditPayment: jest.fn(),
        updateSupplierCreditPayment: jest.fn(),
        deleteSupplierCreditPayment: jest.fn(),
        allocateSupplierPayment: jest.fn(),
        getPaymentMethods: jest.fn(),
    },
}));

const payment = {
    id: 'pay-1',
    type: 'PAYMENT',
    payment_number: 'SP-00007',
    amount: '250.00',
    notes: 'Advance against beans',
    created_at: '2026-03-20T10:00:00.000Z',
    supplier: { id: 'sup-1', name: 'Fresh Farms', phone: '01710000000' },
    creator: { id: 'user-1', name: 'Test User' },
    unapplied_amount: 0,
    payment_method: 'Nagad',
};

const tenantMethods = [
    { id: 'pm-1', name: 'Cash', type: 'Cash', is_active: true, sort_order: 1 },
    { id: 'pm-2', name: 'Nagad', type: 'Mobile Wallet', account_id: 'acc-nagad', is_active: true, sort_order: 2 },
];

const toastMessages = () => useToastStore.getState().toasts.map((t) => `${t.type}:${t.message}`);

describe('SupplierPaymentsPage — duplicate', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getSupplierCreditPayments as jest.Mock).mockResolvedValue([payment]);
        (api.getSuppliers as jest.Mock).mockResolvedValue([
            { id: 'sup-1', name: 'Fresh Farms', phone: '01710000000', due_balance: 0 },
            { id: 'sup-2', name: 'Bean Bros', phone: '01710000001', due_balance: 0 },
        ]);
        (api.getSupplierBillingSummary as jest.Mock).mockResolvedValue({ open_bills: [] });
        (api.recordSupplierCreditPayment as jest.Mock).mockResolvedValue({ id: 'pay-2' });
        (api.getPaymentMethods as jest.Mock).mockResolvedValue(tenantMethods);
        useToastStore.setState({ toasts: [] });
    });

    const openDuplicate = async () => {
        render(<SupplierPaymentsPage />);
        fireEvent.click(await screen.findByTitle('Duplicate'));
    };

    it('opens the create form prefilled from the payment it copied', async () => {
        await openDuplicate();

        expect(await screen.findByText('Duplicate Payment')).toBeInTheDocument();
        expect(screen.getByText(/Copied from SP-00007/)).toBeInTheDocument();

        expect(screen.getByDisplayValue('Pay to supplier')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Fresh Farms (01710000000)')).toBeInTheDocument();
        expect(screen.getByLabelText(/^Amount/)).toHaveValue(250);
        expect(screen.getByLabelText('Notes')).toHaveValue('Advance against beans');
        await waitFor(() => expect(screen.getByLabelText('Payment method')).toHaveValue('Nagad'));
    });

    it('records a new payment with no bill allocations carried over', async () => {
        await openDuplicate();
        await screen.findByText('Duplicate Payment');

        fireEvent.click(screen.getByRole('button', { name: /record payment/i }));

        await waitFor(() => {
            expect(api.recordSupplierCreditPayment).toHaveBeenCalledWith('sup-1', {
                amount: 250,
                direction: 'pay',
                notes: 'Advance against beans',
                paymentMethod: 'Nagad',
                accountId: 'acc-nagad',
                // The original already settled specific bills; the copy picks
                // its own from a freshly loaded list.
                allocations: undefined,
            });
        });
        expect(api.updateSupplierCreditPayment).not.toHaveBeenCalled();
    });

    it('leaves the plain New Payment form empty', async () => {
        render(<SupplierPaymentsPage />);
        fireEvent.click(await screen.findByRole('button', { name: /new supplier payment/i }));

        expect(await screen.findByLabelText(/^Amount/)).toHaveValue(null);
        expect(screen.queryByText('Duplicate Payment')).not.toBeInTheDocument();
        expect(screen.queryByText(/Copied from/)).not.toBeInTheDocument();
    });
});

describe('SupplierPaymentsPage — payment method', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getSupplierCreditPayments as jest.Mock).mockResolvedValue([payment]);
        (api.getSuppliers as jest.Mock).mockResolvedValue([
            { id: 'sup-1', name: 'Fresh Farms', phone: '01710000000', due_balance: 900 },
        ]);
        (api.getSupplierBillingSummary as jest.Mock).mockResolvedValue({ open_bills: [] });
        (api.recordSupplierCreditPayment as jest.Mock).mockResolvedValue({ id: 'pay-2' });
        (api.updateSupplierCreditPayment as jest.Mock).mockResolvedValue({ id: 'pay-1' });
        (api.getPaymentMethods as jest.Mock).mockResolvedValue(tenantMethods);
        useToastStore.setState({ toasts: [] });
    });

    const openNew = async () => {
        render(<SupplierPaymentsPage />);
        // Wait for the list, so the form opens with the suppliers loaded.
        await screen.findByTitle('Duplicate');
        fireEvent.click(screen.getByRole('button', { name: /new supplier payment/i }));
        await screen.findByLabelText(/^Amount/);
    };

    it('shows the method each payment was recorded with', async () => {
        // The list column is hideOnMobile, and jsdom renders the mobile
        // layout, so read it off the details view instead.
        render(<SupplierPaymentsPage />);
        fireEvent.click(await screen.findByTitle('View'));
        const row = (await screen.findByText('Payment method')).parentElement as HTMLElement;
        expect(row).toHaveTextContent('Nagad');
    });

    it('defaults to Cash and sends the chosen method with its linked account', async () => {
        await openNew();
        await waitFor(() => expect(screen.getByLabelText('Payment method')).toHaveValue('Cash'));

        fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '400' } });
        fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'Nagad' } });
        fireEvent.click(screen.getByRole('button', { name: /record payment/i }));

        await waitFor(() => {
            expect(api.recordSupplierCreditPayment).toHaveBeenCalledWith('sup-1', {
                amount: 400,
                direction: 'pay',
                notes: undefined,
                paymentMethod: 'Nagad',
                accountId: 'acc-nagad',
                allocations: undefined,
            });
        });
        await waitFor(() => expect(toastMessages()).toContain('success:Transaction recorded successfully'));
        expect(screen.queryByText('Transaction recorded successfully')).not.toBeInTheDocument();
    });

    it('shows a missing supplier and amount inline instead of submitting', async () => {
        await openNew();
        fireEvent.change(screen.getByLabelText('Supplier *'), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: /record payment/i }));

        const alerts = await screen.findAllByRole('alert');
        expect(alerts.map((a) => a.textContent)).toEqual(['Select a supplier.', 'Enter a valid amount']);
        expect(api.recordSupplierCreditPayment).not.toHaveBeenCalled();
    });

    it('reports a failed load through the global toast', async () => {
        (api.getSupplierCreditPayments as jest.Mock).mockRejectedValue(new Error('down'));
        render(<SupplierPaymentsPage />);

        await waitFor(() => expect(toastMessages()).toContain('error:Failed to load supplier payments'));
    });

    it('sends a changed method on edit', async () => {
        render(<SupplierPaymentsPage />);
        fireEvent.click(await screen.findByTitle('Edit'));
        await waitFor(() => expect(screen.getByLabelText('Payment method')).toHaveValue('Nagad'));

        fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'Cash' } });
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => {
            expect(api.updateSupplierCreditPayment).toHaveBeenCalledWith('pay-1', {
                amount: 250,
                direction: 'pay',
                notes: 'Advance against beans',
                paymentMethod: 'Cash',
                accountId: undefined,
            });
        });
        expect(toastMessages()).toContain('success:Payment updated successfully');
    });
});
