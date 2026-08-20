import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { TenantContext } from '../database/tenant.decorator';
import { canViewPayroll } from '../common/payroll-visibility';
import { money, percent } from '../common/dashboard-window';
import {
    computeStructure,
    structureInForce,
    type ComponentDef,
} from '../payroll/salary-structure.util';
import {
    HrReportGroupByDto,
    HrReportMonthRangeDto,
    LeaveBalanceReportDto,
} from './hr-reports.dto';

/**
 * Working days in a month when nothing better is known.
 *
 * A six-day week is the Bangladeshi private-sector norm, so twenty-six is the
 * conventional divisor. It is only ever a **fallback**: every employee with a
 * single attendance month behind them gets their own real `scheduled_days`
 * instead, and the report says which of the two produced each row. A silent
 * constant standing in for real data is how a liability figure becomes fiction.
 */
export const FALLBACK_SCHEDULED_DAYS = 26;

/** A settled payroll run — one that is either approved or already paid. */
const SETTLED_RUN_STATUSES = ['APPROVED', 'PAID'];

interface MonthKey {
    year: number;
    month: number;
}

/** The three fields every grouped row carries, whatever the dimension was. */
interface GroupHeader {
    key: string;
    label: string;
    sublabel: string | null;
}

interface AttendanceRow extends GroupHeader {
    employees: number;
    months: number;
    scheduledDays: number;
    presentDays: number;
    absentDays: number;
    halfDays: number;
    leaveDays: number;
    holidayDays: number;
    lateDays: number;
    workedHours: number;
    lateHours: number;
    overtimeHours: number;
    attendanceRate: number | null;
}

interface PayrollCostRow extends GroupHeader {
    employees: number;
    lines: number;
    grossEarnings: number;
    overtimeAmount: number;
    absenceDeduction: number;
    structureDeductions: number;
    adjustmentEarnings: number;
    adjustmentDeductions: number;
    totalDeductions: number;
    netPay: number;
    overtimeHours: number;
    share: number;
}

/**
 * Tenant-wide HR reporting.
 *
 * Three reports that had no home: attendance rolled up beyond one employee,
 * leave balances with a money value on them, and payroll cost by department.
 * The statutory registers live in `payroll/statutory-reports.service.ts` — those
 * are legal returns with a fixed layout, these are management questions with a
 * groupBy, and keeping them apart stops a filter added for one screen quietly
 * changing what a filed register says.
 *
 * Everything aggregates **in memory after one indexed query** rather than in
 * SQL. The populations here are per-tenant staff counts, which is hundreds at
 * the very top end, and the alternative is a raw query per grouping that no
 * test can reach.
 */
@Injectable()
export class HrReportsService {
    constructor(private readonly db: DatabaseService) {}

    /**
     * A Prisma filter for an inclusive (year, month) range.
     *
     * The same-year case needs its own branch: `{ year: from.year, month: { gte:
     * from.month } }` alone would sweep in December when the range ends in
     * March, so the upper bound has to be applied to the same clause rather
     * than a second one.
     */
    static monthRangeWhere(from: MonthKey, to: MonthKey) {
        if (from.year === to.year) {
            return { year: from.year, month: { gte: from.month, lte: to.month } };
        }
        return {
            OR: [
                { year: { gt: from.year, lt: to.year } },
                { year: from.year, month: { gte: from.month } },
                { year: to.year, month: { lte: to.month } },
            ],
        };
    }

    /** Normalise a range query, swapping the ends if they arrive backwards. */
    private static resolveRange(query: HrReportMonthRangeDto): { from: MonthKey; to: MonthKey } {
        const from = { year: query.fromYear, month: query.fromMonth };
        const to = { year: query.toYear, month: query.toMonth };
        const ordinal = (key: MonthKey) => key.year * 12 + key.month;
        return ordinal(from) <= ordinal(to) ? { from, to } : { from: to, to: from };
    }

    /** `2026-03`, so a month sorts as a string without a second comparator. */
    private static monthKey(year: number, month: number): string {
        return `${year}-${String(month).padStart(2, '0')}`;
    }

