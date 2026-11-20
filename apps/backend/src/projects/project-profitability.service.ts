import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ProjectAccessService, type ProjectViewer } from './project-access.service';
import { LIVE_COST_ENTRY } from './project-direct-costs.service';
import { marginPct, num, refundNet, round2, saleNet } from './project-money.util';

/** Enough for a shop's whole book of jobs; a bigger one wants paging. */
const REPORT_LIMIT = 500;

const STATUSES = ['DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const;

export interface ProfitabilityRow {
    id: string;
    code: string;
    name: string;
    status: string;
    billingType: string;
    customer: string | null;
    budget: number | null;
    labourCost: number;
    directCost: number;
    cost: number;
    budgetUsedPct: number | null;
    contractValue: number | null;
    revenue: number;
    /** Null on an internal project: it bills nothing, so it has no margin. */
    margin: number | null;
    marginPct: number | null;
    uncostedHours: number;
}

/**
 * Project costing, Phase D: every project's cost, revenue and margin on one
 * page.
 *
 * The same rules as one project's Financials, summed per project in a handful
 * of grouped reads rather than one Financials call per project: cost is what
 * each hour was priced at when logged plus live cost entries, material issue
 * lines and tagged expenses; revenue is non-cancelled project invoices net of
 * VAT/SD and of returns. Visibility applies as everywhere else: a project the
 * viewer cannot open is not on their report.
 */
@Injectable()
export class ProjectProfitabilityService {
    constructor(
        private readonly db: DatabaseService,
        private readonly access: ProjectAccessService,
    ) {}

    async report(viewer: ProjectViewer, query: { status?: string; billingType?: string }) {
        const tenantId = viewer.tenantId;
        const statuses = (query.status ?? '')
            .split(',')
            .map((value) => value.trim().toUpperCase())
            .filter((value): value is (typeof STATUSES)[number] => (STATUSES as readonly string[]).includes(value));

        const projects = await this.db.project.findMany({
            where: {
                tenant_id: tenantId,
                deleted_at: null,
                status: statuses.length > 0 ? { in: statuses } : { not: 'CANCELLED' },
                ...(query.billingType ? { billing_type: query.billingType } : {}),
                ...(await this.access.projectFilter(viewer)),
            } as never,
            select: {
                id: true,
                code: true,
                name: true,
                status: true,
                billing_type: true,
                budget_amount: true,
                contract_value: true,
                customer: { select: { name: true } },
            },
            orderBy: { code: 'asc' },
            take: REPORT_LIMIT,
        });
        const ids = projects.map((project) => project.id);
        if (ids.length === 0) return { rows: [], totals: this.totals([]), truncated: false };

        const where = { tenant_id: tenantId, project_id: { in: ids } };
        const [hours, uncosted, entries, issueLines, expenses, sales] = await Promise.all([
            this.db.projectTimeEntry.groupBy({ by: ['project_id'], where, _sum: { cost_amount: true } }),
            this.db.projectTimeEntry.groupBy({ by: ['project_id'], where: { ...where, cost_amount: null }, _sum: { hours: true } }),
            this.db.projectCostEntry.groupBy({ by: ['project_id'], where: { ...where, ...LIVE_COST_ENTRY }, _sum: { amount: true } }),
            this.db.projectMaterialIssueLine.findMany({
                where: { line_cost: { not: null }, issue: where },
                select: { line_cost: true, issue: { select: { project_id: true } } },
            }),
            this.db.expenseEntry.groupBy({ by: ['project_id'], where, _sum: { amount: true } }),
            this.db.sale.findMany({
                where: { ...where, status: { not: 'CANCELLED' } },
                select: { id: true, project_id: true, total_amount: true, vat_amount: true, sd_amount: true },
            }),
        ]);
        const returns = sales.length
            ? await this.db.salesReturn.findMany({
                  where: { tenant_id: tenantId, sale_id: { in: sales.map((sale) => sale.id) }, status: { not: 'CANCELLED' } },
                  select: { sale_id: true, total_refund: true },
              })
            : [];

        const add = (map: Map<string, number>, key: string | null, value: number) => {
            if (key) map.set(key, (map.get(key) ?? 0) + value);
        };
        const labour = new Map<string, number>();
        const unpriced = new Map<string, number>();
        const direct = new Map<string, number>();
        const revenue = new Map<string, number>();
        for (const row of hours) add(labour, row.project_id, num(row._sum.cost_amount));
        for (const row of uncosted) add(unpriced, row.project_id, num(row._sum.hours));
        for (const row of entries) add(direct, row.project_id, num(row._sum.amount));
        for (const line of issueLines) add(direct, line.issue.project_id, num(line.line_cost));
        for (const row of expenses) add(direct, row.project_id, num(row._sum.amount));
        const saleById = new Map(sales.map((sale) => [sale.id, sale]));
        for (const sale of sales) add(revenue, sale.project_id, saleNet(sale));
        for (const ret of returns) {
            const sale = saleById.get(ret.sale_id ?? '');
            if (sale) add(revenue, sale.project_id, -refundNet(ret.total_refund, sale));
        }

        const rows: ProfitabilityRow[] = projects.map((project) => {
            const labourCost = round2(labour.get(project.id) ?? 0);
            const directCost = round2(direct.get(project.id) ?? 0);
            const cost = round2(labourCost + directCost);
            const budget = project.budget_amount === null ? null : num(project.budget_amount);
            const net = round2(revenue.get(project.id) ?? 0);
            const billed = project.billing_type !== 'INTERNAL';
            const margin = billed ? round2(net - cost) : null;
            return {
                id: project.id,
                code: project.code,
                name: project.name,
                status: project.status,
                billingType: project.billing_type,
                customer: project.customer?.name ?? null,
                budget,
                labourCost,
                directCost,
                cost,
                budgetUsedPct: budget && budget > 0 ? round2((cost / budget) * 100) : null,
                contractValue: project.contract_value === null ? null : num(project.contract_value),
                revenue: net,
                margin,
                marginPct: margin === null ? null : marginPct(margin, net),
                uncostedHours: round2(unpriced.get(project.id) ?? 0),
            };
        });

        return { rows, totals: this.totals(rows), truncated: projects.length === REPORT_LIMIT };
    }

    /**
     * Margin totals count billed projects only: an internal project's cost is
     * real, but it was never meant to earn, so it would only drag the
     * portfolio's margin down with a loss that is not one.
     */
    private totals(rows: ProfitabilityRow[]) {
        const billed = rows.filter((row) => row.margin !== null);
        const revenue = round2(billed.reduce((sum, row) => sum + row.revenue, 0));
        const billedCost = round2(billed.reduce((sum, row) => sum + row.cost, 0));
        const margin = round2(revenue - billedCost);
        return {
            projects: rows.length,
            cost: round2(rows.reduce((sum, row) => sum + row.cost, 0)),
            internalCost: round2(rows.filter((row) => row.margin === null).reduce((sum, row) => sum + row.cost, 0)),
            revenue,
            billedCost,
            margin,
            marginPct: marginPct(margin, revenue),
            uncostedHours: round2(rows.reduce((sum, row) => sum + row.uncostedHours, 0)),
        };
    }
}
