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
};

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
        expect(screen.getByLabelText('Amount')).toHaveValue(250);
        expect(screen.getByLabelText('Notes')).toHaveValue('Advance against beans');
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

        expect(await screen.findByLabelText('Amount')).toHaveValue(null);
        expect(screen.queryByText('Duplicate Payment')).not.toBeInTheDocument();
        expect(screen.queryByText(/Copied from/)).not.toBeInTheDocument();
    });
});
