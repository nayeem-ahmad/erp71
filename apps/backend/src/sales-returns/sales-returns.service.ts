import { Injectable, BadRequestException } from '@nestjs/common';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { DatabaseService } from '../database/database.service';
import { CreateSalesReturnDto, UpdateSalesReturnDto } from './sales-returns.dto';
import { applyInventoryMovement, resolveWarehouseId } from '../database/inventory.utils';
import { autoPostFromRules } from '../accounting/posting.utils';
import { classifyPaymentMode } from '../sales/classify-payment-mode';

@Injectable()
export class SalesReturnsService {
    constructor(private db: DatabaseService) {}

    async create(tenantId: string, userId: string, dto: CreateSalesReturnDto) {
        return this.db.$transaction(async (tx) => {
            // 1. Fetch original sale and its items
            const sale = await tx.sale.findUnique({
                where: { id: dto.saleId, tenant_id: tenantId },
                include: { items: { include: { returns: true } }, payments: true }
            });

            if (!sale) throw new BadRequestException('Sale not found');

            const returnNumber = `RET-${Date.now()}`;
            let totalRefund = 0;
            const returnItemData = [];
            const warehouseId = await resolveWarehouseId(tx, tenantId, dto.storeId);

            // 2. Validate items and calculate total refund
            for (const returnItem of dto.items) {
                const originalItem = sale.items.find((i: any) => i.id === returnItem.saleItemId);
                if (!originalItem) {
                    throw new BadRequestException(`Item ${returnItem.saleItemId} not found in this sale.`);
                }

                // Check previously returned quantity for this item
                const previouslyReturned = originalItem.returns.reduce((sum: number, r: any) => sum + r.quantity, 0);
                const availableToReturn = originalItem.quantity - previouslyReturned;

                if (returnItem.quantity > availableToReturn) {
                    throw new BadRequestException(`Cannot return ${returnItem.quantity}. Only ${availableToReturn} available to return.`);
                }

                const refundAmount = Number(originalItem.price_at_sale) * returnItem.quantity;
                totalRefund += refundAmount;

                returnItemData.push({
                    sale_item_id: originalItem.id,
                    product_id: originalItem.product_id,
                    quantity: returnItem.quantity,
                    refund_amount: refundAmount,
                });

                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: originalItem.product_id,
                    warehouseId,
                    quantityDelta: returnItem.quantity,
                    movementType: 'SALES_RETURN',
                    referenceType: 'SALES_RETURN',
                    referenceId: returnNumber,
                });
            }

            // 3. Create the return record
            const salesReturn = await tx.salesReturn.create({
                data: {
                    tenant_id: tenantId,
                    store_id: dto.storeId,
                    sale_id: sale.id,
                    return_number: returnNumber,
                    total_refund: totalRefund,
                    reason: dto.reason,
                    created_by: userId,
                    items: {
                        create: returnItemData
                    }
                },
                include: { items: true }
            });

            // 4. Optionally: If the sale had a customer, decrease their total spent
            if (sale.customer_id) {
                 await tx.customer.update({
                      where: { id: sale.customer_id },
                      data: { total_spent: { decrement: totalRefund } }
                 });
            }

            // Refund the way the customer paid. An unpaid balance was a receivable,
            // so its return credits AR rather than handing back cash.
            const balanceDue = Number(sale.total_amount) - Number(sale.amount_paid);
            const returnPaymentMode = balanceDue > 0.005
                ? 'credit'
                : classifyPaymentMode(sale.payments?.[0]?.payment_method ?? 'cash');

            const posting = await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'sale_return',
                conditionKey: 'payment_mode',
                conditionValue: returnPaymentMode,
                sourceModule: 'sales',
                sourceType: 'sale_return',
                sourceId: salesReturn.id,
                amount: Number(salesReturn.total_refund),
                description: `Auto-posted sales return ${salesReturn.return_number}`,
                referenceNumber: salesReturn.return_number,
                storeId: sale.store_id,
            });

            return {
                ...salesReturn,
                posting_status: posting.postingStatus,
                voucher_id: posting.voucherId ?? null,
                voucher_number: posting.voucherNumber ?? null,
                voucher_type: posting.voucherType ?? null,
            };
        });
    }

    async findAll(tenantId: string, page = 1, limit = 20): Promise<PaginatedResult<unknown>> {
        const result = await paginatedFindMany({
            findMany: (args) =>
                this.db.salesReturn.findMany({
                    ...(args as object),
                    include: { sale: true, items: { include: { product: true } } },
                }),
            count: (args) => this.db.salesReturn.count(args as any),
            where: { tenant_id: tenantId },
            orderBy: { created_at: 'desc' },
            page,
            limit,
        });

        const returnIds = result.items.map((item: { id: string }) => item.id);
        const vouchers = returnIds.length > 0
            ? await this.db.voucher.findMany({
                where: {
                    tenant_id: tenantId,
                    source_module: 'sales',
                    source_type: 'sale_return',
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

        return {
            ...result,
            items: result.items.map((item: Record<string, unknown> & { id: string }) => {
                const voucher = voucherByReturnId.get(item.id);
                return {
                    ...item,
                    posting_status: voucher ? 'posted' : 'skipped',
                    voucher_id: voucher?.id ?? null,
                    voucher_number: voucher?.voucher_number ?? null,
                    voucher_type: voucher?.voucher_type ?? null,
                };
            }),
        };
    }

    async findOne(tenantId: string, id: string) {
        const salesReturn = await this.db.salesReturn.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                sale: { include: { items: { include: { product: true, returns: true } } } },
                items: { include: { product: true } },
            }
        });

        if (!salesReturn) {
            return null;
        }

        const voucher = await this.db.voucher.findFirst({
            where: {
                tenant_id: tenantId,
                source_module: 'sales',
                source_type: 'sale_return',
                source_id: salesReturn.id,
            },
            select: {
                id: true,
                voucher_number: true,
                voucher_type: true,
            },
        });

        return {
            ...salesReturn,
            posting_status: voucher ? 'posted' : 'skipped',
            voucher_id: voucher?.id ?? null,
            voucher_number: voucher?.voucher_number ?? null,
            voucher_type: voucher?.voucher_type ?? null,
        };
    }

    async update(tenantId: string, id: string, dto: UpdateSalesReturnDto) {
        return this.db.$transaction(async (tx) => {
            const existing = await tx.salesReturn.findFirst({
                where: { id, tenant_id: tenantId },
                include: { items: true, sale: { include: { items: { include: { returns: true } } } } },
            });
            if (!existing) throw new BadRequestException('Return not found');

            // Update reason
            const updateData: any = {};
            if (dto.reason !== undefined) updateData.reason = dto.reason;

            // If items are provided, recalculate everything
            if (dto.items && dto.items.length > 0) {
                const warehouseId = await resolveWarehouseId(tx, tenantId, existing.sale.store_id);
                // 1. Reverse old stock increments
                for (const oldItem of existing.items) {
                    await applyInventoryMovement(tx, {
                        tenantId,
                        productId: oldItem.product_id,
                        warehouseId,
                        quantityDelta: -oldItem.quantity,
                        movementType: 'SALES_RETURN_REVERSAL',
                        referenceType: 'SALES_RETURN',
                        referenceId: id,
                    });
                }

                // 2. Reverse old customer total_spent decrement
                if (existing.sale.customer_id) {
                    await tx.customer.update({
                        where: { id: existing.sale.customer_id },
                        data: { total_spent: { increment: Number(existing.total_refund) } },
                    });
                }

                // 3. Validate new items and calculate new total
                let newTotalRefund = 0;
                const newItemData = [];

                for (const newItem of dto.items) {
                    if (newItem.quantity <= 0) continue;

                    const originalSaleItem = existing.sale.items.find(
                        (si: any) => si.id === newItem.saleItemId,
                    );
                    if (!originalSaleItem) {
                        throw new BadRequestException(`Sale item ${newItem.saleItemId} not found.`);
                    }

                    // Check available quantity (excluding THIS return's old items)
                    const otherReturns = originalSaleItem.returns.filter(
                        (r: any) => r.return_id !== id,
                    );
                    const previouslyReturned = otherReturns.reduce(
                        (sum: number, r: any) => sum + r.quantity,
                        0,
                    );
                    const availableToReturn = originalSaleItem.quantity - previouslyReturned;

                    if (newItem.quantity > availableToReturn) {
                        throw new BadRequestException(
                            `Cannot return ${newItem.quantity} of ${originalSaleItem.product_id}. Only ${availableToReturn} available.`,
                        );
                    }

                    const refundAmount = Number(originalSaleItem.price_at_sale) * newItem.quantity;
                    newTotalRefund += refundAmount;

                    newItemData.push({
                        sale_item_id: newItem.saleItemId,
                        product_id: newItem.productId,
                        quantity: newItem.quantity,
                        refund_amount: refundAmount,
                    });

                    await applyInventoryMovement(tx, {
                        tenantId,
                        productId: newItem.productId,
                        warehouseId,
                        quantityDelta: newItem.quantity,
                        movementType: 'SALES_RETURN_EDIT',
                        referenceType: 'SALES_RETURN',
                        referenceId: id,
                    });
                }

                // 5. Delete old items and create new ones
                await tx.salesReturnItem.deleteMany({ where: { return_id: id } });

                updateData.total_refund = newTotalRefund;

                await tx.salesReturn.update({
                    where: { id },
                    data: {
                        ...updateData,
                        items: { create: newItemData },
                    },
                });

                // 6. Re-apply customer total_spent decrement
                if (existing.sale.customer_id) {
                    await tx.customer.update({
                        where: { id: existing.sale.customer_id },
                        data: { total_spent: { decrement: newTotalRefund } },
                    });
                }
            } else {
                // Only updating reason
                await tx.salesReturn.update({
                    where: { id },
                    data: updateData,
                });
            }

            return tx.salesReturn.findFirst({
                where: { id, tenant_id: tenantId },
                include: { sale: true, items: { include: { product: true } } },
            });
        });
    }

    async remove(tenantId: string, id: string) {
        return this.db.$transaction(async (tx) => {
            const ret = await tx.salesReturn.findFirst({
                where: { id, tenant_id: tenantId },
                include: { items: true },
            });
            if (!ret) throw new BadRequestException('Return not found');

            // Reverse stock increments
            const warehouseId = await resolveWarehouseId(tx, tenantId, ret.store_id);
            for (const item of ret.items) {
                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: item.product_id,
                    warehouseId,
                    quantityDelta: -item.quantity,
                    movementType: 'SALES_RETURN_DELETE',
                    referenceType: 'SALES_RETURN',
                    referenceId: id,
                });
            }

            // Delete return items then the return
            await tx.salesReturnItem.deleteMany({ where: { return_id: id } });
            await tx.salesReturn.deleteMany({ where: { id, tenant_id: tenantId } });

            return { deleted: true };
        });
    }
}
