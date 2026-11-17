import {
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
