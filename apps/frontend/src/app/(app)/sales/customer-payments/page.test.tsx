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
import { api, ApiError } from '@/lib/api';

jest.mock('next/navigation', () => ({
    useSearchParams: () => ({ get: () => null }),
}));

jest.mock('@/lib/branding', () => ({
    useBranding: () => ({ businessName: 'Demo Store' }),
}));

jest.mock('@/lib/api', () => ({
    ApiError: class ApiError extends Error {
        constructor(message: string, public readonly status: number) {
            super(message);
            this.name = 'ApiError';
        }
    },
    // The print-header hook resolves the tenant's print template on mount.
    fetchWithAuth: jest.fn().mockResolvedValue(null),
    api: {
        getCustomerCreditPayments: jest.fn(),
        getCustomers: jest.fn(),
        recordCreditPayment: jest.fn(),
        updateCustomerCreditPayment: jest.fn(),
        getNextCustomerPaymentNumber: jest.fn().mockResolvedValue({ payment_number: 'CPY-00008' }),
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

describe('CustomerPaymentsPage — date and time', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getCustomerCreditPayments as jest.Mock).mockResolvedValue([payment]);
        (api.getCustomers as jest.Mock).mockResolvedValue([
            { id: 'cust-1', name: 'Alice Corp', phone: '01700000001', due_balance: 1000 },
        ]);
        (api.recordCreditPayment as jest.Mock).mockResolvedValue({ id: 'pay-2' });
        (api.updateCustomerCreditPayment as jest.Mock).mockResolvedValue({ id: 'pay-1' });
    });

    const openNewPayment = async () => {
        render(<CustomerPaymentsPage />);
        await screen.findByText('CP-00007');
        fireEvent.click(screen.getByRole('button', { name: /new customer payment/i }));
        fireEvent.change(await screen.findByLabelText('Amount'), { target: { value: '100' } });
    };

    it('opens on the current time and sends no date when left there', async () => {
        await openNewPayment();

        expect((screen.getByLabelText('Date & time') as HTMLInputElement).value)
            .toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

        fireEvent.click(screen.getByRole('button', { name: /record receipt/i }));

        await waitFor(() => expect(api.recordCreditPayment).toHaveBeenCalled());
        expect((api.recordCreditPayment as jest.Mock).mock.calls[0][1].date).toBeUndefined();
    });

    it('records a backdated payment at the picked time, in workspace time', async () => {
        await openNewPayment();

        fireEvent.change(screen.getByLabelText('Date & time'), { target: { value: '2026-01-15T09:30' } });
        fireEvent.click(screen.getByRole('button', { name: /record receipt/i }));

        await waitFor(() => {
            expect(api.recordCreditPayment).toHaveBeenCalledWith('cust-1', expect.objectContaining({
                amount: 100,
                date: '2026-01-15T09:30:00+06:00',
            }));
        });
    });

    it('blocks a payment dated in the future', async () => {
        await openNewPayment();

        fireEvent.change(screen.getByLabelText('Date & time'), { target: { value: '2099-01-01T10:00' } });
        fireEvent.click(screen.getByRole('button', { name: /record receipt/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Date and time cannot be in the future.');
        expect(api.recordCreditPayment).not.toHaveBeenCalled();
    });

    it('edits open on the payment\'s own date and move it only when changed', async () => {
        render(<CustomerPaymentsPage />);
        fireEvent.click(await screen.findByTitle('Edit'));

        // 10:00 UTC is 16:00 in Dhaka.
        expect(await screen.findByLabelText('Date & time')).toHaveValue('2026-03-20T16:00');

        fireEvent.change(screen.getByLabelText('Date & time'), { target: { value: '2026-03-18T11:15' } });
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => {
            expect(api.updateCustomerCreditPayment).toHaveBeenCalledWith('pay-1', expect.objectContaining({
                date: '2026-03-18T11:15:00+06:00',
            }));
        });
    });

    it('leaves an edited payment on its date when the picker is untouched', async () => {
        render(<CustomerPaymentsPage />);
        fireEvent.click(await screen.findByTitle('Edit'));
        await screen.findByLabelText('Date & time');

        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => expect(api.updateCustomerCreditPayment).toHaveBeenCalled());
        expect((api.updateCustomerCreditPayment as jest.Mock).mock.calls[0][1].date).toBeUndefined();
    });
});

describe('CustomerPaymentsPage — serial', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getCustomerCreditPayments as jest.Mock).mockResolvedValue([payment]);
        (api.getCustomers as jest.Mock).mockResolvedValue([
            { id: 'cust-1', name: 'Alice Corp', phone: '01700000001', due_balance: 1000 },
        ]);
        (api.recordCreditPayment as jest.Mock).mockResolvedValue({ id: 'pay-2' });
        (api.updateCustomerCreditPayment as jest.Mock).mockResolvedValue({ id: 'pay-1' });
    });

    const openNewPayment = async () => {
        render(<CustomerPaymentsPage />);
        await screen.findByText('CP-00007');
        fireEvent.click(screen.getByRole('button', { name: /new customer payment/i }));
        fireEvent.change(await screen.findByLabelText('Amount'), { target: { value: '100' } });
    };

    it('opens with the next serial at the top, the date and time beside it', async () => {
        await openNewPayment();

        const serial = await screen.findByDisplayValue('CPY-00008');
        expect(serial).toBe(screen.getByLabelText('Serial'));
        expect(api.getNextCustomerPaymentNumber).toHaveBeenCalledWith('receive');

        // One row: serial first, then the date.
        const row = serial.closest('.grid') as HTMLElement;
        const inputs = Array.from(row.querySelectorAll('input'));
        expect(inputs).toEqual([serial, screen.getByLabelText('Date & time')]);
        // And it is the first field of the form.
        const form = serial.closest('form') as HTMLFormElement;
        expect(form.querySelector('input, select, textarea')).toBe(serial);
    });

    it('previews the payout series when the direction changes', async () => {
        await openNewPayment();
        await screen.findByDisplayValue('CPY-00008');
        (api.getNextCustomerPaymentNumber as jest.Mock).mockResolvedValueOnce({ payment_number: 'CPO-00003' });

        fireEvent.change(screen.getByDisplayValue('Receive from customer'), { target: { value: 'pay' } });

        expect(await screen.findByDisplayValue('CPO-00003')).toBeInTheDocument();
        expect(api.getNextCustomerPaymentNumber).toHaveBeenLastCalledWith('pay');
    });

    it('leaves numbering to the server when the serial is not touched', async () => {
        await openNewPayment();
        await screen.findByDisplayValue('CPY-00008');

        fireEvent.click(screen.getByRole('button', { name: /record receipt/i }));

        await waitFor(() => expect(api.recordCreditPayment).toHaveBeenCalled());
        expect((api.recordCreditPayment as jest.Mock).mock.calls[0][1].paymentNumber).toBeUndefined();
    });

    it('sends a serial the operator typed', async () => {
        await openNewPayment();

        fireEvent.change(await screen.findByLabelText('Serial'), { target: { value: ' MR-0457 ' } });
        fireEvent.click(screen.getByRole('button', { name: /record receipt/i }));

        await waitFor(() => {
            expect(api.recordCreditPayment).toHaveBeenCalledWith('cust-1', expect.objectContaining({ paymentNumber: 'MR-0457' }));
        });
    });

    it('shows a taken serial under the field instead of closing the form', async () => {
        (api.recordCreditPayment as jest.Mock).mockRejectedValue(new ApiError('Serial CPY-00002 is already used', 409));
        await openNewPayment();

        fireEvent.change(await screen.findByLabelText('Serial'), { target: { value: 'CPY-00002' } });
        fireEvent.click(screen.getByRole('button', { name: /record receipt/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Serial CPY-00002 is already used by another payment.');
        expect(screen.getByLabelText('Serial')).toBeInTheDocument();

        // Editing the serial clears the complaint.
        fireEvent.change(screen.getByLabelText('Serial'), { target: { value: 'CPY-00099' } });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('edits open on the payment\'s own serial and send it only when renamed', async () => {
        render(<CustomerPaymentsPage />);
        fireEvent.click(await screen.findByTitle('Edit'));

        const serial = await screen.findByLabelText('Serial');
        expect(serial).toHaveValue('CP-00007');

        fireEvent.change(serial, { target: { value: 'MR-0458' } });
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => {
            expect(api.updateCustomerCreditPayment).toHaveBeenCalledWith('pay-1', expect.objectContaining({ paymentNumber: 'MR-0458' }));
        });
    });

    it('edits leave the serial alone when it is not touched', async () => {
        render(<CustomerPaymentsPage />);
        fireEvent.click(await screen.findByTitle('Edit'));
        await screen.findByLabelText('Serial');

        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => expect(api.updateCustomerCreditPayment).toHaveBeenCalled());
        expect((api.updateCustomerCreditPayment as jest.Mock).mock.calls[0][1].paymentNumber).toBeUndefined();
    });
});
