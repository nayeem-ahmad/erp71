import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { DatabaseService } from '../database/database.service';
import { applyInventoryMovement, assertWarehouseBelongsToTenant } from '../database/inventory.utils';
import { CreateStockTakeSessionDto, UpdateStockTakeCountsDto, UpdateStockTakeStatusDto } from './stock-takes.dto';
import { autoPostFromRules } from '../accounting/posting.utils';

@Injectable()
export class StockTakesService {
    constructor(private db: DatabaseService) {}

    async create(tenantId: string, dto: CreateStockTakeSessionDto) {
        return this.db.$transaction(async (tx) => {
            await assertWarehouseBelongsToTenant(tx, tenantId, dto.warehouseId);
            const stockRows = await tx.productStock.findMany({
                where: { tenant_id: tenantId, warehouse_id: dto.warehouseId },
                include: { product: true },
                orderBy: { product: { name: 'asc' } },
            });

            const count = await tx.stockTakeSession.count({ where: { tenant_id: tenantId } });
            const sessionNumber = `STK-${String(count + 1).padStart(5, '0')}`;

            const session = await tx.stockTakeSession.create({
                data: {
                    tenant_id: tenantId,
                    warehouse_id: dto.warehouseId,
                    session_number: sessionNumber,
                    notes: dto.notes,
                    status: dto.startImmediately === false ? 'DRAFT' : 'COUNTING',
                    lines: {
                        create: stockRows.map((row) => ({
                            product_id: row.product_id,
                            expected_quantity: row.quantity,
                        })),
                    },
                },
                include: this.sessionInclude(),
            });

            const settings = await tx.inventorySettings.findUnique({ where: { tenant_id: tenantId } });
            return this.decorateSession(session, settings?.discrepancy_approval_threshold ?? 25);
        });
    }

    async findAll(tenantId: string, page = 1, limit = 20): Promise<PaginatedResult<unknown>> {
        const result = await paginatedFindMany({
            findMany: (args) =>
                this.db.stockTakeSession.findMany({
                    ...(args as object),
                    include: this.sessionInclude(),
                }),
            count: (args) => this.db.stockTakeSession.count(args as any),
            where: { tenant_id: tenantId },
            orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
            page,
            limit,
        });
        const settings = await this.db.inventorySettings.findUnique({ where: { tenant_id: tenantId } });
        const approvalThreshold = settings?.discrepancy_approval_threshold ?? 25;
        return {
            ...result,
            items: result.items.map((session) => this.decorateSession(session, approvalThreshold)),
        };
    }

    async findOne(tenantId: string, id: string) {
        const session = await this.db.stockTakeSession.findFirst({
            where: { id, tenant_id: tenantId },
            include: this.sessionInclude(),
        });
        if (!session) {
            throw new NotFoundException('Stock-take session not found.');
        }
        const settings = await this.db.inventorySettings.findUnique({ where: { tenant_id: tenantId } });
        return this.decorateSession(session, settings?.discrepancy_approval_threshold ?? 25);
    }

    async updateCounts(tenantId: string, id: string, dto: UpdateStockTakeCountsDto) {
        return this.db.$transaction(async (tx) => {
            const session = await tx.stockTakeSession.findFirst({
                where: { id, tenant_id: tenantId },
                include: this.sessionInclude(),
            });
            if (!session) {
                throw new NotFoundException('Stock-take session not found.');
            }
            if (['POSTED', 'CANCELLED'].includes(session.status)) {
                throw new BadRequestException('This stock-take session can no longer be modified.');
            }

            for (const line of dto.lines) {
                const existing = session.lines.find((item) => item.product_id === line.productId);
                if (!existing) {
                    throw new BadRequestException('One or more count lines do not belong to this session.');
                }
                if (line.reasonId) {
                    await this.assertActiveReason(tx, tenantId, line.reasonId, 'DISCREPANCY');
                }
                await tx.stockTakeCountLine.update({
                    where: { id: existing.id },
                    data: {
                        counted_quantity: line.countedQuantity,
                        variance_quantity: line.countedQuantity - existing.expected_quantity,
                        reason_id: line.reasonId || null,
                        note: line.note,
                    },
                });
            }

            if (session.status === 'DRAFT') {
                await tx.stockTakeSession.update({ where: { id }, data: { status: 'COUNTING' } });
            }

            const refreshed = await tx.stockTakeSession.findFirst({
                where: { id, tenant_id: tenantId },
                include: this.sessionInclude(),
            });
            const settings = await tx.inventorySettings.findUnique({ where: { tenant_id: tenantId } });
            return this.decorateSession(refreshed, settings?.discrepancy_approval_threshold ?? 25);
        });
    }

    async updateStatus(tenantId: string, id: string, dto: UpdateStockTakeStatusDto) {
        const session = await this.findOne(tenantId, id);
        if (session.status === 'POSTED') {
            throw new BadRequestException('Posted stock-takes cannot change status.');
        }
        return this.db.stockTakeSession.update({ where: { id }, data: { status: dto.status } });
    }

