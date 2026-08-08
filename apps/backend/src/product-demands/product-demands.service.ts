import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { assertWarehouseBelongsToTenant } from '../database/inventory.utils';
import {
    CreateProductDemandDto,
    FulfilProductDemandDto,
    ListProductDemandsQueryDto,
    ProductDemandItemDto,
    ReviewProductDemandDto,
    UpdateProductDemandDto,
} from './product-demand.dto';

/**
 * Product demands — a branch asking for stock it does not have.
 *
 * Nothing in here moves stock. A demand is a request, and the movement that
 * answers it is an ordinary warehouse transfer or purchase recorded through its
 * own module; `fulfil` only marks that this happened, with a free-text note for
 * the transfer or PO number. Posting stock from here would give the same physical
 * movement two records and let a demand inflate a warehouse on its own.
 *
 * State machine, deliberately the same shape as `ExpenseClaim`:
 *   DRAFT → SUBMITTED → APPROVED → FULFILLED
 *                    ↘ REJECTED
 *   DRAFT | SUBMITTED → CANCELLED
 */
@Injectable()
export class ProductDemandsService {
    constructor(private readonly db: DatabaseService) {}

    // ── Reads ─────────────────────────────────────────────────────────────────

    async findAll(tenantId: string, query: ListProductDemandsQueryDto = {}, requesterId?: string) {
        return this.db.productDemand.findMany({
            where: {
                tenant_id: tenantId,
                ...(query.status ? { status: query.status } : {}),
                ...(query.warehouseId ? { warehouse_id: query.warehouseId } : {}),
                ...(query.priority ? { priority: query.priority } : {}),
                ...(query.productId ? { items: { some: { product_id: query.productId } } } : {}),
                // `mine` without a caller would silently widen to everyone's, so
                // it resolves to a filter that matches nothing instead.
                ...(query.mine === 'true' ? { requested_by: requesterId ?? '__no_requester__' } : {}),
                ...buildDemandDateRange(query.from, query.to),
            },
            include: this.demandInclude(),
            orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        });
    }

    async findOne(tenantId: string, id: string) {
        const demand = await this.db.productDemand.findFirst({
            where: { id, tenant_id: tenantId },
            include: this.demandInclude(),
        });

        if (!demand) {
            throw new NotFoundException('Product demand not found.');
        }

        return demand;
    }

    // ── Writes ────────────────────────────────────────────────────────────────

    async create(
        tenantId: string,
        dto: CreateProductDemandDto,
        context: { userId?: string; storeId?: string } = {},
    ) {
        this.assertUniqueLines(dto.items);
        const neededBy = this.parseNeededBy(dto.neededBy);

        return this.db.$transaction(async (tx) => {
            await assertWarehouseBelongsToTenant(tx, tenantId, dto.warehouseId);
            await this.assertProductsBelongToTenant(tx, tenantId, dto.items.map((item) => item.productId));

            const status = dto.status === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT';

            const demand = await tx.productDemand.create({
                data: {
                    tenant_id: tenantId,
                    store_id: context.storeId ?? null,
                    warehouse_id: dto.warehouseId,
                    demand_number: await this.nextDemandNumber(tx, tenantId),
                    status,
                    priority: dto.priority ?? 'NORMAL',
                    needed_by: neededBy,
                    notes: dto.notes ?? null,
                    requested_by: context.userId ?? null,
                    submitted_at: status === 'SUBMITTED' ? new Date() : null,
                    items: {
                        create: dto.items.map((item) => ({
                            product_id: item.productId,
                            quantity_requested: item.quantity,
                            note: item.note ?? null,
                        })),
                    },
                },
                include: this.demandInclude(),
            });

            return demand;
        });
    }

