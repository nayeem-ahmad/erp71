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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SupplierPaymentsPage from './page';
import { api, ApiError } from '@/lib/api';

jest.mock('next/navigation', () => ({
    useSearchParams: () => ({ get: () => null }),
}));

jest.mock('@/lib/branding', () => ({
    useBranding: () => ({ businessName: 'Demo Store' }),
}));

jest.mock('@/lib/supplier-payment-receipt', () => ({
    printSupplierPaymentReceipt: jest.fn(),
}));

jest.mock('@/lib/api', () => ({
    ApiError: class ApiError extends Error {
        constructor(message: string, public readonly status: number, public readonly code?: string) {
            super(message);
            this.name = 'ApiError';
        }
    },
    fetchWithAuth: jest.fn().mockResolvedValue(null),
    api: {
        getSupplierCreditPayments: jest.fn(),
        getSuppliers: jest.fn(),
        recordSupplierCreditPayment: jest.fn(),
        getSupplierBillingSummary: jest.fn(),
        updateSupplierCreditPayment: jest.fn(),
        deleteSupplierCreditPayment: jest.fn(),
        allocateSupplierPayment: jest.fn(),
        getNextSupplierPaymentNumber: jest.fn().mockResolvedValue({ payment_number: 'SPY-00012' }),
        getPaymentMethods: jest.fn(),
    },
}));

const methods = [
    { id: 'pm-cash', name: 'Cash', type: 'Cash', is_active: true, show_on_entry: true, sort_order: 1, account: { id: 'a-cash', name: 'Cash in Hand', code: '110101' } },
    { id: 'pm-bank', name: 'Bank', type: 'Bank', is_active: true, show_on_entry: true, sort_order: 2, account: null },
];

const payment = {
    id: 'pay-1',
    type: 'PAYMENT',
    payment_number: 'SP-00007',
    amount: '250.00',
    notes: 'Advance against beans',
    created_at: '2026-03-20T10:00:00.000Z',
    balance_after: '4750.00',
    supplier: { id: 'sup-1', name: 'Fresh Farms', phone: '01710000000' },
    creator: { id: 'user-1', name: 'Test User' },
    unapplied_amount: 0,
};

const bill = (id: string, number: string, due: number) => ({
    id, purchase_number: number, total_amount: due, paid_amount: 0, balance_due: due, payment_status: 'UNPAID',
});

const dialog = () => screen.getByRole('dialog');
const save = () => fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));

function setUp({ payments = [payment], bills = [] as unknown[], due = 5000 } = {}) {
    jest.clearAllMocks();
    (api.getSupplierCreditPayments as jest.Mock).mockResolvedValue(payments);
    (api.getSuppliers as jest.Mock).mockResolvedValue([
        { id: 'sup-1', name: 'Fresh Farms', phone: '01710000000', due_balance: due },
        { id: 'sup-2', name: 'Molla Wholesale', phone: '01712300400', due_balance: 0 },
    ]);
    (api.getSupplierBillingSummary as jest.Mock).mockResolvedValue({ open_bills: bills });
    (api.getPaymentMethods as jest.Mock).mockResolvedValue(methods);
    (api.recordSupplierCreditPayment as jest.Mock).mockResolvedValue({ id: 'pay-2', payment_number: 'SPY-00012', type: 'PAYMENT', amount: 100, created_at: '2026-10-10T05:00:00Z' });
    (api.updateSupplierCreditPayment as jest.Mock).mockResolvedValue({ id: 'pay-1' });
    (api.allocateSupplierPayment as jest.Mock).mockResolvedValue({ id: 'pay-1' });
    (api.getNextSupplierPaymentNumber as jest.Mock).mockResolvedValue({ payment_number: 'SPY-00012' });
}

async function openReadyForm(supplier = 'Fresh Farms') {
    render(<SupplierPaymentsPage />);
    await waitFor(() => expect(api.getSuppliers).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /new supplier payment/i }));
    const input = await within(dialog()).findByLabelText('Supplier');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: supplier } });
    fireEvent.keyDown(input, { key: 'Enter' });
}

