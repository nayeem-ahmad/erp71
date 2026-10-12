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

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CustomerPaymentsPage from './page';
import { api, ApiError } from '@/lib/api';
import { printCustomerPaymentReceipt } from '@/lib/customer-payment-receipt';
import { useToastStore } from '@/lib/toast';

// Every list follows the branch filter; two branches, header = store-1.
jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('next/navigation', () => ({
    useSearchParams: () => ({ get: () => null }),
}));

jest.mock('@/lib/branding', () => ({
    useBranding: () => ({ businessName: 'Demo Store' }),
}));

jest.mock('@/lib/customer-payment-receipt', () => ({
    printCustomerPaymentReceipt: jest.fn(),
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
        getCustomerCreditPayments: jest.fn(),
        getCustomers: jest.fn(),
        recordCreditPayment: jest.fn(),
        updateCustomerCreditPayment: jest.fn(),
        getNextCustomerPaymentNumber: jest.fn().mockResolvedValue({ payment_number: 'CPY-00008' }),
        deleteCustomerCreditPayment: jest.fn(),
        getPaymentMethods: jest.fn(),
    },
}));

const methods = [
    { id: 'pm-cash', name: 'Cash', type: 'Cash', is_active: true, show_on_entry: true, sort_order: 1, account: { id: 'a-cash', name: 'Cash in Hand', code: '110101' } },
    { id: 'pm-bkash', name: 'bKash', type: 'Mobile Wallet', is_active: true, show_on_entry: true, sort_order: 2, account: null },
    { id: 'pm-bank', name: 'City Bank', type: 'Bank', is_active: true, show_on_entry: false, sort_order: 3, account: { id: 'a-bank', name: 'Main Bank Account', code: '110102' } },
    { id: 'pm-off', name: 'Retired till', type: 'Cash', is_active: false, show_on_entry: true, sort_order: 0, account: null },
];

const payout = {
    id: 'pay-1',
    type: 'PAYOUT',
    payment_number: 'CP-00007',
    amount: '250.00',
    notes: 'Refund for damaged goods',
    created_at: '2026-03-20T10:00:00.000Z',
    balance_after: '1250.00',
    customer: { id: 'cust-1', name: 'Alice Corp', phone: '01700000001' },
    creator: { id: 'user-1', name: 'Test User' },
};

const receipt = {
    id: 'pay-2',
    type: 'PAYMENT',
    payment_number: 'CPY-00005',
    amount: '1000.00',
    discount_amount: '20.00',
    created_at: '2026-03-19T10:00:00.000Z',
    balance_after: '1000.00',
    payment_method_name: 'bKash',
    customer: { id: 'cust-1', name: 'Alice Corp', phone: '01700000001' },
    creator: { id: 'user-1', name: 'Test User' },
};

const alice = { id: 'cust-1', name: 'Alice Corp', phone: '01700000001', due_balance: 1000 };
const bob = { id: 'cust-2', name: 'Bob Traders', phone: '01700000002', due_balance: 0 };

const dialog = () => screen.getByRole('dialog');

function setUp({ payments = [payout], customers = [alice, bob] }: { payments?: unknown[]; customers?: unknown[] } = {}) {
    jest.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    (api.getCustomerCreditPayments as jest.Mock).mockResolvedValue(payments);
    (api.getCustomers as jest.Mock).mockResolvedValue(customers);
    (api.getPaymentMethods as jest.Mock).mockResolvedValue(methods);
    (api.recordCreditPayment as jest.Mock).mockResolvedValue({ id: 'pay-9', payment_number: 'CPY-00008', type: 'PAYMENT', amount: 100, created_at: '2026-10-10T05:00:00Z' });
    (api.updateCustomerCreditPayment as jest.Mock).mockResolvedValue({ id: 'pay-1' });
    (api.deleteCustomerCreditPayment as jest.Mock).mockResolvedValue({ deleted: true });
    (api.getNextCustomerPaymentNumber as jest.Mock).mockResolvedValue({ payment_number: 'CPY-00008' });
}

async function openNewPayment() {
    render(<CustomerPaymentsPage />);
    await waitFor(() => expect(api.getCustomers).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /new customer payment/i }));
    return dialog();
}