    /**
     * Which bucket a row belongs to, for whichever dimension was asked for.
     *
     * Returns the id as well as the labels: two departments can share a name
     * after a rename, and grouping on the label alone would merge them.
     */
    private static bucket(
        groupBy: HrReportGroupByDto,
        employee: {
            id: string;
            name: string;
            employee_code: string;
            department?: { id: string; name: string } | null;
            designation?: { id: string; name: string } | null;
        },
        period: MonthKey,
    ): { key: string; label: string; sublabel: string | null } {
        switch (groupBy) {
            case HrReportGroupByDto.DEPARTMENT:
                return {
                    key: employee.department?.id ?? 'none',
                    label: employee.department?.name ?? 'Unassigned',
                    sublabel: null,
                };
            case HrReportGroupByDto.DESIGNATION:
                return {
                    key: employee.designation?.id ?? 'none',
                    label: employee.designation?.name ?? 'Unassigned',
                    sublabel: null,
                };
            case HrReportGroupByDto.MONTH: {
                const key = HrReportsService.monthKey(period.year, period.month);
                return { key, label: key, sublabel: null };
            }
            case HrReportGroupByDto.EMPLOYEE:
            default:
                return {
                    key: employee.id,
                    label: employee.name,
                    sublabel: employee.employee_code,
                };
        }
    }

    // ── Attendance summary ────────────────────────────────────────────────────

    /**
     * Attendance rolled up across employees and months.
     *
     * Reads `AttendanceMonthSnapshot`, not `AttendanceRecord`. The snapshot is
     * the figure payroll consumed — it carries `frozen_at` once a run has taken
     * it — so a report built on it can never disagree with a payslip, which a
     * fresh count over the day rows absolutely could once somebody edits a
     * past day.
     *
     * The cost of that choice is stated rather than hidden: a month nobody has
     * built a snapshot for contributes nothing, so the response reports how
     * many employee-months it actually found.
     */
    async attendanceSummary(tenantId: string, query: HrReportMonthRangeDto) {
        const { from, to } = HrReportsService.resolveRange(query);
        const groupBy = query.groupBy ?? HrReportGroupByDto.EMPLOYEE;

        const snapshots = await this.db.attendanceMonthSnapshot.findMany({
            where: {
                tenant_id: tenantId,
                ...HrReportsService.monthRangeWhere(from, to),
                ...(query.employeeId ? { employee_id: query.employeeId } : {}),
                ...(query.departmentId
                    ? { employee: { department_id: query.departmentId } }
                    : {}),
            },
            include: {
                employee: {
                    select: {
                        id: true,
                        name: true,
                        employee_code: true,
                        department: { select: { id: true, name: true } },
                        designation: { select: { id: true, name: true } },
                    },
                },
            },
        });

        const buckets = new Map<string, any>();
        const employeesSeen = new Set<string>();
        let frozenMonths = 0;

        for (const snapshot of snapshots) {
            const employee = snapshot.employee;
            if (!employee) continue;
            employeesSeen.add(employee.id);
            if (snapshot.frozen_at) frozenMonths += 1;

            const bucket = HrReportsService.bucket(groupBy, employee, {
                year: snapshot.year,
                month: snapshot.month,
            });
            const row = buckets.get(bucket.key) ?? {
                ...bucket,
                employees: new Set<string>(),
                months: 0,
                scheduledDays: 0,
                presentDays: 0,
                absentDays: 0,
                halfDays: 0,
                leaveDays: 0,
                holidayDays: 0,
                lateDays: 0,
                workedMinutes: 0,
                lateMinutes: 0,
                overtimeMinutes: 0,
            };

            row.employees.add(employee.id);
            row.months += 1;
            row.scheduledDays += snapshot.scheduled_days;
            row.presentDays += snapshot.present_days;
            row.absentDays += snapshot.absent_days;
            row.halfDays += snapshot.half_days;
            row.leaveDays += snapshot.leave_days;
            row.holidayDays += snapshot.holiday_days;
            row.lateDays += snapshot.late_days;
            row.workedMinutes += snapshot.worked_minutes;
            row.lateMinutes += snapshot.late_minutes;
            row.overtimeMinutes += snapshot.approved_overtime_minutes;
            buckets.set(bucket.key, row);
        }

        const rows: AttendanceRow[] = [...buckets.values()]
            .map((row) => ({
                key: row.key,
                label: row.label,
                sublabel: row.sublabel,
                employees: row.employees.size,
                months: row.months,
                scheduledDays: money(row.scheduledDays),
                presentDays: money(row.presentDays),
                absentDays: row.absentDays,
                halfDays: row.halfDays,
                leaveDays: row.leaveDays,
                holidayDays: row.holidayDays,
                lateDays: row.lateDays,
                workedHours: money(row.workedMinutes / 60),
                lateHours: money(row.lateMinutes / 60),
                overtimeHours: money(row.overtimeMinutes / 60),
                attendanceRate: percent(row.presentDays, row.scheduledDays),
            }))
            .sort((a, b) =>
                groupBy === HrReportGroupByDto.MONTH
                    ? a.key.localeCompare(b.key)
                    : b.presentDays - a.presentDays || a.label.localeCompare(b.label),
            );

        const totals = rows.reduce(
            (sum, row) => ({
                scheduledDays: sum.scheduledDays + row.scheduledDays,
                presentDays: sum.presentDays + row.presentDays,
                absentDays: sum.absentDays + row.absentDays,
                leaveDays: sum.leaveDays + row.leaveDays,
                lateDays: sum.lateDays + row.lateDays,
                workedHours: sum.workedHours + row.workedHours,
                overtimeHours: sum.overtimeHours + row.overtimeHours,
            }),
            {
                scheduledDays: 0, presentDays: 0, absentDays: 0,
                leaveDays: 0, lateDays: 0, workedHours: 0, overtimeHours: 0,
            },
        );

        return {
            filters: { from, to, groupBy },
            rows,
            summary: {
                ...Object.fromEntries(
                    Object.entries(totals).map(([key, value]) => [key, money(value)]),
                ),
                employees: employeesSeen.size,
                employeeMonths: snapshots.length,
                // Months a payroll run has consumed. A report that is mostly
                // unfrozen is a report of figures that can still move.
                frozenMonths,
                attendanceRate: percent(totals.presentDays, totals.scheduledDays),
            } as Record<string, number | null>,
        };
    }

