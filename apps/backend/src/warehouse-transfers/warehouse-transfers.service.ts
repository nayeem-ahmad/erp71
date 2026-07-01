import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { applyInventoryMovement, assertWarehouseBelongsToTenant } from '../database/inventory.utils';
import { CreateWarehouseTransferDto, ListWarehouseTransfersQueryDto, ReceiveWarehouseTransferDto } from './warehouse-transfer.dto';
import { autoPostFromRules } from '../accounting/posting.utils';
import { VoucherAttribution } from '../accounting/accounting.constants';

@Injectable()
export class WarehouseTransfersService {
    constructor(private db: DatabaseService) {}

    async create(tenantId: string, dto: CreateWarehouseTransferDto) {
        this.assertDistinctWarehouses(dto.sourceWarehouseId, dto.destinationWarehouseId);
        this.assertUniqueLines(dto.items.map((item) => item.productId));

        return this.db.$transaction(async (tx) => {
            await assertWarehouseBelongsToTenant(tx, tenantId, dto.sourceWarehouseId);
            await assertWarehouseBelongsToTenant(tx, tenantId, dto.destinationWarehouseId);
            await this.assertProductsBelongToTenant(tx, tenantId, dto.items.map((item) => item.productId));

            const count = await tx.warehouseTransfer.count({ where: { tenant_id: tenantId } });
            const transferNumber = `TRF-${String(count + 1).padStart(5, '0')}`;
            const status = dto.status === 'DRAFT' ? 'DRAFT' : 'SENT';

            const transfer = await tx.warehouseTransfer.create({
                data: {
                    tenant_id: tenantId,
                    transfer_number: transferNumber,
                    source_warehouse_id: dto.sourceWarehouseId,
                    destination_warehouse_id: dto.destinationWarehouseId,
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

    async findAll(tenantId: string, query?: ListWarehouseTransfersQueryDto) {
        return this.db.warehouseTransfer.findMany({
            where: {
                tenant_id: tenantId,
                ...(query?.status ? { status: query.status } : {}),
                ...(query?.sourceWarehouseId ? { source_warehouse_id: query.sourceWarehouseId } : {}),
                ...(query?.destinationWarehouseId ? { destination_warehouse_id: query.destinationWarehouseId } : {}),
                ...(query?.productId ? { items: { some: { product_id: query.productId } } } : {}),
                ...buildTransferDateRange(query?.from, query?.to),
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
                (sum, item) => sum + (item.quantity_sent * Number(item.product?.price ?? 0)),
                0,
            );

            const sourceStoreId = transfer.source_store_id ?? transfer.sourceWarehouse?.store_id;
            const destinationStoreId = transfer.destination_store_id ?? transfer.destinationWarehouse?.store_id;

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
                where: { id },
                data: { status: 'SENT', sent_at: new Date() },
            });

            const sentTransfer = await tx.warehouseTransfer.findFirst({
                where: { id, tenant_id: tenantId },
                include: this.transferInclude(),
            });

            return {
                ...sentTransfer,
                posting_status: posting.postingStatus,
                voucher_id: posting.voucherId ?? null,
                voucher_number: posting.voucherNumber ?? null,
                voucher_type: posting.voucherType ?? null,
            };
        });
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

function buildTransferDateRange(from?: string, to?: string) {
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