function pickCustomer(name: string) {
    const input = within(dialog()).getByLabelText('Customer');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: name } });
    fireEvent.keyDown(input, { key: 'Enter' });
}

async function openReadyForm(customer = 'Alice Corp') {
    await openNewPayment();
    await within(dialog()).findByLabelText('Amount');
    pickCustomer(customer);
}

async function openRow(serial: string) {
    render(<CustomerPaymentsPage />);
    fireEvent.click(await screen.findByText(serial));
    return dialog();
}

const save = () => fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));

describe('CustomerPaymentsPage — summary', () => {
    beforeEach(() => setUp({ payments: [payout, receipt] }));

    it('shows money in, money out and discounts on their own tiles, and the net between them', async () => {
        render(<CustomerPaymentsPage />);
        await screen.findByText('CP-00007');

        const tile = (label: string) => screen.getByText(label, { selector: 'p' }).parentElement as HTMLElement;
        expect(tile('Received')).toHaveTextContent('1,000.00');
        expect(tile('Paid out (refunds)')).toHaveTextContent('250.00');
        expect(tile('Discount allowed')).toHaveTextContent('20.00');
        expect(tile('Net collected')).toHaveTextContent('750.00');
        // The receipts are broken down by method under their tile.
        expect(tile('Received')).toHaveTextContent('bKash');
    });

    it('filters the list to one direction', async () => {
        render(<CustomerPaymentsPage />);
        await screen.findByText('CP-00007');

        fireEvent.click(screen.getByRole('radio', { name: 'Out' }));

        expect(screen.getByText('CP-00007')).toBeInTheDocument();
        expect(screen.queryByText('CPY-00005')).not.toBeInTheDocument();
    });
});

describe('CustomerPaymentsPage — branch', () => {
    beforeEach(() => setUp());

    it('lists the header branch\'s payments, and another branch\'s when one is picked', async () => {
        render(<CustomerPaymentsPage />);
        await screen.findByText('CP-00007');
        expect(api.getCustomerCreditPayments).toHaveBeenLastCalledWith(expect.objectContaining({ storeId: 'store-1' }));

        fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'store-2' } });

        await waitFor(() => {
            expect(api.getCustomerCreditPayments).toHaveBeenLastCalledWith(expect.objectContaining({ storeId: 'store-2' }));
        });
    });
});

describe('CustomerPaymentsPage — details', () => {
    beforeEach(() => setUp({ payments: [payout, receipt] }));

    it('opens a payment from its row, with what it did to the due', async () => {
        const panel = await openRow('CPY-00005');

        expect(within(panel).getByText('Payment Details')).toBeInTheDocument();
        expect(within(panel).getByText('+৳ 1,000.00')).toBeInTheDocument();
        expect(within(panel).getByText('bKash')).toBeInTheDocument();
        // Due after 1,000; the receipt settled 1,000 + 20 discount, so 2,020 before.
        expect(within(panel).getByTestId('due-flow')).toHaveTextContent(/2,020\.00.*1,000\.00/);
    });

    it('prints from the details panel', async () => {
        const panel = await openRow('CPY-00005');

        fireEvent.click(within(panel).getByRole('button', { name: 'Print money receipt' }));

        expect(printCustomerPaymentReceipt).toHaveBeenCalledWith(expect.objectContaining({
            paymentNumber: 'CPY-00005',
            method: 'bKash',
            direction: 'receive',
        }));
    });

    it('deletes through the app\'s own confirmation, not the browser\'s', async () => {
        const confirmSpy = jest.spyOn(globalThis, 'confirm');
        const panel = await openRow('CP-00007');

        fireEvent.click(within(panel).getByRole('button', { name: 'Delete' }));
        const confirm = screen.getAllByRole('dialog').at(-1)!;
        expect(confirm).toHaveTextContent('Delete this payment?');
        fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(api.deleteCustomerCreditPayment).toHaveBeenCalledWith('pay-1'));
        expect(confirmSpy).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
    });
});

