import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { applyInventoryMovement, assertWarehouseBelongsToTenant } from '../database/inventory.utils';
import {
    CreateWarehouseTransferDto,
    ListWarehouseTransfersQueryDto,
    ReceiveWarehouseTransferDto,
    RejectWarehouseTransferDto,
} from './warehouse-transfer.dto';
import { createdAtRange } from '../common/created-range.util';
import { autoPostFromRules } from '../accounting/posting.utils';
import { VoucherAttribution } from '../accounting/accounting.constants';

/**
 * A transfer parked for approval, and a transfer whose approval was refused.
 * Named rather than inlined because five places have to agree on them: creation,
 * send, approve, reject and receive.
 */
export const TRANSFER_PENDING_APPROVAL = 'PENDING_APPROVAL';
export const TRANSFER_REJECTED = 'REJECTED';

@Injectable()
export class WarehouseTransfersService {
    constructor(private db: DatabaseService) {}

    async create(tenantId: string, dto: CreateWarehouseTransferDto) {
        this.assertDistinctWarehouses(dto.sourceWarehouseId, dto.destinationWarehouseId);
        this.assertUniqueLines(dto.items.map((item) => item.productId));

        return this.db.$transaction(async (tx) => {
            const sourceWarehouse = await assertWarehouseBelongsToTenant(tx, tenantId, dto.sourceWarehouseId);
            const destinationWarehouse = await assertWarehouseBelongsToTenant(tx, tenantId, dto.destinationWarehouseId);
            await this.assertProductsBelongToTenant(tx, tenantId, dto.items.map((item) => item.productId));

            const count = await tx.warehouseTransfer.count({ where: { tenant_id: tenantId } });
            const transferNumber = `TRF-${String(count + 1).padStart(5, '0')}`;

            // Cross-branch is derived from the two warehouses, never taken from the
            // request: a client-settable flag would let the caller opt out of the
            // approval step below, which is the whole control.
            const isCrossBranch = sourceWarehouse.store_id !== destinationWarehouse.store_id;
            const requiresApproval = isCrossBranch;

            // A cross-branch transfer asked for straight away still cannot move
            // stock — it parks at PENDING_APPROVAL instead of SENT. Refusing the
            // request outright would be worse: the caller did nothing wrong, and
            // the lines they typed are exactly what the approver needs to see.
            const requestedStatus = dto.status === 'DRAFT' ? 'DRAFT' : 'SENT';
            const status = requestedStatus === 'SENT' && requiresApproval
                ? TRANSFER_PENDING_APPROVAL
                : requestedStatus;

            const transfer = await tx.warehouseTransfer.create({
                data: {
                    tenant_id: tenantId,
                    transfer_number: transferNumber,
                    source_warehouse_id: dto.sourceWarehouseId,
                    destination_warehouse_id: dto.destinationWarehouseId,
                    source_store_id: sourceWarehouse.store_id,
                    destination_store_id: destinationWarehouse.store_id,
                    is_cross_branch: isCrossBranch,
                    requires_approval: requiresApproval,
                    status,
                    notes: dto.notes,
                    sent_at: status === 'SENT' ? new Date() : null,
                    items: {
                        create: dto.items.map((item) => ({
                            product_id: item.productId,
                            quantity_sent: item.quantity,
                            note: item.note,
                        })),
                    },
                },
                include: this.transferInclude(),
            });

            if (status === 'SENT') {
                for (const item of dto.items) {
                    await applyInventoryMovement(tx, {
                        tenantId,
                        productId: item.productId,
                        warehouseId: dto.sourceWarehouseId,
                        quantityDelta: -item.quantity,
                        movementType: 'TRANSFER_OUT',
                        referenceType: 'WAREHOUSE_TRANSFER',
                        referenceId: transfer.id,
                        note: item.note,
                    });
                }
            }

            return tx.warehouseTransfer.findFirst({
                where: { id: transfer.id, tenant_id: tenantId },
                include: this.transferInclude(),
            });
        });
    }

    async findAll(
        tenantId: string,
        query?: ListWarehouseTransfersQueryDto & { timezone?: string },
    ) {
        return this.db.warehouseTransfer.findMany({
            where: {
                tenant_id: tenantId,
                ...(query?.status ? { status: query.status } : {}),
                ...(query?.sourceWarehouseId ? { source_warehouse_id: query.sourceWarehouseId } : {}),
                ...(query?.destinationWarehouseId ? { destination_warehouse_id: query.destinationWarehouseId } : {}),
                ...(query?.productId ? { items: { some: { product_id: query.productId } } } : {}),
                ...(query?.isCrossBranch !== undefined ? { is_cross_branch: query.isCrossBranch } : {}),
                ...buildTransferDateRange(query?.from, query?.to, query?.timezone),
            },
            include: this.transferInclude(),
            orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        });
    }

    async findOne(tenantId: string, id: string) {
        const transfer = await this.db.warehouseTransfer.findFirst({
            where: { id, tenant_id: tenantId },
            include: this.transferInclude(),
        });

        if (!transfer) {
            throw new NotFoundException('Warehouse transfer not found.');
        }

        return transfer;
    }