async function openRow(serial: string) {
    render(<SupplierPaymentsPage />);
    fireEvent.click(await screen.findByText(serial));
    return dialog();
}

describe('SupplierPaymentsPage — summary', () => {
    beforeEach(() => setUp({
        payments: [
            { ...payment, payment_method_name: 'Bank' },
            { ...payment, id: 'pay-3', type: 'PAYOUT', payment_number: 'SPO-00001', amount: '40.00' },
        ],
    }));

    it('leads with what was paid, and nets the refunds against it', async () => {
        render(<SupplierPaymentsPage />);
        await screen.findByText('SP-00007');

        const tile = (label: string) => screen.getByText(label, { selector: 'p' }).parentElement as HTMLElement;
        expect(tile('Paid')).toHaveTextContent('250.00');
        expect(tile('Paid')).toHaveTextContent('Bank');
        expect(tile('Refunds received')).toHaveTextContent('40.00');
        expect(tile('Net paid')).toHaveTextContent('210.00');
    });
});

describe('SupplierPaymentsPage — duplicate', () => {
    beforeEach(() => setUp());

    it('opens the create form prefilled from the payment it copied', async () => {
        const panel = await openRow('SP-00007');
        fireEvent.click(within(panel).getByRole('button', { name: 'Duplicate' }));
        await within(dialog()).findByText('Duplicate Payment');

        expect(within(dialog()).getByText(/Copied from SP-00007/)).toBeInTheDocument();
        expect(within(dialog()).getByRole('radio', { name: /pay to supplier/i })).toHaveAttribute('aria-checked', 'true');
        expect(within(dialog()).getByPlaceholderText('Fresh Farms')).toBeInTheDocument();
        expect(within(dialog()).getByLabelText('Amount')).toHaveValue(250);
        expect(within(dialog()).getByLabelText('Notes')).toHaveValue('Advance against beans');
    });

    it('records a new payment, allocating afresh rather than carrying the original\'s bills', async () => {
        const panel = await openRow('SP-00007');
        fireEvent.click(within(panel).getByRole('button', { name: 'Duplicate' }));
        await within(dialog()).findByText('Duplicate Payment');

        save();

        await waitFor(() => {
            expect(api.recordSupplierCreditPayment).toHaveBeenCalledWith('sup-1', {
                amount: 250,
                direction: 'pay',
                notes: 'Advance against beans',
                paymentMethodId: 'pm-cash',
            });
        });
        expect(api.updateSupplierCreditPayment).not.toHaveBeenCalled();
    });
});