    // ── Leave balance & liability ─────────────────────────────────────────────

    /**
     * Leave balances, and what the unused days are worth.
     *
     * The money half is the point. Remaining leave is a real obligation and
     * nothing in the system has ever put a figure on it — but only for types
     * that `allows_encashment`, because days that expire unused cost nothing
     * and counting them would inflate the liability to meaninglessness.
     *
     * The daily rate matches payroll's own: **gross earnings ÷ scheduled days**,
     * the same divisor `absenceDeduction` uses. A day of leave paid out and a
     * day of absence deducted have to be worth the same, or the two screens
     * argue.
     *
     * Money is dropped entirely for a caller without `VIEW_PAYROLL` — the days
     * still render, which is what an HR officer without pay access needs.
     */
    async leaveBalance(tenant: TenantContext, query: LeaveBalanceReportDto) {
        const tenantId = tenant.tenantId;
        const canSeeMoney = await canViewPayroll(this.db, tenant);

        const balances = await this.db.leaveBalance.findMany({
            where: {
                tenant_id: tenantId,
                year: query.year,
                ...(query.leaveTypeId ? { leave_type_id: query.leaveTypeId } : {}),
                ...(query.employeeId ? { employee_id: query.employeeId } : {}),
                employee: {
                    deleted_at: null,
                    ...(query.departmentId ? { department_id: query.departmentId } : {}),
                },
            },
            include: {
                employee: {
                    select: {
                        id: true,
                        name: true,
                        employee_code: true,
                        status: true,
                        department: { select: { id: true, name: true } },
                    },
                },
                leave_type: {
                    select: {
                        id: true,
                        name: true,
                        allows_encashment: true,
                        carry_forward_max_days: true,
                    },
                },
            },
        });

        const employeeIds: string[] = [...new Set(balances.map((balance) => balance.employee_id))];
        const rates = canSeeMoney
            ? await this.dailyRates(tenantId, employeeIds)
            : new Map<string, { dailyRate: number; source: string }>();

        const rows = balances
            .map((balance) => {
                const remaining = money(balance.total_days - balance.used_days);
                const encashable = balance.leave_type.allows_encashment;
                const rate = rates.get(balance.employee_id) ?? null;
                // Negative remaining is real — leave taken beyond entitlement —
                // but it is not a liability, it is an overdraw. Clamping keeps
                // one overdrawn employee from cancelling out somebody else's
                // genuine obligation in the total.
                const liability =
                    rate && encashable && remaining > 0
                        ? money(remaining * rate.dailyRate)
                        : encashable && rate
                            ? 0
                            : null;

                return {
                    key: `${balance.employee_id}:${balance.leave_type_id}`,
                    employeeId: balance.employee_id,
                    employeeName: balance.employee.name,
                    employeeCode: balance.employee.employee_code,
                    employeeStatus: balance.employee.status,
                    departmentId: balance.employee.department?.id ?? null,
                    departmentName: balance.employee.department?.name ?? null,
                    leaveTypeId: balance.leave_type_id,
                    leaveTypeName: balance.leave_type.name,
                    entitledDays: money(balance.total_days),
                    usedDays: money(balance.used_days),
                    remainingDays: remaining,
                    carryForwardMaxDays: balance.leave_type.carry_forward_max_days,
                    allowsEncashment: encashable,
                    dailyRate: canSeeMoney ? (rate?.dailyRate ?? null) : null,
                    dailyRateSource: canSeeMoney ? (rate?.source ?? null) : null,
                    liability: canSeeMoney ? liability : null,
                };
            })
            .sort(
                (a, b) =>
                    a.employeeName.localeCompare(b.employeeName) ||
                    a.leaveTypeName.localeCompare(b.leaveTypeName),
            );

        const encashableRows = rows.filter((row) => row.allowsEncashment && row.remainingDays > 0);

        return {
            filters: { year: query.year },
            rows,
            summary: {
                employees: new Set(rows.map((row) => row.employeeId)).size,
                entitledDays: money(rows.reduce((sum, row) => sum + row.entitledDays, 0)),
                usedDays: money(rows.reduce((sum, row) => sum + row.usedDays, 0)),
                remainingDays: money(rows.reduce((sum, row) => sum + row.remainingDays, 0)),
                encashableDays: money(
                    encashableRows.reduce((sum, row) => sum + row.remainingDays, 0),
                ),
                liability: canSeeMoney
                    ? money(rows.reduce((sum, row) => sum + (row.liability ?? 0), 0))
                    : null,
                // How many encashable rows could not be priced. A liability
                // total is only honest next to the count it had to skip.
                unpricedRows: canSeeMoney
                    ? encashableRows.filter((row) => row.dailyRate == null).length
                    : null,
            },
            can_view_payroll: canSeeMoney,
        };
    }

