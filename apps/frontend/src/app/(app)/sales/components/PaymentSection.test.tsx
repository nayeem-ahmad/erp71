import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PaymentSection from './PaymentSection';

jest.mock('@/lib/api', () => ({
    api: {
        getPaymentMethods: jest.fn().mockResolvedValue([
            { id: 'pm-1', name: 'Cash', type: 'CASH', is_active: true, show_on_entry: true, sort_order: 1 },
            { id: 'pm-2', name: 'bKash', type: 'MOBILE_WALLET', is_active: true, show_on_entry: false, sort_order: 2 },
        ]),
    },
}));

describe('PaymentSection', () => {
    it('stops re-rendering after payment methods load', async () => {
        const onPaymentChange = jest.fn();
        const { container } = render(
            <PaymentSection payments={[]} total={100} onPaymentChange={onPaymentChange} />,
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
            <PaymentSection payments={[]} total={100} onPaymentChange={onPaymentChange} />,
        );

        await waitFor(() => {
            expect(screen.getByLabelText('Cash amount')).toBeInTheDocument();
        });

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
            const { api } = require('@/lib/api');
            (api.getPaymentMethods as jest.Mock).mockResolvedValue(bankOnly);
            const onPaymentChange = jest.fn();
            const { rerender } = render(
                <PaymentSection payments={[]} total={amount} onPaymentChange={onPaymentChange} />,
            );
            await waitFor(() => expect(screen.getByLabelText('City Bank amount')).toBeInTheDocument());

            fireEvent.change(screen.getByLabelText('City Bank amount'), { target: { value: String(amount) } });
            const payments = onPaymentChange.mock.calls.at(-1)![0];
            rerender(<PaymentSection payments={payments} total={amount} onPaymentChange={onPaymentChange} />);
            return { onPaymentChange, rerender, amount };
        }

        it('offers the details panel on a bank tender, but only once an amount is entered', async () => {
            const { api } = require('@/lib/api');
            (api.getPaymentMethods as jest.Mock).mockResolvedValue(bankOnly);
            const onPaymentChange = jest.fn();
            const { rerender } = render(
                <PaymentSection payments={[]} total={5000} onPaymentChange={onPaymentChange} />,
            );
            await waitFor(() => expect(screen.getByLabelText('City Bank amount')).toBeInTheDocument());

            expect(screen.queryByText('+ Bank / cheque details')).not.toBeInTheDocument();

            fireEvent.change(screen.getByLabelText('City Bank amount'), { target: { value: '5000' } });
            rerender(
                <PaymentSection
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
            const { api } = require('@/lib/api');
            (api.getPaymentMethods as jest.Mock).mockResolvedValue(bankOnly);

            render(
                <PaymentSection
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
            const { api } = require('@/lib/api');
            (api.getPaymentMethods as jest.Mock).mockResolvedValue(bankOnly);

            render(
                <PaymentSection
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
            rerender(<PaymentSection payments={[]} total={amount} onPaymentChange={onPaymentChange} />);

            await waitFor(() => {
                expect(screen.queryByLabelText('City Bank Cheque / ref. no.')).not.toBeInTheDocument();
            });
            expect(screen.getByLabelText('City Bank amount')).toHaveValue(null);
        });

        it('offers nothing to fill in on a cash tender', async () => {
            const { api } = require('@/lib/api');
            (api.getPaymentMethods as jest.Mock).mockResolvedValue([
                { id: 'pm-1', name: 'Cash', type: 'Cash', is_active: true, show_on_entry: true, sort_order: 1 },
            ]);
            const onPaymentChange = jest.fn();
            const { rerender } = render(
                <PaymentSection payments={[]} total={100} onPaymentChange={onPaymentChange} />,
            );
            await waitFor(() => expect(screen.getByLabelText('Cash amount')).toBeInTheDocument());

            fireEvent.change(screen.getByLabelText('Cash amount'), { target: { value: '100' } });
            rerender(
                <PaymentSection
                    payments={onPaymentChange.mock.calls.at(-1)![0]}
                    total={100}
                    onPaymentChange={onPaymentChange}
                />,
            );

            expect(screen.queryByText('+ Bank / cheque details')).not.toBeInTheDocument();
            expect(screen.queryByText('+ Payment details')).not.toBeInTheDocument();
        });

        it('names a wallet transaction rather than a cheque', async () => {
            const { api } = require('@/lib/api');
            (api.getPaymentMethods as jest.Mock).mockResolvedValue([
                { id: 'pm-2', name: 'bKash', type: 'Mobile Wallet', is_active: true, show_on_entry: true, sort_order: 1 },
            ]);
            const onPaymentChange = jest.fn();
            const { rerender } = render(
                <PaymentSection payments={[]} total={100} onPaymentChange={onPaymentChange} />,
            );
            await waitFor(() => expect(screen.getByLabelText('bKash amount')).toBeInTheDocument());

            fireEvent.change(screen.getByLabelText('bKash amount'), { target: { value: '100' } });
            rerender(
                <PaymentSection
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
                    payments={[{ method: 'Bank', label: 'City Bank', amount: 5000, referenceNo: 'CHQ-889001', bankName: 'City Bank' }]}
                    total={5000}
                    onPaymentChange={jest.fn()}
                    readOnly
                />,
            );

            expect(screen.getByText('CHQ-889001 · City Bank')).toBeInTheDocument();
        });
    });

    it('falls back to generic methods when all defined methods are inactive', async () => {
        const { api } = require('@/lib/api');
        (api.getPaymentMethods as jest.Mock).mockResolvedValueOnce([
            { id: 'pm-1', name: 'Cash', type: 'CASH', is_active: false, show_on_entry: true, sort_order: 1 },
            { id: 'pm-2', name: 'bKash', type: 'MOBILE_WALLET', is_active: false, show_on_entry: true, sort_order: 2 },
        ]);

        render(
            <PaymentSection payments={[]} total={100} onPaymentChange={jest.fn()} />,
        );

        // Generic fallback keeps payment possible even though every defined method is inactive.
        await waitFor(() => {
            expect(screen.getByLabelText('Cash amount')).toBeInTheDocument();
        });
        expect(screen.getByLabelText('Card amount')).toBeInTheDocument();
        expect(screen.getByLabelText('Bank amount')).toBeInTheDocument();
    });
});
