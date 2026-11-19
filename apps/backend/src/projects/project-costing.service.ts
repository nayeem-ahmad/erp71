import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { AuditService, type AuditContext } from '../audit/audit.service';
import { ProjectAccessService, type ProjectViewer } from './project-access.service';
import { LabourPricingService } from './labour-pricing.service';
import { LIVE_COST_ENTRY } from './project-direct-costs.service';
import { ProjectUnbilledService } from './project-unbilled.service';

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
        private readonly unbilled: ProjectUnbilledService,
    ) {}

    async financials(viewer: ProjectViewer, projectId: string) {
        const tenantId = viewer.tenantId;
        await this.access.assertProjectVisible(viewer, projectId);
        const where = { tenant_id: tenantId, project_id: projectId };

        const [project, byPerson, uncostedByPerson, byDay, remaining, settings, costEntries, issues, expenses, sales] = await Promise.all([
            this.db.project.findFirst({
                where: { id: projectId, tenant_id: tenantId },
                select: {
                    id: true,
                    code: true,
                    name: true,
                    budget_amount: true,
                    billing_type: true,
                    contract_value: true,
                    bill_rate: true,
                },
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
            // Phase B: what the project cost beyond its hours.
            this.db.projectCostEntry.findMany({
                where: { ...where, ...LIVE_COST_ENTRY },
                select: { category: true, amount: true, cost_date: true },
            }),
            this.db.projectMaterialIssue.findMany({
                where,
                select: { issue_date: true, lines: { select: { line_cost: true } } },
            }),
            this.db.expenseEntry.findMany({
                where,
                select: { amount: true, expense_date: true },
            }),
            // Phase C: what the project's invoices billed.
            this.db.sale.findMany({
                where: { ...where, status: { not: 'CANCELLED' } },
                select: { id: true, total_amount: true, vat_amount: true, sd_amount: true, sale_date: true },
            }),
        ]);
        if (!project) throw new NotFoundException('Project not found');

        const direct = this.directCosts(costEntries, issues, expenses);

        const people = await this.people(tenantId, byPerson, uncostedByPerson);

        const hours = people.reduce((sum, row) => sum + row.hours, 0);
        const labourCost = round2(people.reduce((sum, row) => sum + row.labourCost, 0));
        const uncostedHours = people.reduce((sum, row) => sum + row.uncostedHours, 0);
        const costedHours = hours - uncostedHours;
        const noEmployeeHours = people
            .filter((row) => !row.employeeId)
            .reduce((sum, row) => sum + row.uncostedHours, 0);
        const totalCost = round2(labourCost + direct.total);
        const revenue = await this.revenue(tenantId, sales);
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
                directCost: direct.total,
                totalCost,
                budget,
                // Against everything the project has cost, not labour alone.
                budgetUsedPct: budget && budget > 0 ? round2((totalCost / budget) * 100) : null,
                budgetRemaining: budget === null ? null : round2(budget - totalCost),
                averageRate,
            },
            byCategory: [
                { category: 'LABOUR', amount: labourCost },
                ...direct.byCategory,
            ].filter((row) => row.amount > 0),
            uncosted: {
                // No employee behind the login: link it on the Team page.
                noEmployeeHours: round2(noEmployeeHours),
                // An employee, but no rate and no salary — or logged before costing existed.
                noRateHours: round2(uncostedHours - noEmployeeHours),
                // Issue lines the stock pool had no cost for when they left.
                materialLines: direct.uncostedMaterialLines,
            },
            forecast: {
                remainingHours: round2(remainingHours),
                // At this project's own average so far: who does the rest is not known yet.
                estimatedRemainingCost,
                estimateAtCompletion: estimatedRemainingCost === null ? null : round2(labourCost + estimatedRemainingCost),
            },
            byPerson: people.sort((a, b) => b.labourCost - a.labourCost || b.hours - a.hours),
            revenue: await this.revenueSummary(tenantId, project, revenue, totalCost, estimatedRemainingCost),
            byMonth: this.months(byDay, direct.byMonth, revenue.byMonth),
        };
    }

    /**
     * Revenue is what the project's invoices billed **net of VAT and SD** — tax
     * collected for the state is not the business's income — less what was
     * refunded on returns against them, at each invoice's own net share.
     */
    private async revenue(
        tenantId: string,
        sales: Array<{ id: string; total_amount: any; vat_amount: any; sd_amount: any; sale_date: Date }>,
    ) {
        const byMonth = new Map<string, number>();
        let invoiced = 0;
        let net = 0;
        const netShare = new Map<string, number>();
        for (const sale of sales) {
            const total = num(sale.total_amount);
            const saleNet = total - num(sale.vat_amount) - num(sale.sd_amount);
            invoiced += total;
            net += saleNet;
            netShare.set(sale.id, total > 0 ? saleNet / total : 0);
            const month = sale.sale_date.toISOString().slice(0, 7);
            byMonth.set(month, (byMonth.get(month) ?? 0) + saleNet);
        }
        if (sales.length > 0) {
            const returns = await this.db.salesReturn.findMany({
                where: { tenant_id: tenantId, sale_id: { in: sales.map((sale) => sale.id) }, status: { not: 'CANCELLED' } },
                select: { sale_id: true, total_refund: true, created_at: true },
            });
            for (const ret of returns) {
                const share = netShare.get(ret.sale_id ?? '') ?? 0;
                const refundNet = num(ret.total_refund) * share;
                net -= refundNet;
                const month = ret.created_at.toISOString().slice(0, 7);
                byMonth.set(month, (byMonth.get(month) ?? 0) - refundNet);
            }
        }
        return { invoiced: round2(invoiced), net: round2(net), byMonth };
    }

    /** Margin now, what is still to bill, and how the project should finish. */
    private async revenueSummary(
        tenantId: string,
        project: { id: string; billing_type: string; contract_value: any; bill_rate: any },
        revenue: { invoiced: number; net: number },
        totalCost: number,
        estimatedRemainingLabour: number | null,
    ) {
        const billingType = project.billing_type;
        const contractValue = project.contract_value === null ? null : num(project.contract_value);
        const unbilled = billingType === 'TIME_AND_MATERIALS'
            ? await this.unbilled.unbilledHours(tenantId, project)
            : null;

        const margin = round2(revenue.net - totalCost);
        // What the job should bring in, all told: the contract on a fixed price;
        // billed plus still-to-bill on time and materials; nothing if internal.
        const expectedRevenue = billingType === 'FIXED_PRICE'
            ? contractValue
            : billingType === 'TIME_AND_MATERIALS'
                ? round2(revenue.net + (unbilled?.amount ?? 0))
                : null;
        const expectedCost = round2(totalCost + (estimatedRemainingLabour ?? 0));

        return {
            billingType,
            contractValue,
            invoiced: revenue.invoiced,
            revenue: revenue.net,
            margin,
            marginPct: revenue.net > 0 ? round2((margin / revenue.net) * 100) : null,
            // Fixed price: the contract less what has been billed so far.
            leftToInvoice: billingType === 'FIXED_PRICE' && contractValue !== null ? round2(contractValue - revenue.net) : null,
            // Time and materials: billable hours not yet on an invoice, at bill rates.
            unbilledHours: unbilled?.hours ?? null,
            unbilledAmount: unbilled?.amount ?? null,
            unratedHours: unbilled?.unratedHours ?? null,
            expectedRevenue,
            expectedCost,
            expectedMargin: expectedRevenue === null ? null : round2(expectedRevenue - expectedCost),
        };
    }

    /** Expenses, cost entries and material issues, by category and by month. */
    private directCosts(
        entries: Array<{ category: string; amount: Prisma.Decimal | number; cost_date: Date }>,
        issues: Array<{ issue_date: Date; lines: Array<{ line_cost: Prisma.Decimal | number | null }> }>,
        expenses: Array<{ amount: Prisma.Decimal | number; expense_date: Date }>,
    ) {
        const byCategory = new Map<string, number>();
        const byMonth = new Map<string, number>();
        let uncostedMaterialLines = 0;
        const add = (category: string, date: Date, amount: number) => {
            byCategory.set(category, (byCategory.get(category) ?? 0) + amount);
            const month = date.toISOString().slice(0, 7);
            byMonth.set(month, (byMonth.get(month) ?? 0) + amount);
        };

        for (const entry of entries) add(entry.category, entry.cost_date, num(entry.amount));
        for (const issue of issues) {
            for (const line of issue.lines) {
                if (line.line_cost === null) uncostedMaterialLines += 1;
                else add('MATERIAL', issue.issue_date, num(line.line_cost));
            }
        }
        for (const expense of expenses) add('EXPENSE', expense.expense_date, num(expense.amount));

        const order = ['MATERIAL', 'SERVICES', 'EXPENSE', 'OVERHEAD', 'OTHER'];
        return {
            total: round2([...byCategory.values()].reduce((sum, value) => sum + value, 0)),
            byCategory: order
                .filter((category) => byCategory.has(category))
                .map((category) => ({ category, amount: round2(byCategory.get(category)!) })),
            byMonth,
            uncostedMaterialLines,
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
        const [settings, row] = await Promise.all([
            this.pricing.settings(tenantId),
            this.db.projectCostingSettings.findUnique({ where: { tenant_id: tenantId }, select: { billing_product_id: true } }),
        ]);
        return { ...settings, billingProductId: row?.billing_product_id ?? null };
    }

    /** Prices hours logged from now on; hours already priced keep their rate. */
    async updateSettings(
        tenantId: string,
        dto: { standardMonthlyHours: number; overheadPct: number; billingProductId?: string | null },
        ctx: AuditContext,
    ) {
        if (!(dto.standardMonthlyHours >= 1 && dto.standardMonthlyHours <= 744)) {
            throw new BadRequestException('Standard monthly hours must be between 1 and 744.');
        }
        if (!(dto.overheadPct >= 0 && dto.overheadPct <= 500)) {
            throw new BadRequestException('Overhead must be between 0% and 500%.');
        }
        if (dto.billingProductId) {
            const product = await this.db.product.findFirst({
                where: { id: dto.billingProductId, tenant_id: tenantId },
                select: { type: true },
            });
            if (!product) throw new BadRequestException('Billing product not found.');
            if (product.type !== 'SERVICE') throw new BadRequestException('Project invoices bill a service product.');
        }
        const before = await this.pricing.settings(tenantId);
        const data = {
            standard_monthly_hours: dto.standardMonthlyHours,
            labour_overhead_pct: dto.overheadPct,
            ...(dto.billingProductId !== undefined ? { billing_product_id: dto.billingProductId } : {}),
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
        return this.getSettings(tenantId);
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

    private months(
        byDay: Array<{ work_date: Date; _sum: { hours: any; cost_amount: any } }>,
        directByMonth: Map<string, number> = new Map(),
        revenueByMonth: Map<string, number> = new Map(),
    ) {
        const months = new Map<string, { month: string; hours: number; labourCost: number; directCost: number; revenue: number }>();
        const bucketOf = (month: string) => {
            const bucket = months.get(month) ?? { month, hours: 0, labourCost: 0, directCost: 0, revenue: 0 };
            months.set(month, bucket);
            return bucket;
        };
        for (const row of byDay) {
            const bucket = bucketOf(row.work_date.toISOString().slice(0, 7));
            bucket.hours += num(row._sum.hours);
            bucket.labourCost += num(row._sum.cost_amount);
        }
        for (const [month, amount] of directByMonth) bucketOf(month).directCost += amount;
        for (const [month, amount] of revenueByMonth) bucketOf(month).revenue += amount;
        return [...months.values()]
            .sort((a, b) => a.month.localeCompare(b.month))
            .map((bucket) => ({
                month: bucket.month,
                hours: round2(bucket.hours),
                labourCost: round2(bucket.labourCost),
                directCost: round2(bucket.directCost),
                totalCost: round2(bucket.labourCost + bucket.directCost),
                revenue: round2(bucket.revenue),
            }));
    }
}
