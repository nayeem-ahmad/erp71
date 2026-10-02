import { fireEvent, render, screen } from '@testing-library/react';
import { PaymentDiscountField, paymentDiscountError, remainderAfterPayment } from './PaymentDiscountField';

const labels = {
    label: 'Discount allowed',
    hint: 'hint',
    fillRemainder: 'Discount the remainder',
    settles: 'Settles {amount}',
    tooLarge: 'Too large: {amount}',
};

describe('remainderAfterPayment', () => {
    it('is what the money leaves due, to the paisa', () => {
        expect(remainderAfterPayment(10003.1, '10000')).toBe(3.1);
    });

    it('never goes below zero for an overpayment', () => {
        expect(remainderAfterPayment(100, '150')).toBe(0);
    });
});

describe('paymentDiscountError', () => {
    it('allows a discount up to the remainder', () => {
        expect(paymentDiscountError(100, '97', '3', labels.tooLarge)).toBeNull();
    });

    it('refuses a discount beyond the remainder', () => {
        expect(paymentDiscountError(100, '97', '4', labels.tooLarge)).toMatch(/^Too large: /);
    });

    it('leaves the check to the server when the due is unknown', () => {
        expect(paymentDiscountError(null, '97', '400', labels.tooLarge)).toBeNull();
    });
});

describe('PaymentDiscountField', () => {
    it('fills the remainder in one click', () => {
        const onChange = jest.fn();
        render(<PaymentDiscountField value="" onChange={onChange} amount="10000" dueBefore={10003} labels={labels} />);

        fireEvent.click(screen.getByRole('button', { name: 'Discount the remainder' }));

        expect(onChange).toHaveBeenCalledWith('3.00');
    });

    it('shows what the payment settles once a discount is entered', () => {
        render(<PaymentDiscountField value="3" onChange={jest.fn()} amount="10000" dueBefore={10003} labels={labels} />);

        expect(screen.getByTestId('payment-discount-settles').textContent).toMatch(/10,003/);
        // Already discounting the whole remainder: nothing left to fill.
        expect(screen.queryByRole('button', { name: 'Discount the remainder' })).toBeNull();
    });

    it('shows the error inline when the discount is too large', () => {
        render(<PaymentDiscountField value="5" onChange={jest.fn()} amount="10000" dueBefore={10003} labels={labels} />);

        expect(screen.getByRole('alert').textContent).toMatch(/^Too large: /);
    });
});