describe('SupplierPaymentsPage — bills', () => {
    beforeEach(() => setUp({
        payments: [],
        due: 42800,
        bills: [bill('pur-1', 'P-00312', 8000), bill('pur-2', 'P-00327', 20000), bill('pur-3', 'P-00341', 14800)],
    }));

    it('fills open bills oldest first as the amount is typed, and sends them', async () => {
        await openReadyForm();
        await within(dialog()).findByText('P-00312');

        fireEvent.change(within(dialog()).getByLabelText('Amount'), { target: { value: '30000' } });

        expect(within(dialog()).getByLabelText(/P-00312/, { selector: 'input[type="number"]' })).toHaveValue(8000);
        expect(within(dialog()).getByLabelText(/P-00327/, { selector: 'input[type="number"]' })).toHaveValue(20000);
        expect(within(dialog()).getByLabelText(/P-00341/, { selector: 'input[type="number"]' })).toHaveValue(2000);
        expect(within(dialog()).getByText(/goes to bills/)).toBeInTheDocument();

        save();

        await waitFor(() => {
            expect(api.recordSupplierCreditPayment).toHaveBeenCalledWith('sup-1', expect.objectContaining({
                amount: 30000,
                allocations: [
                    { purchaseId: 'pur-1', amount: 8000 },
                    { purchaseId: 'pur-2', amount: 20000 },
                    { purchaseId: 'pur-3', amount: 2000 },
                ],
            }));
        });
    });

    it('keeps the operator\'s own split once a bill is edited by hand', async () => {
        await openReadyForm();
        await within(dialog()).findByText('P-00312');

        fireEvent.change(within(dialog()).getByLabelText('Amount'), { target: { value: '10000' } });
        fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'P-00312' }));
        fireEvent.change(within(dialog()).getByLabelText('Amount'), { target: { value: '12000' } });

        expect(within(dialog()).getByLabelText(/P-00312/, { selector: 'input[type="number"]' })).toHaveValue(null);
        expect(within(dialog()).getByLabelText(/P-00327/, { selector: 'input[type="number"]' })).toHaveValue(2000);
        expect(within(dialog()).getByText(/stays as advance/)).toHaveTextContent('10,000.00');
    });

    it('refuses to allocate more than the payment settles', async () => {
        await openReadyForm();
        await within(dialog()).findByText('P-00312');

        fireEvent.change(within(dialog()).getByLabelText('Amount'), { target: { value: '1000' } });
        fireEvent.change(within(dialog()).getByLabelText(/P-00327/, { selector: 'input[type="number"]' }), { target: { value: '5000' } });
        save();

        expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Allocated amounts exceed the payment amount.');
        expect(api.recordSupplierCreditPayment).not.toHaveBeenCalled();
    });

    it('lets money plus discount settle a whole bill', async () => {
        setUp({ payments: [], due: 5000, bills: [bill('pur-1', 'PUR-00001', 5000)] });
        await openReadyForm();
        await within(dialog()).findByText('PUR-00001');

        fireEvent.change(within(dialog()).getByLabelText('Amount'), { target: { value: '4998' } });
        fireEvent.click(within(dialog()).getByRole('button', { name: 'Discount the remainder' }));
        expect(within(dialog()).getByLabelText('Discount received')).toHaveValue(2);

        save();

        await waitFor(() => {
            expect(api.recordSupplierCreditPayment).toHaveBeenCalledWith('sup-1', expect.objectContaining({
                amount: 4998,
                discount: 2,
                direction: 'pay',
                allocations: [{ purchaseId: 'pur-1', amount: 5000 }],
            }));
        });
    });

    it('offers no bills on a refund received', async () => {
        await openReadyForm();
        await within(dialog()).findByText('P-00312');

        fireEvent.click(within(dialog()).getByRole('radio', { name: /receive from supplier/i }));

        expect(within(dialog()).queryByText('P-00312')).not.toBeInTheDocument();
        expect(within(dialog()).queryByLabelText('Discount received')).not.toBeInTheDocument();
    });
});

describe('SupplierPaymentsPage — allocate an advance', () => {
    it('matches a payment\'s unapplied amount to bills from its details', async () => {
        setUp({
            payments: [{ ...payment, unapplied_amount: 250 }],
            bills: [bill('pur-1', 'P-00312', 100), bill('pur-2', 'P-00327', 500)],
        });
        const panel = await openRow('SP-00007');

        fireEvent.click(within(panel).getByRole('button', { name: 'Allocate advance' }));
        await within(dialog()).findByText('P-00312');
        fireEvent.click(within(dialog()).getByRole('button', { name: 'Save allocation' }));

        await waitFor(() => {
            expect(api.allocateSupplierPayment).toHaveBeenCalledWith('pay-1', [
                { purchaseId: 'pur-1', amount: 100 },
                { purchaseId: 'pur-2', amount: 150 },
            ]);
        });
    });

    it('offers no allocation for a payment that is fully applied', async () => {
        setUp();
        const panel = await openRow('SP-00007');

        expect(within(panel).queryByRole('button', { name: 'Allocate advance' })).not.toBeInTheDocument();
    });
});

