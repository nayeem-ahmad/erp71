import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { SalaryStructuresService } from '../payroll/salary-structures.service';
import { money } from '../payroll/salary-structure.util';

/**
 * Joining, leaving, and what is owed on the way out — HRIS Phase 12.
 *
 * The item that matters here is the final settlement, because it is a money
 * event with no home in the system before this: `EmployeeStatus` was
 * `ACTIVE | INACTIVE`, so nothing recorded *why* anyone left, and nothing
 * settled what they were owed.
 */
@Injectable()
export class EmployeeLifecycleService {
    constructor(
        private readonly db: DatabaseService,
        private readonly structures: SalaryStructuresService,
    ) {}

    /** Statuses that mean the person has left. */
    private static readonly EXIT_STATUSES = ['RESIGNED', 'TERMINATED', 'CONTRACT_ENDED', 'INACTIVE'];

    private toDateOnly(value: string | Date): Date {
        const date = value instanceof Date ? value : new Date(value);
        return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    }

    // ── Checklist templates ───────────────────────────────────────────────────

    async listTemplates(tenantId: string, kind?: string) {
        return this.db.checklistTemplate.findMany({
            where: { tenant_id: tenantId, ...(kind ? { kind } : {}), is_active: true },
            orderBy: [{ kind: 'asc' }, { sort_order: 'asc' }],
        });
    }

    async createTemplate(tenantId: string, dto: {
        kind: string; title: string; description?: string; sort_order?: number;
    }) {
        return this.db.checklistTemplate.create({
            data: {
                tenant_id: tenantId,
                kind: dto.kind,
                title: dto.title,
                description: dto.description ?? null,
                sort_order: dto.sort_order ?? 0,
            },
        });
    }

    async deleteTemplate(tenantId: string, id: string) {
        const template = await this.db.checklistTemplate.findFirst({
            where: { id, tenant_id: tenantId },
        });
        if (!template) throw new NotFoundException('Checklist template not found.');
        // Deactivate rather than delete: items already copied from it stay
        // readable, and a tenant that turns it back on keeps its position.
        return this.db.checklistTemplate.update({ where: { id }, data: { is_active: false } });
    }

    // ── Per-employee checklist ────────────────────────────────────────────────

    async listChecklist(tenantId: string, employeeId: string, kind?: string) {
        return this.db.employeeChecklistItem.findMany({
            where: { tenant_id: tenantId, employee_id: employeeId, ...(kind ? { kind } : {}) },
            orderBy: [{ kind: 'asc' }, { sort_order: 'asc' }],
        });
    }

    /**
     * Copy the active templates of a kind onto an employee.
     *
     * Titles are copied, not referenced, so retiring a template later does not
     * rewrite the history of everyone who already completed it. Idempotent on
     * title: re-running after adding one template adds only that one.
     */
    async startChecklist(tenantId: string, employeeId: string, kind: 'ONBOARDING' | 'OFFBOARDING') {
        const employee = await this.db.employee.findFirst({
            where: { id: employeeId, tenant_id: tenantId, deleted_at: null },
        });
        if (!employee) throw new NotFoundException('Employee not found.');

        const [templates, existing] = await Promise.all([
            this.listTemplates(tenantId, kind),
            this.db.employeeChecklistItem.findMany({
                where: { tenant_id: tenantId, employee_id: employeeId, kind },
                select: { title: true },
            }),
        ]);

        const seen = new Set(existing.map((item) => item.title));
        const fresh = templates.filter((template) => !seen.has(template.title));
        if (fresh.length === 0) return { created: 0 };

        await this.db.employeeChecklistItem.createMany({
            data: fresh.map((template) => ({
                tenant_id: tenantId,
                employee_id: employeeId,
                kind,
                title: template.title,
                description: template.description,
                sort_order: template.sort_order,
            })),
        });

        return { created: fresh.length };
    }

    async completeChecklistItem(tenantId: string, id: string, userId: string, notes?: string) {
        const item = await this.db.employeeChecklistItem.findFirst({
            where: { id, tenant_id: tenantId },
        });
        if (!item) throw new NotFoundException('Checklist item not found.');
        if (item.completed_at) return item;

        return this.db.employeeChecklistItem.update({
            where: { id },
            data: { completed_at: new Date(), completed_by: userId, notes: notes ?? item.notes },
        });
    }

    // ── Exit ──────────────────────────────────────────────────────────────────

    /**
     * Record that someone is leaving.
     *
     * Sets the status, the reason and the last working day, and starts the
     * offboarding checklist in one action — an exit recorded without a
     * checklist is how an unreturned laptop goes unnoticed.
     *
     * Deliberately does **not** revoke portal access: an employee working their
     * notice still needs to see their own payslips, and the access is revoked
     * by the settlement, not by the announcement.
     */
    async recordExit(tenantId: string, employeeId: string, dto: {
        status: 'RESIGNED' | 'TERMINATED' | 'CONTRACT_ENDED';
        last_working_day: string;
        exit_reason?: string;
        exit_notes?: string;
    }) {
        const employee = await this.db.employee.findFirst({
            where: { id: employeeId, tenant_id: tenantId, deleted_at: null },
        });
        if (!employee) throw new NotFoundException('Employee not found.');
        if (EmployeeLifecycleService.EXIT_STATUSES.includes(employee.status)) {
            throw new BadRequestException('This employee has already been marked as leaving.');
        }

        const updated = await this.db.employee.update({
            where: { id: employeeId },
            data: {
                status: dto.status as any,
                last_working_day: this.toDateOnly(dto.last_working_day),
                exit_reason: dto.exit_reason ?? null,
                exit_notes: dto.exit_notes ?? null,
            },
            select: { id: true, name: true, status: true, last_working_day: true, exit_reason: true },
        });

        await this.startChecklist(tenantId, employeeId, 'OFFBOARDING');
        return updated;
    }

