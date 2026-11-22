import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { AuditService, type AuditContext } from '../audit/audit.service';
import { applyInventoryMovement, assertWarehouseBelongsToTenant } from '../database/inventory.utils';
import { resolveProductCosts } from '../database/product-cost.utils';
import { allocatedByPurchaseItem, assertWithinLine } from '../common/bill-allocation.util';
import { ProjectAccessService, type ProjectViewer } from './project-access.service';

export const PROJECT_COST_CATEGORIES = ['MATERIAL', 'SERVICES', 'EXPENSE', 'OVERHEAD', 'OTHER'] as const;
export type ProjectCostCategory = (typeof PROJECT_COST_CATEGORIES)[number];

/** A share of a cancelled bill no longer counts: the bill it was drawn from is gone. */
export const LIVE_COST_ENTRY: Prisma.ProjectCostEntryWhereInput = {
    OR: [
        { source_purchase_item_id: null },
        { sourcePurchaseItem: { purchase: { status: { not: 'CANCELLED' } } } },
    ],
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Project costing, Phase B: what a project costs beyond its hours.
 *
 * Three sources, each recorded once where it naturally lives:
 * - an **expense** tagged with the project on the expense form;
 * - a **cost entry** here — a share of a service bill (capped, with
 *   production jobs, at the bill line) or a cost with no document elsewhere;
 * - a **material issue** — stock taken out of a warehouse for the project, at
 *   the average it was held at.
 *
 * None of it posts to the ledger. An expense and a bill already posted; an
 * issue, under periodic inventory, is not an economic event. This is the
 * project's management accounts, not a second set of books.
 */
@Injectable()
export class ProjectDirectCostsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly access: ProjectAccessService,
        private readonly audit: AuditService,
    ) {}

    /** Every direct cost on the project, newest first, in one list for the Financials page. */
    async list(viewer: ProjectViewer, projectId: string) {
        const tenantId = viewer.tenantId;
        await this.access.assertProjectVisible(viewer, projectId);

        const [entries, issues, expenses] = await Promise.all([
            this.db.projectCostEntry.findMany({
                where: { tenant_id: tenantId, project_id: projectId, ...LIVE_COST_ENTRY },
                include: {
                    sourcePurchaseItem: {
                        select: {
                            product: { select: { name: true } },
                            purchase: { select: { purchase_number: true, supplier: { select: { name: true } } } },
                        },
                    },
                },
            }),
            this.db.projectMaterialIssue.findMany({
                where: { tenant_id: tenantId, project_id: projectId },
                include: {
                    warehouse: { select: { name: true } },
                    lines: { include: { product: { select: { id: true, name: true } } } },
                },
            }),
            this.db.expenseEntry.findMany({
                where: { tenant_id: tenantId, project_id: projectId },
                include: { head: { select: { name: true } }, category: { select: { name: true } } },
            }),
        ]);

        const rows = [
            ...entries.map((entry) => ({
                kind: 'ENTRY' as const,
                id: entry.id,
                date: entry.cost_date.toISOString().slice(0, 10),
                category: entry.category as string,
                description: entry.description,
                source: entry.sourcePurchaseItem
                    ? [
                          entry.sourcePurchaseItem.purchase.purchase_number,
                          entry.sourcePurchaseItem.purchase.supplier?.name,
                          entry.sourcePurchaseItem.product.name,
                      ].filter(Boolean).join(' · ')
                    : null,
                amount: Number(entry.amount),
                uncosted: false,
            })),
            ...issues.map((issue) => ({
                kind: 'ISSUE' as const,
                id: issue.id,
                date: issue.issue_date.toISOString().slice(0, 10),
                category: 'MATERIAL',
                description: issue.lines.map((line) => `${line.quantity} × ${line.product.name}`).join(', '),
                source: issue.warehouse.name,
                amount: round2(issue.lines.reduce((sum, line) => sum + Number(line.line_cost ?? 0), 0)),
                // A line the stock pool had no cost for: shown, never counted as free.
                uncosted: issue.lines.some((line) => line.line_cost === null),
            })),
            ...expenses.map((expense) => ({
                kind: 'EXPENSE' as const,
                id: expense.id,
                date: expense.expense_date.toISOString().slice(0, 10),
                category: 'EXPENSE',
                description: expense.description || expense.head?.name || expense.category.name,
                source: expense.head?.name ?? expense.category.name,
                amount: Number(expense.amount),
                uncosted: false,
            })),
        ];
        return rows.sort((a, b) => b.date.localeCompare(a.date));
    }

    /** Service bill lines with something left to draw, for "add a cost from a bill". */
    async costSources(tenantId: string, search?: string) {
        const items = await this.db.purchaseItem.findMany({
            where: {
                purchase: { tenant_id: tenantId, status: { not: 'CANCELLED' } },
                product: { type: 'SERVICE' },
                ...(search
                    ? {
                          OR: [
                              { product: { name: { contains: search, mode: 'insensitive' } } },
                              { purchase: { purchase_number: { contains: search, mode: 'insensitive' } } },
                              { purchase: { supplier: { name: { contains: search, mode: 'insensitive' } } } },
                          ],
                      }
                    : {}),
            },
            include: {
                product: { select: { name: true } },
                purchase: {
                    select: {
                        purchase_number: true,
                        purchase_date: true,
                        created_at: true,
                        supplier: { select: { name: true } },
                    },
                },
            },
            orderBy: { purchase: { purchase_date: 'desc' } },
            take: 100,
        });
        const allocated = await allocatedByPurchaseItem(this.db, tenantId, items.map((item) => item.id));
        return items
            .map((item) => {
                const drawn = allocated.get(item.id) ?? 0;
                return {
                    id: item.id,
                    productName: item.product.name,
                    purchaseNumber: item.purchase.purchase_number,
                    supplierName: item.purchase.supplier?.name ?? null,
                    purchaseDate: (item.purchase.purchase_date ?? item.purchase.created_at).toISOString().slice(0, 10),
                    lineTotal: Number(item.line_total),
                    remainingAmount: round2(Number(item.line_total) - drawn),
                };
            })
            .filter((item) => item.remainingAmount > 0.005);
    }

    async addCost(
        viewer: ProjectViewer,
        projectId: string,
        dto: { category: ProjectCostCategory; amount: number; costDate: string; description: string; sourcePurchaseItemId?: string },
        ctx: AuditContext,
    ) {
        const tenantId = viewer.tenantId;
        await this.access.assertProjectVisible(viewer, projectId);

        if (dto.sourcePurchaseItemId) {
            const item = await this.db.purchaseItem.findFirst({
                where: { id: dto.sourcePurchaseItemId, purchase: { tenant_id: tenantId } },
                select: { id: true, line_total: true, product: { select: { type: true } }, purchase: { select: { status: true } } },
            });
            if (!item) throw new NotFoundException('Bill line not found');
            // Goods reach a project by being issued from stock; drawing them from
            // the bill as well would count them twice.
            if (item.product.type !== 'SERVICE') {
                throw new BadRequestException('Only a service line can be drawn on. Issue goods to the project from stock instead.');
            }
            if (item.purchase.status === 'CANCELLED') {
                throw new BadRequestException('That purchase has been cancelled.');
            }
            const allocated = await allocatedByPurchaseItem(this.db, tenantId, [item.id]);
            assertWithinLine(Number(item.line_total), allocated.get(item.id) ?? 0, dto.amount);
        }

        const created = await this.db.projectCostEntry.create({
            data: {
                tenant_id: tenantId,
                project_id: projectId,
                category: dto.category,
                amount: dto.amount,
                cost_date: new Date(dto.costDate),
                description: dto.description.trim(),
                source_purchase_item_id: dto.sourcePurchaseItemId ?? null,
                created_by: ctx.userId ?? null,
            },
        });
        await this.audit
            .log('PROJECT_COST_ADDED', 'Project', { ...ctx, tenantId }, projectId, {
                cost_entry_id: created.id,
                category: dto.category,
                amount: dto.amount,
                source_purchase_item_id: dto.sourcePurchaseItemId ?? null,
            })
            .catch(() => {});
        return created;
    }

    async removeCost(viewer: ProjectViewer, projectId: string, costId: string, ctx: AuditContext) {
        const tenantId = viewer.tenantId;
        await this.access.assertProjectVisible(viewer, projectId);
        const entry = await this.db.projectCostEntry.findFirst({
            where: { id: costId, tenant_id: tenantId, project_id: projectId },
        });
        if (!entry) throw new NotFoundException('Cost not found');
        await this.db.projectCostEntry.delete({ where: { id: costId } });
        await this.audit
            .log('PROJECT_COST_REMOVED', 'Project', { ...ctx, tenantId }, projectId, {
                cost_entry_id: costId,
                category: entry.category,
                amount: Number(entry.amount),
            })
            .catch(() => {});
        return { removed: true };
    }

    /**
     * Take goods out of a warehouse for the project.
     *
     * The average is read before the stock moves — an issue does not change
     * the average, so reading first and decrementing after agree — and stored
     * on each line. A product the pool has never costed is issued uncosted
     * rather than at zero. The tenant's negative-stock rule applies as it does
     * to any other issue.
     */
    async issueMaterials(
        viewer: ProjectViewer,
        projectId: string,
        dto: { warehouseId: string; issueDate: string; note?: string; items: Array<{ productId: string; quantity: number }> },
        ctx: AuditContext,
    ) {
        const tenantId = viewer.tenantId;
        await this.access.assertProjectVisible(viewer, projectId);
        const productIds = dto.items.map((item) => item.productId);
        if (new Set(productIds).size !== productIds.length) {
            throw new BadRequestException('Each product may appear once. Combine the quantities.');
        }

        const issue = await this.db.$transaction(async (tx) => {
            const warehouse = await assertWarehouseBelongsToTenant(tx, tenantId, dto.warehouseId);
            const products = await tx.product.findMany({
                where: { id: { in: productIds }, tenant_id: tenantId },
                select: { id: true, type: true },
            });
            if (products.length !== productIds.length) throw new BadRequestException('A product was not found.');
            if (products.some((product) => product.type === 'SERVICE')) {
                throw new BadRequestException('A service holds no stock to issue. Add it as a cost from its bill.');
            }

            const costs = await resolveProductCosts(tx, {
                tenantId,
                storeId: (warehouse as { store_id?: string | null }).store_id ?? undefined,
                productIds,
            });

            const created = await tx.projectMaterialIssue.create({
                data: {
                    tenant_id: tenantId,
                    project_id: projectId,
                    warehouse_id: dto.warehouseId,
                    issue_date: new Date(dto.issueDate),
                    note: dto.note?.trim() || null,
                    created_by: ctx.userId ?? null,
                    lines: {
                        create: dto.items.map((item) => {
                            const unit = costs.get(item.productId);
                            return {
                                product_id: item.productId,
                                quantity: item.quantity,
                                unit_cost: unit ?? null,
                                line_cost: unit === undefined ? null : round2(unit * item.quantity),
                            };
                        }),
                    },
                },
                include: { lines: true },
            });

            for (const item of dto.items) {
                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: item.productId,
                    warehouseId: dto.warehouseId,
                    quantityDelta: -item.quantity,
                    movementType: 'PROJECT_ISSUE',
                    referenceType: 'PROJECT_MATERIAL_ISSUE',
                    referenceId: created.id,
                    occurredAt: new Date(dto.issueDate),
                });
            }
            return created;
        });

        await this.audit
            .log('PROJECT_MATERIALS_ISSUED', 'Project', { ...ctx, tenantId }, projectId, {
                issue_id: issue.id,
                warehouse_id: dto.warehouseId,
                lines: issue.lines.length,
                cost: round2(issue.lines.reduce((sum, line) => sum + Number(line.line_cost ?? 0), 0)),
            })
            .catch(() => {});
        return issue;
    }

    /** Undo an issue: the goods go back at the cost they left at, and the record goes. */
    async reverseIssue(viewer: ProjectViewer, projectId: string, issueId: string, ctx: AuditContext) {
        const tenantId = viewer.tenantId;
        await this.access.assertProjectVisible(viewer, projectId);

        const issue = await this.db.$transaction(async (tx) => {
            const found = await tx.projectMaterialIssue.findFirst({
                where: { id: issueId, tenant_id: tenantId, project_id: projectId },
                include: { lines: true },
            });
            if (!found) throw new NotFoundException('Material issue not found');
            for (const line of found.lines) {
                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: line.product_id,
                    warehouseId: found.warehouse_id,
                    quantityDelta: line.quantity,
                    movementType: 'PROJECT_ISSUE_REVERSAL',
                    referenceType: 'PROJECT_MATERIAL_ISSUE',
                    referenceId: found.id,
                    ...(line.unit_cost !== null ? { unitCost: Number(line.unit_cost) } : {}),
                });
            }
            await tx.projectMaterialIssue.delete({ where: { id: found.id } });
            return found;
        });

        await this.audit
            .log('PROJECT_MATERIALS_RETURNED', 'Project', { ...ctx, tenantId }, projectId, {
                issue_id: issue.id,
                lines: issue.lines.length,
            })
            .catch(() => {});
        return { reversed: true };
    }

    /**
     * Projects a person may tag an expense with: live ones they can see. Its own
     * route, because someone recording expenses may hold no project permission
     * at all — and then sees only public projects, as visibility already rules.
     */
    async options(viewer: ProjectViewer) {
        const filter = await this.access.projectFilter(viewer);
        return this.db.project.findMany({
            where: {
                tenant_id: viewer.tenantId,
                deleted_at: null,
                status: { notIn: ['CANCELLED', 'COMPLETED'] },
                ...filter,
            } as never,
            select: { id: true, code: true, name: true },
            orderBy: { code: 'asc' },
        });
    }
}