describe('CustomerPaymentsPage — duplicate', () => {
    beforeEach(() => setUp());

    const openDuplicate = async () => {
        const panel = await openRow('CP-00007');
        fireEvent.click(within(panel).getByRole('button', { name: 'Duplicate' }));
        await within(dialog()).findByText('Duplicate Payment');
    };

    it('opens the create form prefilled from the payment it copied', async () => {
        await openDuplicate();
        const panel = dialog();

        expect(within(panel).getByText(/Copied from CP-00007/)).toBeInTheDocument();
        // Direction, customer, amount and notes all come across.
        expect(within(panel).getByRole('radio', { name: /pay to customer/i })).toHaveAttribute('aria-checked', 'true');
        expect(within(panel).getByPlaceholderText('Alice Corp')).toBeInTheDocument();
        expect(within(panel).getByLabelText('Amount')).toHaveValue(250);
        expect(within(panel).getByLabelText('Notes')).toHaveValue('Refund for damaged goods');
    });

    it('records a new payment rather than updating the source', async () => {
        await openDuplicate();

        save();

        await waitFor(() => {
            expect(api.recordCreditPayment).toHaveBeenCalledWith('cust-1', {
                amount: 250,
                direction: 'pay',
                notes: 'Refund for damaged goods',
                paymentMethodId: 'pm-cash',
            });
        });
        expect(api.updateCustomerCreditPayment).not.toHaveBeenCalled();
    });

    it('leaves the plain New Payment form empty', async () => {
        await openNewPayment();

        expect(await within(dialog()).findByLabelText('Amount')).toHaveValue(null);
        expect(within(dialog()).queryByText('Duplicate Payment')).not.toBeInTheDocument();
        expect(within(dialog()).queryByText(/Copied from/)).not.toBeInTheDocument();
    });
});

describe('CustomerPaymentsPage — customer list loading', () => {
    beforeEach(() => setUp());

    it('says the customers are loading, not that there are none, while they load', async () => {
        // A shop with hundreds of customers takes several requests to load;
        // the form must not claim the list is empty in the meantime.
        (api.getCustomers as jest.Mock).mockReturnValue(new Promise(() => {}));

        await openNewPayment();

        expect(await within(dialog()).findByText('Loading customers…')).toBeInTheDocument();
        expect(within(dialog()).queryByText('No customers found')).not.toBeInTheDocument();
    });

    it('shows the payments even when the customer list fails to load', async () => {
        (api.getCustomers as jest.Mock).mockRejectedValue(new Error('boom'));

        render(<CustomerPaymentsPage />);

        expect(await screen.findByText('CP-00007')).toBeInTheDocument();
    });

    it('offers a retry when the customer list fails, and recovers', async () => {
        (api.getCustomers as jest.Mock)
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValue([alice]);

        await openNewPayment();

        expect(await within(dialog()).findByText('Could not load customers')).toBeInTheDocument();
        fireEvent.click(within(dialog()).getByRole('button', { name: 'Try again' }));

        expect(await within(dialog()).findByLabelText('Amount')).toBeInTheDocument();
        expect(within(dialog()).queryByText('Could not load customers')).not.toBeInTheDocument();
    });

    it('still says there are no customers when the shop truly has none', async () => {
        (api.getCustomers as jest.Mock).mockResolvedValue([]);

        await openNewPayment();

        expect(await within(dialog()).findByText('No customers found')).toBeInTheDocument();
    });
});

describe('CustomerPaymentsPage — entry', () => {
    beforeEach(() => setUp());

    it('starts with no customer picked, and asks for one before saving', async () => {
        await openNewPayment();
        fireEvent.change(await within(dialog()).findByLabelText('Amount'), { target: { value: '100' } });

        save();

        expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Customer and amount are required.');
        expect(api.recordCreditPayment).not.toHaveBeenCalled();
    });

    it('shows the due now and after this payment, and fills the full due in one click', async () => {
        await openReadyForm();

        fireEvent.change(within(dialog()).getByLabelText('Amount'), { target: { value: '400' } });
        expect(within(dialog()).getByTestId('due-flow')).toHaveTextContent(/1,000\.00.*600\.00/);

        fireEvent.click(within(dialog()).getByRole('button', { name: /full due/i }));
        expect(within(dialog()).getByLabelText('Amount')).toHaveValue(1000);
    });

    it('stays open for the next payment after a save, and offers the receipt', async () => {
        await openReadyForm();
        fireEvent.change(within(dialog()).getByLabelText('Amount'), { target: { value: '100' } });

        save();

        await waitFor(() => expect(api.recordCreditPayment).toHaveBeenCalled());
        await waitFor(() => expect(within(dialog()).getByLabelText('Amount')).toHaveValue(null));
        expect(printCustomerPaymentReceipt).not.toHaveBeenCalled();

        const [saved] = useToastStore.getState().toasts;
        expect(saved.message).toBe('CPY-00008 saved');
        act(() => saved.action!.onClick());
        expect(printCustomerPaymentReceipt).toHaveBeenCalledWith(expect.objectContaining({ paymentNumber: 'CPY-00008' }));
    });

    it('prints straight away with Save & print', async () => {
        await openReadyForm();
        fireEvent.change(within(dialog()).getByLabelText('Amount'), { target: { value: '100' } });

        fireEvent.click(within(dialog()).getByRole('button', { name: /save & print/i }));

        await waitFor(() => expect(printCustomerPaymentReceipt).toHaveBeenCalledTimes(1));
    });
});

