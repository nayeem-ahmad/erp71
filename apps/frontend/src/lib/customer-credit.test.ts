import { availableCustomerCredit, canKeepDue, creditDueAmount } from './customer-credit';

describe('customer-credit', () => {
    it('computes credit due from total and paid amount', () => {
        expect(creditDueAmount(1000, 600)).toBe(400);
        expect(creditDueAmount(1000, 1000)).toBe(0);
    });

    it('allows keeping due when within credit limit', () => {
        const customer = { credit_limit: 5000, due_balance: 1000 };
        expect(canKeepDue(customer, 400)).toEqual({ allowed: true });
        expect(availableCustomerCredit(customer)).toBe(4000);
    });

    it('blocks keeping due without a customer', () => {
        expect(canKeepDue(null, 100).allowed).toBe(false);
    });

    it('blocks keeping due when projected balance exceeds limit', () => {
        const customer = { credit_limit: 5000, due_balance: 4800 };
        const result = canKeepDue(customer, 400);
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/Credit limit exceeded/);
    });

    it('blocks keeping due when customer has no credit limit', () => {
        expect(canKeepDue({ credit_limit: null, due_balance: 0 }, 100).allowed).toBe(false);
    });
});