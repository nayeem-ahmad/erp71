import { money, type ComputedStructure } from './salary-structure.util';

/**
 * Turning a structure plus a month of attendance into one payslip.
 *
 * Pure, so every rule below is testable without a database and visible in one
 * place. Each rule is a policy decision, and each is stated as such.
 */

export interface AttendanceInputs {
    scheduledDays: number;
    presentDays: number;
    absentDays: number;
    leaveDays: number;
    approvedOvertimeMinutes: number;
}

export interface Adjustment {
    id: string;
    kind: 'EARNING' | 'DEDUCTION';
    name: string;
    amount: number;
    note?: string | null;
}

export interface PayslipItem {
    kind: 'EARNING' | 'DEDUCTION';
    name: string;
    amount: number;
    note: string | null;
    sort_order: number;
}

export interface Payslip {
    items: PayslipItem[];
    grossEarnings: number;
    overtimeAmount: number;
    absenceDeduction: number;
    structureDeductions: number;
    adjustmentEarnings: number;
    adjustmentDeductions: number;
    totalDeductions: number;
    netPay: number;
}

/**
 * Ordinary working hours in a day, for deriving an hourly rate.
 *
 * Eight is the Bangladesh Labour Act's ordinary working day. It is a constant
 * rather than being read from the schedule because the schedule's hours vary by
 * weekday and an hourly rate that changed depending on which day was worked
 * would be indefensible on a payslip.
 */
export const ORDINARY_HOURS_PER_DAY = 8;

/**
 * Overtime is paid at twice the ordinary hourly rate.
 *
 * Section 108 of the Bangladesh Labour Act 2006. A constant rather than a
 * setting: a tenant paying less would be breaking the law, and one paying more
 * can add an adjustment.
 */
export const OVERTIME_MULTIPLIER = 2;

/**
 * The ordinary hourly rate, derived from basic pay.
 *
 * Basic rather than gross: allowances are not consideration for hours worked,
 * which is the conventional reading here and the one that keeps house rent out
 * of an overtime calculation.
 */
export function hourlyRate(basic: number, scheduledDays: number): number {
    if (scheduledDays <= 0) return 0;
    return basic / (scheduledDays * ORDINARY_HOURS_PER_DAY);
}

export function overtimePay(
    basic: number,
    scheduledDays: number,
    overtimeMinutes: number,
): number {
    if (overtimeMinutes <= 0) return 0;
    return money(hourlyRate(basic, scheduledDays) * OVERTIME_MULTIPLIER * (overtimeMinutes / 60));
}

/**
 * What an absence costs.
 *
 * Pro-rated on **gross earnings**, not basic: a day not worked is a day none of
 * the salary was earned, and deducting only basic would leave an absent
 * employee taking home their full house rent. Approved leave is not an absence
 * and never reaches this — `leaveDays` is carried onto the payslip for the
 * record, not for the arithmetic.
 */
export function absenceDeduction(
    grossEarnings: number,
    scheduledDays: number,
    absentDays: number,
): number {
    if (scheduledDays <= 0 || absentDays <= 0) return 0;
    // Cap at gross: more absent days than scheduled days is a data error, and
    // a negative payslip is never the right answer to one.
    const chargeable = Math.min(absentDays, scheduledDays);
    return money((grossEarnings / scheduledDays) * chargeable);
}

/**
 * Assemble a payslip.
 *
 * The order of the items is the order they will be printed in, which is why
 * every source contributes a `sort_order` rather than relying on push order.
 */
export function buildPayslip(
    structure: ComputedStructure,
    attendance: AttendanceInputs,
    adjustments: Adjustment[] = [],
): Payslip {
    const items: PayslipItem[] = [];

    for (const [index, line] of structure.earnings.entries()) {
        items.push({
            kind: 'EARNING',
            name: line.name,
            amount: line.amount,
            note: line.calculation === 'PERCENT_OF_BASIC' ? `${line.rate}% of basic` : null,
            sort_order: index,
        });
    }

    const overtime = overtimePay(
        structure.basic, attendance.scheduledDays, attendance.approvedOvertimeMinutes,
    );
    if (overtime > 0) {
        const hours = Math.round((attendance.approvedOvertimeMinutes / 60) * 100) / 100;
        items.push({
            kind: 'EARNING',
            name: 'Overtime',
            amount: overtime,
            note: `${hours}h at ${OVERTIME_MULTIPLIER}× ordinary rate`,
            sort_order: 100,
        });
    }

    const adjustmentEarnings = money(
        adjustments.filter((a) => a.kind === 'EARNING').reduce((sum, a) => sum + a.amount, 0),
    );
    for (const [index, adjustment] of adjustments.filter((a) => a.kind === 'EARNING').entries()) {
        items.push({
            kind: 'EARNING',
            name: adjustment.name,
            amount: money(adjustment.amount),
            note: adjustment.note ?? null,
            sort_order: 200 + index,
        });
    }

    for (const [index, line] of structure.deductions.entries()) {
        items.push({
            kind: 'DEDUCTION',
            name: line.name,
            amount: line.amount,
            note: line.calculation === 'PERCENT_OF_BASIC' ? `${line.rate}% of basic` : null,
            sort_order: 300 + index,
        });
    }

    const grossEarnings = money(structure.grossEarnings + overtime + adjustmentEarnings);

    const absence = absenceDeduction(
        structure.grossEarnings, attendance.scheduledDays, attendance.absentDays,
    );
    if (absence > 0) {
        items.push({
            kind: 'DEDUCTION',
            name: 'Absence',
            amount: absence,
            note: `${attendance.absentDays} day(s) of ${attendance.scheduledDays}`,
            sort_order: 400,
        });
    }

    const adjustmentDeductions = money(
        adjustments.filter((a) => a.kind === 'DEDUCTION').reduce((sum, a) => sum + a.amount, 0),
    );
    for (const [index, adjustment] of adjustments.filter((a) => a.kind === 'DEDUCTION').entries()) {
        items.push({
            kind: 'DEDUCTION',
            name: adjustment.name,
            amount: money(adjustment.amount),
            note: adjustment.note ?? null,
            sort_order: 500 + index,
        });
    }

    const totalDeductions = money(
        structure.totalDeductions + absence + adjustmentDeductions,
    );

    return {
        items: items.sort((a, b) => a.sort_order - b.sort_order),
        grossEarnings,
        overtimeAmount: overtime,
        absenceDeduction: absence,
        structureDeductions: structure.totalDeductions,
        adjustmentEarnings,
        adjustmentDeductions,
        totalDeductions,
        // Never below zero. Deductions exceeding earnings is a real situation
        // (a large advance recovery), but a negative payslip is not a way to
        // express it — the shortfall stays with the adjustment to be carried.
        netPay: money(Math.max(0, grossEarnings - totalDeductions)),
    };
}
