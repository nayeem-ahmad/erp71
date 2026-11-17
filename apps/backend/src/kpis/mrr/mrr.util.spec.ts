import { isPaying, mrrMovements, subscriptionMrr, type SubscriptionForMrr } from './mrr.util';

const sub = (overrides: Partial<SubscriptionForMrr> = {}): SubscriptionForMrr => ({
    status: 'ACTIVE',
    billingCycle: 'MONTHLY',
    activatedAt: new Date('2026-01-01'),
    suspendedAt: null,
    monthlyPrice: 2000,
    yearlyPrice: 20000,
    discountType: null,
    discountValue: null,
    addonMonthlyPrices: [],
    ...overrides,
});

describe('isPaying', () => {
    it('counts an active subscription and one in dunning after a first payment', () => {
        expect(isPaying(sub())).toBe(true);
        expect(isPaying(sub({ status: 'PAST_DUE' }))).toBe(true);
    });

    it('does not count a trial, a cancellation, a suspension, or a workspace that never paid', () => {
        expect(isPaying(sub({ status: 'TRIALING' }))).toBe(false);
        expect(isPaying(sub({ status: 'CANCELLED' }))).toBe(false);
        expect(isPaying(sub({ suspendedAt: new Date() }))).toBe(false);
        expect(isPaying(sub({ status: 'PAST_DUE', activatedAt: null }))).toBe(false);
    });
});

describe('subscriptionMrr', () => {
    it('is the monthly price for a monthly plan', () => {
        expect(subscriptionMrr(sub())).toEqual({ mrr: 2000, planMrr: 2000, addonMrr: 0 });
    });

    it('spreads a yearly fee over twelve months, falling back to 12 × monthly', () => {
        expect(subscriptionMrr(sub({ billingCycle: 'YEARLY' })).planMrr).toBe(1666.67);
        expect(subscriptionMrr(sub({ billingCycle: 'YEARLY', yearlyPrice: null })).planMrr).toBe(2000);
    });

    it('takes the discount off the cycle fee, as the fee cron does', () => {
        expect(subscriptionMrr(sub({ discountType: 'PERCENTAGE', discountValue: 25 })).planMrr).toBe(1500);
        // ৳1,200 off a ৳20,000 year is ৳18,800, so ৳1,566.67 a month.
        expect(subscriptionMrr(sub({ billingCycle: 'YEARLY', discountType: 'FIXED', discountValue: 1200 })).planMrr).toBe(1566.67);
    });

    it('adds active add-ons at their monthly price, undiscounted', () => {
        expect(subscriptionMrr(sub({ discountType: 'PERCENTAGE', discountValue: 50, addonMonthlyPrices: [500, 300] })))
            .toEqual({ mrr: 1800, planMrr: 1000, addonMrr: 800 });
    });

    it('is zero for a subscription that is not paying, add-ons included', () => {
        expect(subscriptionMrr(sub({ status: 'TRIALING', addonMonthlyPrices: [500] })).mrr).toBe(0);
    });
});

describe('mrrMovements', () => {
    it('sorts every tenant into new, expansion, contraction, churn or reactivation', () => {
        const start = new Map([['grow', 1000], ['shrink', 1000], ['leave', 800], ['flat', 500], ['back', 0]]);
        const end = new Map([['grow', 1500], ['shrink', 700], ['leave', 0], ['flat', 500], ['back', 900], ['fresh', 2000]]);
        const paidBefore = new Set(['grow', 'shrink', 'leave', 'flat', 'back']);

        expect(mrrMovements(start, end, paidBefore)).toEqual({
            startMrr: 3300,
            endMrr: 5600,
            newMrr: 2000,
            expansionMrr: 500,
            contractionMrr: 300,
            churnedMrr: 800,
            reactivationMrr: 900,
            startCustomers: 4,
            endCustomers: 5,
            newCustomers: 1,
            lostCustomers: 1,
        });
    });

    it('reconciles: start + new + expansion + reactivation − contraction − churn = end', () => {
        const start = new Map([['a', 100], ['b', 250], ['c', 75]]);
        const end = new Map([['a', 0], ['b', 400], ['d', 60]]);
        const m = mrrMovements(start, end, new Set(['a', 'b', 'c']));
        expect(m.startMrr + m.newMrr + m.expansionMrr + m.reactivationMrr - m.contractionMrr - m.churnedMrr).toBeCloseTo(m.endMrr);
    });
});
