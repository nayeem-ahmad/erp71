import { availableCustomerCredit, canKeepDue, creditDueAmount, invoiceDues } from './customer-credit';

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

describe('invoiceDues', () => {
    it('adds the unpaid part of this invoice to what was owed before it', () => {
        expect(invoiceDues(4800, 3000, 2000)).toEqual({
            paid: 3000,
            invoiceDue: 1800,
            previousDue: 2000,
            totalDue: 3800,
        });
    });

    it('carries the previous due alone on an invoice paid in full', () => {
        expect(invoiceDues(4800, 4800, 2000)).toMatchObject({ invoiceDue: 0, totalDue: 2000 });
    });

    it('nets an advance against the new due', () => {
        expect(invoiceDues(500, 0, -300)).toMatchObject({ invoiceDue: 500, totalDue: 200 });
    });

    it('says nothing when there is no previous due to state', () => {
        // A walk-in or a cancelled sale: the server sends none.
        expect(invoiceDues(500, 200, null)).toBeNull();
        expect(invoiceDues(500, 200, undefined)).toBeNull();
    });

    it('says nothing when nothing is owed either way', () => {
        expect(invoiceDues(500, 500, 0)).toBeNull();
    });

    it('says nothing rather than print NaN from a figure that is not a number', () => {
        expect(invoiceDues(500, Number.NaN, 200)).toBeNull();
        expect(invoiceDues(Number.NaN, 0, 200)).toBeNull();
    });

    it('keeps the totals to the paisa', () => {
        // 0.1 + 0.2 is 0.30000000000000004 in floating point.
        expect(invoiceDues(0.2, 0, 0.1)?.totalDue).toBe(0.3);
    });
});