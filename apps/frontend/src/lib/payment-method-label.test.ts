import { paymentMethodLabel } from './payment-method-label';

describe('paymentMethodLabel', () => {
    it('returns the stored display string unchanged', () => {
        // What `PaymentRecord.payment_method` holds for almost every row.
        expect(paymentMethodLabel('Cash')).toBe('Cash');
        expect(paymentMethodLabel('Card')).toBe('Card');
        expect(paymentMethodLabel('Bank')).toBe('Bank');
        expect(paymentMethodLabel('Mobile Wallet')).toBe('Mobile Wallet');
    });

    it('normalises a legacy uppercase key to its modern spelling', () => {
        // `CARD` used to print "Credit Card" while `Card` printed "Card",
        // so one payment type read as two across a tenant's documents.
        expect(paymentMethodLabel('CASH')).toBe('Cash');
        expect(paymentMethodLabel('CARD')).toBe('Card');
        expect(paymentMethodLabel('BANK')).toBe('Bank');
        expect(paymentMethodLabel('MOBILE_WALLET')).toBe('Mobile Wallet');
    });

    it('keeps the local wallet brands that predate the shared enum', () => {
        expect(paymentMethodLabel('bKash')).toBe('bKash');
        expect(paymentMethodLabel('BKASH')).toBe('bKash');
        expect(paymentMethodLabel('Nagad')).toBe('Nagad');
        expect(paymentMethodLabel('NAGAD')).toBe('Nagad');
    });

    it('passes through a name it does not know', () => {
        // A tenant may name a method anything; its own name beats a guess.
        expect(paymentMethodLabel('Cheque')).toBe('Cheque');
        expect(paymentMethodLabel('Rocket')).toBe('Rocket');
    });

    it('does not invent labels for values the system cannot produce', () => {
        // The old map carried BANK_TRANSFER/MOBILE_PAYMENT/OTHER, none of
        // which `PaymentMethodType` can emit — but old rows may hold them.
        expect(paymentMethodLabel('BANK_TRANSFER')).toBe('Bank');
        expect(paymentMethodLabel('MOBILE_PAYMENT')).toBe('Mobile Wallet');
    });
});
