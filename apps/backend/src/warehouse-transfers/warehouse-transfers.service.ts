import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { applyInventoryMovement, assertWarehouseBelongsToTenant } from '../database/inventory.utils';
import { CreateWarehouseTransferDto, ListWarehouseTransfersQueryDto, ReceiveWarehouseTransferDto } from './warehouse-transfer.dto';
import { createdAtRange } from '../common/created-range.util';
import { autoPostFromRules } from '../accounting/posting.utils';
import { VoucherAttribution } from '../accounting/accounting.constants';

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
            const status = dto.status === 'DRAFT' ? 'DRAFT' : 'SENT';

            const transfer = await tx.warehouseTransfer.create({
                data: {
                    tenant_id: tenantId,
                    transfer_number: transferNumber,
                    source_warehouse_id: dto.sourceWarehouseId,
                    destination_warehouse_id: dto.destinationWarehouseId,
                    ...branchColumns(sourceWarehouse, destinationWarehouse),
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

            let posting: AutoPostOutcome = EMPTY_POSTING;

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

                // Posted here as well as in `send`, because saving straight to
                // SENT skips the draft entirely. Without this, whether a
                // transfer reached the ledger depended on whether the user
                // happened to save a draft first.
                //
                // Inside the transaction, so a locked fiscal period now refuses
                // the whole create rather than moving stock and booking nothing.
                // That is the same answer `send` has always given a draft, and
                // it is the point: the alternative leaves stock somewhere the
                // books do not know about.
                posting = await this.postTransfer(tx, tenantId, transfer);
            }

            const created = await tx.warehouseTransfer.findFirst({
                where: { id: transfer.id, tenant_id: tenantId },
                include: this.transferInclude(),
            });

            return { ...created, ...posting };
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

            const posting = await this.postTransfer(tx, tenantId, transfer);

            await tx.warehouseTransfer.update({
                where: { id },
                data: {
                    status: 'SENT',
                    sent_at: new Date(),
                    // Backfilled rather than assumed set: a draft raised before
                    // `create` started writing these columns carries nulls and a
                    // `false` flag. `postTransfer` derives the scope from the
                    // warehouses either way, so this only brings the stored row
                    // into line with what was actually posted — which is what
                    // the `is_cross_branch` index has to be able to answer.
                    ...branchColumns(transfer.sourceWarehouse, transfer.destinationWarehouse),
                },
            });

            const sentTransfer = await tx.warehouseTransfer.findFirst({
                where: { id, tenant_id: tenantId },
                include: this.transferInclude(),
            });

            return { ...sentTransfer, ...posting };
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

    /**
     * Post one transfer to the ledger.
     *
     * **The scope is derived from the two warehouses' branches, never read from
     * `is_cross_branch`.** That column defaulted to `false` and, until this
     * method existed, nothing outside the demo-data generator ever wrote it — so
     * every real inter-branch transfer chose the `intra_store` posting rule,
     * attributed its voucher to a single branch, and named no counterparty. A
     * tenant with an `inter_store` rule never saw it fire and inter-branch stock
     * never reached the clearing account. Deriving it here also covers the
     * drafts already on file, which a migration over the column alone would not:
     * `create` and `send` both persist the same derivation, so the stored
     * columns are a record of what was posted rather than the input to it.
     *
     * Runs through the same `branchColumns` the two callers persist, so what is
     * posted and what is stored cannot disagree. The warehouse relation wins
     * where it is loaded; the stored columns are the fallback for a row loaded
     * without it.
     */
    private async postTransfer(tx: any, tenantId: string, transfer: any) {
        const {
            source_store_id: sourceStoreId,
            destination_store_id: destinationStoreId,
            is_cross_branch: isCrossBranch,
        } = branchColumns(
            transfer.sourceWarehouse ?? { store_id: transfer.source_store_id ?? undefined },
            transfer.destinationWarehouse ?? { store_id: transfer.destination_store_id ?? undefined },
        );

        const totalTransferAmount = transfer.items.reduce(
            (sum: number, item: any) => sum + (item.quantity_sent * Number(item.product?.price ?? 0)),
            0,
        );

        const posting = await autoPostFromRules({
            tx,
            tenantId,
            eventType: 'fund_movement',
            conditionKey: 'transfer_scope',
            conditionValue: isCrossBranch ? 'inter_store' : 'intra_store',
            sourceModule: 'warehouse_transfers',
            sourceType: 'transfer',
            sourceId: transfer.id,
            amount: totalTransferAmount,
            description: `Auto-posted warehouse transfer ${transfer.transfer_number}`,
            referenceNumber: transfer.transfer_number,
            storeId: sourceStoreId ?? undefined,
            attribution: isCrossBranch ? VoucherAttribution.INTER_BRANCH : VoucherAttribution.BRANCH,
            counterpartyStoreId: isCrossBranch ? destinationStoreId ?? undefined : undefined,
        });

        return {
            posting_status: posting.postingStatus,
            voucher_id: posting.voucherId ?? null,
            voucher_number: posting.voucherNumber ?? null,
            voucher_type: posting.voucherType ?? null,
        };
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

/** What `create` reports for a draft: saved, but nothing posted yet. */
const EMPTY_POSTING = {
    posting_status: null as string | null,
    voucher_id: null as string | null,
    voucher_number: null as string | null,
    voucher_type: null as string | null,
};

type AutoPostOutcome = typeof EMPTY_POSTING;

/**
 * The branch pair a transfer runs between, as the columns that record it.
 *
 * `is_cross_branch` is what `send` reads back to pick the posting rule, and what
 * the `[tenant_id, is_cross_branch]` index exists to filter on, so it is written
 * from the warehouses rather than taken from the caller — a transfer's branches
 * are whatever its warehouses' branches are, and nothing else can say.
 */
function branchColumns(
    sourceWarehouse: { store_id?: string } | null | undefined,
    destinationWarehouse: { store_id?: string } | null | undefined,
) {
    const sourceStoreId = sourceWarehouse?.store_id ?? null;
    const destinationStoreId = destinationWarehouse?.store_id ?? null;

    return {
        source_store_id: sourceStoreId,
        destination_store_id: destinationStoreId,
        is_cross_branch: Boolean(sourceStoreId && destinationStoreId && sourceStoreId !== destinationStoreId),
    };
}

function buildTransferDateRange(from: string | undefined, to: string | undefined, timezone: string | undefined) {
    const created = createdAtRange(from, to, timezone);
    return created ? { created_at: created } : {};
}