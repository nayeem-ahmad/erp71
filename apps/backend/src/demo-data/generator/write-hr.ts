import { Prisma } from '@prisma/client';
import { autoPostFromRules } from '../../accounting/posting.utils';
import type { DemoWorld } from './context';
import { personName, phoneNumber } from './people';
import { money } from './write';

type Tx = Prisma.TransactionClient;

/** Phone-sequence offset, so employees never collide with customers or leads. */
const EMPLOYEE_PHONE_OFFSET = 40000;

/** The staff a two-branch Bangladeshi retailer actually has. */
const STAFF = [
    { department: 'Management', designation: 'Store Manager', salary: 45000 },
    { department: 'Sales', designation: 'Senior Salesman', salary: 28000 },
    { department: 'Sales', designation: 'Salesman', salary: 22000 },
    { department: 'Sales', designation: 'Salesman', salary: 21000 },
    { department: 'Accounts', designation: 'Accounts Officer', salary: 32000 },
    { department: 'Warehouse', designation: 'Store Keeper', salary: 20000 },
    { department: 'Warehouse', designation: 'Delivery Assistant', salary: 17000 },
    { department: 'Support', designation: 'Cleaner', salary: 12000 },
];

const LEAVE_TYPES = [
    { name: 'Casual Leave', days: 10 },
    { name: 'Sick Leave', days: 14 },
    { name: 'Earned Leave', days: 15 },
    { name: 'Unpaid Leave', days: 0 },
];

/** Fixed-date national holidays, so the attendance calendar has real gaps. */
const HOLIDAYS = [
    { month: 1, day: 21, name: 'International Mother Language Day' },
    { month: 2, day: 26, name: 'Independence Day' },
    { month: 3, day: 14, name: 'Bengali New Year' },
    { month: 4, day: 1, name: 'May Day' },
    { month: 7, day: 16, name: 'National Mourning Day' },
    { month: 11, day: 16, name: 'Victory Day' },
];

const CLAIM_TITLES = [
    'Delivery van fuel',
    'Client entertainment',
    'Courier and packaging',
    'Office supplies run',
    'Mobile top-up for the sales team',
];

/**
 * The HR side of the store: who works there, whether they turned up, what they
 * were paid and what they claimed back.
 *
 * Payroll here is not a standalone table of numbers — the monthly accrual and
 * the payment both post through `autoPostFromRules`, so Salary Payable behaves
 * as the employee-party control account it is declared to be, and the employee
 * ledger in Accounting shows real movement.
 */
export class HrWriter {
    private departmentIds = new Map<string, string>();
    private designationIds = new Map<string, string>();
    private leaveTypeIds = new Map<string, string>();

    constructor(private readonly world: DemoWorld) {}

    private get counts() {
        return this.world.counts;
    }

    /* ---------------------------------------------------------------- */
    /*  Master data                                                      */
    /* ---------------------------------------------------------------- */

