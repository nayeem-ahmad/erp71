import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { money } from './salary-structure.util';

/**
 * Statutory registers and returns — HRIS Phase 13.
 *
 * ERP71 is deliberately Bangladesh-local everywhere else — bKash and Nagad,
 * BDT formatting, a Bangla locale. HR was the module where that localisation
 * stopped. These are the reports an employer here actually has to produce.
 *
 * Every figure comes from **frozen payroll runs**, never from live structures.
 * A statutory return that changes because somebody edited a salary is worse
 * than no return at all, and the Phase 6 design — copy every input onto the
 * line — is what makes that possible.
 *
 * What this does not do: file anything. These produce the numbers and the
 * layout; submission stays a human act, which is the right division for a
 * regulated form.
 */
@Injectable()
export class StatutoryReportsService {
    constructor(private readonly db: DatabaseService) {}

    /**
     * The Bangladeshi income year runs **July to June**, not January to
     * December. Getting this wrong would make every tax figure a year out, so
     * it is a named function rather than an inline calculation.
     */
    static fiscalYearRange(startYear: number): { from: { year: number; month: number }; to: { year: number; month: number }; label: string } {
        return {
            from: { year: startYear, month: 7 },
            to: { year: startYear + 1, month: 6 },
            label: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
        };
    }

    /** Payroll lines across a month range, from runs that were actually paid. */
    private async settledLines(
        tenantId: string,
        from: { year: number; month: number },
        to: { year: number; month: number },
        employeeId?: string,
    ) {
        return this.db.payrollLine.findMany({
            where: {
                tenant_id: tenantId,
                ...(employeeId ? { employee_id: employeeId } : {}),
                run: {
                    // APPROVED as well as PAID: an approved run is a settled
                    // obligation, and a register that omitted the month you are
                    // about to pay would be useless on the day you file.
                    status: { in: ['APPROVED', 'PAID'] },
                    OR: [
                        { year: { gt: from.year, lt: to.year } },
                        { year: from.year, month: { gte: from.month } },
                        { year: to.year, month: { lte: to.month } },
                    ],
                },
            },
            include: {
                items: { orderBy: { sort_order: 'asc' } },
                employee: {
                    select: {
                        id: true, name: true, employee_code: true, date_of_joining: true,
                        department: { select: { name: true } },
                        designation: { select: { name: true } },
                    },
                },
                run: { select: { year: true, month: true, kind: true } },
            },
            orderBy: [{ run: { year: 'asc' } }, { run: { month: 'asc' } }],
        });
    }

    /**
     * Provident fund register.
     *
     * Reads the PF line off each payslip by name match. That is deliberately
     * loose: a tenant may call it "PF", "Provident Fund" or "প্রভিডেন্ট ফান্ড",
     * and forcing a system flag onto the component would mean a tenant who
     * named it differently silently files an empty register.
     *
     * **The employer's matching contribution is not modelled.** A PF scheme is
     * normally employer-matched, and nothing in this system records the
     * employer side — showing a fabricated match would be worse than showing
     * only what was actually withheld, so the register says so.
     */
    async providentFundRegister(tenantId: string, startYear: number) {
        const range = StatutoryReportsService.fiscalYearRange(startYear);
        const lines = await this.settledLines(tenantId, range.from, range.to);

        const byEmployee = new Map<string, any>();

        for (const line of lines) {
            const pf = line.items
                .filter((item: any) =>
                    item.kind === 'DEDUCTION' && /provident|\bpf\b|প্রভিডেন্ট/i.test(item.name))
                .reduce((sum: number, item: any) => sum + Number(item.amount), 0);
            if (pf <= 0) continue;

            const entry = byEmployee.get(line.employee_id) ?? {
                employee: line.employee,
                months: [] as any[],
                total_employee_contribution: 0,
            };
            entry.months.push({
                year: line.run.year,
                month: line.run.month,
                amount: money(pf),
            });
            entry.total_employee_contribution = money(entry.total_employee_contribution + pf);
            byEmployee.set(line.employee_id, entry);
        }

        return {
            fiscal_year: range.label,
            period: range,
            rows: [...byEmployee.values()],
            grand_total: money(
                [...byEmployee.values()].reduce((sum, row) => sum + row.total_employee_contribution, 0),
            ),
            notes: [
                'Employee contributions only. The employer matching contribution is not recorded in this system.',
                'Figures are taken from approved and paid payroll runs, not from current salary structures.',
            ],
        };
    }

    /**
     * Tax deduction statement for the income year (July–June).
     *
     * Reports taxable earnings and the tax actually withheld. It deliberately
     * **does not compute** what the tax should have been: Bangladeshi personal
     * income tax has slabs, investment rebates and category-dependent
     * thresholds that change by Finance Act each year, and a number this system
     * calculated would be wrong the first time the slabs moved — while looking
     * authoritative. Withholding stays a configured deduction; this reports it.
     */
    async taxDeductionStatement(tenantId: string, startYear: number, employeeId?: string) {
        const range = StatutoryReportsService.fiscalYearRange(startYear);
        const lines = await this.settledLines(tenantId, range.from, range.to, employeeId);

        const byEmployee = new Map<string, any>();

        for (const line of lines) {
            const tax = line.items
                .filter((item: any) =>
                    item.kind === 'DEDUCTION' && /tax|ait|আয়কর/i.test(item.name))
                .reduce((sum: number, item: any) => sum + Number(item.amount), 0);

            const entry = byEmployee.get(line.employee_id) ?? {
                employee: line.employee,
                gross_earnings: 0,
                tax_deducted: 0,
                months: 0,
            };
            entry.gross_earnings = money(entry.gross_earnings + Number(line.gross_earnings));
            entry.tax_deducted = money(entry.tax_deducted + tax);
            entry.months += 1;
            byEmployee.set(line.employee_id, entry);
        }

        return {
            fiscal_year: range.label,
            period: range,
            rows: [...byEmployee.values()],
            totals: {
                gross_earnings: money([...byEmployee.values()].reduce((s, r) => s + r.gross_earnings, 0)),
                tax_deducted: money([...byEmployee.values()].reduce((s, r) => s + r.tax_deducted, 0)),
            },
            notes: [
                'Reports tax actually withheld. It does not compute liability — slabs, rebates and thresholds change by Finance Act and belong with a tax adviser.',
                'The Bangladeshi income year runs July to June.',
            ],
        };
    }

