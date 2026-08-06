import {
    ORDINARY_HOURS_PER_DAY,
    OVERTIME_MULTIPLIER,
    absenceDeduction,
    buildPayslip,
    hourlyRate,
    overtimePay,
} from './payroll-calc.util';
import type { ComputedStructure } from './salary-structure.util';

/** 20,000 basic + 10,000 house rent, less 1,000 PF. */
const STRUCTURE: ComputedStructure = {
    basic: 20000,
    earnings: [
        { component_id: 'c-basic', name: 'Basic', kind: 'EARNING', is_taxable: true, rate: 20000, calculation: 'FIXED', amount: 20000 },
        { component_id: 'c-house', name: 'House Rent', kind: 'EARNING', is_taxable: true, rate: 50, calculation: 'PERCENT_OF_BASIC', amount: 10000 },
    ],
    deductions: [
        { component_id: 'c-pf', name: 'Provident Fund', kind: 'DEDUCTION', is_taxable: false, rate: 5, calculation: 'PERCENT_OF_BASIC', amount: 1000 },
    ],
    grossEarnings: 30000,
    totalDeductions: 1000,
    net: 29000,
    taxableEarnings: 30000,
};

const FULL_MONTH = {
    scheduledDays: 22, presentDays: 22, absentDays: 0, leaveDays: 0, approvedOvertimeMinutes: 0,
};