    /**
     * A daily rate per employee, in bulk.
     *
     * `SalaryStructuresService.resolveStructure` answers this for one employee
     * in three queries; a hundred-employee report cannot afford three hundred.
     * So the same pure functions (`structureInForce`, `computeStructure`) run
     * here over one bulk read — the arithmetic is shared, only the fetching
     * differs.
     */
    private async dailyRates(tenantId: string, employeeIds: string[]) {
        const rates = new Map<string, { dailyRate: number; source: string }>();
        if (employeeIds.length === 0) return rates;

        const today = new Date();
        const [components, structures, employees, snapshots] = await Promise.all([
            this.db.salaryComponent.findMany({
                where: { tenant_id: tenantId, deleted_at: null },
                orderBy: { sort_order: 'asc' },
            }),
            this.db.employeeSalaryStructure.findMany({
                where: { tenant_id: tenantId, employee_id: { in: employeeIds } },
                include: { lines: true },
                orderBy: { effective_from: 'desc' },
            }),
            this.db.employee.findMany({
                where: { id: { in: employeeIds }, tenant_id: tenantId },
                select: { id: true, basic_salary: true },
            }),
            // The most recent snapshot per employee gives a real working-day
            // count for that person's own schedule, which a constant cannot.
            this.db.attendanceMonthSnapshot.findMany({
                where: { tenant_id: tenantId, employee_id: { in: employeeIds } },
                select: { employee_id: true, scheduled_days: true, year: true, month: true },
                orderBy: [{ year: 'desc' }, { month: 'desc' }],
            }),
        ]);

        const defs = components as unknown as ComponentDef[];
        const basicComponent = defs.find((component) => component.is_basic);

        type StructureWithLines = (typeof structures)[number];
        const byEmployee = new Map<string, StructureWithLines[]>();
        for (const structure of structures) {
            const list = byEmployee.get(structure.employee_id) ?? [];
            list.push(structure);
            byEmployee.set(structure.employee_id, list);
        }

        const scheduledDays = new Map<string, number>();
        for (const snapshot of snapshots) {
            if (scheduledDays.has(snapshot.employee_id)) continue;
            if (snapshot.scheduled_days > 0) {
                scheduledDays.set(snapshot.employee_id, snapshot.scheduled_days);
            }
        }

        for (const employee of employees) {
            const inForce = structureInForce<StructureWithLines>(
                byEmployee.get(employee.id) ?? [],
                today,
            );
            const fallbackAmount = Number(employee.basic_salary ?? 0);

            let gross = 0;
            let rateSource: string;
            if (inForce) {
                gross = computeStructure(
                    defs,
                    inForce.lines.map((line) => ({
                        component_id: line.component_id,
                        value: Number(line.value),
                    })),
                ).grossEarnings;
                rateSource = 'STRUCTURE';
            } else if (basicComponent) {
                gross = computeStructure(defs, [
                    { component_id: basicComponent.id, value: fallbackAmount },
                ]).grossEarnings;
                rateSource = 'BASIC_SALARY';
            } else {
                gross = fallbackAmount;
                rateSource = 'BASIC_SALARY';
            }

            if (gross <= 0) continue;

            const days = scheduledDays.get(employee.id);
            rates.set(employee.id, {
                dailyRate: money(gross / (days ?? FALLBACK_SCHEDULED_DAYS)),
                source: days ? rateSource : `${rateSource}_FALLBACK_DAYS`,
            });
        }

        return rates;
    }

