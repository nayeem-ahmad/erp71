import {
    netPromoterScore,
    acquisitionCost,
    ebitda,
    ltvToCac,
    subscriptionLifetimeValue,
    average,
    cashRunway,
    churnRate,
    customerLifetimeValue,
    employeeTurnover,
    growthPct,
    monthsIn,
    observedLifespanMonths,
    revenueRetention,
} from './kpi-math';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('growthPct', () => {
    it('is the change over the previous value', () => {
        expect(growthPct(120_000, 100_000)).toBe(20);
        expect(growthPct(80_000, 100_000)).toBe(-20);
    });

    it('has no answer when there was nothing before', () => {
        expect(growthPct(50_000, 0)).toBeNull();
    });
});

describe('cashRunway', () => {
    it('divides cash on hand by the average monthly burn', () => {
        // Lost ৳90,000 over three months: ৳30,000 a month, ৳300,000 lasts ten months.
        expect(cashRunway(300_000, -90_000, 3)).toEqual({ months: 10, monthlyBurn: 30_000, cashPositive: false });
    });

    it('reports a business whose cash grew as cash-positive, with no runway figure', () => {
        expect(cashRunway(300_000, 15_000, 3)).toEqual({ months: null, monthlyBurn: -5_000, cashPositive: true });
    });

    it('has zero runway when the burn has already used the cash up', () => {
        expect(cashRunway(-5_000, -30_000, 3).months).toBe(0);
    });
});

describe('churnRate', () => {
    it('counts the starting customers who stopped buying', () => {
        const base = new Set(['a', 'b', 'c', 'd']);
        const activeAtEnd = new Set(['a', 'b', 'c', 'z']);
        expect(churnRate(base, activeAtEnd)).toEqual({ rate: 25, lost: 1, base: 4 });
    });

    it('has no answer without starting customers', () => {
        expect(churnRate(new Set(), new Set(['a'])).rate).toBeNull();
    });
});

describe('revenueRetention', () => {
    it("is what last period's customers spent now over what they spent then", () => {
        const before = new Map([['a', 1_000], ['b', 1_000]]);
        // a spent more, b left, c is new and does not count.
        const now = new Map([['a', 1_500], ['c', 5_000]]);
        expect(revenueRetention(before, now)).toEqual({ rate: 75, retained: 1_500, starting: 2_000 });
    });
});

describe('customer lifetime value', () => {
    it('averages first-to-last purchase spans, counting a one-time buyer as one month', () => {
        expect(observedLifespanMonths([
            { first: day('2026-01-01'), last: day('2026-01-01') },
            { first: day('2025-01-01'), last: day('2026-01-01') },
        ])).toBe(6.5);
    });

    it('multiplies monthly gross profit per customer by lifespan', () => {
        // ৳60,000 gross profit from 20 customers over 3 months = ৳1,000/customer/month.
        expect(customerLifetimeValue({ grossProfit: 60_000, customers: 20, periodMonths: 3, lifespanMonths: 12 }))
            .toEqual({ value: 12_000, monthlyGrossProfitPerCustomer: 1_000 });
    });

    it('has no answer without customers', () => {
        expect(customerLifetimeValue({ grossProfit: 0, customers: 0, periodMonths: 1, lifespanMonths: 5 }).value).toBeNull();
    });
});

describe('employeeTurnover', () => {
    it('is departures over the average of opening and closing headcount', () => {
        const staff = [
            { joined: day('2025-01-01'), left: null },
            { joined: day('2025-01-01'), left: null },
            { joined: day('2025-01-01'), left: day('2026-03-10') },
            { joined: day('2026-03-20'), left: null },
        ];
        // Opening 3, closing 3, one departure.
        expect(employeeTurnover(staff, day('2026-03-01'), day('2026-03-31'))).toEqual({
            rate: 33.3,
            departures: 1,
            averageHeadcount: 3,
        });
    });
});

describe('helpers', () => {
    it('measures months by average month length', () => {
        expect(monthsIn({ from: '2026-01-01', to: '2026-12-31' })).toBeCloseTo(11.99, 1);
    });

    it('averages to one decimal place', () => {
        expect(average([10, 20, 31])).toBe(20.3);
        expect(average([])).toBeNull();
    });
});

describe('phase 3 formulas', () => {
    it('adds interest, tax, depreciation and amortisation back to net profit', () => {
        expect(ebitda(10_000, { interest: 1_000, tax: 2_000, depreciation: 1_500, amortization: 500 })).toBe(15_000);
    });

    it('divides acquisition spend by new customers, with no answer and no customers', () => {
        expect(acquisitionCost(30_000, 12)).toBe(2_500);
        expect(acquisitionCost(30_000, 0)).toBeNull();
    });

    it('needs both a lifetime value and a cost to compare them', () => {
        expect(ltvToCac(7_500, 2_500)).toBe(3);
        expect(ltvToCac(7_500, null)).toBeNull();
        expect(ltvToCac(7_500, 0)).toBeNull();
    });

    it('values a subscriber at ARPA × margin ÷ monthly churn', () => {
        // 6% churn over 3 months is 2% a month: a 50-month lifespan.
        expect(subscriptionLifetimeValue({ arpa: 2_000, grossMarginPct: 80, churnRatePct: 6, periodMonths: 3 }))
            .toEqual({ value: 80_000, lifespanMonths: 50, capped: false });
    });

    it('caps the lifespan at five years when nobody churned', () => {
        expect(subscriptionLifetimeValue({ arpa: 1_000, grossMarginPct: 50, churnRatePct: 0, periodMonths: 1 }))
            .toEqual({ value: 30_000, lifespanMonths: 60, capped: true });
    });
});

describe('netPromoterScore', () => {
    it('is the share of promoters less the share of detractors', () => {
        // 5 promoters, 3 passives, 2 detractors out of 10: 50% − 20%.
        expect(netPromoterScore([10, 9, 9, 10, 9, 8, 7, 8, 6, 0])).toEqual({
            score: 30, responses: 10, promoters: 5, passives: 3, detractors: 2,
        });
    });

    it('runs from −100 to 100 and has no score without answers', () => {
        expect(netPromoterScore([0, 3]).score).toBe(-100);
        expect(netPromoterScore([10]).score).toBe(100);
        expect(netPromoterScore([]).score).toBeNull();
    });
});