    /**
     * Wages register for a month — the Labour Rules 2015 salary-sheet shape:
     * every employee, gross, each deduction, net.
     */
    async wagesRegister(tenantId: string, year: number, month: number) {
        const lines = await this.settledLines(
            tenantId, { year, month }, { year, month },
        );

        const rows = lines.map((line: any) => ({
            employee_code: line.employee.employee_code,
            employee_name: line.employee.name,
            designation: line.employee.designation?.name ?? null,
            department: line.employee.department?.name ?? null,
            scheduled_days: line.scheduled_days,
            present_days: line.present_days,
            overtime_minutes: line.approved_overtime_minutes,
            earnings: line.items.filter((i: any) => i.kind === 'EARNING')
                .map((i: any) => ({ name: i.name, amount: Number(i.amount) })),
            deductions: line.items.filter((i: any) => i.kind === 'DEDUCTION')
                .map((i: any) => ({ name: i.name, amount: Number(i.amount) })),
            gross_earnings: Number(line.gross_earnings),
            total_deductions: Number(line.total_deductions),
            net_pay: Number(line.net_pay),
        }));

        return {
            period: { year, month },
            rows,
            totals: {
                gross_earnings: money(rows.reduce((s, r) => s + r.gross_earnings, 0)),
                total_deductions: money(rows.reduce((s, r) => s + r.total_deductions, 0)),
                net_pay: money(rows.reduce((s, r) => s + r.net_pay, 0)),
            },
        };
    }

    /**
     * Employee register — the roster in the shape the labour registers want.
     *
     * Includes leavers, with their reason and last working day. A register that
     * showed only current staff would be exactly the wrong thing for an
     * inspection covering a past period.
     */
    async employeeRegister(tenantId: string) {
        const employees = await this.db.employee.findMany({
            where: { tenant_id: tenantId, deleted_at: null },
            select: {
                employee_code: true, name: true, phone: true, date_of_joining: true,
                status: true, last_working_day: true, exit_reason: true,
                department: { select: { name: true } },
                designation: { select: { name: true } },
            },
            orderBy: [{ status: 'asc' }, { name: 'asc' }],
        });

        return {
            generated_for: 'Employee register',
            rows: employees.map((employee) => ({
                employee_code: employee.employee_code,
                name: employee.name,
                phone: employee.phone,
                designation: employee.designation?.name ?? null,
                department: employee.department?.name ?? null,
                date_of_joining: employee.date_of_joining,
                status: employee.status,
                last_working_day: employee.last_working_day,
                exit_reason: employee.exit_reason,
            })),
            // NID is deliberately absent. It is encrypted at rest and a register
            // exported to a spreadsheet is the last place it should surface.
            notes: ['National ID numbers are held encrypted and are not included in this export.'],
        };
    }

    /**
     * Service book for one employee: their record with the business.
     *
     * Built from what the system genuinely knows — joining date, salary
     * revisions, leave taken, exit. Department and designation *history* is not
     * included because it is not recorded: `Employee` holds only the current
     * one, so a history here would be a single row pretending to be a timeline.
     */
    async serviceBook(tenantId: string, employeeId: string) {
        const [employee, structures, leave, settledLines] = await Promise.all([
            this.db.employee.findFirst({
                where: { id: employeeId, tenant_id: tenantId, deleted_at: null },
                select: {
                    id: true, employee_code: true, name: true, phone: true,
                    date_of_joining: true, status: true, last_working_day: true,
                    exit_reason: true,
                    department: { select: { name: true } },
                    designation: { select: { name: true } },
                },
            }),
            this.db.employeeSalaryStructure.findMany({
                where: { tenant_id: tenantId, employee_id: employeeId },
                include: { lines: true },
                orderBy: { effective_from: 'asc' },
            }),
            this.db.leaveRequest.findMany({
                where: { tenant_id: tenantId, employee_id: employeeId, status: 'APPROVED', deleted_at: null },
                include: { leave_type: { select: { name: true } } },
                orderBy: { start_date: 'asc' },
            }),
            this.settledLines(
                tenantId, { year: 2000, month: 1 }, { year: 2200, month: 12 }, employeeId,
            ),
        ]);

        if (!employee) return null;

        return {
            employee,
            salary_revisions: structures.map((structure: any) => ({
                effective_from: structure.effective_from,
                note: structure.note,
                line_count: structure.lines.length,
            })),
            leave_taken: leave.map((request: any) => ({
                leave_type: request.leave_type?.name ?? null,
                start_date: request.start_date,
                end_date: request.end_date,
                days: request.days,
            })),
            total_leave_days: leave.reduce((sum: number, r: any) => sum + r.days, 0),
            months_paid: settledLines.length,
            notes: [
                'Department and designation history is not recorded; only the current assignment is shown.',
            ],
        };
    }
}