    // ── Payroll cost summary ──────────────────────────────────────────────────

    /**
     * What payroll cost, by whichever dimension was asked for.
     *
     * Settled runs only — APPROVED or PAID — matching the statutory registers
     * exactly. A draft run is recomputable, so including one would give a cost
     * figure that changes without anybody deciding it should.
     *
     * Every figure is read off `PayrollLine`, where the payroll design already
     * copied it at run time. Nothing here reaches back into live salary
     * structures, so a report of March still shows March's cost after somebody
     * gets a raise in April.
     */
    async payrollCost(tenantId: string, query: HrReportMonthRangeDto) {
        const { from, to } = HrReportsService.resolveRange(query);
        const groupBy = query.groupBy ?? HrReportGroupByDto.DEPARTMENT;

        const lines = await this.db.payrollLine.findMany({
            where: {
                tenant_id: tenantId,
                ...(query.employeeId ? { employee_id: query.employeeId } : {}),
                ...(query.departmentId
                    ? { employee: { department_id: query.departmentId } }
                    : {}),
                run: {
                    status: { in: SETTLED_RUN_STATUSES },
                    ...HrReportsService.monthRangeWhere(from, to),
                },
            },
            include: {
                employee: {
                    select: {
                        id: true,
                        name: true,
                        employee_code: true,
                        department: { select: { id: true, name: true } },
                        designation: { select: { id: true, name: true } },
                    },
                },
                run: { select: { year: true, month: true, kind: true, status: true } },
            },
        });

        const buckets = new Map<string, any>();
        const byMonth = new Map<string, number>();

        for (const line of lines) {
            const employee = line.employee;
            if (!employee) continue;
            const period = { year: line.run.year, month: line.run.month };

            const monthKey = HrReportsService.monthKey(period.year, period.month);
            byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + Number(line.net_pay));

            const bucket = HrReportsService.bucket(groupBy, employee, period);
            const row = buckets.get(bucket.key) ?? {
                ...bucket,
                employees: new Set<string>(),
                lines: 0,
                grossEarnings: 0,
                overtimeAmount: 0,
                absenceDeduction: 0,
                structureDeductions: 0,
                adjustmentEarnings: 0,
                adjustmentDeductions: 0,
                totalDeductions: 0,
                netPay: 0,
                overtimeMinutes: 0,
            };

            row.employees.add(employee.id);
            row.lines += 1;
            row.grossEarnings += Number(line.gross_earnings);
            row.overtimeAmount += Number(line.overtime_amount);
            row.absenceDeduction += Number(line.absence_deduction);
            row.structureDeductions += Number(line.structure_deductions);
            row.adjustmentEarnings += Number(line.adjustment_earnings);
            row.adjustmentDeductions += Number(line.adjustment_deductions);
            row.totalDeductions += Number(line.total_deductions);
            row.netPay += Number(line.net_pay);
            row.overtimeMinutes += line.approved_overtime_minutes;
            buckets.set(bucket.key, row);
        }

