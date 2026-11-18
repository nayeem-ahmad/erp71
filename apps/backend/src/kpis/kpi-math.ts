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

/** Expense classes EBITDA adds back to net profit. */
export interface EbitdaAddBacks {
    interest: number;
    tax: number;
    depreciation: number;
    amortization: number;
}

/** Net income + interest + taxes + depreciation + amortisation. */
export function ebitda(netProfit: number, addBacks: EbitdaAddBacks): number {
    return round2(netProfit + addBacks.interest + addBacks.tax + addBacks.depreciation + addBacks.amortization);
}

/** (Sales + marketing spend) ÷ new customers. */
export function acquisitionCost(spend: number, newCustomers: number): number | null {
    if (newCustomers <= 0) return null;
    return round2(spend / newCustomers);
}

/** Lifetime value ÷ acquisition cost; nothing to say when either is missing or zero. */
export function ltvToCac(ltv: number | null, cac: number | null): number | null {
    if (ltv === null || cac === null || cac <= 0 || ltv <= 0) return null;
    return round2(ltv / cac);
}

/** Five years: the longest a subscription customer is assumed to stay when nobody churned. */
export const MAX_LIFESPAN_MONTHS = 60;

/**
 * Subscription lifetime value: ARPA × gross margin × expected lifespan, where
 * the lifespan is 1 ÷ monthly churn. A period's churn is spread evenly over
 * its months. With no churn the lifespan is capped at five years rather than
 * read as infinite.
 */
export function subscriptionLifetimeValue(input: {
    arpa: number;
    grossMarginPct: number;
    churnRatePct: number;
    periodMonths: number;
}): { value: number; lifespanMonths: number; capped: boolean } {
    const monthlyChurn = input.periodMonths > 0 ? input.churnRatePct / 100 / input.periodMonths : 0;
    const uncapped = monthlyChurn > 0 ? 1 / monthlyChurn : Infinity;
    const lifespanMonths = Math.min(uncapped, MAX_LIFESPAN_MONTHS);
    return {
        value: round2(input.arpa * (input.grossMarginPct / 100) * lifespanMonths),
        lifespanMonths: round1(lifespanMonths),
        capped: uncapped > MAX_LIFESPAN_MONTHS,
    };
}

/**
 * Net Promoter Score from 0–10 answers: % promoters (9–10) − % detractors
 * (0–6), a whole number from −100 to 100. Passives (7–8) count toward the
 * total only.
 */
export function netPromoterScore(scores: readonly number[]): {
    score: number | null;
    responses: number;
    promoters: number;
    passives: number;
    detractors: number;
} {
    const promoters = scores.filter((s) => s >= 9).length;
    const detractors = scores.filter((s) => s <= 6).length;
    const passives = scores.length - promoters - detractors;
    const score = scores.length > 0 ? Math.round(((promoters - detractors) / scores.length) * 100) + 0 : null;
    return { score, responses: scores.length, promoters, passives, detractors };
}