    /**
     * DRAFT → SENT, or DRAFT → PENDING_APPROVAL when the transfer crosses
     * branches. The split is the point of the approval step: a branch may raise
     * a request for another branch's stock, but it may not help itself to it.
     */
    async send(tenantId: string, id: string) {
        return this.db.$transaction(async (tx) => {
            const transfer = await tx.warehouseTransfer.findFirst({
                where: { id, tenant_id: tenantId },
                include: this.transferInclude(),
            });

            if (!transfer) {
                throw new NotFoundException('Warehouse transfer not found.');
            }

            if (transfer.status !== 'DRAFT') {
                throw new BadRequestException('Only draft transfers can be sent.');
            }

            if (transfer.requires_approval) {
                await tx.warehouseTransfer.update({
                    where: { id },
                    data: { status: TRANSFER_PENDING_APPROVAL },
                });

                // No stock moved and nothing posted, so there is no posting status
                // to report — the shape below stays consistent with the dispatched
                // case rather than making the caller handle two response shapes.
                return {
                    ...(await tx.warehouseTransfer.findFirst({
                        where: { id, tenant_id: tenantId },
                        include: this.transferInclude(),
                    })),
                    posting_status: null,
                    voucher_id: null,
                    voucher_number: null,
                    voucher_type: null,
                };
            }

            return this.dispatch(tx, tenantId, transfer);
        });
    }

    /**
     * PENDING_APPROVAL → SENT. This is the moment the stock actually leaves the
     * source warehouse, which is why the whole approval step exists.
     *
     * The approver may be the person who raised it. Identity is deliberately not
     * the control — APPROVE_GOODS_TRANSFER is (see the controller) — because the
     * owner of a two-branch shop is both, and refusing self-approval would
     * deadlock exactly the tenant this product is built for.
     */
    async approve(tenantId: string, id: string, userId: string) {
        return this.db.$transaction(async (tx) => {
            const transfer = await this.findPendingForDecision(tx, tenantId, id);

            await tx.warehouseTransfer.update({
                where: { id },
                data: { approved_by: userId, approval_date: new Date() },
            });

            return this.dispatch(tx, tenantId, transfer);
        });
    }

    /**
     * PENDING_APPROVAL → REJECTED, which is terminal: no stock ever moved, so
     * there is nothing to reverse, and re-raising is a new transfer with the
     * approver's reason to work from.
     */
    async reject(tenantId: string, id: string, userId: string, dto: RejectWarehouseTransferDto) {
        return this.db.$transaction(async (tx) => {
            await this.findPendingForDecision(tx, tenantId, id);

            await tx.warehouseTransfer.update({
                where: { id },
                data: {
                    status: TRANSFER_REJECTED,
                    rejected_by: userId,
                    rejected_at: new Date(),
                    rejection_reason: dto.reason?.trim() || null,
                },
            });

            return tx.warehouseTransfer.findFirst({
                where: { id, tenant_id: tenantId },
                include: this.transferInclude(),
            });
        });
    }

    /**
     * Moves the stock out of the source and records the transfer as SENT.
     *
     * Shared by `send` and `approve` so the two paths into SENT cannot drift:
     * an intra-branch transfer and an approved cross-branch one must deplete the
     * source identically, and only the accounting attribution differs.
     */
    private async dispatch(tx: any, tenantId: string, transfer: any) {
        for (const item of transfer.items) {
            await applyInventoryMovement(tx, {
                tenantId,
                productId: item.product_id,
                warehouseId: transfer.source_warehouse_id,
                quantityDelta: -item.quantity_sent,
                movementType: 'TRANSFER_OUT',
                referenceType: 'WAREHOUSE_TRANSFER',
                referenceId: transfer.id,
                note: item.note || undefined,
            });
        }

        const totalTransferAmount = transfer.items.reduce(
            (sum: number, item: any) => sum + (item.quantity_sent * Number(item.product?.price ?? 0)),
            0,
        );

        const sourceStoreId = transfer.source_store_id ?? transfer.sourceWarehouse?.store_id;
        const destinationStoreId = transfer.destination_store_id ?? transfer.destinationWarehouse?.store_id;

        // Posts nothing by design: there is no `fund_movement` rule for either
        // scope, because under periodic inventory moving your own stock between
        // your own warehouses is not an economic event. The call stays so the
        // scope is declared and `POSTING_CONTRACT` can keep asserting the skip —
        // see posting-contract.ts and bootstrap-accounting.ts.
        const posting = await autoPostFromRules({
            tx,
            tenantId,
            eventType: 'fund_movement',
            conditionKey: 'transfer_scope',
            conditionValue: transfer.is_cross_branch ? 'inter_store' : 'intra_store',
            sourceModule: 'warehouse_transfers',
            sourceType: 'transfer',
            sourceId: transfer.id,
            amount: totalTransferAmount,
            description: `Auto-posted warehouse transfer ${transfer.transfer_number}`,
            referenceNumber: transfer.transfer_number,
            storeId: sourceStoreId,
            attribution: transfer.is_cross_branch ? VoucherAttribution.INTER_BRANCH : VoucherAttribution.BRANCH,
            counterpartyStoreId: transfer.is_cross_branch ? destinationStoreId : undefined,
        });

        await tx.warehouseTransfer.update({
            where: { id: transfer.id },
            data: { status: 'SENT', sent_at: new Date() },
        });

        const sentTransfer = await tx.warehouseTransfer.findFirst({
            where: { id: transfer.id, tenant_id: tenantId },
            include: this.transferInclude(),
        });

        return {
            ...sentTransfer,
            posting_status: posting.postingStatus,
            voucher_id: posting.voucherId ?? null,
            voucher_number: posting.voucherNumber ?? null,
            voucher_type: posting.voucherType ?? null,
        };
    }