    /**
     * Edit a demand that has not been sent yet.
     *
     * Scoped to the raiser: a demand is somebody's request, and letting a second
     * person with the same permission rewrite the lines before it is reviewed
     * makes the approver's decision about something the requester never asked
     * for. Tenant owners are exempt — they bypass the permission guard anyway,
     * so refusing them here would be a check that only inconveniences the person
     * it cannot stop.
     */
    async update(
        tenantId: string,
        id: string,
        dto: UpdateProductDemandDto,
        context: { userId?: string; userRole?: string } = {},
    ) {
        const demand = await this.findOne(tenantId, id);
        if (demand.status !== 'DRAFT') {
            throw new BadRequestException('Only a draft demand can be edited.');
        }
        this.assertOwnDemand(demand, context);

        if (dto.items) this.assertUniqueLines(dto.items);
        const neededBy = dto.neededBy === undefined ? undefined : this.parseNeededBy(dto.neededBy);

        return this.db.$transaction(async (tx) => {
            if (dto.warehouseId) {
                await assertWarehouseBelongsToTenant(tx, tenantId, dto.warehouseId);
            }

            if (dto.items) {
                await this.assertProductsBelongToTenant(tx, tenantId, dto.items.map((item) => item.productId));
                await tx.productDemandItem.deleteMany({ where: { demand_id: id } });
                await tx.productDemandItem.createMany({
                    data: dto.items.map((item) => ({
                        demand_id: id,
                        product_id: item.productId,
                        quantity_requested: item.quantity,
                        note: item.note ?? null,
                    })),
                });
            }

            return tx.productDemand.update({
                where: { id },
                data: {
                    ...(dto.warehouseId ? { warehouse_id: dto.warehouseId } : {}),
                    ...(dto.priority ? { priority: dto.priority } : {}),
                    ...(neededBy !== undefined ? { needed_by: neededBy } : {}),
                    ...(dto.notes !== undefined ? { notes: dto.notes || null } : {}),
                },
                include: this.demandInclude(),
            });
        });
    }

    async submit(tenantId: string, id: string, context: { userId?: string; userRole?: string } = {}) {
        const demand = await this.findOne(tenantId, id);
        if (demand.status !== 'DRAFT') {
            throw new BadRequestException('Only a draft demand can be submitted.');
        }
        this.assertOwnDemand(demand, context);
        if (demand.items.length === 0) {
            throw new BadRequestException('A demand needs at least one product before it can be submitted.');
        }

        return this.db.productDemand.update({
            where: { id },
            data: { status: 'SUBMITTED', submitted_at: new Date() },
            include: this.demandInclude(),
        });
    }

    /** Withdraw your own demand, while it is still yours to withdraw. */
    async cancel(tenantId: string, id: string, context: { userId?: string; userRole?: string } = {}) {
        const demand = await this.findOne(tenantId, id);
        if (!['DRAFT', 'SUBMITTED'].includes(demand.status)) {
            throw new BadRequestException('Only a draft or submitted demand can be cancelled.');
        }
        this.assertOwnDemand(demand, context);

        return this.db.productDemand.update({
            where: { id },
            data: { status: 'CANCELLED' },
            include: this.demandInclude(),
        });
    }

    /**
     * Approve or reject. Deliberately unscoped to the raiser — an approver is by
     * definition acting on somebody else's demand.
     *
     * An approval can cut quantities line by line. Cutting every line to zero is
     * a rejection wearing an approval's clothes, so it is refused: say REJECTED
     * and the requester gets a reason instead of a demand that reads as approved
     * and delivers nothing.
     */
    async review(tenantId: string, id: string, dto: ReviewProductDemandDto, reviewerUserId?: string) {
        const demand = await this.findOne(tenantId, id);
        if (demand.status !== 'SUBMITTED') {
            throw new BadRequestException('Only a submitted demand can be reviewed.');
        }

        const approvedByProduct = new Map<string, number>();
        for (const line of dto.items ?? []) {
            if (!demand.items.some((item) => item.product_id === line.productId)) {
                throw new BadRequestException('Reviewed item does not belong to this demand.');
            }
            const item = demand.items.find((candidate) => candidate.product_id === line.productId)!;
            if (line.quantityApproved > item.quantity_requested) {
                throw new BadRequestException('Approved quantity cannot exceed the quantity requested.');
            }
            approvedByProduct.set(line.productId, line.quantityApproved);
        }

        // An omitted line is approved in full — see ReviewProductDemandDto.
        const resolved = demand.items.map((item) => ({
            id: item.id,
            quantity: approvedByProduct.has(item.product_id)
                ? approvedByProduct.get(item.product_id)!
                : item.quantity_requested,
        }));

        if (dto.status === 'APPROVED' && resolved.every((line) => line.quantity === 0)) {
            throw new BadRequestException('An approval needs at least one line with a quantity. Reject the demand instead.');
        }

        return this.db.$transaction(async (tx) => {
            for (const line of resolved) {
                await tx.productDemandItem.update({
                    where: { id: line.id },
                    // A rejection zeroes every line rather than leaving the
                    // approved quantities null: "nothing was approved" is the
                    // answer, and null reads as "not decided yet".
                    data: { quantity_approved: dto.status === 'APPROVED' ? line.quantity : 0 },
                });
            }

            return tx.productDemand.update({
                where: { id },
                data: {
                    status: dto.status,
                    reviewed_by: reviewerUserId ?? null,
                    reviewed_at: new Date(),
                    review_note: dto.reviewNote ?? null,
                },
                include: this.demandInclude(),
            });
        });
    }