describe('CustomerPaymentsPage — payment method', () => {
    beforeEach(() => setUp());

    it('offers the methods shown on entry, the rest under More, and starts on the first', async () => {
        await openReadyForm();
        const panel = dialog();

        expect(within(panel).getByRole('radio', { name: 'Cash' })).toHaveAttribute('aria-checked', 'true');
        expect(within(panel).getByRole('radio', { name: 'bKash' })).toBeInTheDocument();
        expect(within(panel).queryByRole('radio', { name: 'City Bank' })).not.toBeInTheDocument();
        expect(within(panel).queryByRole('radio', { name: 'Retired till' })).not.toBeInTheDocument();
        expect(within(panel).getByText('Posts to Cash in Hand · 110101')).toBeInTheDocument();

        fireEvent.click(within(panel).getByRole('button', { name: 'More' }));
        expect(within(panel).getByRole('radio', { name: 'City Bank' })).toBeInTheDocument();
    });

    it('warns before saving when the method has no ledger account, and sends the one picked', async () => {
        await openReadyForm();
        const panel = dialog();
        fireEvent.change(within(panel).getByLabelText('Amount'), { target: { value: '100' } });

        fireEvent.click(within(panel).getByRole('radio', { name: 'bKash' }));
        expect(within(panel).getByText(/bKash has no ledger account linked/)).toBeInTheDocument();

        save();

        await waitFor(() => {
            expect(api.recordCreditPayment).toHaveBeenCalledWith('cust-1', expect.objectContaining({ paymentMethodId: 'pm-bkash' }));
        });
    });

    it('sends a method on an edit only when it was changed', async () => {
        setUp({ payments: [{ ...receipt, payment_method_id: 'pm-bkash' }] });
        const panel = await openRow('CPY-00005');
        fireEvent.click(within(panel).getByRole('button', { name: 'Edit' }));

        fireEvent.click(await within(dialog()).findByRole('button', { name: /save changes/i }));
        await waitFor(() => expect(api.updateCustomerCreditPayment).toHaveBeenCalledTimes(1));
        expect((api.updateCustomerCreditPayment as jest.Mock).mock.calls[0][1].paymentMethodId).toBeUndefined();
    });
});

describe('CustomerPaymentsPage — discount', () => {
    beforeEach(() => setUp({ payments: [], customers: [{ ...alice, due_balance: 10003 }] }));

    it('discounts the remainder in one click and sends it with the receipt', async () => {
        await openReadyForm();

        fireEvent.change(within(dialog()).getByLabelText('Amount'), { target: { value: '10000' } });
        fireEvent.click(within(dialog()).getByRole('button', { name: 'Discount the remainder' }));
        expect(within(dialog()).getByLabelText('Discount allowed')).toHaveValue(3);

        save();

        await waitFor(() => {
            expect(api.recordCreditPayment).toHaveBeenCalledWith('cust-1', expect.objectContaining({
                amount: 10000,
                discount: 3,
                direction: 'receive',
            }));
        });
    });

    it('blocks a discount larger than what the payment leaves due', async () => {
        await openReadyForm();

        fireEvent.change(within(dialog()).getByLabelText('Amount'), { target: { value: '10000' } });
        fireEvent.change(within(dialog()).getByLabelText('Discount allowed'), { target: { value: '5' } });
        save();

        expect(await within(dialog()).findByRole('alert')).toHaveTextContent(/still due after this payment/);
        expect(api.recordCreditPayment).not.toHaveBeenCalled();
    });

    it('offers no discount on a payout', async () => {
        await openReadyForm();

        fireEvent.click(within(dialog()).getByRole('radio', { name: /pay to customer/i }));

        expect(within(dialog()).queryByLabelText('Discount allowed')).not.toBeInTheDocument();
    });
});

