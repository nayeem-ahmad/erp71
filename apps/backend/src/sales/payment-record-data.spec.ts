import type { ResolvedTender } from '../accounting/payment-account.util';
import { paymentRecordData } from './payment-record-data';

/** A tender as resolveTenders returns it; no method matched unless given. */
const tender = (row: Partial<ResolvedTender> = {}): ResolvedTender => ({
    paymentMethod: 'Cash',
    methodId: null,
    methodName: null,
    accountId: null,
    mode: 'cash',
    amount: 0,
    ...row,
});

describe('paymentRecordData', () => {
    it('writes the method, its name and the server-resolved account, ignoring the client accountId', () => {
        expect(paymentRecordData(
            { paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-bkash', amount: 500, accountId: 'acct-from-the-client' },
            tender({
                paymentMethod: 'Mobile Wallet',
                methodId: 'pm-bkash',
                methodName: 'bKash',
                accountId: 'acct-bkash',
                mode: 'bkash',
                amount: 500,
            }),
        )).toEqual(expect.objectContaining({
            payment_method: 'Mobile Wallet',
            payment_method_id: 'pm-bkash',
            payment_method_name: 'bKash',
            account_id: 'acct-bkash',
            amount: 500,
        }));
    });

    it('stores no method and no account for a tender that matched no method', () => {
        expect(paymentRecordData(
            { paymentMethod: 'Upay', amount: 50, accountId: 'acct-from-the-client' },
            tender({ paymentMethod: 'Upay', amount: 50 }),
        )).toEqual(expect.objectContaining({
            payment_method: 'Upay',
            payment_method_id: null,
            payment_method_name: null,
            account_id: null,
        }));
    });

    it('carries the cheque a customer handed over', () => {
        expect(paymentRecordData({
            paymentMethod: 'Bank',
            paymentMethodId: 'pm-bank',
            amount: 15000,
            accountId: 'acct-1',
            bankName: 'City Bank',
            bankBranch: 'Gulshan',
            bankAccountNumber: '1234567890',
            referenceNo: 'CHQ-889001',
            instrumentDate: '2026-09-25',
        }, tender({
            paymentMethod: 'Bank', methodId: 'pm-bank', methodName: 'Bank', accountId: 'acct-bank', mode: 'bank', amount: 15000,
        }))).toEqual({
            payment_method: 'Bank',
            payment_method_id: 'pm-bank',
            payment_method_name: 'Bank',
            amount: 15000,
            account_id: 'acct-bank',
            bank_name: 'City Bank',
            bank_branch: 'Gulshan',
            bank_account_number: '1234567890',
            reference_no: 'CHQ-889001',
            instrument_date: new Date(Date.UTC(2026, 8, 25)),
        });
    });

    it('leaves every instrument column null for a cash payment', () => {
        expect(paymentRecordData({ paymentMethod: 'Cash', amount: 500 }, tender({ amount: 500 }))).toEqual({
            payment_method: 'Cash',
            payment_method_id: null,
            payment_method_name: null,
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
        }, tender({ paymentMethod: 'Bank', mode: 'bank', amount: 100 }));

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
        }, tender({ paymentMethod: 'Bank', mode: 'bank', amount: 100 })).reference_no).toBe('CHQ-889001');
    });

    it('keeps the day written on the cheque whatever the server timezone', () => {
        // Regression guard: parsing '2026-09-25' as a local datetime and letting
        // Prisma send it to a UTC connection moves a Dhaka (UTC+6) cheque back to
        // the 24th. The date is anchored to UTC midnight instead.
        const stored = paymentRecordData({
            paymentMethod: 'Bank',
            amount: 100,
            instrumentDate: '2026-09-25',
        }, tender({ paymentMethod: 'Bank', mode: 'bank', amount: 100 })).instrument_date;

        expect(stored?.toISOString()).toBe('2026-09-25T00:00:00.000Z');
    });
});