describe('SupplierPaymentsPage — serial and date', () => {
    beforeEach(() => setUp());

    const openWithAmount = async () => {
        await openReadyForm();
        fireEvent.change(within(dialog()).getByLabelText('Amount'), { target: { value: '100' } });
    };

    it('opens with the next serial and the current time, sending neither when untouched', async () => {
        await openWithAmount();

        expect(await within(dialog()).findByText('SPY-00012')).toBeInTheDocument();
        expect(api.getNextSupplierPaymentNumber).toHaveBeenCalledWith('pay');

        save();

        await waitFor(() => expect(api.recordSupplierCreditPayment).toHaveBeenCalled());
        const sent = (api.recordSupplierCreditPayment as jest.Mock).mock.calls[0][1];
        expect(sent.paymentNumber).toBeUndefined();
        expect(sent.date).toBeUndefined();
    });

    it('sends a typed serial and a backdated time, in workspace time', async () => {
        await openWithAmount();

        fireEvent.click(within(dialog()).getByRole('button', { name: 'Change' }));
        fireEvent.change(within(dialog()).getByLabelText('Serial'), { target: { value: 'BILL-77' } });
        fireEvent.change(within(dialog()).getByLabelText('Date & time'), { target: { value: '2026-01-15T09:30' } });
        save();

        await waitFor(() => {
            expect(api.recordSupplierCreditPayment).toHaveBeenCalledWith('sup-1', expect.objectContaining({
                paymentNumber: 'BILL-77',
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
        expect(api.recordSupplierCreditPayment).not.toHaveBeenCalled();
    });

    it('shows a serial ahead of the series under the field instead of closing the form', async () => {
        (api.recordSupplierCreditPayment as jest.Mock).mockRejectedValue(new ApiError('ahead', 400, 'SERIAL_AHEAD_OF_SERIES'));
        await openWithAmount();

        fireEvent.click(within(dialog()).getByRole('button', { name: 'Change' }));
        fireEvent.change(within(dialog()).getByLabelText('Serial'), { target: { value: 'SPY-000125' } });
        save();

        expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
            'SPY-000125 is ahead of the next number in this series.',
        );
        expect(within(dialog()).getByLabelText('Serial')).toBeInTheDocument();
    });

    it('shows a taken serial under the field instead of closing the form', async () => {
        (api.recordSupplierCreditPayment as jest.Mock).mockRejectedValue(new ApiError('taken', 409));
        await openWithAmount();

        fireEvent.click(within(dialog()).getByRole('button', { name: 'Change' }));
        fireEvent.change(within(dialog()).getByLabelText('Serial'), { target: { value: 'SPY-00002' } });
        save();

        expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Serial SPY-00002 is already used by another payment.');
        expect(within(dialog()).getByLabelText('Serial')).toBeInTheDocument();
    });

    it('edits open on the payment\'s own serial and time, and send only what changed', async () => {
        const panel = await openRow('SP-00007');
        fireEvent.click(within(panel).getByRole('button', { name: 'Edit' }));
        fireEvent.click(await within(dialog()).findByRole('button', { name: 'Change' }));

        const serial = within(dialog()).getByLabelText('Serial');
        expect(serial).toHaveValue('SP-00007');
        // 10:00 UTC is 16:00 in Dhaka.
        expect(within(dialog()).getByLabelText('Date & time')).toHaveValue('2026-03-20T16:00');

        fireEvent.change(serial, { target: { value: 'SP-00700' } });
        fireEvent.change(within(dialog()).getByLabelText('Date & time'), { target: { value: '2026-03-18T11:15' } });
        fireEvent.click(within(dialog()).getByRole('button', { name: /save changes/i }));

        await waitFor(() => {
            expect(api.updateSupplierCreditPayment).toHaveBeenCalledWith('pay-1', expect.objectContaining({
                paymentNumber: 'SP-00700',
                date: '2026-03-18T11:15:00+06:00',
            }));
        });
    });
});
