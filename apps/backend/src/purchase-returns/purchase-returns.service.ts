import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreatePurchaseReturnDto, UpdatePurchaseReturnDto } from './purchase-return.dto';
import { applyInventoryMovement, resolveWarehouseId } from '../database/inventory.utils';
import { autoPostFromRules } from '../accounting/posting.utils';

@Injectable()
export class PurchaseReturnsService {
    constructor(private db: DatabaseService) {}

    async create(tenantId: string, userId: string, dto: CreatePurchaseReturnDto) {
        return this.db.$transaction(async (tx) => {
            const store = await tx.store.findFirst({
                where: { id: dto.storeId, tenant_id: tenantId },
            });

            if (!store) {
                throw new NotFoundException('Store not found');
            }

            const purchase = await tx.purchase.findFirst({
                where: { id: dto.purchaseId, tenant_id: tenantId },
                include: {
                    items: {
                        include: {
                            returnItems: true,
                        },
                    },
                    supplier: true,
                },
            });

            if (!purchase) {
                throw new NotFoundException('Purchase not found');
            }

            if (purchase.store_id !== dto.storeId) {
                throw new BadRequestException('Purchase does not belong to the provided store.');
            }

            const returnItemData = this.buildReturnItemData(purchase.items, dto.items);
            const totalAmount = returnItemData.reduce((sum, item) => sum + item.line_total, 0);
            const count = await tx.purchaseReturn.count({ where: { tenant_id: tenantId } });
            const returnNumber = `PRET-${String(count + 1).padStart(5, '0')}`;
            const warehouseId = await resolveWarehouseId(tx, tenantId, purchase.store_id);

            for (const item of returnItemData) {
                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: item.product_id,
                    warehouseId,
                    quantityDelta: -item.quantity,
                    movementType: 'PURCHASE_RETURN',
                    referenceType: 'PURCHASE_RETURN',
                    referenceId: returnNumber,
                    unitCost: item.unit_cost,
                });
            }

            const purchaseReturn = await tx.purchaseReturn.create({
                data: {
                    tenant_id: tenantId,
                    store_id: dto.storeId,
                    purchase_id: purchase.id,
                    supplier_id: purchase.supplier_id,
                    return_number: returnNumber,
                    reference_number: dto.referenceNumber,
                    total_amount: totalAmount,
                    notes: dto.notes,
                    created_by: userId,
                },
            });

            await tx.purchaseReturnItem.createMany({
                data: returnItemData.map((item) => ({
                    return_id: purchaseReturn.id,
                    ...item,
                })),
            });

            const posting = await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'purchase_return',
                conditionKey: 'none',
                conditionValue: null,
                sourceModule: 'purchases',
                sourceType: 'purchase_return',
                sourceId: purchaseReturn.id,
                amount: Number(purchaseReturn.total_amount),
                description: `Auto-posted purchase return ${purchaseReturn.return_number}`,
                referenceNumber: purchaseReturn.return_number,
            });

            const purchaseReturnWithDetails = await tx.purchaseReturn.findFirst({
                where: { id: purchaseReturn.id, tenant_id: tenantId },
                include: this.returnInclude(true),
            });

            return {
                ...purchaseReturnWithDetails,
                posting_status: posting.postingStatus,
                voucher_id: posting.voucherId ?? null,
                voucher_number: posting.voucherNumber ?? null,
                voucher_type: posting.voucherType ?? null,
            };
        });
    }

    async findAll(tenantId: string) {
        const returns = await this.db.purchaseReturn.findMany({
            where: { tenant_id: tenantId },
            include: this.returnInclude(),
            orderBy: { created_at: 'desc' },
        });

        const returnIds = returns.map((item) => item.id);
        const vouchers = returnIds.length > 0
            ? await this.db.voucher.findMany({
                where: {
                    tenant_id: tenantId,
                    source_module: 'purchases',
                    source_type: 'purchase_return',
                    source_id: { in: returnIds },
                },
                select: {
                    source_id: true,
                    id: true,
                    voucher_number: true,
                    voucher_type: true,
                },
            })
            : [];

        const voucherByReturnId = new Map(vouchers.map((voucher) => [voucher.source_id, voucher]));

        return returns.map((item) => {
            const voucher = voucherByReturnId.get(item.id);
            return {
                ...item,
                posting_status: voucher ? 'posted' : 'skipped',
                voucher_id: voucher?.id ?? null,
                voucher_number: voucher?.voucher_number ?? null,
                voucher_type: voucher?.voucher_type ?? null,
            };
        });
    }

    async findOne(tenantId: string, id: string) {
        const purchaseReturn = await this.db.purchaseReturn.findFirst({
            where: { id, tenant_id: tenantId },
            include: this.returnInclude(true),
        });

        if (!purchaseReturn) {
            throw new NotFoundException('Purchase return not found');
        }

        const voucher = await this.db.voucher.findFirst({
            where: {
                tenant_id: tenantId,
                source_module: 'purchases',
                source_type: 'purchase_return',
                source_id: purchaseReturn.id,
            },
            select: {
                id: true,
                voucher_number: true,
                voucher_type: true,
            },
        });

        return {
            ...purchaseReturn,
            posting_status: voucher ? 'posted' : 'skipped',
            voucher_id: voucher?.id ?? null,
            voucher_number: voucher?.voucher_number ?? null,
            voucher_type: voucher?.voucher_type ?? null,
        };
    }

    async update(tenantId: string, id: string, dto: UpdatePurchaseReturnDto) {
        return this.db.$transaction(async (tx) => {
            const existingReturn = await tx.purchaseReturn.findFirst({
                where: { id, tenant_id: tenantId },
                include: {
                    purchase: {
                        include: {
                            items: {
                                include: {
                                    returnItems: true,
                                },
                            },
                        },
                    },
                    items: true,
                },
            });

            if (!existingReturn) {
                throw new NotFoundException('Purchase return not found');
            }

            const updateData: Record<string, unknown> = {};

            if (dto.referenceNumber !== undefined) {
                updateData.reference_number = dto.referenceNumber;
            }

            if (dto.notes !== undefined) {
                updateData.notes = dto.notes;
            }

            if (dto.items) {
                const warehouseId = await resolveWarehouseId(tx, tenantId, existingReturn.purchase.store_id);
                for (const oldItem of existingReturn.items) {
                    await applyInventoryMovement(tx, {
                        tenantId,
                        productId: oldItem.product_id,
                        warehouseId,
                        quantityDelta: oldItem.quantity,
                        movementType: 'PURCHASE_RETURN_REVERSAL',
                        referenceType: 'PURCHASE_RETURN',
                        referenceId: id,
                    });
                }

                const newItems = this.buildReturnItemData(existingReturn.purchase.items, dto.items, id);

                updateData.total_amount = newItems.reduce((sum, item) => sum + item.line_total, 0);

                for (const item of newItems) {
                    await applyInventoryMovement(tx, {
                        tenantId,
                        productId: item.product_id,
                        warehouseId,
                        quantityDelta: -item.quantity,
                        movementType: 'PURCHASE_RETURN_EDIT',
                        referenceType: 'PURCHASE_RETURN',
                        referenceId: id,
                        unitCost: item.unit_cost,
                    });
                }

                await tx.purchaseReturnItem.deleteMany({ where: { return_id: id } });

                await tx.purchaseReturnItem.createMany({
                    data: newItems.map((item) => ({
                        return_id: id,
                        ...item,
                    })),
                });
            }

            await tx.purchaseReturn.update({
                where: { id },
                data: updateData,
            });

            return tx.purchaseReturn.findFirst({
                where: { id, tenant_id: tenantId },
                include: this.returnInclude(true),
            });
        });
    }

    async remove(tenantId: string, id: string) {
        return this.db.$transaction(async (tx) => {
            const existingReturn = await tx.purchaseReturn.findFirst({
                where: { id, tenant_id: tenantId },
                include: { items: true },
            });

            if (!existingReturn) {
                throw new NotFoundException('Purchase return not found');
            }

            for (const item of existingReturn.items) {
                const warehouseId = await resolveWarehouseId(tx, tenantId, existingReturn.store_id);
                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: item.product_id,
                    warehouseId,
                    quantityDelta: item.quantity,
                    movementType: 'PURCHASE_RETURN_DELETE',
                    referenceType: 'PURCHASE_RETURN',
                    referenceId: id,
                });
            }

            await tx.purchaseReturn.delete({ where: { id } });

            return { deleted: true };
        });
    }

    private buildReturnItemData(
        purchaseItems: Array<{
            id: string;
            product_id: string;
            quantity: number;
            unit_cost: unknown;
            returnItems?: Array<{ quantity: number; return_id: string }>;
        }>,
        items: Array<{ purchaseItemId: string; quantity: number }>,
        currentReturnId?: string,
    ) {
        const seen = new Set<string>();

        return items.map((item) => {
            if (seen.has(item.purchaseItemId)) {
                throw new BadRequestException(`Duplicate purchase item ${item.purchaseItemId} in return payload.`);
            }
            seen.add(item.purchaseItemId);

            const purchaseItem = purchaseItems.find((existingItem) => existingItem.id === item.purchaseItemId);
            if (!purchaseItem) {
                throw new BadRequestException(`Purchase item ${item.purchaseItemId} not found on this purchase.`);
            }

            const previouslyReturned = (purchaseItem.returnItems ?? [])
                .filter((returnItem) => returnItem.return_id !== currentReturnId)
                .reduce((sum, returnItem) => sum + returnItem.quantity, 0);
            const availableToReturn = purchaseItem.quantity - previouslyReturned;
            const unitCost = Number(purchaseItem.unit_cost);

            if (item.quantity > availableToReturn) {
                throw new BadRequestException(
                    `Cannot return ${item.quantity}. Only ${availableToReturn} available for purchase item ${item.purchaseItemId}.`,
                );
            }

            return {
                purchase_item_id: purchaseItem.id,
                product_id: purchaseItem.product_id,
                quantity: item.quantity,
                unit_cost: unitCost,
                line_total: unitCost * item.quantity,
            };
        });
    }

    private returnInclude(includePurchaseItems = false) {
        return {
            supplier: true,
            purchase: {
                include: {
                    supplier: true,
                    ...(includePurchaseItems
                        ? {
                              items: {
                                  include: {
                                      product: true,
                                      returnItems: true,
                                  },
                              },
                          }
                        : {}),
                },
            },
            items: {
                include: {
                    product: true,
                    purchaseItem: true,
                },
            },
        };
    }
}