    async post(tenantId: string, id: string) {
        return this.db.$transaction(async (tx) => {
            const session = await tx.stockTakeSession.findFirst({
                where: { id, tenant_id: tenantId },
                include: this.sessionInclude(),
            });
            if (!session) {
                throw new NotFoundException('Stock-take session not found.');
            }
            if (session.status === 'POSTED') {
                throw new BadRequestException('Stock-take session is already posted.');
            }
            if (session.status === 'CANCELLED') {
                throw new BadRequestException('Cancelled stock-take sessions cannot be posted.');
            }

            const settings = await tx.inventorySettings.findUnique({ where: { tenant_id: tenantId } });
            const threshold = settings?.discrepancy_approval_threshold ?? 25;
            const maxVariance = session.lines.reduce((largest, line) => Math.max(largest, Math.abs((line.counted_quantity ?? line.expected_quantity) - line.expected_quantity)), 0);
            const requiresReview = maxVariance > threshold;

            if (requiresReview && session.status !== 'REVIEW') {
                throw new BadRequestException('Large discrepancies require review before posting.');
            }

            let adjustmentAmount = 0;
            for (const line of session.lines) {
                if (line.counted_quantity === null || line.counted_quantity === undefined) {
                    continue;
                }
                const variance = (line.counted_quantity ?? 0) - line.expected_quantity;
                if (variance === 0) {
                    continue;
                }
                adjustmentAmount += Math.abs(variance) * Number(line.product?.price ?? 0);
                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: line.product_id,
                    warehouseId: session.warehouse_id,
                    quantityDelta: variance,
                    movementType: 'STOCK_TAKE_ADJUSTMENT',
                    referenceType: 'STOCK_TAKE',
                    referenceId: session.id,
                    note: line.note || undefined,
                });
            }

            await tx.stockTakeSession.update({
                where: { id },
                data: { status: 'POSTED', posted_at: new Date() },
            });

            const refreshed = await tx.stockTakeSession.findFirst({
                where: { id, tenant_id: tenantId },
                include: this.sessionInclude(),
            });

            const posting = await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'inventory_adjustment',
                conditionKey: 'reason_type',
                conditionValue: 'DISCREPANCY',
                sourceModule: 'inventory',
                sourceType: 'stock_take_adjustment',
                sourceId: session.id,
                amount: adjustmentAmount,
                description: `Auto-posted stock take ${session.session_number}`,
                referenceNumber: session.session_number,
                storeId: session.warehouse?.store_id,
            });

            return {
                ...this.decorateSession(refreshed, threshold),
                posting_status: posting.postingStatus,
                voucher_id: posting.voucherId ?? null,
                voucher_number: posting.voucherNumber ?? null,
                voucher_type: posting.voucherType ?? null,
            };
        });
    }

    private sessionInclude() {
        return {
            warehouse: true,
            lines: {
                include: {
                    product: {
                        include: { group: true, subgroup: true },
                    },
                    reason: true,
                },
                orderBy: { product: { name: 'asc' as const } },
            },
        };
    }

    private decorateSession(session: any, approvalThreshold: number) {
        const countedLines = session.lines.filter((line) => line.counted_quantity !== null && line.counted_quantity !== undefined).length;
        const discrepantLines = session.lines.filter((line) => (line.variance_quantity ?? 0) !== 0).length;
        const totalExpectedQuantity = session.lines.reduce((sum, line) => sum + line.expected_quantity, 0);
        const positiveDiscrepancies = session.lines.filter((line) => (line.variance_quantity ?? 0) > 0).length;
        const negativeDiscrepancies = session.lines.filter((line) => (line.variance_quantity ?? 0) < 0).length;
        const netQuantityImpact = session.lines.reduce((sum, line) => sum + (line.variance_quantity ?? 0), 0);
        const netValueImpact = session.lines.reduce((sum, line) => sum + ((line.variance_quantity ?? 0) * Number(line.product?.price ?? 0)), 0);
        const maxVariance = session.lines.reduce((largest, line) => Math.max(largest, Math.abs(line.variance_quantity ?? 0)), 0);
        return {
            ...session,
            summary: {
                countedLines,
                totalLines: session.lines.length,
                discrepantLines,
                totalExpectedQuantity,
                positiveDiscrepancies,
                negativeDiscrepancies,
                approvalThreshold,
                requiresReview: maxVariance > approvalThreshold,
                maxVariance,
                netQuantityImpact,
                netValueImpact,
            },
        };
    }

    private async assertActiveReason(tx: any, tenantId: string, reasonId: string, type: string) {
        const reason = await tx.inventoryReason.findFirst({
            where: { id: reasonId, tenant_id: tenantId, type, is_active: true },
        });
        if (!reason) {
            throw new BadRequestException('Active inventory reason not found for this workflow.');
        }
    }
}