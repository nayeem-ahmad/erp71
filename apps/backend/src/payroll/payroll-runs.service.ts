import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { OvertimeService } from '../attendance/overtime.service';
import { SalaryStructuresService } from './salary-structures.service';
import { buildPayslip, type Adjustment } from './payroll-calc.util';

/**
 * The payroll run — HRIS Phase 6.
 *
 * Replaces "one POST per employee per month, by hand". A run drafts every
 * employee's pay, is approved as a whole, and then settles through the
 * `salary_accrual` / `salary_payment` posting events that already exist. No new
 * accounting machinery: this phase gives a working accrual richer inputs.
 */
@Injectable()
export class PayrollRunsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly structures: SalaryStructuresService,
        private readonly overtime: OvertimeService,
    ) {}

    private periodDate(year: number, month: number): Date {
        // The last day of the month: the structure and schedule in force at
        // month end are the ones that governed the month.
        return new Date(Date.UTC(year, month, 0));
    }

    async list(tenantId: string, opts: { year?: number; status?: string } = {}) {
        const where: any = { tenant_id: tenantId };
        if (opts.year) where.year = opts.year;
        if (opts.status) where.status = opts.status;

        return this.db.payrollRun.findMany({
            where,
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
            include: { _count: { select: { lines: true } } },
        });
    }

    async get(tenantId: string, id: string) {
        const run = await this.db.payrollRun.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                lines: {
                    include: {
                        employee: { select: { id: true, name: true, employee_code: true } },
                        items: { orderBy: { sort_order: 'asc' } },
                    },
                    orderBy: { employee: { name: 'asc' } },
                },
            },
        });
        if (!run) throw new NotFoundException('Payroll run not found.');
        return run;
    }

    /**
     * Create a draft run and compute every line.
     *
     * Freezes the attendance month first. That is the whole point of the freeze:
     * without it, correcting an attendance row after the draft would make a
     * re-run produce different pay with nobody being told.
     */
    async createDraft(tenantId: string, dto: {
        year: number; month: number; kind?: string; label?: string;
    }, createdBy?: string) {
        const kind = dto.kind ?? 'REGULAR';

        const existing = await this.db.payrollRun.findFirst({
            where: { tenant_id: tenantId, year: dto.year, month: dto.month, kind },
        });
        if (existing) {
            throw new ConflictException(
                `A ${kind.toLowerCase()} payroll run already exists for ${dto.year}-${String(dto.month).padStart(2, '0')}.`,
            );
        }

        if (kind === 'REGULAR') {
            await this.overtime.freezeMonth(tenantId, dto.year, dto.month);
        }

        const run = await this.db.payrollRun.create({
            data: {
                tenant_id: tenantId,
                year: dto.year,
                month: dto.month,
                kind,
                label: dto.label ?? null,
                status: 'DRAFT',
                created_by: createdBy ?? null,
            },
        });

        await this.computeLines(tenantId, run.id);
        return this.get(tenantId, run.id);
    }

    /** Recompute a draft. Refused once approved — that is what approval means. */
    async recompute(tenantId: string, runId: string) {
        const run = await this.db.payrollRun.findFirst({ where: { id: runId, tenant_id: tenantId } });
        if (!run) throw new NotFoundException('Payroll run not found.');
        if (run.status !== 'DRAFT') {
            throw new BadRequestException('Only a draft payroll run can be recomputed.');
        }
        await this.computeLines(tenantId, runId);
        return this.get(tenantId, runId);
    }

    private async computeLines(tenantId: string, runId: string) {
        const run = await this.db.payrollRun.findFirst({ where: { id: runId, tenant_id: tenantId } });
        if (!run) throw new NotFoundException('Payroll run not found.');

        const periodDate = this.periodDate(run.year, run.month);

        const employees = await this.db.employee.findMany({
            where: { tenant_id: tenantId, status: 'ACTIVE', deleted_at: null },
            select: { id: true },
        });

        // Rewritten wholesale rather than diffed: a recompute must drop lines
        // for anyone who has since left, and a per-employee diff would leave
        // them on the run.
        await this.db.payrollLine.deleteMany({ where: { run_id: runId } });

        for (const employee of employees) {
            const [structure, snapshot, adjustments] = await Promise.all([
                this.structures.resolveStructure(tenantId, employee.id, periodDate),
                this.overtime.getFrozenSnapshot(tenantId, employee.id, run.year, run.month),
                this.db.payrollAdjustment.findMany({
                    where: {
                        tenant_id: tenantId, employee_id: employee.id,
                        year: run.year, month: run.month,
                        applied_run_id: null,
                    },
                }),
            ]);

            // No frozen snapshot means no attendance was recorded for this
            // employee. Paying the full structure is the right default — a shop
            // that does not track attendance still pays its staff — and it is
            // why the attendance figures are zeroed rather than the pay.
            const attendance = {
                scheduledDays: snapshot?.scheduled_days ?? 0,
                presentDays: snapshot?.present_days ?? 0,
                absentDays: snapshot?.absent_days ?? 0,
                leaveDays: snapshot?.leave_days ?? 0,
                approvedOvertimeMinutes: snapshot?.approved_overtime_minutes ?? 0,
            };

            const payslip = buildPayslip(
                structure,
                attendance,
                adjustments.map((adjustment): Adjustment => ({
                    id: adjustment.id,
                    kind: adjustment.kind as 'EARNING' | 'DEDUCTION',
                    name: adjustment.name,
                    amount: Number(adjustment.amount),
                    note: adjustment.note,
                })),
            );

            await this.db.payrollLine.create({
                data: {
                    run_id: runId,
                    tenant_id: tenantId,
                    employee_id: employee.id,
                    scheduled_days: attendance.scheduledDays,
                    present_days: attendance.presentDays,
                    absent_days: attendance.absentDays,
                    leave_days: attendance.leaveDays,
                    approved_overtime_minutes: attendance.approvedOvertimeMinutes,
                    gross_earnings: payslip.grossEarnings,
                    overtime_amount: payslip.overtimeAmount,
                    absence_deduction: payslip.absenceDeduction,
                    structure_deductions: payslip.structureDeductions,
                    adjustment_earnings: payslip.adjustmentEarnings,
                    adjustment_deductions: payslip.adjustmentDeductions,
                    total_deductions: payslip.totalDeductions,
                    net_pay: payslip.netPay,
                    items: {
                        create: payslip.items.map((item) => ({
                            kind: item.kind,
                            name: item.name,
                            amount: item.amount,
                            note: item.note,
                            sort_order: item.sort_order,
                        })),
                    },
                },
            });
        }
    }

    /**
     * Approve the run.
     *
     * Marks the adjustments it consumed, so the same advance recovery cannot be
     * applied again by a later run — the reason `applied_run_id` exists.
     */
    async approve(tenantId: string, runId: string, approverUserId: string) {
        const run = await this.db.payrollRun.findFirst({
            where: { id: runId, tenant_id: tenantId },
            include: { lines: { select: { employee_id: true } } },
        });
        if (!run) throw new NotFoundException('Payroll run not found.');
        if (run.status !== 'DRAFT') {
            throw new BadRequestException('Only a draft payroll run can be approved.');
        }
        if (run.lines.length === 0) {
            throw new BadRequestException('This payroll run has no lines to approve.');
        }

        return this.db.$transaction(async (tx) => {
            await tx.payrollAdjustment.updateMany({
                where: {
                    tenant_id: tenantId, year: run.year, month: run.month,
                    applied_run_id: null,
                    employee_id: { in: run.lines.map((line) => line.employee_id) },
                },
                data: { applied_run_id: runId },
            });

            return tx.payrollRun.update({
                where: { id: runId },
                data: { status: 'APPROVED', approved_by: approverUserId, approved_at: new Date() },
            });
        });
    }

    /**
     * Reopen an approved run.
     *
     * Releases its adjustments so a recompute picks them up again. Refused once
     * the run is paid: money has left the building and a draft cannot describe
     * that.
     */
    async reopen(tenantId: string, runId: string) {
        const run = await this.db.payrollRun.findFirst({ where: { id: runId, tenant_id: tenantId } });
        if (!run) throw new NotFoundException('Payroll run not found.');
        if (run.status === 'PAID') {
            throw new BadRequestException('A paid payroll run cannot be reopened.');
        }
        if (run.status !== 'APPROVED') {
            throw new BadRequestException('Only an approved payroll run can be reopened.');
        }

        return this.db.$transaction(async (tx) => {
            await tx.payrollAdjustment.updateMany({
                where: { tenant_id: tenantId, applied_run_id: runId },
                data: { applied_run_id: null },
            });
            return tx.payrollRun.update({
                where: { id: runId },
                data: { status: 'DRAFT', approved_by: null, approved_at: null },
            });
        });
    }

    async cancel(tenantId: string, runId: string) {
        const run = await this.db.payrollRun.findFirst({ where: { id: runId, tenant_id: tenantId } });
        if (!run) throw new NotFoundException('Payroll run not found.');
        if (run.status === 'PAID') {
            throw new BadRequestException('A paid payroll run cannot be cancelled.');
        }

        return this.db.$transaction(async (tx) => {
            await tx.payrollAdjustment.updateMany({
                where: { tenant_id: tenantId, applied_run_id: runId },
                data: { applied_run_id: null },
            });
            return tx.payrollRun.update({ where: { id: runId }, data: { status: 'CANCELLED' } });
        });
    }

    /** One employee's payslip, self-contained — every figure is on the line. */
    async getPayslip(tenantId: string, runId: string, employeeId: string) {
        const line = await this.db.payrollLine.findFirst({
            where: { run_id: runId, tenant_id: tenantId, employee_id: employeeId },
            include: {
                items: { orderBy: { sort_order: 'asc' } },
                employee: {
                    select: {
                        id: true, name: true, employee_code: true,
                        department: { select: { name: true } },
                        designation: { select: { name: true } },
                    },
                },
                run: { select: { id: true, year: true, month: true, kind: true, status: true, label: true } },
            },
        });
        if (!line) throw new NotFoundException('Payslip not found.');
        return line;
    }

    // ── Adjustments ───────────────────────────────────────────────────────────

    async listAdjustments(tenantId: string, year: number, month: number) {
        return this.db.payrollAdjustment.findMany({
            where: { tenant_id: tenantId, year, month },
            include: { employee: { select: { id: true, name: true, employee_code: true } } },
            orderBy: { created_at: 'desc' },
        });
    }

    async createAdjustment(tenantId: string, dto: {
        employee_id: string; year: number; month: number;
        kind: string; name: string; amount: number; note?: string;
    }, createdBy?: string) {
        const employee = await this.db.employee.findFirst({
            where: { id: dto.employee_id, tenant_id: tenantId, deleted_at: null },
        });
        if (!employee) throw new NotFoundException('Employee not found.');
        if (dto.amount <= 0) {
            // Direction is `kind`, not the sign. A negative deduction is an
            // earning wearing a disguise and would not print sensibly.
            throw new BadRequestException('An adjustment amount must be positive.');
        }

        return this.db.payrollAdjustment.create({
            data: { tenant_id: tenantId, ...dto, created_by: createdBy ?? null },
        });
    }

    async deleteAdjustment(tenantId: string, id: string) {
        const adjustment = await this.db.payrollAdjustment.findFirst({
            where: { id, tenant_id: tenantId },
        });
        if (!adjustment) throw new NotFoundException('Adjustment not found.');
        if (adjustment.applied_run_id) {
            throw new BadRequestException(
                'This adjustment has been applied to an approved payroll run. Reopen the run first.',
            );
        }
        return this.db.payrollAdjustment.delete({ where: { id } });
    }
}