describe('payroll-calc.util', () => {
    describe('hourlyRate', () => {
        it('derives from basic across the scheduled days', () => {
            // 20000 / (22 × 8) = 113.63…
            expect(hourlyRate(20000, 22)).toBeCloseTo(113.636, 2);
        });

        it('uses the Labour Act ordinary day, not the schedule', () => {
            expect(ORDINARY_HOURS_PER_DAY).toBe(8);
        });

        it('is zero rather than Infinity with no scheduled days', () => {
            expect(hourlyRate(20000, 0)).toBe(0);
        });
    });

    describe('overtimePay', () => {
        it('pays twice the ordinary rate', () => {
            expect(OVERTIME_MULTIPLIER).toBe(2);
            // 2h at 113.636 × 2 = 454.55
            expect(overtimePay(20000, 22, 120)).toBeCloseTo(454.55, 2);
        });

        it('is zero with no overtime', () => {
            expect(overtimePay(20000, 22, 0)).toBe(0);
        });

        it('is zero with negative minutes rather than a credit', () => {
            expect(overtimePay(20000, 22, -60)).toBe(0);
        });

        it('excludes allowances by deriving from basic only', () => {
            // House rent is not consideration for hours worked, so a bigger
            // gross must not raise the overtime rate.
            expect(overtimePay(20000, 22, 60)).toBe(overtimePay(20000, 22, 60));
        });
    });

    describe('absenceDeduction', () => {
        it('pro-rates on gross, not basic', () => {
            // A day not worked is a day none of the salary was earned; charging
            // only basic would leave an absent employee taking full house rent.
            expect(absenceDeduction(30000, 22, 1)).toBeCloseTo(1363.64, 2);
        });

        it('is zero with no absence', () => {
            expect(absenceDeduction(30000, 22, 0)).toBe(0);
        });

        it('is zero with no scheduled days', () => {
            expect(absenceDeduction(30000, 0, 3)).toBe(0);
        });

        it('caps at the full month rather than going negative', () => {
            // More absent days than scheduled days is a data error, and a
            // negative payslip is never the right answer to one.
            expect(absenceDeduction(30000, 22, 40)).toBe(30000);
        });
    });

    describe('buildPayslip', () => {
        it('lists every structure earning and deduction', () => {
            const slip = buildPayslip(STRUCTURE, FULL_MONTH);
            expect(slip.items.map((i) => i.name)).toEqual(['Basic', 'House Rent', 'Provident Fund']);
            expect(slip.grossEarnings).toBe(30000);
            expect(slip.netPay).toBe(29000);
        });

        it('explains a percentage line on the payslip', () => {
            // The payslip's job is answering "why this number".
            const slip = buildPayslip(STRUCTURE, FULL_MONTH);
            expect(slip.items.find((i) => i.name === 'House Rent')?.note).toBe('50% of basic');
        });

        it('adds approved overtime as an earning with its working', () => {
            const slip = buildPayslip(STRUCTURE, { ...FULL_MONTH, approvedOvertimeMinutes: 120 });
            const overtime = slip.items.find((i) => i.name === 'Overtime');
            expect(overtime?.amount).toBeCloseTo(454.55, 2);
            expect(overtime?.note).toBe('2h at 2× ordinary rate');
            expect(slip.grossEarnings).toBeCloseTo(30454.55, 2);
        });

        it('does not add an overtime line when there is none', () => {
            const slip = buildPayslip(STRUCTURE, FULL_MONTH);
            expect(slip.items.find((i) => i.name === 'Overtime')).toBeUndefined();
        });

        it('deducts absence and says how many days', () => {
            const slip = buildPayslip(STRUCTURE, { ...FULL_MONTH, absentDays: 2, presentDays: 20 });
            const absence = slip.items.find((i) => i.name === 'Absence');
            expect(absence?.amount).toBeCloseTo(2727.27, 2);
            expect(absence?.note).toBe('2 day(s) of 22');
        });

        it('never deducts for approved leave', () => {
            // Leave days are carried for the record, not for the arithmetic.
            const withLeave = buildPayslip(STRUCTURE, { ...FULL_MONTH, leaveDays: 5, presentDays: 17 });
            expect(withLeave.netPay).toBe(29000);
            expect(withLeave.items.find((i) => i.name === 'Absence')).toBeUndefined();
        });

        it('applies an earning adjustment', () => {
            const slip = buildPayslip(STRUCTURE, FULL_MONTH, [
                { id: 'a1', kind: 'EARNING', name: 'Festival Bonus', amount: 5000, note: null },
            ]);
            expect(slip.adjustmentEarnings).toBe(5000);
            expect(slip.grossEarnings).toBe(35000);
            expect(slip.netPay).toBe(34000);
        });

        it('applies a deduction adjustment', () => {
            const slip = buildPayslip(STRUCTURE, FULL_MONTH, [
                { id: 'a1', kind: 'DEDUCTION', name: 'Advance recovery', amount: 4000, note: '1 of 4' },
            ]);
            expect(slip.adjustmentDeductions).toBe(4000);
            expect(slip.netPay).toBe(25000);
            expect(slip.items.find((i) => i.name === 'Advance recovery')?.note).toBe('1 of 4');
        });

        it('never produces a negative net pay', () => {
            // Deductions exceeding earnings is a real situation; a negative
            // payslip is not a way to express it.
            const slip = buildPayslip(STRUCTURE, FULL_MONTH, [
                { id: 'a1', kind: 'DEDUCTION', name: 'Huge recovery', amount: 999999, note: null },
            ]);
            expect(slip.netPay).toBe(0);
        });

        it('prints earnings before deductions', () => {
            const slip = buildPayslip(STRUCTURE, { ...FULL_MONTH, absentDays: 1 }, [
                { id: 'a1', kind: 'EARNING', name: 'Bonus', amount: 1000, note: null },
                { id: 'a2', kind: 'DEDUCTION', name: 'Fine', amount: 500, note: null },
            ]);
            const kinds = slip.items.map((i) => i.kind);
            expect(kinds.indexOf('DEDUCTION')).toBeGreaterThan(kinds.lastIndexOf('EARNING'));
        });

        it('pays the full structure when no attendance was recorded', () => {
            // A shop that does not track attendance still pays its staff, so
            // the attendance figures are zeroed rather than the pay.
            const slip = buildPayslip(STRUCTURE, {
                scheduledDays: 0, presentDays: 0, absentDays: 0, leaveDays: 0, approvedOvertimeMinutes: 0,
            });
            expect(slip.netPay).toBe(29000);
        });

        it('combines overtime, absence and adjustments in one slip', () => {
            const slip = buildPayslip(
                STRUCTURE,
                { scheduledDays: 22, presentDays: 19, absentDays: 2, leaveDays: 1, approvedOvertimeMinutes: 60 },
                [{ id: 'a1', kind: 'DEDUCTION', name: 'Advance', amount: 2000, note: null }],
            );

            // 30000 + 227.27 overtime = 30227.27 gross
            expect(slip.grossEarnings).toBeCloseTo(30227.27, 2);
            // 1000 PF + 2727.27 absence + 2000 advance = 5727.27
            expect(slip.totalDeductions).toBeCloseTo(5727.27, 2);
            expect(slip.netPay).toBeCloseTo(24500, 0);
        });
    });
});
