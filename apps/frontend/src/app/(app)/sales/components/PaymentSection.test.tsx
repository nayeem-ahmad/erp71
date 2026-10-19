import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import PaymentSection from './PaymentSection';

jest.mock('@/lib/api', () => ({
    api: {
        getPaymentLayout: jest.fn(),
        getPaymentMethods: jest.fn(),
    },
}));

/** A method row as `/payment-methods` and its layout route return it. */
const method = (over: { id: string; name: string; type: string } & Record<string, unknown>) => ({
    account_id: null,
    is_active: true,
    sort_order: 0,
    show_on_entry: true,
    all_branches: true,
    store_ids: [],
    ...over,
});

const CASH = method({ id: 'pm-cash', name: 'Cash', type: 'Cash', account_id: 'acc-cash', sort_order: 1 });
const BKASH = method({ id: 'pm-bkash', name: 'bKash', type: 'Mobile Wallet', account_id: 'acc-bkash', sort_order: 2 });
const NAGAD = method({ id: 'pm-nagad', name: 'Nagad', type: 'Mobile Wallet', account_id: 'acc-nagad', sort_order: 3 });
const CARD = method({ id: 'pm-card', name: 'Card', type: 'Card', account_id: 'acc-bank', sort_order: 4 });

/**
 * What the branch offers this user: `visible` is their strip, `available` the
 * active methods the branch offers, and `branch` the branch's whole list, which
 * keeps switched-off methods.
 */
function mockMethods({
    visible,
    available = visible,
    branch = available,
}: {
    visible: ReturnType<typeof method>[] | Record<string, unknown>[];
    available?: ReturnType<typeof method>[] | Record<string, unknown>[];
    branch?: ReturnType<typeof method>[] | Record<string, unknown>[];
}) {
    const { api } = require('@/lib/api');
    (api.getPaymentLayout as jest.Mock).mockResolvedValue({ customised: false, visible, available });
    (api.getPaymentMethods as jest.Mock).mockResolvedValue(branch);
}

/** Every render takes the branch and screen it lays the strip out for. */
const strip = { context: 'sale' as const, storeId: 'store-1' };

beforeEach(() => {
    jest.clearAllMocks();
    // Cash on the strip; bKash offered at the branch, but tucked away.
    mockMethods({
        visible: [method({ id: 'pm-1', name: 'Cash', type: 'CASH', sort_order: 1 })],
        available: [
            method({ id: 'pm-1', name: 'Cash', type: 'CASH', sort_order: 1 }),
            method({ id: 'pm-2', name: 'bKash', type: 'MOBILE_WALLET', show_on_entry: false, sort_order: 2 }),
        ],
    });
});

