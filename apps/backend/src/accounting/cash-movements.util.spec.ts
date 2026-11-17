import { apportionCashMovements, cashActivityOf, type CashActivity } from './cash-movements.util';

const ACTIVITY: Record<string, CashActivity | null> = {
    cash: null,
    bank: null,
    sales: 'operating',
    rent: 'operating',
    receivable: 'operating',
    equipment: 'investing',
    loan: 'financing',
};
const activityOf = (id: string) => ACTIVITY[id];
const line = (voucherId: string, accountId: string, debit: number, credit = 0) => ({ voucherId, accountId, debit, credit });

describe('cashActivityOf', () => {
    it('follows the cash-flow report classification', () => {
        expect(cashActivityOf({ name: 'Office Equipment', code: null, type: 'asset' })).toBe('investing');
        expect(cashActivityOf({ name: 'Bank Loan', code: null, type: 'liability' })).toBe('financing');
        expect(cashActivityOf({ name: "Owner's Capital", code: null, type: 'equity' })).toBe('financing');
        expect(cashActivityOf({ name: 'Accounts Payable', code: null, type: 'liability' })).toBe('operating');
        expect(cashActivityOf({ name: 'Rent', code: null, type: 'expense' })).toBe('operating');
    });
});

describe('apportionCashMovements', () => {
    it('puts a cash sale and a rent payment in operating', () => {
        const totals = apportionCashMovements([
            line('v1', 'cash', 1000), line('v1', 'sales', 0, 1000),
            line('v2', 'rent', 300), line('v2', 'bank', 0, 300),
        ], activityOf);
        expect(totals).toEqual({ operating: 700, investing: 0, financing: 0, net: 700 });
    });

    it('splits one receipt across the activities on its other side, by size', () => {
        // ৳1,500 in: ৳1,000 settles a receivable, ৳500 is a new loan.
        const totals = apportionCashMovements([
            line('v1', 'bank', 1500),
            line('v1', 'receivable', 0, 1000),
            line('v1', 'loan', 0, 500),
        ], activityOf);
        expect(totals).toEqual({ operating: 1000, investing: 0, financing: 500, net: 1500 });
    });

    it('counts buying equipment as investing and ignores transfers between cash accounts', () => {
        const totals = apportionCashMovements([
            line('v1', 'equipment', 2000), line('v1', 'bank', 0, 2000),
            line('v2', 'cash', 400), line('v2', 'bank', 0, 400),
        ], activityOf);
        expect(totals).toEqual({ operating: 0, investing: -2000, financing: 0, net: -2000 });
    });
});
