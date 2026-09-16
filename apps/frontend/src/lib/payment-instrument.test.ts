import { instrumentSummary, paymentInstrumentSummary } from './payment-instrument';

describe('instrumentSummary', () => {
    it('leads with the cheque number, then the bank and the date', () => {
        expect(instrumentSummary({
            referenceNo: 'CHQ-889001',
            bankName: 'City Bank',
            bankBranch: 'Gulshan',
            bankAccountNumber: '1234567890',
            instrumentDate: '2026-09-25',
        })).toBe('CHQ-889001 · City Bank · 1234567890 · 2026-09-25');
    });

    it('is empty for a payment with no instrument', () => {
        expect(instrumentSummary(undefined)).toBe('');
        expect(instrumentSummary({})).toBe('');
    });

    it('ignores a box that was opened and left blank', () => {
        // The entry strip keeps what is typed untrimmed so a name can be typed
        // one word at a time; whitespace must not show up as a cheque number.
        expect(instrumentSummary({ referenceNo: '  ', bankName: 'City Bank' })).toBe('City Bank');
    });

    it('reads the instrument straight off a payment', () => {
        expect(paymentInstrumentSummary({
            method: 'Bank',
            amount: 5000,
            referenceNo: 'CHQ-889001',
        })).toBe('CHQ-889001');
    });

    it('says nothing about a cash payment', () => {
        expect(paymentInstrumentSummary({ method: 'Cash', amount: 500 })).toBe('');
    });
});
