import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { createdAtRange } from '../common/created-range.util';
import { DatabaseService } from '../database/database.service';
import { CreateSalesReturnDto, UpdateSalesReturnDto } from './sales-returns.dto';
import {
    applyInventoryMovement,
    resolveEntryWarehouses,
    reversalWarehouseResolver,
    usableWarehouseIds,
} from '../database/inventory.utils';
import { resolveProductCosts } from '../database/product-cost.utils';
import { autoPostFromRules, voidAutoPostedVoucher, type AutoPostInput, type AutoPostResult } from '../accounting/posting.utils';
import { loadPostingSummaries, loadPostingSummary, NO_POSTING_EVENT } from '../accounting/posting-status.util';
import { allocateTenders, sameTenders } from '../accounting/payment-account.util';
import { classifyPaymentMode } from '../sales/classify-payment-mode';
import { creditDueAmount } from '../customers/customer-credit.utils';
import { findOpenSessionForUser } from '../cashier-sessions/active-session.util';
import { committedReturnQuantity, completedExchangeLinesInclude } from '../sales/open-sale-quantity';
import {
    resolveReturnTenders,
    resolveStoredReturnTenders,
    returnPaymentRow,
    sameReturnPaymentRows,
    type ReturnTender,
} from '../common/return-tenders.util';
import { sameReturnLines } from '../common/return-lines.util';

/** The 400 for refund tenders that add up to more than the goods coming back. */
const REFUND_ABOVE_TOTAL = 'The refund is more than the return total.';
/** The 400 for a partial refund with no customer whose due could take the rest. */
const REFUND_NEEDS_CUSTOMER = "Refund the full amount, or pick the customer's sale";
/** The 400 for an edit that shrinks a return below the refund it already records. */
const STORED_REFUND_ABOVE_TOTAL = 'The refund is more than the new return total — change the refund too.';
/** The 400 for changing the lines or refund of a return external sync wrote. */
const IMPORTED_RETURN = 'This return came from an import — change it in the source system and re-sync.';

/** Below half a paisa two amounts are the same money. */
const EPSILON = 0.005;

/** The refund tenders in the order they were saved, the order they post in. */
const PAYMENTS_IN_ORDER = { orderBy: { created_at: 'asc' } } as const;

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

/** What settling a return reads off the sale it came back from. */
interface ReturnSale {
    store_id: string;
    customer_id: string | null;
    total_amount: unknown;
    amount_paid: unknown;
    /** In `created_at` order: the legacy path refunds the way the sale was first paid. */
    payments?: { payment_method: string }[];
}