    async ensureMasterData(tx: Tx): Promise<void> {
        const { tenantId, rng, batchNumber } = this.world;

        for (const name of [...new Set(STAFF.map((s) => s.department))]) {
            const row = await tx.department.upsert({
                where: { tenant_id_name: { tenant_id: tenantId, name } },
                update: {}, create: { tenant_id: tenantId, name },
            });
            this.departmentIds.set(name, row.id);
            this.counts.departments++;
        }

        for (const name of [...new Set(STAFF.map((s) => s.designation))]) {
            const row = await tx.designation.upsert({
                where: { tenant_id_name: { tenant_id: tenantId, name } },
                update: {}, create: { tenant_id: tenantId, name },
            });
            this.designationIds.set(name, row.id);
            this.counts.designations++;
        }

        for (const type of LEAVE_TYPES) {
            const row = await tx.leaveType.upsert({
                where: { tenant_id_name: { tenant_id: tenantId, name: type.name } },
                update: {},
                create: { tenant_id: tenantId, name: type.name, days_per_year: type.days },
            });
            this.leaveTypeIds.set(type.name, row.id);
        }

        // Sat–Thu working week, Friday off — the Bangladeshi retail norm.
        const scheduleName = 'Shop Roster';
        const existingSchedule = await tx.workSchedule.findFirst({ where: { tenant_id: tenantId, name: scheduleName } });
        const schedule = existingSchedule ?? await tx.workSchedule.create({
            data: {
                tenant_id: tenantId, name: scheduleName, is_default: true,
                days: {
                    create: Array.from({ length: 7 }, (_, weekday) => ({
                        weekday,
                        is_working: weekday !== 5,
                        start_minute: weekday === 5 ? null : 10 * 60,
                        end_minute: weekday === 5 ? null : 20 * 60,
                        break_minutes: weekday === 5 ? 0 : 60,
                    })),
                },
            },
        });
        if (!existingSchedule) this.counts.workSchedules++;

        for (const holiday of HOLIDAYS) {
            const year = this.world.end.getUTCFullYear();
            const date = new Date(Date.UTC(year, holiday.month - 1, holiday.day));
            if (date < this.world.start || date > this.world.end) continue;
            const created = await tx.holiday.createMany({
                data: [{ tenant_id: tenantId, date, name: holiday.name }],
                skipDuplicates: true,
            });
            this.counts.holidays += created.count;
        }

        const joinedBase = new Date(this.world.start.getTime() - 400 * 86400000);
        for (const [index, spec] of STAFF.entries()) {
            const employee = await tx.employee.create({
                data: {
                    tenant_id: tenantId,
                    employee_code: `D${batchNumber}-EMP${String(index + 1).padStart(4, '0')}`,
                    name: personName(rng),
                    phone: phoneNumber(rng, batchNumber * 100000 + EMPLOYEE_PHONE_OFFSET + index),
                    department_id: this.departmentIds.get(spec.department),
                    designation_id: this.designationIds.get(spec.designation),
                    basic_salary: spec.salary,
                    // One of the eight is still on probation, so the status filter
                    // in the employee list has something to filter.
                    status: index === STAFF.length - 1 ? 'PROBATION' : 'ACTIVE',
                    date_of_joining: new Date(joinedBase.getTime() + index * 45 * 86400000),
                    created_at: this.world.start,
                    updated_at: this.world.start,
                },
            });
            this.world.employees.push({
                id: employee.id, name: employee.name, salary: spec.salary,
                departmentName: spec.department, designationName: spec.designation,
            });
            this.counts.employees++;

            await tx.employeeSchedule.create({
                data: {
                    tenant_id: tenantId, employee_id: employee.id, schedule_id: schedule.id,
                    effective_from: this.world.start, created_at: this.world.start,
                },
            });

            const year = this.world.end.getUTCFullYear();
            for (const type of LEAVE_TYPES) {
                if (type.days === 0) continue;
                await tx.leaveBalance.create({
                    data: {
                        tenant_id: tenantId, employee_id: employee.id,
                        leave_type_id: this.leaveTypeIds.get(type.name)!,
                        year, total_days: type.days, used_days: rng.int(0, Math.floor(type.days / 2)),
                        created_at: this.world.start, updated_at: this.world.start,
                    },
                });
            }
        }
    }

    /* ---------------------------------------------------------------- */
    /*  Daily attendance                                                 */
    /* ---------------------------------------------------------------- */

    /**
     * One attendance row per employee per working day, with realistic slippage.
     * Written as a single `createMany`: eight round-trips a day over six months
     * is most of a minute of the run spent waiting on the network.
     */
    async writeAttendance(tx: Tx, dayStart: Date): Promise<void> {
        const rng = this.world.rng;
        const weekday = dayStart.getUTCDay();
        if (weekday === 5) return; // Friday off.

        const clockOut = this.world.clampToWindow(new Date(dayStart.getTime() + 20 * 3600_000));
        const rows = this.world.employees.map((employee) => {
            const roll = rng.float();
            let status: string;
            let lateMinutes = 0;
            if (roll < 0.04) status = 'ABSENT';
            else if (roll < 0.09) status = 'ON_LEAVE';
            else if (roll < 0.2) { status = 'LATE'; lateMinutes = rng.int(5, 55); }
            else if (roll < 0.23) status = 'HALF_DAY';
            else status = 'PRESENT';

            const worked = status === 'ABSENT' || status === 'ON_LEAVE'
                ? 0
                : status === 'HALF_DAY' ? 240 : 540 - lateMinutes;

            return {
                tenant_id: this.world.tenantId,
                employee_id: employee.id,
                date: dayStart,
                clock_in: worked > 0 ? new Date(dayStart.getTime() + (10 * 60 + lateMinutes) * 60_000) : null,
                clock_out: worked > 0 ? clockOut : null,
                status: status as never,
                late_minutes: lateMinutes,
                worked_minutes: worked,
                overtime_minutes: status === 'PRESENT' && rng.chance(0.12) ? rng.int(30, 120) : 0,
                source: 'ADMIN',
                store_id: this.world.mainStore.storeId,
                created_at: dayStart,
                updated_at: dayStart,
            };
        });
        if (rows.length === 0) return;

        const { count } = await tx.attendanceRecord.createMany({ data: rows, skipDuplicates: true });
        this.counts.attendanceRecords += count;
    }

