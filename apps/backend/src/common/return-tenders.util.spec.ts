import { BadRequestException } from '@nestjs/common';
import {
    resolveReturnTenders,
    resolveStoredReturnTenders,
    returnPaymentRow,
    sameReturnPaymentRows,
    type ReturnTender,
    type StoredReturnPayment,
} from './return-tenders.util';

const NO_INSTRUMENT = {
    bank_name: null,
    bank_branch: null,
    bank_account_number: null,
    reference_no: null,
    instrument_date: null,
};

const tender = (overrides: Partial<ReturnTender> = {}): ReturnTender => ({
    paymentMethod: 'Mobile Wallet',
    methodId: 'pm-bkash',
    methodName: 'bKash',
    accountId: 'bkash-acct',
    mode: 'bkash',
    amount: 100,
    instrument: { ...NO_INSTRUMENT, reference_no: 'TX-1', instrument_date: new Date('2026-10-01T00:00:00.000Z') },
    ...overrides,
});

const row = (overrides: Partial<StoredReturnPayment> = {}): StoredReturnPayment => ({
    payment_method: 'Mobile Wallet',
    payment_method_id: 'pm-bkash',
    payment_method_name: 'bKash',
    account_id: 'bkash-acct',
    // Prisma hands a Decimal back; it only has to compare as a number.
    amount: '100.00',
    ...NO_INSTRUMENT,
    reference_no: 'TX-1',
    instrument_date: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
});

describe('returnPaymentRow', () => {
    it('saves the method, the name and account it resolved to, the amount and the instrument', () => {
        expect(returnPaymentRow('ret-1', tender())).toEqual({
            return_id: 'ret-1',
            payment_method: 'Mobile Wallet',
            payment_method_id: 'pm-bkash',
            payment_method_name: 'bKash',
            account_id: 'bkash-acct',
            amount: 100,
            bank_name: null,
            bank_branch: null,
            bank_account_number: null,
            reference_no: 'TX-1',
            instrument_date: new Date('2026-10-01T00:00:00.000Z'),
        });
    });
});

describe('sameReturnPaymentRows', () => {
    it('is true when the rows already say what the tenders would write', () => {
        expect(sameReturnPaymentRows([row()], [tender()])).toBe(true);
        expect(sameReturnPaymentRows([], [])).toBe(true);
    });

    it('treats amounts within half a paisa as the same money', () => {
        expect(sameReturnPaymentRows([row({ amount: '100.004' })], [tender()])).toBe(true);
        expect(sameReturnPaymentRows([row({ amount: '100.01' })], [tender()])).toBe(false);
    });

    it('is false when an instrument detail changed', () => {
        expect(sameReturnPaymentRows([row({ reference_no: 'TX-9' })], [tender()])).toBe(false);
        expect(sameReturnPaymentRows([row({ instrument_date: new Date('2026-10-02T00:00:00.000Z') })], [tender()])).toBe(false);
        expect(sameReturnPaymentRows([row({ instrument_date: null })], [tender()])).toBe(false);
    });

    it('is false when the order or the count differs', () => {
        const cash = tender({ paymentMethod: 'Cash', methodId: 'pm-cash', methodName: 'Cash', accountId: 'cash-in-hand', mode: 'cash', instrument: NO_INSTRUMENT });
        const cashRow = row({ payment_method: 'Cash', payment_method_id: 'pm-cash', payment_method_name: 'Cash', account_id: 'cash-in-hand', ...NO_INSTRUMENT });
        expect(sameReturnPaymentRows([row(), cashRow], [cash, tender()])).toBe(false);
        expect(sameReturnPaymentRows([row()], [tender(), cash])).toBe(false);
    });
});

describe('resolving return tenders', () => {
    const methods = [
        { id: 'pm-cash', name: 'Cash', account_id: 'cash-in-hand', all_branches: true, stores: [], sort_order: 1 },
        { id: 'pm-bkash', name: 'bKash', account_id: 'bkash-acct', all_branches: false, stores: [{ store_id: 'store-2' }], sort_order: 3 },
    ].map((method) => ({ tenant_id: 'tenant-1', is_active: true, ...method }));

    // Answers the filters resolveTenders uses the way Postgres would.
    const tx: any = {
        paymentMethod: {
            findMany: jest.fn(async ({ where }: any) =>
                methods.filter((method) =>
                    method.tenant_id === where.tenant_id
                    && (!where.id?.in || where.id.in.includes(method.id))
                    && (where.is_active === undefined || method.is_active === where.is_active)
                    && (!where.OR || where.OR.some((c: any) => c.name?.equals?.toLowerCase() === method.name.toLowerCase())))),
        },
    };

    it("resolves each payment's method, account and mode at the branch, with its instrument trimmed", async () => {
        const resolved = await resolveReturnTenders(tx, 'tenant-1', 'store-1', [
            { paymentMethod: 'Cash', paymentMethodId: 'pm-cash', amount: 200, referenceNo: ' R-1 ', instrumentDate: '2026-10-05' },
        ]);

        expect(resolved).toEqual([{
            paymentMethod: 'Cash',
            methodId: 'pm-cash',
            methodName: 'Cash',
            accountId: 'cash-in-hand',
            mode: 'cash',
            amount: 200,
            instrument: { ...NO_INSTRUMENT, reference_no: 'R-1', instrument_date: new Date('2026-10-05T00:00:00.000Z') },
        }]);
    });

    it("refuses a new tender on a method the branch doesn't offer, but keeps one the return already carries", async () => {
        const payment = { paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-bkash', amount: 100 };

        await expect(resolveReturnTenders(tx, 'tenant-1', 'store-1', [payment])).rejects.toThrow(
            new BadRequestException("That payment method isn't available at this branch."),
        );

        const kept = await resolveReturnTenders(tx, 'tenant-1', 'store-1', [payment], [row({ account_id: 'bkash-old' })]);
        expect(kept[0]).toEqual(expect.objectContaining({ methodId: 'pm-bkash', accountId: 'bkash-old', amount: 100 }));
    });

    it("re-resolves saved rows with the account, name and instrument they were saved with", async () => {
        const resolved = await resolveStoredReturnTenders(tx, 'tenant-1', 'store-1', [
            row({ account_id: 'bkash-old', payment_method_name: 'bKash (old)', bank_name: 'City Bank' }),
        ]);

        expect(resolved).toEqual([{
            paymentMethod: 'Mobile Wallet',
            methodId: 'pm-bkash',
            methodName: 'bKash (old)',
            accountId: 'bkash-old',
            mode: 'bkash',
            amount: 100,
            instrument: {
                ...NO_INSTRUMENT,
                bank_name: 'City Bank',
                reference_no: 'TX-1',
                instrument_date: new Date('2026-10-01T00:00:00.000Z'),
            },
        }]);
    });
});