describe('CustomerPaymentsPage — date and time', () => {
    beforeEach(() => setUp());

    const openWithAmount = async () => {
        await openReadyForm();
        fireEvent.change(within(dialog()).getByLabelText('Amount'), { target: { value: '100' } });
    };

    it('opens on "now" and sends no date when left there', async () => {
        await openWithAmount();
        expect(within(dialog()).getByText('Now')).toBeInTheDocument();

        fireEvent.click(within(dialog()).getByRole('button', { name: 'Change' }));
        expect((within(dialog()).getByLabelText('Date & time') as HTMLInputElement).value)
            .toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

        save();

        await waitFor(() => expect(api.recordCreditPayment).toHaveBeenCalled());
        expect((api.recordCreditPayment as jest.Mock).mock.calls[0][1].date).toBeUndefined();
    });

    it('records a backdated payment at the picked time, in workspace time', async () => {
        await openWithAmount();

        fireEvent.click(within(dialog()).getByRole('button', { name: 'Change' }));
        fireEvent.change(within(dialog()).getByLabelText('Date & time'), { target: { value: '2026-01-15T09:30' } });
        save();

        await waitFor(() => {
            expect(api.recordCreditPayment).toHaveBeenCalledWith('cust-1', expect.objectContaining({
                amount: 100,
                date: '2026-01-15T09:30:00+06:00',
            }));
        });
    });

    it('blocks a payment dated in the future', async () => {
        await openWithAmount();

        fireEvent.click(within(dialog()).getByRole('button', { name: 'Change' }));
        fireEvent.change(within(dialog()).getByLabelText('Date & time'), { target: { value: '2099-01-01T10:00' } });
        save();

        expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Date and time cannot be in the future.');
        expect(api.recordCreditPayment).not.toHaveBeenCalled();
    });

    it('edits open on the payment\'s own date and move it only when changed', async () => {
        const panel = await openRow('CP-00007');
        fireEvent.click(within(panel).getByRole('button', { name: 'Edit' }));
        fireEvent.click(await within(dialog()).findByRole('button', { name: 'Change' }));

        // 10:00 UTC is 16:00 in Dhaka.
        expect(within(dialog()).getByLabelText('Date & time')).toHaveValue('2026-03-20T16:00');

        fireEvent.change(within(dialog()).getByLabelText('Date & time'), { target: { value: '2026-03-18T11:15' } });
        fireEvent.click(within(dialog()).getByRole('button', { name: /save changes/i }));

        await waitFor(() => {
            expect(api.updateCustomerCreditPayment).toHaveBeenCalledWith('pay-1', expect.objectContaining({
                date: '2026-03-18T11:15:00+06:00',
            }));
        });
    });

    it('leaves an edited payment on its date when the picker is untouched', async () => {
        const panel = await openRow('CP-00007');
        fireEvent.click(within(panel).getByRole('button', { name: 'Edit' }));

        fireEvent.click(await within(dialog()).findByRole('button', { name: /save changes/i }));

        await waitFor(() => expect(api.updateCustomerCreditPayment).toHaveBeenCalled());
        expect((api.updateCustomerCreditPayment as jest.Mock).mock.calls[0][1].date).toBeUndefined();
    });
});

