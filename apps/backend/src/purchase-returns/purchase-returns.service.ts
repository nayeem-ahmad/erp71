import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { createdAtRange } from '../common/created-range.util';
import { DatabaseService } from '../database/database.service';
import { CreatePurchaseReturnDto, UpdatePurchaseReturnDto } from './purchase-return.dto';
import { applyInventoryMovement, resolveWarehouseId } from '../database/inventory.utils';
import { autoPostFromRules } from '../accounting/posting.utils';
import { loadPostingSummaries, loadPostingSummary, NO_POSTING_EVENT } from '../accounting/posting-status.util';

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
                where: { id: dto.purchaseId ?? '', tenant_id: tenantId },
                include: {
                    items: {
                        include: {
                            returnItems: true,
                        },
                    },
                    supplier: true,
                },
            });

            if (dto.purchaseId && !purchase) {
                throw new NotFoundException('Purchase not found');
            }

            if (purchase && purchase.store_id !== dto.storeId) {
                throw new BadRequestException('Purchase does not belong to the provided store.');
            }

            const returnItemData = purchase
                ? this.buildReturnItemData(purchase.items, dto.items)
                : await this.buildStandaloneReturnItemData(tx, tenantId, dto.items);
            const totalAmount = returnItemData.reduce((sum, item) => sum + item.line_total, 0);
            const count = await tx.purchaseReturn.count({ where: { tenant_id: tenantId } });
            const returnNumber = `PRET-${String(count + 1).padStart(5, '0')}`;
            const warehouseId = await resolveWarehouseId(tx, tenantId, purchase?.store_id ?? dto.storeId);

            // Create the return row first, so movements can reference its id
            // (every other caller passes the id, not the PRET- string).
            const purchaseReturn = await tx.purchaseReturn.create({
                data: {
                    tenant_id: tenantId,
                    store_id: dto.storeId,
                    purchase_id: purchase?.id ?? null,
                    supplier_id: purchase?.supplier_id ?? null,
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

            for (const item of returnItemData) {
                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: item.product_id,
                    warehouseId,
                    quantityDelta: -item.quantity,
                    movementType: 'PURCHASE_RETURN',
                    referenceType: 'PURCHASE_RETURN',
                    referenceId: purchaseReturn.id,
                    unitCost: item.unit_cost,
                });
            }

            // Returning purchased goods reduces what we owe the supplier. Record
            // the credit-ledger entry and adjust the running balance to match, so
            // a purchase return no longer leaves the payable overstated.
            if (purchase?.supplier_id) {
                const currentDue = Number(purchase.supplier?.due_balance ?? 0);
                const creditReduction = Math.min(totalAmount, currentDue);
                if (creditReduction > 0.005) {
                    const balanceAfter = currentDue - creditReduction;
                    await tx.supplierCreditTransaction.create({
                        data: {
                            tenant_id: tenantId,
                            supplier_id: purchase.supplier_id,
                            type: 'ADJUSTMENT',
                            amount: -creditReduction,
                            balance_after: balanceAfter,
                            reference_type: 'PURCHASE_RETURN',
                            reference_id: purchaseReturn.id,
                            notes: `Purchase return ${returnNumber}`,
                            created_by: userId,
                        },
                    });
                    await tx.supplier.update({
                        where: { id: purchase.supplier_id },
                        data: { due_balance: balanceAfter },
                    });
                }
            }

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
                storeId: purchase?.store_id ?? dto.storeId,
                partyType: 'SUPPLIER',
                partyId: purchase?.supplier_id ?? undefined,
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

    async findAll(
        tenantId: string,
        page = 1,
        limit = 20,
        opts?: { createdFrom?: string; createdTo?: string },
    ): Promise<PaginatedResult<unknown>> {
        const created = createdAtRange(opts?.createdFrom, opts?.createdTo);
        const result = await paginatedFindMany({
            findMany: (args) =>
                this.db.purchaseReturn.findMany({
                    ...(args as object),
                    include: this.returnInclude(),
                }),
            count: (args) => this.db.purchaseReturn.count(args as any),
            where: { tenant_id: tenantId, ...(created ? { created_at: created } : {}) },
            orderBy: { created_at: 'desc' },
            page,
            limit,
        });

        const summaries = await loadPostingSummaries(
            this.db,
            tenantId,
            'purchases',
            'purchase_return',
            result.items.map((item: { id: string }) => item.id),
        );

        return {
            ...result,
            items: result.items.map((item: Record<string, unknown> & { id: string }) => ({
                ...item,
                ...(summaries.get(item.id) ?? NO_POSTING_EVENT),
            })),
        };
    }

    async findOne(tenantId: string, id: string) {
        const purchaseReturn = await this.db.purchaseReturn.findFirst({
            where: { id, tenant_id: tenantId },
            include: this.returnInclude(true),
        });

        if (!purchaseReturn) {
            throw new NotFoundException('Purchase return not found');
        }

        return {
            ...purchaseReturn,
            ...(await loadPostingSummary(this.db, tenantId, 'purchases', 'purchase_return', purchaseReturn.id)),
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
                // A parentless return has no purchase to take the store from.
                const warehouseId = await resolveWarehouseId(
                    tx,
                    tenantId,
                    existingReturn.purchase?.store_id ?? existingReturn.store_id,
                );
                for (const oldItem of existingReturn.items) {
                    await applyInventoryMovement(tx, {
                        tenantId,
                        productId: oldItem.product_id,
                        warehouseId,
                        quantityDelta: oldItem.quantity,
                        movementType: 'PURCHASE_RETURN_REVERSAL',
                        referenceType: 'PURCHASE_RETURN',
                        referenceId: id,
                        // Goods rejoin the average at the cost they left at, so
                        // editing a purchase return nets to zero against the
                        // PURCHASE_RETURN that created it.
                        unitCost: Number(oldItem.unit_cost),
                    });
                }

                const newItems = existingReturn.purchase
                    ? this.buildReturnItemData(existingReturn.purchase.items, dto.items, id)
                    : await this.buildStandaloneReturnItemData(tx, tenantId, dto.items);

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
                    // Same symmetry as the edit path above: deleting the return
                    // must put back exactly the value it took out.
                    unitCost: Number(item.unit_cost),
                });
            }

            await tx.purchaseReturn.delete({ where: { id } });

            return { deleted: true };
        });
    }

    /**
     * Lines for a return with no parent purchase. Nothing bounds or prices them,
     * so the caller has to name the product and its cost; the checks that a
     * parent would provide (line belongs to it, quantity still returnable) have
     * no equivalent here.
     */
    private async buildStandaloneReturnItemData(
        tx: any,
        tenantId: string,
        items: Array<{ productId?: string; quantity: number; unitCost?: number }>,
    ) {
        const seen = new Set<string>();
        const rows = [];

        for (const item of items) {
            if (!item.productId) {
                throw new BadRequestException('productId is required on each line when no purchase is given.');
            }
            if (item.unitCost == null || item.unitCost < 0) {
                throw new BadRequestException('unitCost is required on each line when no purchase is given.');
            }
            if (seen.has(item.productId)) {
                throw new BadRequestException(`Duplicate product ${item.productId} in return payload.`);
            }
            seen.add(item.productId);

            const product = await tx.product.findFirst({
                where: { id: item.productId, tenant_id: tenantId },
                select: { id: true },
            });
            if (!product) throw new BadRequestException(`Product ${item.productId} not found.`);

            rows.push({
                purchase_item_id: null,
                product_id: product.id,
                quantity: item.quantity,
                unit_cost: item.unitCost,
                line_total: item.unitCost * item.quantity,
            });
        }

        return rows;
    }

    private buildReturnItemData(
        purchaseItems: Array<{
            id: string;
            product_id: string;
            quantity: number;
            unit_cost: unknown;
            returnItems?: Array<{ quantity: number; return_id: string }>;
        }>,
        items: Array<{ purchaseItemId?: string; quantity: number }>,
        currentReturnId?: string,
    ) {
        const seen = new Set<string>();

        return items.map((item) => {
            if (!item.purchaseItemId) {
                throw new BadRequestException('purchaseItemId is required on each line when a purchase is given.');
            }
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