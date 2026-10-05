import { netOfChange, splitSaleOverpayment } from './sale-overpayment.util';

describe('splitSaleOverpayment', () => {
    it('finds nothing to split on a sale paid exactly or short', () => {
        expect(splitSaleOverpayment({ total: 850, amountPaid: 850, hasCustomer: true }))
            .toEqual({ excess: 0, changeReturned: 0, accountPayment: 0 });
        expect(splitSaleOverpayment({ total: 850, amountPaid: 600, hasCustomer: true }))
            .toEqual({ excess: 0, changeReturned: 0, accountPayment: 0 });
    });

    it('puts a customer\'s excess on their account', () => {
        expect(splitSaleOverpayment({ total: 850, amountPaid: 1500, hasCustomer: true }))
            .toEqual({ excess: 650, changeReturned: 0, accountPayment: 650 });
    });

    it('makes a walk-in\'s excess change', () => {
        expect(splitSaleOverpayment({ total: 850, amountPaid: 1000, hasCustomer: false }))
            .toEqual({ excess: 150, changeReturned: 150, accountPayment: 0 });
    });

    it('makes a customer\'s excess change when the till handed it back', () => {
        expect(splitSaleOverpayment({ total: 850, amountPaid: 1000, hasCustomer: true, returnChange: true }))
            .toEqual({ excess: 150, changeReturned: 150, accountPayment: 0 });
    });

    it('rounds the excess to the paisa', () => {
        expect(splitSaleOverpayment({ total: 0.1 + 0.2, amountPaid: 1, hasCustomer: true }).excess).toBe(0.7);
    });
});

describe('netOfChange', () => {
    it('leaves the tenders alone when there is no change', () => {
        const payments = [{ paymentMethod: 'Cash', amount: 850 }];
        expect(netOfChange(payments, 0)).toBe(payments);
        expect(netOfChange(undefined, 150)).toBeUndefined();
    });

    it('takes the change out of cash', () => {
        expect(netOfChange([
            { paymentMethod: 'Card', amount: 500 },
            { paymentMethod: 'Cash', amount: 500 },
        ], 150)).toEqual([
            { paymentMethod: 'Card', amount: 500 },
            { paymentMethod: 'Cash', amount: 350 },
        ]);
    });

    it('drops a tender the change takes down to nothing', () => {
        expect(netOfChange([
            { paymentMethod: 'bKash', amount: 800 },
            { paymentMethod: 'Cash', amount: 100 },
        ], 100)).toEqual([{ paymentMethod: 'bKash', amount: 800 }]);
    });

    it('takes what cash cannot cover off the other tenders, last one first', () => {
        expect(netOfChange([
            { paymentMethod: 'Card', amount: 600 },
            { paymentMethod: 'bKash', amount: 300 },
            { paymentMethod: 'Cash', amount: 50 },
        ], 100)).toEqual([
            { paymentMethod: 'Card', amount: 600 },
            { paymentMethod: 'bKash', amount: 250 },
        ]);
    });

    it('keeps everything else on the tender, cheque details included', () => {
        expect(netOfChange([
            { paymentMethod: 'Bank', amount: 1000, referenceNo: 'CHQ-1' },
        ], 150)).toEqual([{ paymentMethod: 'Bank', amount: 850, referenceNo: 'CHQ-1' }]);
    });
});
