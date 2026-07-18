import { buildPartyLedger } from './party-ledger.util';

const line = (debit: number, credit: number, date: string, voucher_number = 'V', description = 'desc') => ({
    id: `${voucher_number}-${date}`,
    debit_amount: debit,
    credit_amount: credit,
    voucher: { date: new Date(date), voucher_number, description },
});

function buildDb(controlAccountId: string | null, lines: unknown[]) {
    return {
        account: { findFirst: jest.fn().mockResolvedValue(controlAccountId ? { id: controlAccountId } : null) },
        voucherDetail: { findMany: jest.fn().mockResolvedValue(lines) },
    } as any;
}

const CUST = { increaseLabel: 'CREDIT_SALE', decreaseLabel: 'PAYMENT' };
const SUP = { increaseLabel: 'CREDIT_PURCHASE', decreaseLabel: 'PAYMENT' };

describe('buildPartyLedger', () => {
    it('a customer receivable is debit − credit, with a running balance', async () => {
        // Sale posts Dr AR 700; payment posts Cr AR 300 → 700 then 400.
        const db = buildDb('ar', [line(700, 0, '2026-05-01'), line(0, 300, '2026-05-10')]);

        const ledger = await buildPartyLedger(db, 't1', 'CUSTOMER', 'cust-1', CUST);

        expect(ledger.transactions).toEqual([
            expect.objectContaining({ type: 'CREDIT_SALE', amount: 700, balance_before: 0, balance_after: 700 }),
            expect.objectContaining({ type: 'PAYMENT', amount: 300, balance_before: 700, balance_after: 400 }),
        ]);
        expect(ledger.closing_balance).toBe(400);
    });

    it('a supplier payable is credit − debit', async () => {
        // Purchase posts Cr AP 500; payment posts Dr AP 200 → 500 then 300.
        const db = buildDb('ap', [line(0, 500, '2026-05-01'), line(200, 0, '2026-05-10')]);

        const ledger = await buildPartyLedger(db, 't1', 'SUPPLIER', 'sup-1', SUP);

        expect(ledger.transactions).toEqual([
            expect.objectContaining({ type: 'CREDIT_PURCHASE', amount: 500, balance_after: 500 }),
            expect.objectContaining({ type: 'PAYMENT', amount: 200, balance_after: 300 }),
        ]);
        expect(ledger.closing_balance).toBe(300);
    });

    it('rolls lines before `from` into the opening balance and excludes them from rows', async () => {
        const db = buildDb('ar', [
            line(1000, 0, '2026-04-01'), // before window → opening
            line(0, 400, '2026-05-05'),  // in window
        ]);

        const ledger = await buildPartyLedger(db, 't1', 'CUSTOMER', 'cust-1', { ...CUST, from: '2026-05-01' });

        expect(ledger.opening_balance).toBe(1000);
        expect(ledger.transactions).toHaveLength(1);
        expect(ledger.transactions[0]).toEqual(expect.objectContaining({ balance_before: 1000, balance_after: 600 }));
    });

    it('excludes lines after `to`', async () => {
        const db = buildDb('ar', [line(500, 0, '2026-05-05'), line(200, 0, '2026-06-05')]);

        const ledger = await buildPartyLedger(db, 't1', 'CUSTOMER', 'cust-1', { ...CUST, to: '2026-05-31' });

        expect(ledger.transactions).toHaveLength(1);
        expect(ledger.closing_balance).toBe(500);
    });

    it('returns an empty ledger when the tenant has no control account for the party type', async () => {
        const db = buildDb(null, []);

        const ledger = await buildPartyLedger(db, 't1', 'CUSTOMER', 'cust-1', CUST);

        expect(ledger).toEqual({ opening_balance: 0, closing_balance: 0, transactions: [], total: 0 });
        expect(db.voucherDetail.findMany).not.toHaveBeenCalled();
    });

    it('scopes the query to the control account and the party', async () => {
        const db = buildDb('ar', []);

        await buildPartyLedger(db, 't1', 'CUSTOMER', 'cust-1', CUST);

        expect(db.voucherDetail.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { account_id: 'ar', party_id: 'cust-1' },
        }));
    });
});
