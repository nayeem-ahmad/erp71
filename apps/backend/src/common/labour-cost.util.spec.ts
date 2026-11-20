import { Prisma } from '@prisma/client';
import {
    DEFAULT_COSTING_SETTINGS,
    costColumns,
    costOf,
    resolveHourlyCost,
    salaryDerivedRate,
    settingsFromRow,
    withoutCost,
} from './labour-cost.util';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('salaryDerivedRate', () => {
    it('divides the monthly salary by the standard hours', () => {
        expect(Number(salaryDerivedRate(41600, DEFAULT_COSTING_SETTINGS))).toBe(200);
    });

    it('adds the overhead on top', () => {
        expect(Number(salaryDerivedRate(41600, { standardMonthlyHours: 208, overheadPct: 25 }))).toBe(250);
    });

    it('rounds to the paisa', () => {
        expect(salaryDerivedRate(10000, DEFAULT_COSTING_SETTINGS)!.toString()).toBe('48.08');
    });

    it('prices nothing without a salary, or from a zero one', () => {
        expect(salaryDerivedRate(null, DEFAULT_COSTING_SETTINGS)).toBeNull();
        expect(salaryDerivedRate(0, DEFAULT_COSTING_SETTINGS)).toBeNull();
    });
});

describe('resolveHourlyCost', () => {
    const rates = [
        { hourly_cost: 300, effective_from: day('2026-01-01') },
        { hourly_cost: 350, effective_from: day('2026-07-01') },
    ];

    it('uses the explicit rate in force on the day, whatever order they arrive in', () => {
        expect(resolveHourlyCost(day('2026-03-15'), rates, 41600, DEFAULT_COSTING_SETTINGS)).toEqual({
            rate: new Prisma.Decimal(300),
            source: 'RATE',
        });
        expect(Number(resolveHourlyCost(day('2026-07-01'), [...rates].reverse(), 41600, DEFAULT_COSTING_SETTINGS)!.rate)).toBe(350);
    });

    it('does not add overhead to an explicit rate — whoever set it decided the full cost', () => {
        const settings = { standardMonthlyHours: 208, overheadPct: 50 };
        expect(Number(resolveHourlyCost(day('2026-03-15'), rates, 41600, settings)!.rate)).toBe(300);
    });

    it('falls back to the salary for an hour worked before the first rate', () => {
        expect(resolveHourlyCost(day('2025-12-31'), rates, 41600, DEFAULT_COSTING_SETTINGS)).toEqual({
            rate: new Prisma.Decimal(200),
            source: 'SALARY',
        });
    });

    it('leaves the hour uncosted with neither a rate nor a salary', () => {
        expect(resolveHourlyCost(day('2026-03-15'), [], null, DEFAULT_COSTING_SETTINGS)).toBeNull();
    });
});

describe('cost columns', () => {
    it('multiplies hours by the rate, to the paisa', () => {
        expect(costOf(2.25, new Prisma.Decimal('48.08')).toString()).toBe('108.18');
    });

    it('writes all three columns, or all three nulls for an uncosted hour', () => {
        expect(costColumns(3, null)).toEqual({ cost_rate: null, cost_amount: null, cost_source: null });
        const priced = costColumns(3, { rate: new Prisma.Decimal(200), source: 'SALARY' });
        expect(Number(priced.cost_amount)).toBe(600);
        expect(priced.cost_source).toBe('SALARY');
    });
});

describe('settingsFromRow', () => {
    it('is the defaults when the workspace never saved any', () => {
        expect(settingsFromRow(null)).toEqual(DEFAULT_COSTING_SETTINGS);
    });

    it('reads a saved row as numbers', () => {
        expect(
            settingsFromRow({ standard_monthly_hours: new Prisma.Decimal(176), labour_overhead_pct: new Prisma.Decimal(15) }),
        ).toEqual({ standardMonthlyHours: 176, overheadPct: 15 });
    });
});

describe('withoutCost', () => {
    it('drops exactly the three cost fields', () => {
        expect(withoutCost({ id: 'e1', hours: 3, cost_rate: 1, cost_amount: 3, cost_source: 'RATE' })).toEqual({
            id: 'e1',
            hours: 3,
        });
    });
});
