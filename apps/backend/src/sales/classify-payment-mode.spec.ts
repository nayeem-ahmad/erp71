import { classifyPaymentMode } from './classify-payment-mode';

describe('classifyPaymentMode', () => {
    it.each([
        ['Cash', 'cash'],
        ['cash register', 'cash'],
        ['Bank', 'bank'],
        ['Card', 'bank'],
        ['bKash', 'bkash'],
        ['bKash Personal', 'bkash'],
        ['Nagad', 'nagad'],
        ['Credit', 'credit'],
    ] as const)('maps %s to %s', (method, expected) => {
        expect(classifyPaymentMode(method)).toBe(expected);
    });

    it('does not collapse bKash into bank', () => {
        // Regression: wallets used to map to 'bank', so the bKash Account never
        // received a posting and every wallet sale landed in Main Bank Account.
        expect(classifyPaymentMode('bKash')).not.toBe('bank');
    });

    it('falls back to cash for an unrecognised method', () => {
        // Known limitation: payment methods are tenant-configurable, so a method
        // named e.g. 'Upay' posts to cash. Tracked as a follow-up - the real fix is
        // wiring PaymentMethod.account_id into posting.
        expect(classifyPaymentMode('Upay')).toBe('cash');
    });
});