        const totalNet = [...buckets.values()].reduce((sum, row) => sum + row.netPay, 0);

        const rows: PayrollCostRow[] = [...buckets.values()]
            .map((row) => ({
                key: row.key,
                label: row.label,
                sublabel: row.sublabel,
                employees: row.employees.size,
                lines: row.lines,
                grossEarnings: money(row.grossEarnings),
                overtimeAmount: money(row.overtimeAmount),
                absenceDeduction: money(row.absenceDeduction),
                structureDeductions: money(row.structureDeductions),
                adjustmentEarnings: money(row.adjustmentEarnings),
                adjustmentDeductions: money(row.adjustmentDeductions),
                totalDeductions: money(row.totalDeductions),
                netPay: money(row.netPay),
                overtimeHours: money(row.overtimeMinutes / 60),
                share: percent(row.netPay, totalNet) ?? 0,
            }))
            .sort((a, b) =>
                groupBy === HrReportGroupByDto.MONTH
                    ? a.key.localeCompare(b.key)
                    : b.netPay - a.netPay || a.label.localeCompare(b.label),
            );

        const employeeCount = new Set(lines.map((line) => line.employee_id)).size;
        const months = [...byMonth.keys()].sort();
        const latest = months.length > 0 ? byMonth.get(months[months.length - 1]) ?? 0 : 0;
        const previous = months.length > 1 ? byMonth.get(months[months.length - 2]) ?? 0 : null;

        return {
            filters: { from, to, groupBy },
            rows,
            summary: {
                employees: employeeCount,
                months: months.length,
                grossEarnings: money(rows.reduce((sum, row) => sum + row.grossEarnings, 0)),
                overtimeAmount: money(rows.reduce((sum, row) => sum + row.overtimeAmount, 0)),
                totalDeductions: money(rows.reduce((sum, row) => sum + row.totalDeductions, 0)),
                netPay: money(totalNet),
                averagePerEmployee: employeeCount === 0 ? null : money(totalNet / employeeCount),
                // Month-over-month on the two most recent months that actually
                // have a settled run — not on calendar adjacency, which would
                // report a fall of 100% for a month nobody has run yet.
                latestMonth: months.length > 0 ? months[months.length - 1] : null,
                latestMonthNet: money(latest),
                previousMonthNet: previous == null ? null : money(previous),
                monthOverMonth:
                    previous == null || previous === 0
                        ? null
                        : money(((latest - previous) / previous) * 100),
            },
        };
    }
}
