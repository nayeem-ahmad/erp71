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
import { api, ApiError } from '@/lib/api';

jest.mock('next/navigation', () => ({
    useSearchParams: () => ({ get: () => null }),
}));

jest.mock('@/lib/branding', () => ({
    useBranding: () => ({ businessName: 'Demo Store' }),
}));

jest.mock('@/lib/api', () => ({
    ApiError: class ApiError extends Error {
        constructor(message: string, public readonly status: number, public readonly code?: string) {
            super(message);
            this.name = 'ApiError';
        }
    },
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
        getNextSupplierPaymentNumber: jest.fn().mockResolvedValue({ payment_number: 'SPY-00012' }),
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
        expect(screen.getByPlaceholderText('Fresh Farms')).toBeInTheDocument();
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

describe('SupplierPaymentsPage — discount', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getSupplierCreditPayments as jest.Mock).mockResolvedValue([]);
        (api.getSuppliers as jest.Mock).mockResolvedValue([
            { id: 'sup-1', name: 'Fresh Farms', phone: '01710000000', due_balance: 5000 },
        ]);
        (api.getSupplierBillingSummary as jest.Mock).mockResolvedValue({
            open_bills: [
                { id: 'pur-1', purchase_number: 'PUR-00001', total_amount: 5000, paid_amount: 0, balance_due: 5000, payment_status: 'UNPAID' },
            ],
        });
        (api.recordSupplierCreditPayment as jest.Mock).mockResolvedValue({ id: 'pay-2' });
    });

    it('lets money plus discount settle a whole bill', async () => {
        render(<SupplierPaymentsPage />);
        // The form defaults to the first supplier, so wait for them to load.
        await screen.findByText('No supplier payments in this period');
        fireEvent.click(screen.getByRole('button', { name: /new supplier payment/i }));

        fireEvent.change(await screen.findByLabelText('Amount'), { target: { value: '4998' } });
        fireEvent.click(screen.getByRole('button', { name: 'Discount the remainder' }));
        expect(screen.getByLabelText('Discount received')).toHaveValue(2);

        const billInput = (await screen.findAllByPlaceholderText('0.00')).find((el) => el.id !== 'supplier-payment-discount')!;
        fireEvent.change(billInput, { target: { value: '5000' } });
        fireEvent.click(screen.getByRole('button', { name: /record payment/i }));

        await waitFor(() => {
            expect(api.recordSupplierCreditPayment).toHaveBeenCalledWith('sup-1', expect.objectContaining({
                amount: 4998,
                discount: 2,
                direction: 'pay',
                allocations: [{ purchaseId: 'pur-1', amount: 5000 }],
            }));
        });
    });
});

describe('SupplierPaymentsPage — serial and date', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getSupplierCreditPayments as jest.Mock).mockResolvedValue([payment]);
        (api.getSuppliers as jest.Mock).mockResolvedValue([
            { id: 'sup-1', name: 'Fresh Farms', phone: '01710000000', due_balance: 1000 },
        ]);
        (api.getSupplierBillingSummary as jest.Mock).mockResolvedValue({ open_bills: [] });
        (api.recordSupplierCreditPayment as jest.Mock).mockResolvedValue({ id: 'pay-2' });
        (api.updateSupplierCreditPayment as jest.Mock).mockResolvedValue({ id: 'pay-1' });
    });

    const openNewPayment = async () => {
        render(<SupplierPaymentsPage />);
        await screen.findByText('SP-00007');
        fireEvent.click(screen.getByRole('button', { name: /new supplier payment/i }));
        fireEvent.change(await screen.findByLabelText('Amount'), { target: { value: '100' } });
    };

    it('opens with the next serial at the top and the current time beside it, sending neither when untouched', async () => {
        await openNewPayment();

        const serial = await screen.findByDisplayValue('SPY-00012');
        expect(serial).toBe(screen.getByLabelText('Serial'));
        const row = serial.closest('.grid') as HTMLElement;
        expect(Array.from(row.querySelectorAll('input'))).toEqual([serial, screen.getByLabelText('Date & time')]);
        expect((screen.getByLabelText('Date & time') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
        expect(api.getNextSupplierPaymentNumber).toHaveBeenCalledWith('pay');

        fireEvent.click(screen.getByRole('button', { name: /record payment/i }));

        await waitFor(() => expect(api.recordSupplierCreditPayment).toHaveBeenCalled());
        const sent = (api.recordSupplierCreditPayment as jest.Mock).mock.calls[0][1];
        expect(sent.paymentNumber).toBeUndefined();
        expect(sent.date).toBeUndefined();
    });

    it('sends a typed serial and a backdated time, in workspace time', async () => {
        await openNewPayment();

        fireEvent.change(await screen.findByLabelText('Serial'), { target: { value: 'BILL-77' } });
        fireEvent.change(screen.getByLabelText('Date & time'), { target: { value: '2026-01-15T09:30' } });
        fireEvent.click(screen.getByRole('button', { name: /record payment/i }));

        await waitFor(() => {
            expect(api.recordSupplierCreditPayment).toHaveBeenCalledWith('sup-1', expect.objectContaining({
                paymentNumber: 'BILL-77',
                date: '2026-01-15T09:30:00+06:00',
            }));
        });
    });

    it('blocks a payment dated in the future', async () => {
        await openNewPayment();

        fireEvent.change(await screen.findByLabelText('Date & time'), { target: { value: '2099-01-01T10:00' } });
        fireEvent.click(screen.getByRole('button', { name: /record payment/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Date and time cannot be in the future.');
        expect(api.recordSupplierCreditPayment).not.toHaveBeenCalled();
    });

    it('shows a serial ahead of the series under the field instead of closing the form', async () => {
        (api.recordSupplierCreditPayment as jest.Mock).mockRejectedValue(new ApiError('ahead', 400, 'SERIAL_AHEAD_OF_SERIES'));
        await openNewPayment();

        fireEvent.change(await screen.findByLabelText('Serial'), { target: { value: 'SPY-000125' } });
        fireEvent.click(screen.getByRole('button', { name: /record payment/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'SPY-000125 is ahead of the next number in this series. Leave the serial blank to take the next one, or use a serial outside the series.',
        );
        expect(screen.getByLabelText('Serial')).toBeInTheDocument();
    });

    it('shows a taken serial under the field instead of closing the form', async () => {
        (api.recordSupplierCreditPayment as jest.Mock).mockRejectedValue(new ApiError('taken', 409));
        await openNewPayment();

        fireEvent.change(await screen.findByLabelText('Serial'), { target: { value: 'SPY-00002' } });
        fireEvent.click(screen.getByRole('button', { name: /record payment/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Serial SPY-00002 is already used by another payment.');
        expect(screen.getByLabelText('Serial')).toBeInTheDocument();
    });

    it('edits open on the payment\'s own serial and time, and send only what changed', async () => {
        render(<SupplierPaymentsPage />);
        fireEvent.click(await screen.findByTitle('Edit'));

        const serial = await screen.findByLabelText('Serial');
        expect(serial).toHaveValue('SP-00007');
        // 10:00 UTC is 16:00 in Dhaka.
        expect(screen.getByLabelText('Date & time')).toHaveValue('2026-03-20T16:00');

        fireEvent.change(serial, { target: { value: 'SP-00700' } });
        fireEvent.change(screen.getByLabelText('Date & time'), { target: { value: '2026-03-18T11:15' } });
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => {
            expect(api.updateSupplierCreditPayment).toHaveBeenCalledWith('pay-1', expect.objectContaining({
                paymentNumber: 'SP-00700',
                date: '2026-03-18T11:15:00+06:00',
            }));
        });
    });
});