describe('PaymentSection', () => {
    it('stops re-rendering after payment methods load', async () => {
        const onPaymentChange = jest.fn();
        const { container } = render(
            <PaymentSection {...strip} payments={[]} total={100} onPaymentChange={onPaymentChange} />,
        );

        await waitFor(() => {
            expect(screen.getByLabelText('Cash amount')).toBeInTheDocument();
        });

        await new Promise((resolve) => setTimeout(resolve, 50));

        let mutationCount = 0;
        const observer = new MutationObserver(() => {
            mutationCount += 1;
        });
        observer.observe(container, {
            subtree: true,
            attributes: true,
            childList: true,
        });

        await new Promise((resolve) => setTimeout(resolve, 200));
        observer.disconnect();

        expect(mutationCount).toBeLessThan(5);
    });

    it('shows only show_on_entry methods by default, revealing others via the Add method picker', async () => {
        const onPaymentChange = jest.fn();
        render(
            <PaymentSection {...strip} payments={[]} total={100} onPaymentChange={onPaymentChange} />,
        );

        // Until the branch's methods land the strip shows the generic boxes,
        // and no picker.
        await settle();
        expect(screen.getByLabelText('Cash amount')).toBeInTheDocument();

        expect(screen.queryByLabelText('bKash amount')).not.toBeInTheDocument();

        const picker = screen.getByLabelText('Add payment method');
        fireEvent.change(picker, { target: { value: 'pm-2' } });

        await waitFor(() => {
            expect(screen.getByLabelText('bKash amount')).toBeInTheDocument();
        });
    });

    describe('cheque / bank details', () => {
        const bankOnly = [
            { id: 'pm-3', name: 'City Bank', type: 'Bank', is_active: true, show_on_entry: true, sort_order: 1 },
        ];

        /**
         * The panel is offered only once money has come in on that tender, so
         * every test here types an amount first — a cheque number with no
         * amount beside it records nothing.
         */
        async function renderWithBankAmount(amount = 5000) {
            mockMethods({ visible: bankOnly });
            const onPaymentChange = jest.fn();
            const { rerender } = render(
                <PaymentSection {...strip} payments={[]} total={amount} onPaymentChange={onPaymentChange} />,
            );
            await waitFor(() => expect(screen.getByLabelText('City Bank amount')).toBeInTheDocument());

            fireEvent.change(screen.getByLabelText('City Bank amount'), { target: { value: String(amount) } });
            const payments = onPaymentChange.mock.calls.at(-1)![0];
            rerender(<PaymentSection {...strip} payments={payments} total={amount} onPaymentChange={onPaymentChange} />);
            return { onPaymentChange, rerender, amount };
        }

        it('offers the details panel on a bank tender, but only once an amount is entered', async () => {
            mockMethods({ visible: bankOnly });
            const onPaymentChange = jest.fn();
            const { rerender } = render(
                <PaymentSection {...strip} payments={[]} total={5000} onPaymentChange={onPaymentChange} />,
            );
            await waitFor(() => expect(screen.getByLabelText('City Bank amount')).toBeInTheDocument());

            expect(screen.queryByText('+ Bank / cheque details')).not.toBeInTheDocument();

            fireEvent.change(screen.getByLabelText('City Bank amount'), { target: { value: '5000' } });
            rerender(
                <PaymentSection
                    {...strip}
                    payments={onPaymentChange.mock.calls.at(-1)![0]}
                    total={5000}
                    onPaymentChange={onPaymentChange}
                />,
            );

            expect(screen.getByText('+ Bank / cheque details')).toBeInTheDocument();
        });

        it('sends the bank, the account and the cheque number with the payment', async () => {
            const { onPaymentChange, rerender, amount } = await renderWithBankAmount();

            fireEvent.click(screen.getByText('+ Bank / cheque details'));
            for (const [label, value] of [
                ['City Bank Bank', 'City Bank'],
                ['City Bank Branch', 'Gulshan'],
                ['City Bank A/C number', '1234567890'],
                ['City Bank Cheque / ref. no.', 'CHQ-889001'],
                ['City Bank Cheque date', '2026-09-25'],
            ]) {
                fireEvent.change(screen.getByLabelText(label), { target: { value } });
                rerender(
                    <PaymentSection
                        {...strip}
                        payments={onPaymentChange.mock.calls.at(-1)![0]}
                        total={amount}
                        onPaymentChange={onPaymentChange}
                    />,
                );
            }

            expect(onPaymentChange.mock.calls.at(-1)![0]).toEqual([
                expect.objectContaining({
                    method: 'Bank',
                    amount: 5000,
                    bankName: 'City Bank',
                    bankBranch: 'Gulshan',
                    bankAccountNumber: '1234567890',
                    referenceNo: 'CHQ-889001',
                    instrumentDate: '2026-09-25',
                }),
            ]);
        });

        it('summarises a recorded cheque on the collapsed toggle', async () => {
            mockMethods({ visible: bankOnly });

            render(
                <PaymentSection
                    {...strip}
                    payments={[{ method: 'Bank', label: 'City Bank', amount: 5000, referenceNo: 'CHQ-889001', bankName: 'City Bank' }]}
                    total={5000}
                    onPaymentChange={jest.fn()}
                />,
            );

            // The amount box first: until the tenant's methods have loaded the
            // strip is still showing the generic fallback, and the row is
            // rekeyed (and momentarily blank) when they arrive.
            await waitFor(() => expect(screen.getByLabelText('City Bank amount')).toHaveValue(5000));
            expect(screen.getByText('CHQ-889001 · City Bank')).toBeInTheDocument();
        });

        it('fills the boxes back in from a saved payment', async () => {
            mockMethods({ visible: bankOnly });

            render(
                <PaymentSection
                    {...strip}
                    payments={[{ method: 'Bank', label: 'City Bank', amount: 5000, referenceNo: 'CHQ-889001' }]}
                    total={5000}
                    onPaymentChange={jest.fn()}
                />,
            );

            await waitFor(() => expect(screen.getByLabelText('City Bank amount')).toHaveValue(5000));
            fireEvent.click(screen.getByText('CHQ-889001'));

            expect(screen.getByLabelText('City Bank Cheque / ref. no.')).toHaveValue('CHQ-889001');
        });

        it('keeps a typed cheque while the amount box is cleared to retype it', async () => {
            const { onPaymentChange, rerender, amount } = await renderWithBankAmount();

            fireEvent.click(screen.getByText('+ Bank / cheque details'));
            fireEvent.change(screen.getByLabelText('City Bank Cheque / ref. no.'), { target: { value: 'CHQ-889001' } });
            rerender(
                <PaymentSection
                    {...strip}
                    payments={onPaymentChange.mock.calls.at(-1)![0]}
                    total={amount}
                    onPaymentChange={onPaymentChange}
                />,
            );

            // Emptying the box drops the payment for a keystroke. The panel has
            // to survive that, or correcting a figure costs you the cheque.
            fireEvent.change(screen.getByLabelText('City Bank amount'), { target: { value: '' } });
            rerender(
                <PaymentSection
                    {...strip}
                    payments={onPaymentChange.mock.calls.at(-1)![0]}
                    total={amount}
                    onPaymentChange={onPaymentChange}
                />,
            );
            expect(screen.getByLabelText('City Bank Cheque / ref. no.')).toHaveValue('CHQ-889001');

            fireEvent.change(screen.getByLabelText('City Bank amount'), { target: { value: '4500' } });
            expect(onPaymentChange.mock.calls.at(-1)![0]).toEqual([
                expect.objectContaining({ amount: 4500, referenceNo: 'CHQ-889001' }),
            ]);
        });

        it('clears the panel once the cart is emptied after checkout', async () => {
            const { onPaymentChange, rerender, amount } = await renderWithBankAmount();

            fireEvent.click(screen.getByText('+ Bank / cheque details'));
            fireEvent.change(screen.getByLabelText('City Bank Cheque / ref. no.'), { target: { value: 'CHQ-889001' } });
            rerender(<PaymentSection {...strip} payments={[]} total={amount} onPaymentChange={onPaymentChange} />);

            await waitFor(() => {
                expect(screen.queryByLabelText('City Bank Cheque / ref. no.')).not.toBeInTheDocument();
            });
            expect(screen.getByLabelText('City Bank amount')).toHaveValue(null);
        });

        it('offers nothing to fill in on a cash tender', async () => {
            mockMethods({ visible: [
                { id: 'pm-1', name: 'Cash', type: 'Cash', is_active: true, show_on_entry: true, sort_order: 1 },
            ] });
            const onPaymentChange = jest.fn();
            const { rerender } = render(
                <PaymentSection {...strip} payments={[]} total={100} onPaymentChange={onPaymentChange} />,
            );
            // The generic Cash box is there from the start, but locked until the branch's methods land.
            await settle();
            expect(screen.getByLabelText('Cash amount')).toBeEnabled();

            fireEvent.change(screen.getByLabelText('Cash amount'), { target: { value: '100' } });
            rerender(
                <PaymentSection
                    {...strip}
                    payments={onPaymentChange.mock.calls.at(-1)![0]}
                    total={100}
                    onPaymentChange={onPaymentChange}
                />,
            );

            expect(screen.queryByText('+ Bank / cheque details')).not.toBeInTheDocument();
            expect(screen.queryByText('+ Payment details')).not.toBeInTheDocument();
        });

        it('names a wallet transaction rather than a cheque', async () => {
            mockMethods({ visible: [
                { id: 'pm-2', name: 'bKash', type: 'Mobile Wallet', is_active: true, show_on_entry: true, sort_order: 1 },
            ] });
            const onPaymentChange = jest.fn();
            const { rerender } = render(
                <PaymentSection {...strip} payments={[]} total={100} onPaymentChange={onPaymentChange} />,
            );
            await waitFor(() => expect(screen.getByLabelText('bKash amount')).toBeInTheDocument());

            fireEvent.change(screen.getByLabelText('bKash amount'), { target: { value: '100' } });
            rerender(
                <PaymentSection
                    {...strip}
                    payments={onPaymentChange.mock.calls.at(-1)![0]}
                    total={100}
                    onPaymentChange={onPaymentChange}
                />,
            );

            fireEvent.click(screen.getByText('+ Payment details'));
            expect(screen.getByLabelText('bKash Transaction ID')).toBeInTheDocument();
            expect(screen.getByLabelText('bKash Wallet number')).toBeInTheDocument();
            expect(screen.queryByLabelText('bKash Branch')).not.toBeInTheDocument();
        });

        it('lists a recorded cheque under the payment when read-only', async () => {
            render(
                <PaymentSection
                    {...strip}
                    payments={[{ method: 'Bank', label: 'City Bank', amount: 5000, referenceNo: 'CHQ-889001', bankName: 'City Bank' }]}
                    total={5000}
                    onPaymentChange={jest.fn()}
                    readOnly
                />,
            );

            expect(screen.getByText('CHQ-889001 · City Bank')).toBeInTheDocument();
        });
    });

    describe('paying more than the total', () => {
        const cash = (amount: number) => [{ method: 'Cash', label: 'Cash', amount }];
        const customer = { id: 'cust-1', name: 'Rahim Store', due_balance: 400 };

        it('notes the excess going toward the previous due, without a warning', async () => {
            render(
                <PaymentSection {...strip} payments={cash(1150)} total={850} customer={customer} onPaymentChange={jest.fn()} />,
            );

            await waitFor(() => expect(screen.getByLabelText('Cash amount')).toBeInTheDocument());
            expect(screen.getByText(/৳\s?300\.00 goes toward the previous due/)).toBeInTheDocument();
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            expect(screen.getByText(/On account/)).toBeInTheDocument();
        });

        it('warns, without blocking, when the excess runs past the previous due', async () => {
            render(
                <PaymentSection {...strip} payments={cash(1500)} total={850} customer={customer} onPaymentChange={jest.fn()} />,
            );

            const alert = await screen.findByRole('alert');
            expect(alert).toHaveTextContent(/Paid ৳\s?250\.00 more than this sale and the previous due/);
            expect(alert).toHaveTextContent(/৳\s?400\.00 settles the previous due/);
            expect(alert).toHaveTextContent(/advance on Rahim Store's account/);
        });

        it('settles the previous due the server reports, not the customer\'s balance today', async () => {
            render(
                <PaymentSection
                    {...strip}
                    payments={cash(1000)}
                    total={850}
                    customer={customer}
                    previousDue={0}
                    onPaymentChange={jest.fn()}
                />,
            );

            const alert = await screen.findByRole('alert');
            expect(alert).toHaveTextContent(/Paid ৳\s?150\.00 more than this sale\. The/);
        });

        it('calls a walk-in\'s excess change', async () => {
            render(<PaymentSection {...strip} payments={cash(1000)} total={850} onPaymentChange={jest.fn()} />);

            const alert = await screen.findByRole('alert');
            expect(alert).toHaveTextContent(/change to hand back/);
            expect(screen.getByText(/^Change/)).toBeInTheDocument();
        });

        it('says nothing where the excess would not be posted', async () => {
            render(
                <PaymentSection
                    {...strip}
                    payments={cash(1500)}
                    total={850}
                    customer={customer}
                    warnOnOverpayment={false}
                    onPaymentChange={jest.fn()}
                />,
            );

            await waitFor(() => expect(screen.getByLabelText('Cash amount')).toBeInTheDocument());
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });
    });

    it('falls back to generic methods when all defined methods are inactive', async () => {
        const { api } = require('@/lib/api');
        // Nothing active at the branch; its list still carries the switched-off rows.
        mockMethods({
            visible: [],
            available: [],
            branch: [
                { id: 'pm-1', name: 'Cash', type: 'CASH', is_active: false, show_on_entry: true, sort_order: 1 },
                { id: 'pm-2', name: 'bKash', type: 'MOBILE_WALLET', is_active: false, show_on_entry: true, sort_order: 2 },
            ],
        });

        render(
            <PaymentSection {...strip} payments={[]} total={100} onPaymentChange={jest.fn()} />,
        );
        await waitFor(() => expect(api.getPaymentMethods).toHaveBeenCalled());
        await act(async () => {});

        // Generic fallback keeps payment possible even though every defined method is inactive.
        expect(screen.getByLabelText('Cash amount')).toBeInTheDocument();
        expect(screen.getByLabelText('Card amount')).toBeInTheDocument();
        expect(screen.getByLabelText('Bank amount')).toBeInTheDocument();
        expect(screen.queryByLabelText('bKash amount')).not.toBeInTheDocument();
    });

    it('the generic fallback sends no paymentMethodId', async () => {
        mockMethods({ visible: [], available: [] });
        const onPaymentChange = jest.fn();
        render(<PaymentSection {...strip} payments={[]} total={100} onPaymentChange={onPaymentChange} />);
        await settle();

        fireEvent.change(screen.getByLabelText('Cash amount'), { target: { value: '100' } });

        const [payment] = onPaymentChange.mock.calls.at(-1)![0];
        expect(payment).toMatchObject({ method: 'Cash', label: 'Cash', amount: 100 });
        expect(payment).not.toHaveProperty('paymentMethodId');
    });

    it('locks the boxes until the layout and the branch\'s methods have loaded', async () => {
        const { api } = require('@/lib/api');
        let answerLayout!: (value: unknown) => void;
        (api.getPaymentLayout as jest.Mock).mockImplementationOnce(
            () => new Promise((resolve) => { answerLayout = resolve; }),
        );
        (api.getPaymentMethods as jest.Mock).mockResolvedValue([CASH, BKASH, NAGAD]);
        const onPaymentChange = jest.fn();
        render(
            <PaymentSection
                {...strip}
                payments={[{ method: 'Mobile Wallet', label: 'Nagad', amount: 40 }]}
                total={100}
                onPaymentChange={onPaymentChange}
            />,
        );

        // The generic boxes stand in meanwhile, but take no input: a figure
        // typed here would send the Nagad payment out as "Mobile Wallet".
        const generic = screen.getAllByRole('spinbutton');
        expect(generic.length).toBeGreaterThan(0);
        generic.forEach((input) => expect(input).toBeDisabled());
        fireEvent.change(screen.getByLabelText('Cash amount'), { target: { value: '5' } });
        expect(onPaymentChange).not.toHaveBeenCalled();

        await act(async () => {
            answerLayout({ customised: false, visible: [CASH, BKASH], available: [CASH, BKASH, NAGAD] });
        });
        await settle();
        expect(amountBoxes()).toEqual(['Cash amount', 'bKash amount', 'Nagad amount']);
        expect(screen.getByLabelText('Nagad amount')).toHaveValue(40);
        screen.getAllByRole('spinbutton').forEach((input) => expect(input).toBeEnabled());
    });

    it('leaves the generic boxes usable once loading finds no active method', async () => {
        mockMethods({ visible: [], available: [] });
        render(<PaymentSection {...strip} payments={[]} total={100} onPaymentChange={jest.fn()} />);
        await settle();

        expect(amountBoxes()).toEqual(['Cash amount', 'Mobile Wallet amount', 'Card amount', 'Bank amount']);
        screen.getAllByRole('spinbutton').forEach((input) => expect(input).toBeEnabled());
    });

    describe('the user\'s layout', () => {
        it('renders the user\'s visible methods in layout order', async () => {
            mockMethods({ visible: [BKASH, CARD, CASH], available: [CASH, BKASH, NAGAD, CARD] });
            render(<PaymentSection {...strip} payments={[]} total={100} onPaymentChange={jest.fn()} />);

            await waitFor(() => expect(amountBoxes()).toEqual(['bKash amount', 'Card amount', 'Cash amount']));
            // The rest of what the branch offers waits in the picker.
            const picker = screen.getByLabelText('Add payment method');
            expect(Array.from(picker.querySelectorAll('option')).map((o) => o.textContent))
                .toEqual(['+ Add method…', 'Nagad']);
        });

        it('requests the layout for the given storeId and context', async () => {
            const { api } = require('@/lib/api');
            mockMethods({ visible: [CASH] });
            const { rerender } = render(
                <PaymentSection context="purchase" storeId="store-banani" payments={[]} total={100} onPaymentChange={jest.fn()} />,
            );
            await settle();

            expect(api.getPaymentLayout).toHaveBeenCalledTimes(1);
            expect(api.getPaymentLayout).toHaveBeenCalledWith('store-banani', 'purchase');
            // The branch's whole list, switched-off methods included, to match saved payments against.
            expect(api.getPaymentMethods).toHaveBeenCalledTimes(1);
            expect(api.getPaymentMethods).toHaveBeenCalledWith(undefined, 'store-banani');

            // A re-render for the same branch asks again for nothing.
            rerender(
                <PaymentSection context="purchase" storeId="store-banani" payments={[]} total={200} onPaymentChange={jest.fn()} />,
            );
            await settle();
            expect(api.getPaymentLayout).toHaveBeenCalledTimes(1);

            rerender(
                <PaymentSection context="purchase" storeId="store-gulshan" payments={[]} total={200} onPaymentChange={jest.fn()} />,
            );
            await settle();
            expect(api.getPaymentLayout).toHaveBeenCalledTimes(2);
            expect(api.getPaymentLayout).toHaveBeenLastCalledWith('store-gulshan', 'purchase');
            expect(api.getPaymentMethods).toHaveBeenLastCalledWith(undefined, 'store-gulshan');
        });

        it('ignores a layout that arrives after the branch changed', async () => {
            const { api } = require('@/lib/api');
            let answerBanani!: (value: unknown) => void;
            (api.getPaymentLayout as jest.Mock)
                .mockImplementationOnce(() => new Promise((resolve) => { answerBanani = resolve; }))
                .mockResolvedValueOnce({ customised: false, visible: [CASH], available: [CASH] });
            (api.getPaymentMethods as jest.Mock).mockResolvedValue([CASH, NAGAD]);

            const { rerender } = render(
                <PaymentSection {...strip} storeId="store-banani" payments={[]} total={100} onPaymentChange={jest.fn()} />,
            );
            rerender(
                <PaymentSection {...strip} storeId="store-gulshan" payments={[]} total={100} onPaymentChange={jest.fn()} />,
            );
            await waitFor(() => expect(amountBoxes()).toEqual(['Cash amount']));

            await act(async () => {
                answerBanani({ customised: false, visible: [NAGAD], available: [NAGAD] });
            });
            expect(amountBoxes()).toEqual(['Cash amount']);
        });

        it('emits paymentMethodId for a defined method', async () => {
            mockMethods({ visible: [CASH, BKASH] });
            const onPaymentChange = jest.fn();
            render(<PaymentSection {...strip} payments={[]} total={100} onPaymentChange={onPaymentChange} />);
            await waitFor(() => expect(amountBoxes()).toEqual(['Cash amount', 'bKash amount']));

            fireEvent.change(screen.getByLabelText('bKash amount'), { target: { value: '100' } });

            expect(onPaymentChange.mock.calls.at(-1)![0]).toEqual([
                {
                    method: 'Mobile Wallet',
                    label: 'bKash',
                    paymentMethodId: 'pm-bkash',
                    accountId: 'acc-bkash',
                    amount: 100,
                },
            ]);
        });
    });

    /**
     * A saved document is edited without losing a payment, whatever spelling
     * it was stored under. The two reproductions are from
     * docs/dynamic-payment-methods-plan.md §2.4.
     */
    describe('reopening a saved document', () => {
        it('৳60 CASH + ৳40 BKASH reopens filled; typing 5 into Card emits [CASH 60, BKASH 40, Card 5]', async () => {
            mockMethods({ visible: [CASH, BKASH, CARD] });
            const onPaymentChange = jest.fn();
            render(
                <PaymentSection
                    {...strip}
                    payments={[{ method: 'CASH', amount: 60 }, { method: 'BKASH', amount: 40 }]}
                    total={105}
                    onPaymentChange={onPaymentChange}
                />,
            );

            await settle();
            expect(screen.getByLabelText('Cash amount')).toHaveValue(60);
            expect(screen.getByLabelText('bKash amount')).toHaveValue(40);

            fireEvent.change(screen.getByLabelText('Card amount'), { target: { value: '5' } });

            expect(onPaymentChange.mock.calls.at(-1)![0]).toEqual([
                expect.objectContaining({ method: 'Cash', label: 'Cash', paymentMethodId: 'pm-cash', amount: 60 }),
                expect.objectContaining({ method: 'Mobile Wallet', label: 'bKash', paymentMethodId: 'pm-bkash', amount: 40 }),
                expect.objectContaining({ method: 'Card', label: 'Card', paymentMethodId: 'pm-card', amount: 5 }),
            ]);
        });

        it('৳50 Cash + ৳30 bKash + ৳20 Nagad reopens with all three filled', async () => {
            mockMethods({ visible: [CASH, BKASH, NAGAD, CARD] });
            const onPaymentChange = jest.fn();
            render(
                <PaymentSection
                    {...strip}
                    payments={[
                        { method: 'Cash', amount: 50 },
                        { method: 'bKash', amount: 30 },
                        { method: 'Nagad', amount: 20 },
                    ]}
                    total={105}
                    onPaymentChange={onPaymentChange}
                />,
            );

            await settle();
            expect(screen.getByLabelText('bKash amount')).toHaveValue(30);
            expect(screen.getByLabelText('Cash amount')).toHaveValue(50);
            expect(screen.getByLabelText('Nagad amount')).toHaveValue(20);

            fireEvent.change(screen.getByLabelText('Card amount'), { target: { value: '5' } });
            expect(onPaymentChange.mock.calls.at(-1)![0].map((p: any) => [p.label, p.amount])).toEqual([
                ['Cash', 50],
                ['bKash', 30],
                ['Nagad', 20],
                ['Card', 5],
            ]);
        });

        it('a payment on a hidden method still shows with its amount', async () => {
            // bKash is offered here, but this user hid it from their strip.
            mockMethods({ visible: [CASH], available: [CASH, BKASH] });
            const onPaymentChange = jest.fn();
            const { rerender } = render(
                <PaymentSection
                    {...strip}
                    payments={[{ method: 'Mobile Wallet', label: 'bKash', paymentMethodId: 'pm-bkash', amount: 100 }]}
                    total={100}
                    onPaymentChange={onPaymentChange}
                />,
            );

            await settle();
            expect(amountBoxes()).toEqual(['Cash amount', 'bKash amount']);
            expect(screen.getByLabelText('bKash amount')).toHaveValue(100);

            // Emptying the box to retype the figure must not take the row away.
            fireEvent.change(screen.getByLabelText('bKash amount'), { target: { value: '' } });
            rerender(
                <PaymentSection {...strip} payments={onPaymentChange.mock.calls.at(-1)![0]} total={100} onPaymentChange={onPaymentChange} />,
            );
            expect(screen.getByLabelText('bKash amount')).toHaveValue(null);
            fireEvent.change(screen.getByLabelText('bKash amount'), { target: { value: '90' } });
            expect(onPaymentChange.mock.calls.at(-1)![0]).toEqual([
                expect.objectContaining({ paymentMethodId: 'pm-bkash', amount: 90 }),
            ]);
        });

        it('a payment on a switched-off method shows, marked inactive, with its amount', async () => {
            const offNagad = { ...NAGAD, is_active: false };
            mockMethods({ visible: [CASH], available: [CASH], branch: [CASH, offNagad] });
            render(
                <PaymentSection
                    {...strip}
                    payments={[{ method: 'Mobile Wallet', label: 'Nagad', paymentMethodId: 'pm-nagad', amount: 100 }]}
                    total={100}
                    onPaymentChange={jest.fn()}
                />,
            );

            await settle();
            expect(screen.getByLabelText('Nagad amount')).toHaveValue(100);
            expect(screen.getByText('(inactive)')).toBeInTheDocument();
        });

        it('an unmatched payment shows as its own row and survives a change elsewhere', async () => {
            mockMethods({ visible: [CASH] });
            const onPaymentChange = jest.fn();
            const legacy = { method: 'Old Wallet', amount: 70, referenceNo: 'TRX-1' };
            const { rerender } = render(
                <PaymentSection {...strip} payments={[legacy]} total={100} onPaymentChange={onPaymentChange} />,
            );
            await settle();
            expect(screen.getByLabelText('Old Wallet amount')).toHaveValue(70);

            fireEvent.change(screen.getByLabelText('Cash amount'), { target: { value: '30' } });
            // Sent back as it was saved, so the server's name path still reads it.
            expect(onPaymentChange.mock.calls.at(-1)![0]).toEqual([
                expect.objectContaining({ label: 'Cash', paymentMethodId: 'pm-cash', amount: 30 }),
                legacy,
            ]);

            rerender(
                <PaymentSection {...strip} payments={onPaymentChange.mock.calls.at(-1)![0]} total={100} onPaymentChange={onPaymentChange} />,
            );
            expect(screen.getByLabelText('Old Wallet amount')).toHaveValue(70);

            // Its amount stays editable; nothing else about it changes.
            fireEvent.change(screen.getByLabelText('Old Wallet amount'), { target: { value: '60' } });
            expect(onPaymentChange.mock.calls.at(-1)![0]).toEqual([
                expect.objectContaining({ label: 'Cash', amount: 30 }),
                { ...legacy, amount: 60 },
            ]);
        });

        it('a payment saved under a name another method now has keeps its own row and original id', async () => {
            // Taken on bKash (pm-x), since renamed "bKash Gulshan" and limited
            // to Gulshan; the "bKash" here is a new method for this branch.
            const newBkash = method({ id: 'pm-y', name: 'bKash', type: 'Mobile Wallet', account_id: 'acc-y', sort_order: 2 });
            mockMethods({ visible: [CASH, newBkash] });
            const onPaymentChange = jest.fn();
            const saved = { method: 'Mobile Wallet', label: 'bKash', paymentMethodId: 'pm-x', amount: 40 };
            render(<PaymentSection {...strip} payments={[saved]} total={100} onPaymentChange={onPaymentChange} />);
            await settle();

            // This branch's bKash stays empty; the saved payment has a row of its own.
            expect(screen.getAllByLabelText('bKash amount').map((input) => (input as HTMLInputElement).value))
                .toEqual(['', '40']);

            fireEvent.change(screen.getByLabelText('Cash amount'), { target: { value: '60' } });
            expect(onPaymentChange.mock.calls.at(-1)![0]).toEqual([
                expect.objectContaining({ paymentMethodId: 'pm-cash', amount: 60 }),
                saved,
            ]);
        });

        it('keeps a payment whose method moved to another branch under its own name', async () => {
            // Taken on "bKash Gulshan"; this branch's bKash is another till.
            mockMethods({ visible: [CASH, BKASH] });
            const onPaymentChange = jest.fn();
            const moved = { method: 'Mobile Wallet', label: 'bKash Gulshan', paymentMethodId: 'pm-gulshan', amount: 40 };
            render(<PaymentSection {...strip} payments={[moved]} total={100} onPaymentChange={onPaymentChange} />);
            await settle();

            expect(screen.getByLabelText('bKash Gulshan amount')).toHaveValue(40);
            expect(screen.getByLabelText('bKash amount')).toHaveValue(null);

            fireEvent.change(screen.getByLabelText('Cash amount'), { target: { value: '60' } });
            expect(onPaymentChange.mock.calls.at(-1)![0]).toEqual([
                expect.objectContaining({ paymentMethodId: 'pm-cash', amount: 60 }),
                moved,
            ]);
        });
    });
});

/** The accessible names of the strip's amount boxes, top to bottom. */
function amountBoxes() {
    return screen.queryAllByRole('spinbutton').map((input) => input.getAttribute('aria-label'));
}

/** Lets the layout and the branch's method list land. */
async function settle() {
    const { api } = require('@/lib/api');
    await waitFor(() => expect(api.getPaymentLayout).toHaveBeenCalled());
    const answers = [api.getPaymentLayout, api.getPaymentMethods]
        .flatMap((fn: jest.Mock) => fn.mock.results.map((r) => r.value));
    await act(async () => {
        await Promise.allSettled(answers);
        // A macrotask, so the strip's own handlers on those answers have run.
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}