/** The return being settled or unwound. */
interface SettledReturn {
    id: string;
    return_number: string;
    store_id: string;
    /** The total as stored. The legacy path posts this, as it always has. */
    total_refund: unknown;
    /** Already set when the return was saved, or last edited, with tenders. */
    tenders_recorded?: boolean;
}

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
                      include: {
                          items: { include: { returns: true, exchangeLines: completedExchangeLinesInclude } },
                          payments: { orderBy: { created_at: 'asc' } },
                      },
                  })
                : null;

            if (dto.saleId && !sale) throw new BadRequestException('Sale not found');

            const returnNumber = `RET-${Date.now()}`;
            let totalRefund = 0;
            const returnItemData = [];

            // Goods go back where the sale took them from unless the user says
            // otherwise, so a two-warehouse tenant does not have to restate on
            // every return what the sale already recorded. Filtered first: a
            // warehouse closed since the sale is no longer somewhere stock can
            // be booked, and that must not block the refund.
            const inheritable = await usableWarehouseIds(tx, tenantId, dto.storeId, [
                sale?.warehouse_id,
                ...(sale?.items ?? []).map((item: any) => item.warehouse_id),
            ]);
            const inherited = (warehouseId?: string | null) =>
                warehouseId && inheritable.has(warehouseId) ? warehouseId : null;

            const warehouses = await resolveEntryWarehouses(
                tx,
                tenantId,
                dto.storeId,
                dto.warehouseId ?? inherited(sale?.warehouse_id) ?? undefined,
                dto.items.map((item) => item.warehouseId),
            );

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
                        warehouse_id: returnItem.warehouseId ?? null,
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

                // Returns and completed exchanges share one open quantity, so the
                // same unit cannot be refunded and also exchanged.
                const previouslyReturned = committedReturnQuantity(originalItem);
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
                    // A line the user did not steer goes back where the sale
                    // took it from, so the two documents net out per warehouse
                    // rather than only in total.
                    warehouse_id: returnItem.warehouseId ?? inherited(originalItem.warehouse_id),
                    // Goods go back on the shelf at the cost they left at. Using
                    // today's average instead would book a profit or loss on the
                    // return itself, which is not what a refund is.
                    unit_cost_at_return: originalItem.unit_cost_at_sale ?? null,
                });
            }

            // How the refund was paid, when the client says. Resolved at the
            // return's branch — the sale's, which is where the original
            // tenders were offered. Omitted, the refund is guessed from the
            // sale as it always has been.
            const tenders = dto.payments
                ? await resolveReturnTenders(tx, tenantId, sale?.store_id ?? dto.storeId, dto.payments)
                : null;

            // 3. Create the return record first, so movements can reference its
            //    row id (every other caller passes the id, not the RET- string).
            // The drawer this refund comes out of is whichever one the person
            // handing the money back has open — not the shift that made the
            // original sale, which may be weeks ago and somebody else's.
            const session = await findOpenSessionForUser(tx, tenantId, userId);

            const salesReturn = await tx.salesReturn.create({
                data: {
                    tenant_id: tenantId,
                    store_id: dto.storeId,
                    sale_id: sale?.id ?? null,
                    session_id: session?.id ?? null,
                    return_number: returnNumber,
                    total_refund: totalRefund,
                    reason: dto.reason,
                    created_by: userId,
                    warehouse_id: warehouses.entryWarehouseId,
                    ...(tenders && { tenders_recorded: true }),
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
                    warehouseId: warehouses.warehouseIdFor(item.warehouse_id),
                    quantityDelta: item.quantity,
                    movementType: 'SALES_RETURN',
                    referenceType: 'SALES_RETURN',
                    referenceId: salesReturn.id,
                });
            }

            // 5. What the customer has spent falls by the goods coming back. A
            //    statistic, not the ledger: a new return moves it by its whole
            //    total and an edit by the difference (see update), since
            //    nothing records whether an existing return — an imported one,
            //    say — ever moved it.
            if (sale?.customer_id) {
                await tx.customer.update({
                    where: { id: sale.customer_id },
                    data: { total_spent: { decrement: totalRefund } },
                });
            }

            const posting = await this.settleSalesReturn(tx, tenantId, userId, salesReturn, {
                total: totalRefund,
                tenders,
                sale,
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
        opts?: { createdFrom?: string; createdTo?: string; timezone: string; storeId?: string },
    ): Promise<PaginatedResult<unknown>> {
        const created = createdAtRange(opts?.createdFrom, opts?.createdTo, opts?.timezone);
        const result = await paginatedFindMany({
            findMany: (args) =>
                this.db.salesReturn.findMany({
                    ...(args as object),
                    include: { sale: true, items: { include: { product: true } }, payments: PAYMENTS_IN_ORDER },
                }),
            count: (args) => this.db.salesReturn.count(args as any),
            where: { tenant_id: tenantId, ...(opts?.storeId ? { store_id: opts.storeId } : {}), ...(created ? { created_at: created } : {}) },
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
                sale: { include: { items: { include: { product: true, returns: true, exchangeLines: completedExchangeLinesInclude } } } },
                items: { include: { product: true } },
                payments: PAYMENTS_IN_ORDER,
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

    async update(tenantId: string, id: string, dto: UpdateSalesReturnDto, userId?: string) {
        return this.db.$transaction(async (tx) => {
            const existing = await tx.salesReturn.findFirst({
                where: { id, tenant_id: tenantId },
                include: {
                    items: true,
                    payments: PAYMENTS_IN_ORDER,
                    sale: {
                        include: {
                            items: { include: { returns: true, exchangeLines: completedExchangeLinesInclude } },
                            // The legacy path refunds the way the sale was first paid.
                            payments: PAYMENTS_IN_ORDER,
                        },
                    },
                },
            });
            if (!existing) throw new BadRequestException('Return not found');

            // Update reason
            const updateData: any = {};
            if (dto.reason !== undefined) updateData.reason = dto.reason;

            // The edit screen sends every line back on each save. Lines that
            // are the ones already stored are no line edit at all, and are
            // treated exactly as if none had been sent — decided before the
            // import guard, the unchanged-tenders check and the unwind.
            const lineEdit = dto.items?.length && !this.keepsLines(existing, dto) ? dto.items : null;
            const itemsChanged = lineEdit !== null;

            // A reason-only edit leaves the stock, the due and the vouchers alone.
            if (!itemsChanged && !dto.payments) {
                await tx.salesReturn.update({
                    where: { id },
                    data: updateData,
                });
                return this.findEdited(tx, tenantId, id);
            }

            // An import booked this return its own way — the whole total off
            // the due, any cash handed back as a separate customer payment —
            // which unwinding and settling it here would double. Checked
            // before anything is written.
            if (await this.isImportedReturn(tx, tenantId, id)) {
                throw new BadRequestException(IMPORTED_RETURN);
            }

            // The return's own branch. Tenders it already carries are exempt
            // from the branch check and keep the account they were saved with.
            const requested = dto.payments
                ? await resolveReturnTenders(tx, tenantId, existing.store_id, dto.payments, existing.payments)
                : null;

            // The refund it already records, sent back with the same lines:
            // nothing for the books to do. Resolved against each other, as a
            // sale edit compares its tenders. Only a return saved with tenders
            // qualifies — one saved before them has no rows, which is not the
            // same as refunding nothing.
            if (requested && !itemsChanged && existing.tenders_recorded) {
                const stored = await resolveStoredReturnTenders(tx, tenantId, existing.store_id, existing.payments);
                if (sameTenders(requested, stored)) {
                    // A cheque number or date corrected, or the order changed:
                    // the rows follow, the vouchers and the due do not.
                    if (!sameReturnPaymentRows(existing.payments, requested)) {
                        await tx.salesReturnPayment.deleteMany({ where: { return_id: id } });
                        await tx.salesReturnPayment.createMany({
                            data: requested.map((tender) => returnPaymentRow(id, tender)),
                        });
                    }
                    await tx.salesReturn.update({
                        where: { id },
                        data: updateData,
                    });
                    return this.findEdited(tx, tenantId, id);
                }
            }

            // Take back everything the return did to the books, then settle it
            // afresh below as if it had been entered this way.
            await this.unwindSalesReturn(tx, tenantId, existing, userId);
            let total = Number(existing.total_refund);

            // If the lines changed, recalculate everything
            if (lineEdit) {
                // A parentless return has no sale to take the store from.
                const storeId = existing.sale?.store_id ?? existing.store_id;
                const warehouses = await resolveEntryWarehouses(
                    tx,
                    tenantId,
                    storeId,
                    dto.warehouseId ?? existing.warehouse_id ?? undefined,
                    lineEdit.map((item) => item.warehouseId),
                );
                updateData.warehouse_id = warehouses.entryWarehouseId;

                // 1. Reverse old stock increments — out of the warehouse each
                //    line was actually put into, which the edited return may
                //    well be moving away from.
                const reversalWarehouseId = reversalWarehouseResolver(
                    tx,
                    tenantId,
                    storeId,
                    existing.warehouse_id,
                );
                for (const oldItem of existing.items) {
                    await applyInventoryMovement(tx, {
                        tenantId,
                        productId: oldItem.product_id,
                        warehouseId: await reversalWarehouseId(oldItem.warehouse_id),
                        quantityDelta: -oldItem.quantity,
                        movementType: 'SALES_RETURN_REVERSAL',
                        referenceType: 'SALES_RETURN',
                        referenceId: id,
                    });
                }

                // 2. total_spent moves by the difference once the new total
                //    is known, below.

                // 3. Validate new items and calculate new total
                let newTotalRefund = 0;
                const newItemData = [];

                // Only consulted for parentless lines; a line tied to a sale
                // takes its cost from that sale, not from today's pool.
                const editCosts = await resolveProductCosts(tx, {
                    tenantId,
                    storeId: existing.sale?.store_id ?? existing.store_id,
                    productIds: lineEdit.map((item) => item.productId).filter((pid): pid is string => Boolean(pid)),
                });

                for (const newItem of lineEdit) {
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
                            warehouse_id: newItem.warehouseId ?? null,
                        });
                        continue;
                    }

                    const originalSaleItem = existing.sale.items.find(
                        (si: any) => si.id === newItem.saleItemId,
                    );
                    if (!originalSaleItem) {
                        throw new BadRequestException(`Sale item ${newItem.saleItemId} not found.`);
                    }

                    // This return's own lines are about to be replaced, so they
                    // do not count. Completed exchanges do: that quantity is gone.
                    const otherReturns = (originalSaleItem.returns ?? []).filter(
                        (r: any) => r.return_id !== id,
                    );
                    const exchanged = (originalSaleItem.exchangeLines ?? []).reduce(
                        (sum: number, row: { returned_quantity: number }) => sum + row.returned_quantity,
                        0,
                    );
                    const previouslyReturned = otherReturns.reduce(
                        (sum: number, r: any) => sum + r.quantity,
                        0,
                    ) + exchanged;
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
                        warehouse_id: newItem.warehouseId ?? null,
                    });

                    await applyInventoryMovement(tx, {
                        tenantId,
                        productId: newItem.productId,
                        warehouseId: warehouses.warehouseIdFor(newItem.warehouseId),
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

                total = newTotalRefund;

                // 6. Only the difference: whether this return lowered
                //    total_spent when it was saved is not recorded (an imported
                //    one never did), so it is never restored and taken again.
                const totalSpentDelta = round2(newTotalRefund - Number(existing.total_refund));
                if (existing.sale?.customer_id && Math.abs(totalSpentDelta) > EPSILON) {
                    await tx.customer.update({
                        where: { id: existing.sale.customer_id },
                        data: { total_spent: { decrement: totalSpentDelta } },
                    });
                }
            } else {
                // New tenders on the same goods.
                await tx.salesReturn.update({
                    where: { id },
                    data: updateData,
                });
            }

            let tenders: ReturnTender[] | null;
            if (requested) {
                tenders = requested;
            } else if (existing.tenders_recorded) {
                // New lines, same refund: the tenders stay as they were, and
                // whatever they no longer cover comes off the due.
                const stored = existing.payments.reduce((sum, row) => sum + Number(row.amount), 0);
                if (stored - total > EPSILON) throw new BadRequestException(STORED_REFUND_ABOVE_TOTAL);
                tenders = await resolveStoredReturnTenders(tx, tenantId, existing.store_id, existing.payments);
            } else {
                // Saved before tenders existed: settled the way it was then.
                tenders = null;
            }

            await this.settleSalesReturn(
                tx,
                tenantId,
                userId,
                { ...existing, total_refund: total },
                // The return's own date, so the edit reposts in the period
                // the return was entered in rather than today's.
                { total, tenders, sale: existing.sale, date: existing.created_at },
            );

            return this.findEdited(tx, tenantId, id);
        });
    }

    async remove(tenantId: string, id: string, userId?: string) {
        return this.db.$transaction(async (tx) => {
            const ret = await tx.salesReturn.findFirst({
                where: { id, tenant_id: tenantId },
                include: { items: true },
            });
            if (!ret) throw new BadRequestException('Return not found');

            // Vouchers and due first: a return in a closed period is refused
            // here, before any stock moves. total_spent is left as it is, as
            // it always has been on a delete.
            await this.unwindSalesReturn(tx, tenantId, ret, userId);

            // Reverse stock increments, out of the warehouse each line was put
            // into rather than wherever the default points today.
            const reversalWarehouseId = reversalWarehouseResolver(
                tx,
                tenantId,
                ret.store_id,
                ret.warehouse_id,
            );
            for (const item of ret.items) {
                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: item.product_id,
                    warehouseId: await reversalWarehouseId(item.warehouse_id),
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

    /** The return as an edit answers with it. */
    private findEdited(tx: Prisma.TransactionClient, tenantId: string, id: string) {
        return tx.salesReturn.findFirst({
            where: { id, tenant_id: tenantId },
            include: { sale: true, items: { include: { product: true } }, payments: PAYMENTS_IN_ORDER },
        });
    }

    /**
     * Whether an edit's lines are the ones the return already holds (see
     * `sameReturnLines`). Matched as the edit matches them: by sale line, or
     * by product on a return with no sale, where the sent price counts too.
     * Lines of no quantity are dropped by the edit, so they are not lines
     * here either; a new return warehouse is a change of its own.
     */
    private keepsLines(
        existing: {
            warehouse_id: string | null;
            sale: unknown;
            items: { sale_item_id: string | null; product_id: string; quantity: number; warehouse_id: string | null; refund_amount: unknown }[];
        },
        dto: UpdateSalesReturnDto,
    ): boolean {
        if (dto.warehouseId !== undefined && dto.warehouseId !== existing.warehouse_id) return false;
        const standalone = !existing.sale;
        return sameReturnLines(
            existing.items.map((item) => ({
                key: standalone ? item.product_id : item.sale_item_id,
                productId: item.product_id,
                quantity: item.quantity,
                warehouseId: item.warehouse_id,
                amount: Number(item.refund_amount),
            })),
            (dto.items ?? [])
                .filter((item) => item.quantity > 0)
                .map((item) => ({
                    key: standalone ? item.productId : item.saleItemId,
                    productId: item.productId,
                    quantity: item.quantity,
                    warehouseId: item.warehouseId,
                    amount: standalone && item.unitPrice != null ? item.unitPrice * item.quantity : undefined,
                })),
            existing.warehouse_id,
        );
    }

    /**
     * Whether external sync wrote this return. Either marker settles it,
     * because each alone has a gap:
     *
     * - a `SALE_RETURN` mapping row pointing at it — the importer writes one
     *   for every return it creates, but mappings cascade away when the
     *   connection is deleted while the imported documents stay;
     * - a posting event for it from `external-sync` — written in the same
     *   transaction as the return whenever the import books its impacts, and
     *   never removed, but absent when impacts are off.
     */
    private async isImportedReturn(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<boolean> {
        const mapping = await tx.externalSyncMapping.findFirst({
            where: { tenant_id: tenantId, entity_type: 'SALE_RETURN', internal_id: id },
            select: { id: true },
        });
        if (mapping) return true;
        const event = await tx.postingEvent.findFirst({
            where: { tenant_id: tenantId, source_module: 'external-sync', source_type: 'sale_return', source_id: id },
            select: { id: true },
        });
        return Boolean(event);
    }

    /**
     * What a return does to its customer and the ledger once its lines are
     * saved. Shared by create and by an edit (after `unwindSalesReturn`), so an
     * edited return settles exactly as if it had been entered that way.
     *
     * - `tenders === null` — the client sent no payments, or an edit of a
     *   return saved before tenders existed: the refund is guessed from the sale,
     *   exactly as it always has been (`settleGuessedRefund`).
     * - With tenders, `refunded` is what they add up to and `adjusted`, the rest
     *   of the total, comes off the sale customer's due — not clamped to it, so
     *   any excess becomes an advance. The posting mirrors
     *   `SalesService.postSaleVouchers`: with `adjusted` the primary voucher is
     *   the AR credit for it (party-tagged) and the refund posts on
     *   `legKey 'paid'`, a credit line per tender account; a full refund is one
     *   keyless voucher.
     *
     * `total_spent` is not touched here: create lowers it by the total and an
     * edit by the difference.
     *
     * Returns the primary posting.
     */
    private async settleSalesReturn(
        tx: Prisma.TransactionClient,
        tenantId: string,
        userId: string | undefined,
        ret: SettledReturn,
        input: { total: number; tenders: ReturnTender[] | null; sale: ReturnSale | null; date?: Date },
    ): Promise<AutoPostResult> {
        const { tenders, sale, date } = input;
        if (tenders === null) return this.settleGuessedRefund(tx, tenantId, userId, ret, input);

        const total = round2(input.total);
        const refunded = round2(tenders.reduce((sum, tender) => sum + tender.amount, 0));
        if (refunded - total > EPSILON) throw new BadRequestException(REFUND_ABOVE_TOTAL);
        const adjusted = round2(total - refunded);
        const customerId = sale?.customer_id ?? null;
        // With no customer there is no due for the rest to come off.
        if (adjusted > EPSILON && !customerId) throw new BadRequestException(REFUND_NEEDS_CUSTOMER);

        if (customerId && adjusted > EPSILON) {
            const customer = await tx.customer.findUnique({
                where: { id: customerId },
                select: { due_balance: true, store_id: true },
            });
            const balanceAfter = round2(Number(customer?.due_balance ?? 0) - adjusted);
            await tx.customerCreditTransaction.create({
                data: {
                    tenant_id: tenantId,
                    customer_id: customerId,
                    store_id: customer!.store_id,
                    type: 'ADJUSTMENT',
                    amount: -adjusted,
                    balance_after: balanceAfter,
                    reference_type: 'SALES_RETURN',
                    reference_id: ret.id,
                    notes: `Return ${ret.return_number} adjusted against due`,
                    created_by: userId,
                },
            });
            await tx.customer.update({
                where: { id: customerId },
                data: { due_balance: balanceAfter },
            });
        }

        // The drawer counts the cash ones; a return recorded with none (all
        // against the due) counts nothing, unlike one saved before tenders.
        if (tenders.length) {
            await tx.salesReturnPayment.createMany({
                data: tenders.map((tender) => returnPaymentRow(ret.id, tender)),
            });
        }
        if (!ret.tenders_recorded) {
            await tx.salesReturn.update({
                where: { id: ret.id },
                data: { tenders_recorded: true },
            });
        }

        const posting = {
            tx,
            tenantId,
            eventType: 'sale_return',
            conditionKey: 'payment_mode',
            sourceModule: 'sales',
            sourceType: 'sale_return',
            sourceId: ret.id,
            referenceNumber: ret.return_number,
            storeId: sale?.store_id ?? ret.store_id,
            ...(date && { date }),
        } satisfies Partial<AutoPostInput>;

        if (adjusted > EPSILON) {
            // Dr Sales Revenue / Cr Accounts Receivable for what came off the due.
            const primary = await autoPostFromRules({
                ...posting,
                conditionValue: 'credit',
                amount: adjusted,
                description: `Auto-posted sales return ${ret.return_number} — adjusted against due`,
                partyType: 'CUSTOMER',
                partyId: customerId!,
            });
            if (refunded > EPSILON) {
                // Dr Sales Revenue / Cr each tender's account. The 'paid' leg
                // key keeps it off the primary voucher's idempotency key.
                const { lines } = allocateTenders(tenders, refunded);
                await autoPostFromRules({
                    ...posting,
                    conditionValue: lines[0]?.mode ?? 'cash',
                    legKey: 'paid',
                    amount: refunded,
                    description: `Auto-posted refund — sales return ${ret.return_number}`,
                    tenderLegs: { side: 'credit', lines },
                });
            }
            return primary;
        }

        const { lines } = allocateTenders(tenders, total);
        return autoPostFromRules({
            ...posting,
            conditionValue: lines[0]?.mode ?? 'cash',
            amount: total,
            description: `Auto-posted sales return ${ret.return_number}`,
            tenderLegs: { side: 'credit', lines },
            // No control account on either side, so this tags nothing — kept
            // as the guessed path has always passed it.
            partyType: 'CUSTOMER',
            partyId: customerId ?? undefined,
        });
    }

    /**
     * The refund as it was settled before tenders existed, unchanged: guessed
     * from the sale, with the credit part clamped to the customer's due.
     */
    private async settleGuessedRefund(
        tx: Prisma.TransactionClient,
        tenantId: string,
        userId: string | undefined,
        ret: SettledReturn,
        input: { total: number; sale: ReturnSale | null; date?: Date },
    ): Promise<AutoPostResult> {
        const { total: totalRefund, sale, date } = input;

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

        // For a credit sale, reduce what the customer still owes and record a
        // matching credit-ledger entry, so a returned credit sale no longer
        // leaves them owing for the goods. (total_spent is the caller's: see
        // create and update.)
        if (sale?.customer_id && returnPaymentMode === 'credit') {
            const customer = await tx.customer.findUnique({
                where: { id: sale.customer_id },
                select: { due_balance: true, store_id: true },
            });
            const currentDue = Number(customer?.due_balance ?? 0);
            const creditReduction = Math.min(totalRefund, currentDue);
            if (creditReduction > 0.005) {
                const balanceAfter = currentDue - creditReduction;
                await tx.customerCreditTransaction.create({
                    data: {
                        tenant_id: tenantId,
                        customer_id: sale.customer_id,
                        store_id: customer!.store_id,
                        type: 'ADJUSTMENT',
                        amount: -creditReduction,
                        balance_after: balanceAfter,
                        reference_type: 'SALES_RETURN',
                        reference_id: ret.id,
                        notes: `Credit sale return ${ret.return_number}`,
                        created_by: userId,
                    },
                });
                await tx.customer.update({
                    where: { id: sale.customer_id },
                    data: { due_balance: balanceAfter },
                });
            }
        }

        return autoPostFromRules({
            tx,
            tenantId,
            eventType: 'sale_return',
            conditionKey: 'payment_mode',
            conditionValue: returnPaymentMode,
            sourceModule: 'sales',
            sourceType: 'sale_return',
            sourceId: ret.id,
            amount: Number(ret.total_refund),
            description: `Auto-posted sales return ${ret.return_number}`,
            referenceNumber: ret.return_number,
            storeId: sale?.store_id ?? ret.store_id,
            // Only the credit return touches AR; a cash return's legs are not
            // control accounts, so this tags nothing and is a safe no-op there.
            partyType: 'CUSTOMER',
            partyId: sale?.customer_id ?? undefined,
            ...(date && { date }),
        });
    }

    /**
     * Takes back what a return did to the books, before an edit re-settles it
     * or a delete removes it. It reads what was written, not what would be
     * posted now, so a return saved before refund tenders existed unwinds just
     * the same:
     *
     * - its vouchers, the primary and the `'paid'` refund leg — voiding applies
     *   the fiscal-period lock, so a return in a closed month stops here;
     * - its net on each customer's ledger (every row referencing it), reversed
     *   by an opposite ADJUSTMENT that references it too, so the rows always
     *   net to what the return currently holds;
     * - its tender rows.
     *
     * Not `total_spent`: nothing records whether the return lowered it (an
     * imported one never did), so an edit moves it by the difference and a
     * delete leaves it alone.
     */
    private async unwindSalesReturn(
        tx: Prisma.TransactionClient,
        tenantId: string,
        ret: { id: string; return_number: string },
        userId?: string,
    ): Promise<void> {
        await voidAutoPostedVoucher(tx, tenantId, 'sale_return', ret.id);
        await voidAutoPostedVoucher(tx, tenantId, 'sale_return', ret.id, 'paid');

        const rows = await tx.customerCreditTransaction.findMany({
            where: { tenant_id: tenantId, reference_type: 'SALES_RETURN', reference_id: ret.id },
            select: { customer_id: true, amount: true },
        });
        const netByCustomer = new Map<string, number>();
        for (const row of rows) {
            netByCustomer.set(row.customer_id, (netByCustomer.get(row.customer_id) ?? 0) + Number(row.amount));
        }
        for (const [customerId, sum] of netByCustomer) {
            const net = round2(sum);
            if (Math.abs(net) <= EPSILON) continue;
            const customer = await tx.customer.findUnique({
                where: { id: customerId },
                select: { due_balance: true, store_id: true },
            });
            if (!customer) continue;
            const balanceAfter = round2(Number(customer.due_balance) - net);
            await tx.customerCreditTransaction.create({
                data: {
                    tenant_id: tenantId,
                    customer_id: customerId,
                    store_id: customer.store_id,
                    type: 'ADJUSTMENT',
                    amount: -net,
                    balance_after: balanceAfter,
                    reference_type: 'SALES_RETURN',
                    reference_id: ret.id,
                    notes: `Reversed return ${ret.return_number}`,
                    created_by: userId,
                },
            });
            await tx.customer.update({
                where: { id: customerId },
                data: { due_balance: balanceAfter },
            });
        }

        await tx.salesReturnPayment.deleteMany({ where: { return_id: ret.id } });
    }
}