describe('CustomerPaymentsPage — serial', () => {
    beforeEach(() => setUp());

    const openWithAmount = async () => {
        await openReadyForm();
        fireEvent.change(within(dialog()).getByLabelText('Amount'), { target: { value: '100' } });
    };

    it('shows the next serial up front, editable beside the date', async () => {
        await openWithAmount();

        expect(await within(dialog()).findByText('CPY-00008')).toBeInTheDocument();
        expect(api.getNextCustomerPaymentNumber).toHaveBeenCalledWith('receive');

        fireEvent.click(within(dialog()).getByRole('button', { name: 'Change' }));
        const serial = within(dialog()).getByLabelText('Serial');
        expect(serial).toHaveValue('CPY-00008');
        const row = serial.closest('.grid') as HTMLElement;
        expect(Array.from(row.querySelectorAll('input'))).toEqual([serial, within(dialog()).getByLabelText('Date & time')]);
    });

    it('previews the payout series when the direction changes', async () => {
        await openWithAmount();
        await within(dialog()).findByText('CPY-00008');
        (api.getNextCustomerPaymentNumber as jest.Mock).mockResolvedValueOnce({ payment_number: 'CPO-00003' });

        fireEvent.click(within(dialog()).getByRole('radio', { name: /pay to customer/i }));

        expect(await within(dialog()).findByText('CPO-00003')).toBeInTheDocument();
        expect(api.getNextCustomerPaymentNumber).toHaveBeenLastCalledWith('pay');
    });

    it('leaves numbering to the server when the serial is not touched', async () => {
        await openWithAmount();
        await within(dialog()).findByText('CPY-00008');

        save();

        await waitFor(() => expect(api.recordCreditPayment).toHaveBeenCalled());
        expect((api.recordCreditPayment as jest.Mock).mock.calls[0][1].paymentNumber).toBeUndefined();
    });

    it('sends a serial the operator typed', async () => {
        await openWithAmount();

        fireEvent.click(within(dialog()).getByRole('button', { name: 'Change' }));
        fireEvent.change(within(dialog()).getByLabelText('Serial'), { target: { value: ' MR-0457 ' } });
        save();

        await waitFor(() => {
            expect(api.recordCreditPayment).toHaveBeenCalledWith('cust-1', expect.objectContaining({ paymentNumber: 'MR-0457' }));
        });
    });

    it('shows a serial ahead of the series under the field instead of closing the form', async () => {
        (api.recordCreditPayment as jest.Mock).mockRejectedValue(
            new ApiError('CPY-000125 is ahead of the next number in this series', 400, 'SERIAL_AHEAD_OF_SERIES'),
        );
        await openWithAmount();

        fireEvent.click(within(dialog()).getByRole('button', { name: 'Change' }));
        fireEvent.change(within(dialog()).getByLabelText('Serial'), { target: { value: 'CPY-000125' } });
        save();

        expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
            'CPY-000125 is ahead of the next number in this series. Leave the serial blank to take the next one, or use a serial outside the series.',
        );
        expect(within(dialog()).getByLabelText('Serial')).toBeInTheDocument();
    });

    it('opens the serial under a taken-serial error even when it was never touched', async () => {
        (api.recordCreditPayment as jest.Mock).mockRejectedValue(new ApiError('Serial CPY-00008 is already used', 409));
        await openWithAmount();
        await within(dialog()).findByText('CPY-00008');

        save();

        expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Serial CPY-00008 is already used by another payment.');
        // Editing the serial clears the complaint.
        fireEvent.change(within(dialog()).getByLabelText('Serial'), { target: { value: 'CPY-00099' } });
        expect(within(dialog()).queryByRole('alert')).not.toBeInTheDocument();
    });

    it('edits open on the payment\'s own serial and send it only when renamed', async () => {
        const panel = await openRow('CP-00007');
        fireEvent.click(within(panel).getByRole('button', { name: 'Edit' }));
        fireEvent.click(await within(dialog()).findByRole('button', { name: 'Change' }));

        const serial = within(dialog()).getByLabelText('Serial');
        expect(serial).toHaveValue('CP-00007');

        fireEvent.change(serial, { target: { value: 'MR-0458' } });
        fireEvent.click(within(dialog()).getByRole('button', { name: /save changes/i }));

        await waitFor(() => {
            expect(api.updateCustomerCreditPayment).toHaveBeenCalledWith('pay-1', expect.objectContaining({ paymentNumber: 'MR-0458' }));
        });
    });

    it('edits leave the serial alone when it is not touched', async () => {
        const panel = await openRow('CP-00007');
        fireEvent.click(within(panel).getByRole('button', { name: 'Edit' }));

        fireEvent.click(await within(dialog()).findByRole('button', { name: /save changes/i }));

        await waitFor(() => expect(api.updateCustomerCreditPayment).toHaveBeenCalled());
        expect((api.updateCustomerCreditPayment as jest.Mock).mock.calls[0][1].paymentNumber).toBeUndefined();
    });
});
