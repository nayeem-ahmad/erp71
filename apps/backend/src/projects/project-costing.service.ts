import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { AuditService, type AuditContext } from '../audit/audit.service';
import { ProjectAccessService, type ProjectViewer } from './project-access.service';
import { LabourPricingService } from './labour-pricing.service';

const num = (value: Prisma.Decimal | number | null | undefined) => Number(value ?? 0);
const round2 = (value: number) => Math.round(value * 100) / 100;

/** Writes per transaction when pricing a backlog of hours: keeps each one short. */
const PRICE_BATCH = 200;

export interface FinancialsPerson {
    key: string;
    employeeId: string | null;
    userId: string | null;
    name: string;
    employeeCode: string | null;
    hours: number;
    labourCost: number;
    uncostedHours: number;
}

/**
 * Project costing, Phase A: what a project's hours have cost.
 *
 * Reads only what each entry was priced at when it was written (see
 * `LabourPricingService`); nothing here re-prices history. The one write is
 * the explicit "price these hours" action, for hours logged before costing
 * existed or before the person had a rate.
 *
 * Behind VIEW_PROJECT_FINANCIALS, because a person's line is their pay ÷ the
 * hours they worked. Project visibility still applies on top: financials of a
 * private project are no wider than the project.
 */
@Injectable()
export class ProjectCostingService {
    constructor(
        private readonly db: DatabaseService,
        private readonly access: ProjectAccessService,
        private readonly pricing: LabourPricingService,
        private readonly audit: AuditService,
    ) {}

    async financials(viewer: ProjectViewer, projectId: string) {
        const tenantId = viewer.tenantId;
        await this.access.assertProjectVisible(viewer, projectId);
        const where = { tenant_id: tenantId, project_id: projectId };

        const [project, byPerson, uncostedByPerson, byDay, remaining, settings] = await Promise.all([
            this.db.project.findFirst({
                where: { id: projectId, tenant_id: tenantId },
                select: { id: true, code: true, name: true, budget_amount: true },
            }),
            this.db.projectTimeEntry.groupBy({
                by: ['employee_id', 'user_id'],
                where,
                _sum: { hours: true, cost_amount: true },
            }),
            this.db.projectTimeEntry.groupBy({
                by: ['employee_id', 'user_id'],
                where: { ...where, cost_amount: null },
                _sum: { hours: true },
            }),
            this.db.projectTimeEntry.groupBy({
                by: ['work_date'],
                where,
                _sum: { hours: true, cost_amount: true },
            }),
            this.db.projectTask.aggregate({
                where: { tenant_id: tenantId, project_id: projectId, deleted_at: null, status: { category: { not: 'DONE' } } },
                _sum: { remaining_hours: true },
            }),
            this.pricing.settings(tenantId),
        ]);
        if (!project) throw new NotFoundException('Project not found');

        const people = await this.people(tenantId, byPerson, uncostedByPerson);

        const hours = people.reduce((sum, row) => sum + row.hours, 0);
        const labourCost = round2(people.reduce((sum, row) => sum + row.labourCost, 0));
        const uncostedHours = people.reduce((sum, row) => sum + row.uncostedHours, 0);
        const costedHours = hours - uncostedHours;
        const noEmployeeHours = people
            .filter((row) => !row.employeeId)
            .reduce((sum, row) => sum + row.uncostedHours, 0);
        const budget = project.budget_amount === null ? null : num(project.budget_amount);
        const averageRate = costedHours > 0 ? round2(labourCost / costedHours) : null;
        const remainingHours = num(remaining._sum.remaining_hours);
        const estimatedRemainingCost = averageRate === null ? null : round2(remainingHours * averageRate);

        return {
            project: { id: project.id, code: project.code, name: project.name },
            settings,
            totals: {
                hours: round2(hours),
                costedHours: round2(costedHours),
                uncostedHours: round2(uncostedHours),
                labourCost,
                budget,
                budgetUsedPct: budget && budget > 0 ? round2((labourCost / budget) * 100) : null,
                budgetRemaining: budget === null ? null : round2(budget - labourCost),
                averageRate,
            },
            uncosted: {
                // No employee behind the login: link it on the Team page.
                noEmployeeHours: round2(noEmployeeHours),
                // An employee, but no rate and no salary — or logged before costing existed.
                noRateHours: round2(uncostedHours - noEmployeeHours),
            },
            forecast: {
                remainingHours: round2(remainingHours),
                // At this project's own average so far: who does the rest is not known yet.
                estimatedRemainingCost,
                estimateAtCompletion: estimatedRemainingCost === null ? null : round2(labourCost + estimatedRemainingCost),
            },
            byPerson: people.sort((a, b) => b.labourCost - a.labourCost || b.hours - a.hours),
            byMonth: this.months(byDay),
        };
    }

