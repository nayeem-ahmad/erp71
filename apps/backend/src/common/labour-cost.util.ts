import { Prisma } from '@prisma/client';

/**
 * Turning an hour of someone's time into money.
 *
 * One rule, used everywhere an hour is priced: an explicit rate HR set for
 * the person, in force on the day the hour was worked, wins; otherwise the
 * rate is derived from the basic salary — salary ÷ standard monthly hours,
 * plus the workspace's overhead; otherwise the hour is **uncosted**, and says
 * so, rather than counting as free.
 *
 * Pure, so the projects module (which prices hours) and the employees module
 * (which shows HR what a person's hour costs) cannot disagree.
 */

export type LabourCostSource = 'RATE' | 'SALARY';

export interface CostingSettings {
    standardMonthlyHours: number;
    overheadPct: number;
}

export const DEFAULT_COSTING_SETTINGS: CostingSettings = {
    // 26 working days × 8 hours.
    standardMonthlyHours: 208,
    overheadPct: 0,
};

export interface CostRateRow {
    hourly_cost: Prisma.Decimal | number | string;
    effective_from: Date;
}

export interface HourlyCost {
    rate: Prisma.Decimal;
    source: LabourCostSource;
}

const toDecimal = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value);

/** The calendar day of a `@db.Date` value, as `YYYY-MM-DD`, so comparisons ignore any time part. */
function dayOf(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/** basic ÷ standard hours × (1 + overhead%), to the paisa. Null for no salary or a nonsensical divisor. */
export function salaryDerivedRate(
    basicSalary: Prisma.Decimal | number | string | null | undefined,
    settings: CostingSettings,
): Prisma.Decimal | null {
    if (basicSalary === null || basicSalary === undefined) return null;
    const salary = toDecimal(basicSalary);
    if (salary.lte(0) || !(settings.standardMonthlyHours > 0)) return null;
    return salary
        .div(settings.standardMonthlyHours)
        .mul(new Prisma.Decimal(1).plus(new Prisma.Decimal(settings.overheadPct).div(100)))
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * What an hour of this person cost on `workDate`.
 *
 * `rates` may come in any order. A rate takes effect on its own date; an hour
 * worked before the first rate falls back to the salary, the same as someone
 * who never had one.
 */
export function resolveHourlyCost(
    workDate: Date,
    rates: readonly CostRateRow[],
    basicSalary: Prisma.Decimal | number | string | null | undefined,
    settings: CostingSettings,
): HourlyCost | null {
    const day = dayOf(workDate);
    const inForce = rates
        .filter((row) => dayOf(row.effective_from) <= day)
        .sort((a, b) => dayOf(b.effective_from).localeCompare(dayOf(a.effective_from)))[0];
    if (inForce) return { rate: toDecimal(inForce.hourly_cost), source: 'RATE' };

    const derived = salaryDerivedRate(basicSalary, settings);
    return derived ? { rate: derived, source: 'SALARY' } : null;
}

/** hours × rate, to the paisa — the figure stored on the entry. */
export function costOf(hours: Prisma.Decimal | number | string, rate: Prisma.Decimal): Prisma.Decimal {
    return toDecimal(hours).mul(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** The cost columns of a `ProjectTimeEntry`, ready to spread into a write. */
export function costColumns(hours: Prisma.Decimal | number | string, cost: HourlyCost | null) {
    if (!cost) return { cost_rate: null, cost_amount: null, cost_source: null };
    return { cost_rate: cost.rate, cost_amount: costOf(hours, cost.rate), cost_source: cost.source };
}

/** A settings row (or none) as numbers. */
export function settingsFromRow(
    row: { standard_monthly_hours: Prisma.Decimal | number; labour_overhead_pct: Prisma.Decimal | number } | null,
): CostingSettings {
    if (!row) return { ...DEFAULT_COSTING_SETTINGS };
    return {
        standardMonthlyHours: Number(row.standard_monthly_hours),
        overheadPct: Number(row.labour_overhead_pct),
    };
}

/**
 * The fields that must never leave the hours APIs: they are a person's pay,
 * divided by the hours they work. Project financials is the one place they
 * are read, behind its own permission.
 */
export function withoutCost<T extends Record<string, unknown>>(
    entry: T,
): Omit<T, 'cost_rate' | 'cost_amount' | 'cost_source'> {
    const { cost_rate: _rate, cost_amount: _amount, cost_source: _source, ...rest } = entry as any;
    return rest;
}
