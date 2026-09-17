import { paymentRecordData } from './payment-record-data';

describe('paymentRecordData', () => {
    it('carries the cheque a customer handed over', () => {
        expect(paymentRecordData({
            paymentMethod: 'Bank',
            amount: 15000,
            accountId: 'acct-1',
            bankName: 'City Bank',
            bankBranch: 'Gulshan',
            bankAccountNumber: '1234567890',
            referenceNo: 'CHQ-889001',
            instrumentDate: '2026-09-25',
        })).toEqual({
            payment_method: 'Bank',
            amount: 15000,
            account_id: 'acct-1',
            bank_name: 'City Bank',
            bank_branch: 'Gulshan',
            bank_account_number: '1234567890',
            reference_no: 'CHQ-889001',
            instrument_date: new Date(Date.UTC(2026, 8, 25)),
        });
    });

    it('leaves every instrument column null for a cash payment', () => {
        expect(paymentRecordData({ paymentMethod: 'Cash', amount: 500 })).toEqual({
            payment_method: 'Cash',
            amount: 500,
            account_id: null,
            bank_name: null,
            bank_branch: null,
            bank_account_number: null,
            reference_no: null,
            instrument_date: null,
        });
    });

    it('stores a box that was opened and left empty as null, not as an empty string', () => {
        // The entry form sends '' for every field of a details panel the operator
        // expanded and abandoned. Stored verbatim those would be a second way of
        // saying "no cheque number", and a report filtering on one would miss the
        // other.
        const row = paymentRecordData({
            paymentMethod: 'Bank',
            amount: 100,
            bankName: '   ',
            bankBranch: '',
            referenceNo: '',
            instrumentDate: '',
        });

        expect(row.bank_name).toBeNull();
        expect(row.bank_branch).toBeNull();
        expect(row.reference_no).toBeNull();
        expect(row.instrument_date).toBeNull();
    });

    it('trims what is typed around a cheque number', () => {
        expect(paymentRecordData({
            paymentMethod: 'Bank',
            amount: 100,
            referenceNo: '  CHQ-889001 ',
        }).reference_no).toBe('CHQ-889001');
    });

    it('keeps the day written on the cheque whatever the server timezone', () => {
        // Regression guard: parsing '2026-09-25' as a local datetime and letting
        // Prisma send it to a UTC connection moves a Dhaka (UTC+6) cheque back to
        // the 24th. The date is anchored to UTC midnight instead.
        const stored = paymentRecordData({
            paymentMethod: 'Bank',
            amount: 100,
            instrumentDate: '2026-09-25',
        }).instrument_date;

        expect(stored?.toISOString()).toBe('2026-09-25T00:00:00.000Z');
    });
});
