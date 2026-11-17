/**
 * The arithmetic behind the KPI scorecard, as pure functions so each formula
 * can be checked against a hand-worked example without a database.
 *
 * Every function returns null when its denominator is zero or missing. A KPI
 * with nothing to divide by has no value, and showing 0 instead would read as
 * a real result ("no churn") rather than "not enough data to say".
 */
import { daysInRange, type DateRange } from '../common/period.util';

/** Average days in a month, so a 30-day and a 31-day period scale the same way. */
export const DAYS_PER_MONTH = 365.25 / 12;

/** One decimal place for percentages, days and months; two for money. */
export const round1 = (value: number) => Math.round(value * 10) / 10 + 0;
export const round2 = (value: number) => Math.round(value * 100) / 100 + 0;

export function monthsIn(range: DateRange): number {
    return daysInRange(range) / DAYS_PER_MONTH;
}

/** (current − previous) / previous, as a percentage. */
export function growthPct(current: number, previous: number): number | null {
    if (previous <= 0) return null;
    return round1(((current - previous) / previous) * 100);
}

/** part / whole, as a percentage. */
export function ratioPct(part: number, whole: number): number | null {
    if (whole === 0) return null;
    return round1((part / whole) * 100);
}

/**
 * Months of cash left at the current burn.
 *
 * `netCashChange` is the change in cash and bank over `months` months (the
 * trailing window). A business whose cash grew is not burning, and has no
 * runway figure: it is reported as cash-positive instead.
 */
export function cashRunway(
    cashOnHand: number,
    netCashChange: number,
    months: number,
): { months: number | null; monthlyBurn: number; cashPositive: boolean } {
    const monthlyBurn = months > 0 ? round2(-netCashChange / months) : 0;
    if (monthlyBurn <= 0) return { months: null, monthlyBurn, cashPositive: true };
    return { months: round1(Math.max(cashOnHand, 0) / monthlyBurn), monthlyBurn, cashPositive: false };
}

/**
 * Lost customers / customers at the start of the period.
 *
 * `startBase` is everyone who bought in the lapse window before the period
 * started (they were active customers going in). A customer is lost when they
 * made no purchase in the lapse window ending with the period (`activeAtEnd`).
 */
export function churnRate(
    startBase: ReadonlySet<string>,
    activeAtEnd: ReadonlySet<string>,
): { rate: number | null; lost: number; base: number } {
    let lost = 0;
    for (const customerId of startBase) {
        if (!activeAtEnd.has(customerId)) lost += 1;
    }
    return { rate: ratioPct(lost, startBase.size), lost, base: startBase.size };
}

/**
 * Revenue kept from existing customers: what last period's customers spent
 * this period, over what they spent last period.
 *
 * The retail reading of net revenue retention. Above 100% means the customers
 * you already had spent more this time, which covers the ones who left.
 */
export function revenueRetention(
    previousByCustomer: ReadonlyMap<string, number>,
    currentByCustomer: ReadonlyMap<string, number>,
): { rate: number | null; retained: number; starting: number } {
    let starting = 0;
    let retained = 0;
    for (const [customerId, amount] of previousByCustomer) {
        starting += amount;
        retained += currentByCustomer.get(customerId) ?? 0;
    }
    return { rate: ratioPct(retained, starting), retained: round2(retained), starting: round2(starting) };
}

/**
 * How long customers have kept buying, in months: the mean span from each
 * named customer's first purchase to their last.
 *
 * A one-time buyer counts as one month rather than zero, because they were a
 * customer for that purchase. This understates lifespan for a young business
 * whose customers have not had time to show how long they stay, which keeps
 * the lifetime value it feeds conservative.
 */
export function observedLifespanMonths(spans: ReadonlyArray<{ first: Date; last: Date }>): number | null {
    if (spans.length === 0) return null;
    const total = spans.reduce((sum, { first, last }) => {
        const months = (last.getTime() - first.getTime()) / (86_400_000 * DAYS_PER_MONTH);
        return sum + Math.max(1, months);
    }, 0);
    return round1(total / spans.length);
}

/**
 * Average monthly gross profit per customer × average months a customer stays.
 */
export function customerLifetimeValue(input: {
    grossProfit: number;
    customers: number;
    periodMonths: number;
    lifespanMonths: number | null;
}): { value: number | null; monthlyGrossProfitPerCustomer: number | null } {
    if (input.customers <= 0 || input.periodMonths <= 0) return { value: null, monthlyGrossProfitPerCustomer: null };
    const monthly = input.grossProfit / input.customers / input.periodMonths;
    return {
        value: input.lifespanMonths === null ? null : round2(monthly * input.lifespanMonths),
        monthlyGrossProfitPerCustomer: round2(monthly),
    };
}

/** Mean of a list, one decimal place, or null for an empty list. */
export function average(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    return round1(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/** Whole and fractional days from one instant to another. */
export function daysBetween(from: Date, to: Date): number {
    return (to.getTime() - from.getTime()) / 86_400_000;
}

export interface StaffRecord {
    /** When they started; falls back to when the record was created. */
    joined: Date;
    /** Their last day on the payroll, or null while they are still employed. */
    left: Date | null;
}

/** Employed on this instant: started on or before it and not yet gone. */
function employedOn(person: StaffRecord, instant: Date): boolean {
    return person.joined <= instant && (person.left === null || person.left >= instant);
}

/**
 * Departures in the period / average headcount, where the average is the mean
 * of the headcount on the first and the last day.
 */
export function employeeTurnover(
    staff: readonly StaffRecord[],
    start: Date,
    end: Date,
): { rate: number | null; departures: number; averageHeadcount: number } {
    const departures = staff.filter((p) => p.left !== null && p.left >= start && p.left <= end).length;
    const opening = staff.filter((p) => employedOn(p, start)).length;
    const closing = staff.filter((p) => employedOn(p, end)).length;
    const averageHeadcount = (opening + closing) / 2;
    return { rate: averageHeadcount > 0 ? round1((departures / averageHeadcount) * 100) : null, departures, averageHeadcount };
}
