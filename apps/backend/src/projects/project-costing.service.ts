import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { AuditService, type AuditContext } from '../audit/audit.service';
import { ProjectAccessService, type ProjectViewer } from './project-access.service';
import { LabourPricingService } from './labour-pricing.service';
import { LIVE_COST_ENTRY } from './project-direct-costs.service';
import { ProjectUnbilledService } from './project-unbilled.service';
import { BUDGET_CATEGORIES, type BudgetCategory, marginPct, num, refundNet, round2, saleNet } from './project-money.util';

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

/** One person's share of the work still to do, and what it should cost. */
export interface ForecastPerson {
    key: string;
    name: string;
    employeeId: string | null;
    remainingHours: number;
    rate: number | null;
    /** PERSON: their own rate today. AVERAGE: the project's average so far, for
     *  unassigned work or a person nothing prices. Null: no rate at all. */
    rateSource: 'PERSON' | 'AVERAGE' | null;
    cost: number | null;
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

        const [project, byPerson, uncostedByPerson, byDay, remaining, settings, costEntries, issues, expenses, sales, budgetLines] = await Promise.all([
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
            // Phase D: the work still open, by who is on it — so the rest is
            // priced at each assignee's own rate, not the project's average.
            this.db.projectTask.groupBy({
                by: ['assignee_id', 'assignee_employee_id'],
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
            // Phase D: the budget split by category, when it has been.
            this.db.projectBudgetLine.findMany({
                where,
                select: { category: true, amount: true },
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
        // Split by category, the budget is the lines' sum (saving them writes
        // that sum to the project too, so the two only differ mid-save).
        const budgetOf = new Map<string, number>(budgetLines.map((line) => [line.category, num(line.amount)]));
        const budget = budgetLines.length > 0
            ? round2([...budgetOf.values()].reduce((sum, value) => sum + value, 0))
            : project.budget_amount === null ? null : num(project.budget_amount);
        const averageRate = costedHours > 0 ? round2(labourCost / costedHours) : null;
        const actualOf = new Map<string, number>([
            ['LABOUR', labourCost],
            ...direct.byCategory.map((row) => [row.category, row.amount] as [string, number]),
        ]);
        const forecast = await this.forecast(tenantId, remaining, averageRate, budgetOf, actualOf, totalCost);

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
            budgetByCategory: budgetLines.length > 0,
            // Budget vs actual: every category that has either.
            byCategory: BUDGET_CATEGORIES
                .filter((category) => (actualOf.get(category) ?? 0) > 0 || budgetOf.has(category))
                .map((category) => {
                    const amount = round2(actualOf.get(category) ?? 0);
                    const lineBudget = budgetOf.has(category) ? round2(budgetOf.get(category)!) : null;
                    return {
                        category,
                        amount,
                        budget: lineBudget,
                        remaining: lineBudget === null ? null : round2(lineBudget - amount),
                        usedPct: lineBudget && lineBudget > 0 ? round2((amount / lineBudget) * 100) : null,
                    };
                }),
            uncosted: {
                // No employee behind the login: link it on the Team page.
                noEmployeeHours: round2(noEmployeeHours),
                // An employee, but no rate and no salary — or logged before costing existed.
                noRateHours: round2(uncostedHours - noEmployeeHours),
                // Issue lines the stock pool had no cost for when they left.
                materialLines: direct.uncostedMaterialLines,
            },
            forecast,
            byPerson: people.sort((a, b) => b.labourCost - a.labourCost || b.hours - a.hours),
            revenue: await this.revenueSummary(tenantId, project, revenue, totalCost, forecast.estimateAtCompletion),
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
        const saleById = new Map(sales.map((sale) => [sale.id, sale]));
        for (const sale of sales) {
            const value = saleNet(sale);
            invoiced += num(sale.total_amount);
            net += value;
            const month = sale.sale_date.toISOString().slice(0, 7);
            byMonth.set(month, (byMonth.get(month) ?? 0) + value);
        }
        if (sales.length > 0) {
            const returns = await this.db.salesReturn.findMany({
                where: { tenant_id: tenantId, sale_id: { in: sales.map((sale) => sale.id) }, status: { not: 'CANCELLED' } },
                select: { sale_id: true, total_refund: true, created_at: true },
            });
            for (const ret of returns) {
                const value = refundNet(ret.total_refund, saleById.get(ret.sale_id ?? ''));
                net -= value;
                const month = ret.created_at.toISOString().slice(0, 7);
                byMonth.set(month, (byMonth.get(month) ?? 0) - value);
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
        estimateAtCompletion: number,
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
        const expectedCost = estimateAtCompletion;
        // Fixed price, by cost: how far along the job is (cost so far ÷ cost at
        // completion), what that share of the contract has earned, and whether
        // the invoices are ahead of it (billed in advance) or behind (earned,
        // not yet billed). Margin on invoices alone swings with the billing
        // plan; this does not.
        const completion = billingType === 'FIXED_PRICE' && contractValue !== null && expectedCost > 0
            ? Math.min(totalCost / expectedCost, 1)
            : null;
        const percentComplete = completion === null ? null : round2(completion * 100);
        const earnedRevenue = completion === null ? null : round2((contractValue ?? 0) * completion);

        return {
            billingType,
            contractValue,
            invoiced: revenue.invoiced,
            revenue: revenue.net,
            margin,
            marginPct: marginPct(margin, revenue.net),
            // Fixed price: the contract less what has been billed so far.
            leftToInvoice: billingType === 'FIXED_PRICE' && contractValue !== null ? round2(contractValue - revenue.net) : null,
            // Time and materials: billable hours not yet on an invoice, at bill rates.
            unbilledHours: unbilled?.hours ?? null,
            unbilledAmount: unbilled?.amount ?? null,
            unratedHours: unbilled?.unratedHours ?? null,
            expectedRevenue,
            expectedCost,
            expectedMargin: expectedRevenue === null ? null : round2(expectedRevenue - expectedCost),
            percentComplete,
            earnedRevenue,
            earnedMargin: earnedRevenue === null ? null : round2(earnedRevenue - totalCost),
            // Positive: invoiced ahead of the work. Negative: work not yet invoiced.
            billedAheadOfWork: earnedRevenue === null ? null : round2(revenue.net - earnedRevenue),
        };
    }

    /**
     * How the project should finish, cost-wise.
     *
     * Labour still to come is each open task's remaining hours at its
     * assignee's rate **today** — a raise next month is not known yet — or at
     * the project's own average so far for work nobody is on, or someone
     * nothing prices. Hours neither can price are counted apart, never as free.
     *
     * Other costs still to come are what each budgeted category has left
     * (never less than nothing: an overspent category is not a saving). A
     * category with no budget line forecasts nothing further.
     */
    private async forecast(
        tenantId: string,
        remaining: Array<{ assignee_id: string | null; assignee_employee_id: string | null; _sum: { remaining_hours: any } }>,
        averageRate: number | null,
        budgetOf: Map<string, number>,
        actualOf: Map<string, number>,
        totalCost: number,
    ) {
        const open = remaining.filter((row) => num(row._sum.remaining_hours) > 0);
        const userIds = [...new Set(open.map((row) => row.assignee_id).filter((id): id is string => !!id))];
        const assignedEmployeeIds = open.map((row) => row.assignee_employee_id).filter((id): id is string => !!id);

        // A login assignee is priced as the employee behind it, if there is one.
        const [linked, users] = await Promise.all([
            userIds.length
                ? this.db.employee.findMany({
                      where: { tenant_id: tenantId, user_id: { in: userIds }, deleted_at: null },
                      select: { id: true, user_id: true },
                  })
                : Promise.resolve([]),
            userIds.length
                ? this.db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
                : Promise.resolve([]),
        ]);
        const employeeOfUser = new Map(linked.map((row) => [row.user_id as string, row.id]));
        const employeeIds = [...new Set([...assignedEmployeeIds, ...employeeOfUser.values()])];
        const [rates, employees] = await Promise.all([
            this.pricing.ratesOn(tenantId, employeeIds, new Date()),
            employeeIds.length
                ? this.db.employee.findMany({
                      where: { tenant_id: tenantId, id: { in: employeeIds } },
                      select: { id: true, name: true },
                  })
                : Promise.resolve([]),
        ]);
        const employeeName = new Map(employees.map((row) => [row.id, row.name]));
        const userName = new Map(users.map((row) => [row.id, row.name || row.email || '']));

        const people = new Map<string, ForecastPerson>();
        for (const row of open) {
            const employeeId = row.assignee_employee_id ?? (row.assignee_id ? employeeOfUser.get(row.assignee_id) ?? null : null);
            const key = employeeId ? `employee:${employeeId}` : row.assignee_id ? `user:${row.assignee_id}` : 'unassigned';
            const person = people.get(key) ?? {
                key,
                name: employeeId ? employeeName.get(employeeId) ?? '' : row.assignee_id ? userName.get(row.assignee_id) ?? '' : '',
                employeeId,
                remainingHours: 0,
                rate: null,
                rateSource: null,
                cost: null,
            };
            person.remainingHours += num(row._sum.remaining_hours);
            people.set(key, person);
        }
        for (const person of people.values()) {
            const own = person.employeeId ? rates.get(person.employeeId) : undefined;
            if (own) {
                person.rate = round2(Number(own.rate));
                person.rateSource = 'PERSON';
            } else if (averageRate !== null) {
                person.rate = averageRate;
                person.rateSource = 'AVERAGE';
            }
            person.remainingHours = round2(person.remainingHours);
            person.cost = person.rate === null ? null : round2(person.remainingHours * person.rate);
        }

        const byPerson = [...people.values()].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0) || b.remainingHours - a.remainingHours);
        const remainingHours = round2(byPerson.reduce((sum, row) => sum + row.remainingHours, 0));
        const unratedHours = round2(byPerson.filter((row) => row.cost === null).reduce((sum, row) => sum + row.remainingHours, 0));
        const estimatedRemainingCost = round2(byPerson.reduce((sum, row) => sum + (row.cost ?? 0), 0));
        const remainingDirectCost = round2(
            [...budgetOf.entries()]
                .filter(([category]) => category !== 'LABOUR')
                .reduce((sum, [category, budget]) => sum + Math.max(budget - (actualOf.get(category) ?? 0), 0), 0),
        );

        return {
            remainingHours,
            estimatedRemainingCost,
            unratedHours,
            remainingDirectCost,
            estimateAtCompletion: round2(totalCost + estimatedRemainingCost + remainingDirectCost),
            byPerson,
        };
    }

    /**
     * Split the project's budget by category. Replaces every line; categories
     * left out (or at zero) have no budget of their own. While any line
     * exists the project's budget is their sum, written to the project in the
     * same transaction so lists and the project page agree. Saving no lines
     * leaves the project's single budget figure as it was.
     */
    async setBudget(
        viewer: ProjectViewer,
        projectId: string,
        lines: ReadonlyArray<{ category: BudgetCategory; amount: number }>,
        ctx: AuditContext,
    ) {
        const tenantId = viewer.tenantId;
        await this.access.assertProjectVisible(viewer, projectId);

        const seen = new Set<string>();
        for (const line of lines) {
            if (!BUDGET_CATEGORIES.includes(line.category)) throw new BadRequestException('Unknown budget category.');
            if (seen.has(line.category)) throw new BadRequestException('Each category can be budgeted once.');
            seen.add(line.category);
            if (!(line.amount >= 0 && line.amount <= 1e12)) throw new BadRequestException('A budget amount must be zero or more.');
        }
        const kept = lines.filter((line) => line.amount > 0).map((line) => ({ ...line, amount: round2(line.amount) }));
        const total = round2(kept.reduce((sum, line) => sum + line.amount, 0));

        const before = await this.db.projectBudgetLine.findMany({
            where: { tenant_id: tenantId, project_id: projectId },
            select: { category: true, amount: true },
        });
        await this.db.$transaction(async (tx) => {
            await tx.projectBudgetLine.deleteMany({ where: { tenant_id: tenantId, project_id: projectId } });
            if (kept.length === 0) return;
            await tx.projectBudgetLine.createMany({
                data: kept.map((line) => ({
                    tenant_id: tenantId,
                    project_id: projectId,
                    category: line.category,
                    amount: line.amount,
                    updated_by: ctx.userId ?? null,
                })),
            });
            await tx.project.update({ where: { id: projectId }, data: { budget_amount: total } });
        });

        await this.audit
            .log('PROJECT_BUDGET_UPDATED', 'Project', { ...ctx, tenantId }, projectId, {
                before: before.map((line) => ({ category: line.category, amount: num(line.amount) })),
                after: kept,
            })
            .catch(() => {});

        return { lines: kept, total: kept.length > 0 ? total : null };
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

        const order = BUDGET_CATEGORIES.filter((category) => category !== 'LABOUR');
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