    /** An occasional leave application, at every stage of approval. */
    async maybeLeaveRequest(tx: Tx, date: Date): Promise<void> {
        const rng = this.world.rng;
        if (this.world.employees.length === 0 || !rng.chance(0.12)) return;

        const employee = rng.pick(this.world.employees);
        const typeName = rng.weighted(LEAVE_TYPES.map((t) => t.name), [40, 35, 20, 5]);
        const days = rng.int(1, 4);
        const start = new Date(date.getTime() + rng.int(1, 14) * 86400000);
        const status = rng.weighted(['APPROVED', 'PENDING', 'REJECTED', 'CANCELLED'], [55, 25, 12, 8]);
        const decided = status === 'APPROVED' || status === 'REJECTED';

        await tx.leaveRequest.create({
            data: {
                tenant_id: this.world.tenantId,
                employee_id: employee.id,
                leave_type_id: this.leaveTypeIds.get(typeName)!,
                start_date: start,
                end_date: new Date(start.getTime() + (days - 1) * 86400000),
                days,
                reason: rng.pick(['Family event', 'Medical appointment', 'Travelling home', 'Personal work']),
                status: status as never,
                approved_by: decided ? this.world.userId : null,
                approved_at: decided ? date : null,
                approvals_given: status === 'APPROVED' ? 1 : 0,
                created_at: date,
                updated_at: date,
            },
        });
        this.counts.leaveRequests++;
    }

    /** A staff expense claim, most of them reimbursed. */
    async maybeExpenseClaim(tx: Tx, date: Date): Promise<void> {
        const rng = this.world.rng;
        if (this.world.employees.length === 0 || !rng.chance(0.1)) return;

        const employee = rng.pick(this.world.employees);
        const lineCount = rng.int(1, 3);
        const lines = Array.from({ length: lineCount }, () => ({
            description: rng.pick(CLAIM_TITLES),
            amount: money(rng.int(200, 3500)),
            spent_on: new Date(date.getTime() - rng.int(1, 6) * 86400000),
            category_id: this.world.expenseCategoryIds.get('Transport') ?? null,
        }));
        const total = money(lines.reduce((s, l) => s + l.amount, 0));
        const status = rng.weighted(['REIMBURSED', 'APPROVED', 'SUBMITTED', 'DRAFT', 'REJECTED'], [40, 20, 20, 12, 8]);
        const decided = status === 'REIMBURSED' || status === 'APPROVED' || status === 'REJECTED';

        await tx.expenseClaim.create({
            data: {
                tenant_id: this.world.tenantId,
                employee_id: employee.id,
                title: rng.pick(CLAIM_TITLES),
                status,
                claim_date: date,
                total_amount: total,
                approved_by: decided ? this.world.userId : null,
                approved_at: decided ? date : null,
                reimbursed_via: status === 'REIMBURSED' ? rng.pick(['CASH', 'BANK', 'BKASH']) : null,
                reimbursed_at: status === 'REIMBURSED' ? new Date(date.getTime() + 86400000) : null,
                created_at: date,
                updated_at: date,
                lines: { create: lines },
            },
        });
        this.counts.expenseClaims++;
    }

    /* ---------------------------------------------------------------- */
    /*  Monthly payroll                                                  */
    /* ---------------------------------------------------------------- */