    /**
     * Price this project's hours that have an employee but no cost yet, at the
     * rate in force for each person on each entry's own day.
     *
     * Hours with no employee behind them stay uncosted — there is nobody to
     * price them as. Hours already priced are never touched.
     */
    async priceUncosted(viewer: ProjectViewer, projectId: string, ctx: AuditContext) {
        const tenantId = viewer.tenantId;
        await this.access.assertProjectVisible(viewer, projectId);

        const entries = await this.db.projectTimeEntry.findMany({
            where: { tenant_id: tenantId, project_id: projectId, cost_amount: null, employee_id: { not: null } },
            select: { id: true, employee_id: true, work_date: true, hours: true },
        });
        const priced = await this.pricing.priceMany(tenantId, entries);
        const updates = [...priced.entries()];

        for (let i = 0; i < updates.length; i += PRICE_BATCH) {
            await this.db.$transaction(
                updates.slice(i, i + PRICE_BATCH).map(([id, columns]) =>
                    // `cost_amount: null` in the filter: an entry priced by a
                    // write since the read above keeps that newer price.
                    this.db.projectTimeEntry.updateMany({ where: { id, cost_amount: null }, data: columns }),
                ),
            );
        }

        await this.audit
            .log('PROJECT_HOURS_PRICED', 'Project', { ...ctx, tenantId }, projectId, {
                priced: updates.length,
                still_uncosted: entries.length - updates.length,
            })
            .catch(() => {});

        return { priced: updates.length, stillUncosted: entries.length - updates.length };
    }

    async getSettings(tenantId: string) {
        return this.pricing.settings(tenantId);
    }

    /** Prices hours logged from now on; hours already priced keep their rate. */
    async updateSettings(
        tenantId: string,
        dto: { standardMonthlyHours: number; overheadPct: number },
        ctx: AuditContext,
    ) {
        if (!(dto.standardMonthlyHours >= 1 && dto.standardMonthlyHours <= 744)) {
            throw new BadRequestException('Standard monthly hours must be between 1 and 744.');
        }
        if (!(dto.overheadPct >= 0 && dto.overheadPct <= 500)) {
            throw new BadRequestException('Overhead must be between 0% and 500%.');
        }
        const before = await this.pricing.settings(tenantId);
        const data = {
            standard_monthly_hours: dto.standardMonthlyHours,
            labour_overhead_pct: dto.overheadPct,
            updated_by: ctx.userId ?? null,
        };
        await this.db.projectCostingSettings.upsert({
            where: { tenant_id: tenantId },
            create: { tenant_id: tenantId, ...data },
            update: data,
        });
        await this.audit
            .log('PROJECT_COSTING_SETTINGS_UPDATED', 'ProjectCostingSettings', { ...ctx, tenantId }, tenantId, {
                before,
                after: dto,
            })
            .catch(() => {});
        return this.pricing.settings(tenantId);
    }

    /** One line per person, keyed by employee when there is one, else by login. */
    private async people(
        tenantId: string,
        byPerson: Array<{ employee_id: string | null; user_id: string | null; _sum: { hours: any; cost_amount: any } }>,
        uncostedByPerson: Array<{ employee_id: string | null; user_id: string | null; _sum: { hours: any } }>,
    ): Promise<FinancialsPerson[]> {
        const keyOf = (row: { employee_id: string | null; user_id: string | null }) =>
            row.employee_id ? `employee:${row.employee_id}` : `user:${row.user_id ?? 'none'}`;

        const merged = new Map<string, FinancialsPerson>();
        for (const row of byPerson) {
            const key = keyOf(row);
            const line = merged.get(key) ?? {
                key,
                employeeId: row.employee_id,
                userId: row.employee_id ? null : row.user_id,
                name: '',
                employeeCode: null,
                hours: 0,
                labourCost: 0,
                uncostedHours: 0,
            };
            line.hours += num(row._sum.hours);
            line.labourCost += num(row._sum.cost_amount);
            merged.set(key, line);
        }
        for (const row of uncostedByPerson) {
            const line = merged.get(keyOf(row));
            if (line) line.uncostedHours += num(row._sum.hours);
        }

        const employeeIds = [...merged.values()].map((line) => line.employeeId).filter((id): id is string => !!id);
        const userIds = [...merged.values()].map((line) => line.userId).filter((id): id is string => !!id);
        const [employees, users] = await Promise.all([
            employeeIds.length
                ? this.db.employee.findMany({
                      where: { tenant_id: tenantId, id: { in: employeeIds } },
                      select: { id: true, name: true, employee_code: true },
                  })
                : Promise.resolve([]),
            userIds.length
                ? this.db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
                : Promise.resolve([]),
        ]);
        const employeeById = new Map(employees.map((row) => [row.id, row]));
        const userById = new Map(users.map((row) => [row.id, row]));

        return [...merged.values()].map((line) => {
            const employee = line.employeeId ? employeeById.get(line.employeeId) : undefined;
            const user = line.userId ? userById.get(line.userId) : undefined;
            return {
                ...line,
                name: employee?.name ?? user?.name ?? user?.email ?? '',
                employeeCode: employee?.employee_code ?? null,
                hours: round2(line.hours),
                labourCost: round2(line.labourCost),
                uncostedHours: round2(line.uncostedHours),
            };
        });
    }

    private months(byDay: Array<{ work_date: Date; _sum: { hours: any; cost_amount: any } }>) {
        const months = new Map<string, { month: string; hours: number; labourCost: number }>();
        for (const row of byDay) {
            const month = row.work_date.toISOString().slice(0, 7);
            const bucket = months.get(month) ?? { month, hours: 0, labourCost: 0 };
            bucket.hours += num(row._sum.hours);
            bucket.labourCost += num(row._sum.cost_amount);
            months.set(month, bucket);
        }
        return [...months.values()]
            .sort((a, b) => a.month.localeCompare(b.month))
            .map((bucket) => ({ ...bucket, hours: round2(bucket.hours), labourCost: round2(bucket.labourCost) }));
    }
}
