import { instrumentFromRecord, instrumentSummary, paymentInstrumentSummary } from './payment-instrument';

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

describe('instrumentFromRecord', () => {
    it('reads a stored cheque back into the shape the form edits', () => {
        expect(instrumentFromRecord({
            bank_name: 'City Bank',
            bank_branch: 'Gulshan',
            bank_account_number: '1234567890',
            reference_no: 'CHQ-100231',
            // A DATE column comes back as midnight UTC; the day is all of it.
            instrument_date: '2026-10-05T00:00:00.000Z',
        })).toEqual({
            bankName: 'City Bank',
            bankBranch: 'Gulshan',
            bankAccountNumber: '1234567890',
            referenceNo: 'CHQ-100231',
            instrumentDate: '2026-10-05',
        });
    });

    it('turns the NULLs of a cash row into nothing at all', () => {
        const instrument = instrumentFromRecord({
            bank_name: null,
            bank_branch: null,
            bank_account_number: null,
            reference_no: null,
            instrument_date: null,
        });

        expect(instrumentSummary(instrument)).toBe('');
        expect(Object.values(instrument).every((value) => value === undefined)).toBe(true);
    });
});
