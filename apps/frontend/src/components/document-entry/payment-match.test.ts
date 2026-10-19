import { matchPaymentToMethod } from './payment-match';

const CASH = { id: 'pm-cash', name: 'Hand Cash', type: 'Cash', is_active: true };
const BKASH = { id: 'pm-bkash', name: 'bKash', type: 'Mobile Wallet', is_active: true };
const NAGAD = { id: 'pm-nagad', name: 'Nagad', type: 'Mobile Wallet', is_active: true };
const CARD = { id: 'pm-card', name: 'City Card', type: 'Card', is_active: true };
const METHODS = [CASH, BKASH, NAGAD, CARD];

describe('matchPaymentToMethod', () => {
    it('matches the method the payment was taken on by id, before its label', () => {
        expect(matchPaymentToMethod(METHODS, {
            method: 'Mobile Wallet',
            label: 'bKash',
            paymentMethodId: 'pm-nagad',
            amount: 10,
        })).toBe(NAGAD);
    });

    it('matches the saved method name, ignoring case', () => {
        expect(matchPaymentToMethod(METHODS, { method: 'Card', label: 'CITY CARD', amount: 10 })).toBe(CARD);
    });

    it('prefers the exact spelling when two names differ only in case', () => {
        const shouty = { id: 'pm-shouty', name: 'BKASH', type: 'Mobile Wallet', is_active: true };
        expect(matchPaymentToMethod([shouty, BKASH], { method: 'bKash', amount: 10 })).toBe(BKASH);
    });

    it.each([
        ['CASH', CASH],
        ['cash', CASH],
        ['BKASH', BKASH],
        ['bKash', BKASH],
        ['bkash', BKASH],
        ['NAGAD', NAGAD],
        ['Nagad', NAGAD],
        ['nagad', NAGAD],
    ])('reads the legacy string %s as its method', (legacy, expected) => {
        expect(matchPaymentToMethod(METHODS, { method: legacy, amount: 10 })).toBe(expected);
    });

    it('a Mobile Wallet payment labelled Nagad matches Nagad, not bKash', () => {
        expect(matchPaymentToMethod(METHODS, { method: 'Mobile Wallet', label: 'Nagad', amount: 10 })).toBe(NAGAD);
    });

    it('falls back to the first method of the payment\'s type', () => {
        expect(matchPaymentToMethod(METHODS, { method: 'Mobile Wallet', amount: 10 })).toBe(BKASH);
        // POS writes the type in capitals.
        expect(matchPaymentToMethod(METHODS, { method: 'CARD', amount: 10 })).toBe(CARD);
    });

    it('does not fall back to a switched-off method of that type', () => {
        const offBkash = { ...BKASH, is_active: false };
        expect(matchPaymentToMethod([CASH, offBkash, NAGAD], { method: 'Mobile Wallet', amount: 10 })).toBe(NAGAD);
        expect(matchPaymentToMethod([CASH, offBkash], { method: 'Mobile Wallet', amount: 10 })).toBeUndefined();
    });

    it('still finds a switched-off method by id or by name', () => {
        const offBkash = { ...BKASH, is_active: false };
        expect(matchPaymentToMethod([CASH, offBkash], { method: 'Mobile Wallet', paymentMethodId: 'pm-bkash', amount: 10 }))
            .toBe(offBkash);
        expect(matchPaymentToMethod([CASH, offBkash], { method: 'BKASH', amount: 10 })).toBe(offBkash);
    });

    it('does not swap a payment whose method is gone for another of the same type', () => {
        // Taken on "bKash Gulshan", which has since moved to another branch:
        // the bKash here is a different till, and guessing it would move the
        // money.
        expect(matchPaymentToMethod(METHODS, {
            method: 'Mobile Wallet',
            label: 'bKash Gulshan',
            paymentMethodId: 'pm-elsewhere',
            amount: 10,
        })).toBeUndefined();
    });

    it.each(['bKash', 'BKASH'])(
        'a payment whose saved label equals a local method\'s name but carries another method\'s id keeps its own row and id (%s)',
        (label) => {
            // Taken on bKash (pm-x), since renamed "bKash Gulshan" and limited
            // to Gulshan; this branch's new "bKash" is another method.
            expect(matchPaymentToMethod(METHODS, {
                method: 'Mobile Wallet',
                label,
                paymentMethodId: 'pm-x',
                amount: 10,
            })).toBeUndefined();
        },
    );

    it('reads a legacy string only on a payment without an id', () => {
        expect(matchPaymentToMethod(METHODS, { method: 'CASH', paymentMethodId: 'pm-x', amount: 10 })).toBeUndefined();
    });

    it('matches nothing for a string that names no method or type', () => {
        expect(matchPaymentToMethod(METHODS, { method: 'Old Wallet', amount: 10 })).toBeUndefined();
    });
});