    /** The transfer an approve/reject may act on, or the reason it may not. */
    private async findPendingForDecision(tx: any, tenantId: string, id: string) {
        const transfer = await tx.warehouseTransfer.findFirst({
            where: { id, tenant_id: tenantId },
            include: this.transferInclude(),
        });

        if (!transfer) {
            throw new NotFoundException('Warehouse transfer not found.');
        }

        if (transfer.status !== TRANSFER_PENDING_APPROVAL) {
            throw new BadRequestException('Only transfers awaiting approval can be approved or rejected.');
        }

        return transfer;
    }

    async receive(tenantId: string, id: string, dto: ReceiveWarehouseTransferDto) {
        this.assertUniqueLines(dto.items.map((item) => item.productId));

        return this.db.$transaction(async (tx) => {
            const transfer = await tx.warehouseTransfer.findFirst({
                where: { id, tenant_id: tenantId },
                include: this.transferInclude(),
            });

            if (!transfer) {
                throw new NotFoundException('Warehouse transfer not found.');
            }

            if (!['SENT', 'PARTIALLY_RECEIVED'].includes(transfer.status)) {
                throw new BadRequestException('Only sent transfers can be received.');
            }

            const itemsByProduct = new Map(transfer.items.map((item) => [item.product_id, item]));

            for (const line of dto.items) {
                const transferItem = itemsByProduct.get(line.productId);
                if (!transferItem) {
                    throw new BadRequestException('Received item does not belong to this transfer.');
                }

                const outstanding = transferItem.quantity_sent - transferItem.quantity_received;
                if (line.quantityReceived > outstanding) {
                    throw new BadRequestException('Receive quantity exceeds outstanding transfer quantity.');
                }

                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: line.productId,
                    warehouseId: transfer.destination_warehouse_id,
                    quantityDelta: line.quantityReceived,
                    movementType: 'TRANSFER_IN',
                    referenceType: 'WAREHOUSE_TRANSFER',
                    referenceId: transfer.id,
                    note: line.note,
                });

                await tx.warehouseTransferItem.update({
                    where: { id: transferItem.id },
                    data: {
                        quantity_received: { increment: line.quantityReceived },
                        ...(line.note !== undefined ? { note: line.note } : {}),
                    },
                });
            }

            const refreshed = await tx.warehouseTransfer.findFirst({
                where: { id, tenant_id: tenantId },
                include: this.transferInclude(),
            });

            const isFullyReceived = refreshed?.items.every((item) => item.quantity_received >= item.quantity_sent);

            await tx.warehouseTransfer.update({
                where: { id },
                data: {
                    status: isFullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
                    received_at: isFullyReceived ? new Date() : null,
                },
            });

            return tx.warehouseTransfer.findFirst({
                where: { id, tenant_id: tenantId },
                include: this.transferInclude(),
            });
        });
    }

    private transferInclude() {
        return {
            sourceWarehouse: true,
            destinationWarehouse: true,
            items: {
                include: {
                    product: {
                        include: { group: true, subgroup: true },
                    },
                },
                orderBy: { product: { name: 'asc' as const } },
            },
        };
    }

    private assertDistinctWarehouses(sourceWarehouseId: string, destinationWarehouseId: string) {
        if (sourceWarehouseId === destinationWarehouseId) {
            throw new BadRequestException('Source and destination warehouses must be different.');
        }
    }

    private assertUniqueLines(productIds: string[]) {
        if (new Set(productIds).size !== productIds.length) {
            throw new BadRequestException('Duplicate product lines are not allowed.');
        }
    }

    private async assertProductsBelongToTenant(tx: any, tenantId: string, productIds: string[]) {
        const count = await tx.product.count({
            where: { tenant_id: tenantId, id: { in: productIds } },
        });

        if (count !== productIds.length) {
            throw new BadRequestException('One or more products were not found for this tenant.');
        }
    }
}

function buildTransferDateRange(from: string | undefined, to: string | undefined, timezone: string | undefined) {
    const created = createdAtRange(from, to, timezone);
    return created ? { created_at: created } : {};
}