    /** Mark an approved demand as met by a transfer or purchase made elsewhere. */
    async fulfil(tenantId: string, id: string, dto: FulfilProductDemandDto, actorUserId?: string) {
        const demand = await this.findOne(tenantId, id);
        if (demand.status !== 'APPROVED') {
            throw new BadRequestException('Only an approved demand can be marked fulfilled.');
        }

        return this.db.productDemand.update({
            where: { id },
            data: {
                status: 'FULFILLED',
                fulfilled_at: new Date(),
                fulfilled_by: actorUserId ?? null,
                fulfilment_note: dto.fulfilmentNote ?? null,
            },
            include: this.demandInclude(),
        });
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    private demandInclude() {
        return {
            warehouse: { select: { id: true, name: true, code: true } },
            store: { select: { id: true, name: true } },
            items: {
                include: {
                    product: {
                        select: { id: true, name: true, sku: true, reorder_level: true },
                    },
                },
                orderBy: { product: { name: 'asc' as const } },
            },
        };
    }

    /**
     * `PD-00001`, allocated from the highest existing number rather than a row
     * count: a count reuses a number the moment any row goes away, and the
     * `[tenant_id, demand_number]` unique index would then reject the write.
     */
    private async nextDemandNumber(tx: any, tenantId: string): Promise<string> {
        const last = await tx.productDemand.findFirst({
            where: { tenant_id: tenantId },
            orderBy: { demand_number: 'desc' },
            select: { demand_number: true },
        });

        const match = last?.demand_number?.match(/PD-(\d+)/);
        const next = match ? parseInt(match[1], 10) + 1 : 1;
        return `PD-${String(next).padStart(5, '0')}`;
    }

    private parseNeededBy(value?: string): Date | null {
        if (!value) return null;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            throw new BadRequestException('Needed-by date is not a valid date.');
        }
        return date;
    }

    private assertOwnDemand(
        demand: { requested_by: string | null },
        context: { userId?: string; userRole?: string },
    ) {
        if (context.userRole === 'OWNER') return;
        if (demand.requested_by && context.userId && demand.requested_by !== context.userId) {
            throw new ForbiddenException('This demand was raised by another team member.');
        }
    }

    private assertUniqueLines(items: ProductDemandItemDto[]) {
        const productIds = items.map((item) => item.productId);
        if (new Set(productIds).size !== productIds.length) {
            throw new BadRequestException('Duplicate product lines are not allowed.');
        }
    }

    private async assertProductsBelongToTenant(tx: any, tenantId: string, productIds: string[]) {
        const count = await tx.product.count({
            where: { tenant_id: tenantId, id: { in: productIds }, deleted_at: null },
        });

        if (count !== productIds.length) {
            throw new BadRequestException('One or more products were not found for this tenant.');
        }
    }
}

function buildDemandDateRange(from?: string, to?: string) {
    const where: Record<string, any> = {};
    if (from || to) {
        where.created_at = {};
        if (from) {
            const date = new Date(from);
            if (!Number.isNaN(date.getTime())) where.created_at.gte = date;
        }
        if (to) {
            const date = new Date(to);
            if (!Number.isNaN(date.getTime())) where.created_at.lte = date;
        }
    }
    return where;
}