    /**
     * Close off `payPeriod` (a 'YYYY-MM' string): accrue each employee's salary
     * to Salary Payable, then settle it. Both legs post through the rules engine
     * with the employee as the party, so the payable nets to zero per person and
     * the employee ledger reads as a statement rather than a lump.
     */
    async runPayroll(tx: Tx, date: Date, payPeriod: string): Promise<void> {
        const rng = this.world.rng;
        if (this.world.employees.length === 0) return;

        const [yearText, monthText] = payPeriod.split('-');
        const year = Number(yearText);
        const month = Number(monthText);

        // A prior batch may already have closed this month; reuse its run rather
        // than colliding on @@unique([tenant_id, year, month, kind]).
        const existingRun = await tx.payrollRun.findFirst({
            where: { tenant_id: this.world.tenantId, year, month, kind: 'REGULAR' },
        });
        const run = existingRun ?? await tx.payrollRun.create({
            data: {
                tenant_id: this.world.tenantId, year, month, kind: 'REGULAR', status: 'PAID',
                label: `Payroll ${payPeriod}`, approved_by: this.world.userId, approved_at: date,
                paid_at: date, created_by: this.world.userId, created_at: date, updated_at: date,
            },
        });
        if (!existingRun) this.counts.payrollRuns++;

        for (const employee of this.world.employees) {
            const absentDays = rng.int(0, 2);
            const overtimeAmount = money(rng.chance(0.3) ? rng.int(500, 2500) : 0);
            const absenceDeduction = money((employee.salary / 30) * absentDays);
            const netPay = money(employee.salary + overtimeAmount - absenceDeduction);

            await tx.payrollLine.create({
                data: {
                    run_id: run.id,
                    tenant_id: this.world.tenantId,
                    employee_id: employee.id,
                    scheduled_days: 26,
                    present_days: 26 - absentDays,
                    absent_days: absentDays,
                    gross_earnings: employee.salary,
                    overtime_amount: overtimeAmount,
                    absence_deduction: absenceDeduction,
                    total_deductions: absenceDeduction,
                    net_pay: netPay,
                    created_at: date,
                    updated_at: date,
                },
            });

            const accrual = await tx.salaryAccrual.create({
                data: {
                    tenant_id: this.world.tenantId, employee_id: employee.id,
                    pay_period: payPeriod, amount: netPay,
                    created_by: this.world.userId, created_at: date,
                },
            });
            this.counts.salaryAccruals++;

            await autoPostFromRules({
                tx,
                tenantId: this.world.tenantId,
                eventType: 'salary_accrual',
                conditionKey: 'none',
                conditionValue: null,
                sourceModule: 'payroll',
                sourceType: 'salary_accrual',
                sourceId: accrual.id,
                amount: netPay,
                description: `Salary accrual ${payPeriod} — ${employee.name}`,
                date,
                storeId: this.world.mainStore.storeId,
                partyType: 'EMPLOYEE',
                partyId: employee.id,
            });

            // Paid a few days after the month closes, the way a shop actually
            // does it — bank transfer for the salaried staff, cash for the rest.
            const paidOn = this.world.clampToWindow(new Date(date.getTime() + 4 * 86400000));
            const method = employee.salary >= 25000 ? 'BANK' : 'CASH';
            const payment = await tx.salaryPayment.create({
                data: {
                    tenant_id: this.world.tenantId, employee_id: employee.id,
                    amount: netPay, pay_period: payPeriod, payment_date: paidOn,
                    payment_method: method, notes: 'Demo payroll settlement',
                    created_by: this.world.userId, created_at: paidOn, updated_at: paidOn,
                },
            });
            this.counts.salaryPayments++;

            await autoPostFromRules({
                tx,
                tenantId: this.world.tenantId,
                eventType: 'salary_payment',
                conditionKey: 'payment_mode',
                conditionValue: method.toLowerCase(),
                sourceModule: 'payroll',
                sourceType: 'salary_payment',
                sourceId: payment.id,
                amount: netPay,
                description: `Salary paid ${payPeriod} — ${employee.name}`,
                date: paidOn,
                storeId: this.world.mainStore.storeId,
                partyType: 'EMPLOYEE',
                partyId: employee.id,
            });
        }
    }
}
