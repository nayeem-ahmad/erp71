import { Injectable, BadRequestException } from '@nestjs/common';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { createdAtRange } from '../common/created-range.util';
import { DatabaseService } from '../database/database.service';
import { CreateSalesReturnDto, UpdateSalesReturnDto } from './sales-returns.dto';
import { applyInventoryMovement, resolveWarehouseId } from '../database/inventory.utils';
import { resolveProductCosts } from '../database/product-cost.utils';
import { autoPostFromRules } from '../accounting/posting.utils';
import { loadPostingSummaries, loadPostingSummary, NO_POSTING_EVENT } from '../accounting/posting-status.util';
import { classifyPaymentMode } from '../sales/classify-payment-mode';
import { creditDueAmount } from '../customers/customer-credit.utils';

@Injectable()
export class SalesReturnsService {
    constructor(private db: DatabaseService) {}

    async create(tenantId: string, userId: string, dto: CreateSalesReturnDto) {
        return this.db.$transaction(async (tx) => {
            // 1. The sale is optional. Goods can come back that were sold
            //    before the business moved onto this system, and refusing those
            //    leaves them unrecordable. When a sale IS named it is fetched
            //    and every line checked against it.
            const sale = dto.saleId
                ? await tx.sale.findUnique({
                      where: { id: dto.saleId, tenant_id: tenantId },
                      include: { items: { include: { returns: true } }, payments: { orderBy: { created_at: 'asc' } } },
                  })
                : null;

            if (dto.saleId && !sale) throw new BadRequestException('Sale not found');

            const returnNumber = `RET-${Date.now()}`;
            let totalRefund = 0;
            const returnItemData = [];
            const warehouseId = await resolveWarehouseId(tx, tenantId, dto.storeId);

            // Lines with no parent sale carry no cost of their own, so they fall
            // back to the pool. Resolved in one query up front rather than per
            // line inside the loop below.
            const standaloneCosts = await resolveProductCosts(tx, {
                tenantId,
                storeId: dto.storeId,
                productIds: dto.items.map((item) => item.productId).filter((id): id is string => Boolean(id)),
            });

            // 2. Validate items and calculate total refund
            for (const returnItem of dto.items) {
                if (returnItem.quantity <= 0) {
                    throw new BadRequestException('Return quantity must be greater than zero.');
                }

                if (!sale) {
                    // No parent to price or bound the line, so the caller must
                    // say what came back and what it is worth.
                    if (!returnItem.productId) {
                        throw new BadRequestException('productId is required on each line when no sale is given.');
                    }
                    if (returnItem.unitPrice == null || returnItem.unitPrice < 0) {
                        throw new BadRequestException('unitPrice is required on each line when no sale is given.');
                    }

                    const product = await tx.product.findFirst({
                        where: { id: returnItem.productId, tenant_id: tenantId },
                        select: { id: true },
                    });
                    if (!product) throw new BadRequestException(`Product ${returnItem.productId} not found.`);

                    const refundAmount = returnItem.unitPrice * returnItem.quantity;
                    totalRefund += refundAmount;
                    returnItemData.push({
                        sale_item_id: null,
                        product_id: product.id,
                        quantity: returnItem.quantity,
                        refund_amount: refundAmount,
                        // No parent sale to take a cost from, so the pool's
                        // current average is the best available answer for what
                        // these goods cost.
                        unit_cost_at_return: standaloneCosts.get(product.id) ?? null,
                    });
                    continue;
                }

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

                // Priced from the sale, so a return can never refund more per
                // unit than was charged — which is why unitPrice is ignored here.
                const refundAmount = Number(originalItem.price_at_sale) * returnItem.quantity;
                totalRefund += refundAmount;

                returnItemData.push({
                    sale_item_id: originalItem.id,
                    product_id: originalItem.product_id,
                    quantity: returnItem.quantity,
                    refund_amount: refundAmount,
                    // Goods go back on the shelf at the cost they left at. Using
                    // today's average instead would book a profit or loss on the
                    // return itself, which is not what a refund is.
                    unit_cost_at_return: originalItem.unit_cost_at_sale ?? null,
                });
            }

            // 3. Create the return record first, so movements can reference its
            //    row id (every other caller passes the id, not the RET- string).
            const salesReturn = await tx.salesReturn.create({
                data: {
                    tenant_id: tenantId,
                    store_id: dto.storeId,
                    sale_id: sale?.id ?? null,
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

            // 4. Restock the returned goods, keyed to the return row.
            for (const item of returnItemData) {
                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: item.product_id,
                    warehouseId,
                    quantityDelta: item.quantity,
                    movementType: 'SALES_RETURN',
                    referenceType: 'SALES_RETURN',
                    referenceId: salesReturn.id,
                });
            }

            // Refund the way the customer paid. An unpaid balance was a receivable,
            // so its return credits AR rather than handing back cash.
            //
            // With no sale there is nothing to mirror: no customer, no payment
            // history, no receivable. Such a return settles in cash, which is
            // the only defensible default when the original tender is unknown.
            const balanceDue = sale ? creditDueAmount(Number(sale.total_amount), Number(sale.amount_paid)) : 0;
            const returnPaymentMode = !sale
                ? 'cash'
                : balanceDue > 0.005
                    ? 'credit'
                    : classifyPaymentMode(sale.payments?.[0]?.payment_method ?? 'cash');

            // 5. If the sale had a customer, keep their balances consistent:
            //    reduce total_spent, and — for a credit sale — reduce what they
            //    still owe and record a matching credit-ledger entry, so a
            //    returned credit sale no longer leaves them owing for the goods.
            if (sale?.customer_id) {
                await tx.customer.update({
                    where: { id: sale.customer_id },
                    data: { total_spent: { decrement: totalRefund } },
                });

                if (returnPaymentMode === 'credit') {
                    const customer = await tx.customer.findUnique({
                        where: { id: sale.customer_id },
                        select: { due_balance: true },
                    });
                    const currentDue = Number(customer?.due_balance ?? 0);
                    const creditReduction = Math.min(totalRefund, currentDue);
                    if (creditReduction > 0.005) {
                        const balanceAfter = currentDue - creditReduction;
                        await tx.customerCreditTransaction.create({
                            data: {
                                tenant_id: tenantId,
                                customer_id: sale.customer_id,
                                type: 'ADJUSTMENT',
                                amount: -creditReduction,
                                balance_after: balanceAfter,
                                reference_type: 'SALES_RETURN',
                                reference_id: salesReturn.id,
                                notes: `Credit sale return ${returnNumber}`,
                                created_by: userId,
                            },
                        });
                        await tx.customer.update({
                            where: { id: sale.customer_id },
                            data: { due_balance: balanceAfter },
                        });
                    }
                }
            }

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
                storeId: sale?.store_id ?? dto.storeId,
                // Only the credit return touches AR; a cash return's legs are not
                // control accounts, so this tags nothing and is a safe no-op there.
                partyType: 'CUSTOMER',
                partyId: sale?.customer_id ?? undefined,
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

    async findAll(
        tenantId: string,
        page = 1,
        limit = 20,
        opts?: { createdFrom?: string; createdTo?: string; timezone: string },
    ): Promise<PaginatedResult<unknown>> {
        const created = createdAtRange(opts?.createdFrom, opts?.createdTo, opts?.timezone);
        const result = await paginatedFindMany({
            findMany: (args) =>
                this.db.salesReturn.findMany({
                    ...(args as object),
                    include: { sale: true, items: { include: { product: true } } },
                }),
            count: (args) => this.db.salesReturn.count(args as any),
            where: { tenant_id: tenantId, ...(created ? { created_at: created } : {}) },
            orderBy: { created_at: 'desc' },
            page,
            limit,
        });

        const summaries = await loadPostingSummaries(
            this.db,
            tenantId,
            'sales',
            'sale_return',
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

        return {
            ...salesReturn,
            ...(await loadPostingSummary(this.db, tenantId, 'sales', 'sale_return', salesReturn.id)),
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
                // A parentless return has no sale to take the store from.
                const warehouseId = await resolveWarehouseId(tx, tenantId, existing.sale?.store_id ?? existing.store_id);
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
                if (existing.sale?.customer_id) {
                    await tx.customer.update({
                        where: { id: existing.sale.customer_id },
                        data: { total_spent: { increment: Number(existing.total_refund) } },
                    });
                }

                // 3. Validate new items and calculate new total
                let newTotalRefund = 0;
                const newItemData = [];

                // Only consulted for parentless lines; a line tied to a sale
                // takes its cost from that sale, not from today's pool.
                const editCosts = await resolveProductCosts(tx, {
                    tenantId,
                    storeId: existing.sale?.store_id ?? existing.store_id,
                    productIds: dto.items.map((item) => item.productId).filter((pid): pid is string => Boolean(pid)),
                });

                for (const newItem of dto.items) {
                    if (newItem.quantity <= 0) continue;

                    // A return recorded without a sale keeps its lines
                    // self-describing on update too: nothing bounds or prices
                    // them, so the caller supplies product and value.
                    if (!existing.sale) {
                        if (!newItem.productId) {
                            throw new BadRequestException('productId is required on each line when the return has no sale.');
                        }
                        const unitPrice = (newItem as any).unitPrice;
                        if (unitPrice == null || unitPrice < 0) {
                            throw new BadRequestException('unitPrice is required on each line when the return has no sale.');
                        }
                        const refundAmount = unitPrice * newItem.quantity;
                        newTotalRefund += refundAmount;
                        newItemData.push({
                            sale_item_id: null,
                            product_id: newItem.productId,
                            quantity: newItem.quantity,
                            refund_amount: refundAmount,
                            unit_cost_at_return: editCosts.get(newItem.productId) ?? null,
                        });
                        continue;
                    }

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
                        // Same rule as the create path: the cost the goods left
                        // the sale at, not today's average.
                        unit_cost_at_return: originalSaleItem.unit_cost_at_sale ?? null,
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
                if (existing.sale?.customer_id) {
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