    /**
     * What is owed on the way out, and what is outstanding.
     *
     * A **preview**, not a payment: it returns the figures and the blockers so
     * a human decides. Settling automatically would mean paying somebody out
     * while their laptop is still missing.
     */
    async previewFinalSettlement(tenantId: string, employeeId: string) {
        const employee = await this.db.employee.findFirst({
            where: { id: employeeId, tenant_id: tenantId, deleted_at: null },
            select: { id: true, name: true, employee_code: true, status: true, last_working_day: true },
        });
        if (!employee) throw new NotFoundException('Employee not found.');

        const asOf = employee.last_working_day ?? new Date();
        const year = new Date(asOf).getUTCFullYear();

        const [structure, balances, outstandingAssets, openChecklist, unappliedAdjustments] = await Promise.all([
            this.structures.resolveStructure(tenantId, employeeId, new Date(asOf)),
            this.db.leaveBalance.findMany({
                where: { tenant_id: tenantId, employee_id: employeeId, year },
                include: { leave_type: { select: { name: true, allows_encashment: true } } },
            }),
            this.db.assetAssignment.findMany({
                where: { tenant_id: tenantId, employee_id: employeeId, returned_on: null },
                select: { id: true, item_name: true, serial_number: true, assigned_on: true },
            }),
            this.db.employeeChecklistItem.findMany({
                where: {
                    tenant_id: tenantId, employee_id: employeeId,
                    kind: 'OFFBOARDING', completed_at: null,
                },
                select: { id: true, title: true },
            }),
            this.db.payrollAdjustment.findMany({
                where: { tenant_id: tenantId, employee_id: employeeId, applied_run_id: null },
                select: { id: true, kind: true, name: true, amount: true },
            }),
        ]);

        // Leave encashment uses the *daily* rate off gross, the same basis the
        // absence deduction uses. Using a different basis for money in and money
        // out is the kind of asymmetry an employee notices.
        const encashable = balances
            .filter((balance) => balance.leave_type?.allows_encashment)
            .map((balance) => {
                const days = Math.max(0, balance.total_days - balance.used_days);
                return {
                    leave_type: balance.leave_type?.name ?? null,
                    days,
                    // 30 rather than a scheduled-day count: a leave day encashed
                    // is a calendar day of salary, which is the common reading.
                    amount: money((structure.grossEarnings / 30) * days),
                };
            })
            .filter((row) => row.days > 0);

        const leaveEncashmentTotal = money(encashable.reduce((sum, row) => sum + row.amount, 0));
        const pendingDeductions = money(
            unappliedAdjustments.filter((a) => a.kind === 'DEDUCTION')
                .reduce((sum, a) => sum + Number(a.amount), 0),
        );
        const pendingEarnings = money(
            unappliedAdjustments.filter((a) => a.kind === 'EARNING')
                .reduce((sum, a) => sum + Number(a.amount), 0),
        );

        return {
            employee,
            as_of: asOf,
            monthly_gross: structure.grossEarnings,
            leave_encashment: { lines: encashable, total: leaveEncashmentTotal },
            pending_adjustments: { earnings: pendingEarnings, deductions: pendingDeductions },
            estimated_net: money(
                leaveEncashmentTotal + pendingEarnings - pendingDeductions,
            ),
            /**
             * Things that should be resolved before paying. Reported, never
             * enforced: a business may well decide to settle anyway and chase
             * the laptop separately, and blocking that would be the system
             * overruling a judgement it is not equipped to make.
             */
            blockers: {
                outstanding_assets: outstandingAssets,
                incomplete_checklist: openChecklist,
            },
        };
    }

    /**
     * Turn the preview into adjustments a FINAL_SETTLEMENT run will pay.
     *
     * Creating adjustments rather than a payment keeps settlement on exactly
     * the same path as ordinary pay — it posts, it appears on a payslip, and it
     * needs no second route to the GL.
     */
    async prepareFinalSettlement(tenantId: string, employeeId: string, dto: {
        year: number; month: number;
    }, userId?: string) {
        const preview = await this.previewFinalSettlement(tenantId, employeeId);

        if (preview.leave_encashment.total <= 0) {
            return { created: 0, preview };
        }

        await this.db.payrollAdjustment.create({
            data: {
                tenant_id: tenantId,
                employee_id: employeeId,
                year: dto.year,
                month: dto.month,
                kind: 'EARNING',
                name: 'Leave encashment',
                amount: preview.leave_encashment.total,
                note: preview.leave_encashment.lines
                    .map((line) => `${line.days}d ${line.leave_type ?? ''}`.trim())
                    .join(', '),
                created_by: userId ?? null,
            },
        });

        return { created: 1, preview };
    }
}
