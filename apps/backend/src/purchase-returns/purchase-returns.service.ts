import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { createdAtRange } from '../common/created-range.util';
import { DatabaseService } from '../database/database.service';
import { CreatePurchaseReturnDto, UpdatePurchaseReturnDto } from './purchase-return.dto';
import {
    applyInventoryMovement,
    resolveEntryWarehouses,
    reversalWarehouseResolver,
    usableWarehouseIds,
} from '../database/inventory.utils';
import { autoPostFromRules, voidAutoPostedVoucher, type AutoPostInput, type AutoPostResult } from '../accounting/posting.utils';
import { loadPostingSummaries, loadPostingSummary, NO_POSTING_EVENT } from '../accounting/posting-status.util';
import {
    allocateTenders,
    resolveTenders,
    sameTenders,
    storedToTenderInputs,
    type ResolvedTender,
    type StoredTender,
} from '../accounting/payment-account.util';
import { paymentInstrumentData, type PaymentInstrumentColumns } from '../common/payment-instrument.util';
import type { ReturnPaymentDto } from '../common/return-payment.dto';

/** The 400 for money received that adds up to more than the goods going back. */
const RECEIVED_ABOVE_TOTAL = 'The amount received is more than the return total.';
/** The 400 for a part-received return with no supplier whose payable could take the rest. */
const RECEIVED_NEEDS_SUPPLIER = "Record the full amount received, or pick the supplier's purchase";
/** The 400 for an edit that shrinks a return below the money it already records. */
const STORED_RECEIVED_ABOVE_TOTAL = 'The amount received is more than the new return total — change it too.';
/** The 400 for changing the lines or money received of a return external sync wrote. */
const IMPORTED_RETURN = 'This return came from an import — change it in the source system and re-sync.';

/** Below half a paisa two amounts are the same money. */
const EPSILON = 0.005;

/** The tenders received in the order they were saved, the order they post in. */
const PAYMENTS_IN_ORDER = { orderBy: { created_at: 'asc' } } as const;

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

/** A tender received back, as resolved, with the instrument details its row stores. */
type ReceivedTender = ResolvedTender & { instrument: PaymentInstrumentColumns };

/** A `PurchaseReturnPayment` row, as an edit reads it back. */
type StoredReceivedRow = StoredTender & PaymentInstrumentColumns;

/** The `PurchaseReturnPayment` row a resolved tender is saved as. */
function receivedPaymentRow(returnId: string, tender: ReceivedTender) {
    return {
        return_id: returnId,
        payment_method: tender.paymentMethod,
        payment_method_id: tender.methodId,
        payment_method_name: tender.methodName,
        account_id: tender.accountId,
        amount: tender.amount,
        ...tender.instrument,
    };
}

/**
 * Whether the saved rows already say exactly what `tenders` would write, in
 * the same order — method, amount and every instrument detail. Used once the
 * tenders are known to be the same money, to tell a cheque number corrected
 * from nothing changed at all.
 */
function sameReceivedRows(rows: StoredReceivedRow[], tenders: ReceivedTender[]): boolean {
    const time = (date: Date | null) => date?.getTime() ?? null;
    return rows.length === tenders.length && rows.every((row, index) => {
        const tender = tenders[index];
        return row.payment_method === tender.paymentMethod
            && row.payment_method_id === tender.methodId
            && Math.abs(Number(row.amount) - tender.amount) <= EPSILON
            && row.bank_name === tender.instrument.bank_name
            && row.bank_branch === tender.instrument.bank_branch
            && row.bank_account_number === tender.instrument.bank_account_number
            && row.reference_no === tender.instrument.reference_no
            && time(row.instrument_date) === time(tender.instrument.instrument_date);
    });
}

/** What settling a return reads off the purchase the goods go back against. */
interface ReturnPurchase {
    store_id: string;
    supplier_id: string | null;
    /** The supplier's due as the legacy path clamps to it; read after any unwind. */
    supplier?: { due_balance: unknown; store_id: string } | null;
}

/** The return being settled. */
interface SettledReturn {
    id: string;
    return_number: string;
    store_id: string;
    /** Set when the purchase named one; an import may set it without a purchase. */
    supplier_id: string | null;
    /** The total as stored. The legacy path posts this, as it always has. */
    total_amount: unknown;
    /** Already set when the return was saved, or last edited, with tenders. */
    tenders_recorded?: boolean;
}

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

            const storeId = purchase?.store_id ?? dto.storeId;

            // Goods go back out of the warehouse the purchase put them in
            // unless the user says otherwise. Filtered first, so a warehouse
            // closed since the purchase falls through to the default rather
            // than blocking the return.
            const inheritable = await usableWarehouseIds(tx, tenantId, storeId, [
                purchase?.warehouse_id,
                ...(purchase?.items ?? []).map((item: { warehouse_id?: string | null }) => item.warehouse_id),
            ]);
            const inherited = (warehouseId?: string | null) =>
                warehouseId && inheritable.has(warehouseId) ? warehouseId : null;

            const returnItemData = purchase
                ? this.buildReturnItemData(purchase.items, dto.items, undefined, inherited)
                : await this.buildStandaloneReturnItemData(tx, tenantId, dto.items);
            const totalAmount = returnItemData.reduce((sum, item) => sum + item.line_total, 0);

            // The money the supplier handed back, when the client says.
            // Resolved at the purchase's branch, where its tenders are offered.
            // Omitted, the whole return comes off the payable as it always has.
            const tenders = dto.payments
                ? await this.receivedTenders(tx, tenantId, storeId, dto.payments)
                : null;

            const count = await tx.purchaseReturn.count({ where: { tenant_id: tenantId } });
            const returnNumber = `PRET-${String(count + 1).padStart(5, '0')}`;
            const warehouses = await resolveEntryWarehouses(
                tx,
                tenantId,
                storeId,
                dto.warehouseId ?? inherited(purchase?.warehouse_id) ?? undefined,
                returnItemData.map((item) => item.warehouse_id),
            );

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
                    warehouse_id: warehouses.entryWarehouseId,
                    ...(tenders && { tenders_recorded: true }),
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
                    warehouseId: warehouses.warehouseIdFor(item.warehouse_id),
                    quantityDelta: -item.quantity,
                    movementType: 'PURCHASE_RETURN',
                    referenceType: 'PURCHASE_RETURN',
                    referenceId: purchaseReturn.id,
                    unitCost: item.unit_cost,
                });
            }

            const posting = await this.settlePurchaseReturn(tx, tenantId, userId, purchaseReturn, {
                total: totalAmount,
                tenders,
                purchase,
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
        opts?: { createdFrom?: string; createdTo?: string; timezone: string; storeId?: string },
    ): Promise<PaginatedResult<unknown>> {
        const created = createdAtRange(opts?.createdFrom, opts?.createdTo, opts?.timezone);
        const result = await paginatedFindMany({
            findMany: (args) =>
                this.db.purchaseReturn.findMany({
                    ...(args as object),
                    include: this.returnInclude(),
                }),
            count: (args) => this.db.purchaseReturn.count(args as any),
            where: { tenant_id: tenantId, ...(opts?.storeId ? { store_id: opts.storeId } : {}), ...(created ? { created_at: created } : {}) },
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

    async update(tenantId: string, id: string, dto: UpdatePurchaseReturnDto, userId?: string) {
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
                    payments: PAYMENTS_IN_ORDER,
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

            // A notes-only edit leaves the stock, the due and the vouchers alone.
            if (!dto.items && !dto.payments) {
                await tx.purchaseReturn.update({
                    where: { id },
                    data: updateData,
                });
                return this.findEdited(tx, tenantId, id);
            }

            // An import booked this return its own way — the whole total off
            // the payable, unclamped — which unwinding and settling it here
            // would rewrite. Checked before anything is written.
            if (await this.isImportedReturn(tx, tenantId, id)) {
                throw new BadRequestException(IMPORTED_RETURN);
            }

            // The return's own branch. Tenders it already carries are exempt
            // from the branch check and keep the account they were saved with.
            const requested = dto.payments
                ? await this.receivedTenders(tx, tenantId, existingReturn.store_id, dto.payments, existingReturn.payments)
                : null;

            // The money it already records, sent back with the same lines:
            // nothing for the books to do. Resolved against each other, as a
            // sale edit compares its tenders. Only a return saved with tenders
            // qualifies — one saved before them has no rows, which is not the
            // same as nothing received.
            if (requested && !dto.items && existingReturn.tenders_recorded) {
                const stored = await this.storedReceivedTenders(tx, tenantId, existingReturn.store_id, existingReturn.payments);
                if (sameTenders(requested, stored)) {
                    // A cheque number or date corrected, or the order changed:
                    // the rows follow, the vouchers and the due do not.
                    if (!sameReceivedRows(existingReturn.payments, requested)) {
                        await tx.purchaseReturnPayment.deleteMany({ where: { return_id: id } });
                        await tx.purchaseReturnPayment.createMany({
                            data: requested.map((tender) => receivedPaymentRow(id, tender)),
                        });
                    }
                    await tx.purchaseReturn.update({
                        where: { id },
                        data: updateData,
                    });
                    return this.findEdited(tx, tenantId, id);
                }
            }

            // Take back everything the return did to the books, then settle it
            // afresh below as if it had been entered this way.
            await this.unwindPurchaseReturn(tx, tenantId, existingReturn, userId);
            let total = Number(existingReturn.total_amount);

            if (dto.items) {
                // A parentless return has no purchase to take the store from.
                const storeId = existingReturn.purchase?.store_id ?? existingReturn.store_id;

                const inheritable = await usableWarehouseIds(tx, tenantId, storeId, [
                    existingReturn.purchase?.warehouse_id,
                    ...(existingReturn.purchase?.items ?? []).map(
                        (item: { warehouse_id?: string | null }) => item.warehouse_id,
                    ),
                ]);
                const inherited = (warehouseId?: string | null) =>
                    warehouseId && inheritable.has(warehouseId) ? warehouseId : null;

                const newItems = existingReturn.purchase
                    ? this.buildReturnItemData(existingReturn.purchase.items, dto.items, id, inherited)
                    : await this.buildStandaloneReturnItemData(tx, tenantId, dto.items);

                const warehouses = await resolveEntryWarehouses(
                    tx,
                    tenantId,
                    storeId,
                    dto.warehouseId ?? existingReturn.warehouse_id ?? undefined,
                    newItems.map((item) => item.warehouse_id),
                );
                updateData.warehouse_id = warehouses.entryWarehouseId;

                // Put the old quantities back where they were taken from, which
                // the edited return may be moving away from.
                const reversalWarehouseId = reversalWarehouseResolver(
                    tx,
                    tenantId,
                    storeId,
                    existingReturn.warehouse_id,
                );
                for (const oldItem of existingReturn.items) {
                    await applyInventoryMovement(tx, {
                        tenantId,
                        productId: oldItem.product_id,
                        warehouseId: await reversalWarehouseId(oldItem.warehouse_id),
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

                total = newItems.reduce((sum, item) => sum + item.line_total, 0);
                updateData.total_amount = total;

                for (const item of newItems) {
                    await applyInventoryMovement(tx, {
                        tenantId,
                        productId: item.product_id,
                        warehouseId: warehouses.warehouseIdFor(item.warehouse_id),
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

            let tenders: ReceivedTender[] | null;
            if (requested) {
                tenders = requested;
            } else if (existingReturn.tenders_recorded) {
                // New lines, same money back: the tenders stay as they were,
                // and whatever they no longer cover comes off the payable.
                const stored = existingReturn.payments.reduce((sum, row) => sum + Number(row.amount), 0);
                if (stored - total > EPSILON) throw new BadRequestException(STORED_RECEIVED_ABOVE_TOTAL);
                tenders = await this.storedReceivedTenders(tx, tenantId, existingReturn.store_id, existingReturn.payments);
            } else {
                // Saved before tenders existed: settled the way it was then.
                tenders = null;
            }

            const purchase = existingReturn.purchase && {
                store_id: existingReturn.purchase.store_id,
                supplier_id: existingReturn.purchase.supplier_id,
                // The legacy path clamps to the supplier's due, which the
                // unwind above may just have moved, so it is read now.
                supplier: tenders === null && existingReturn.purchase.supplier_id
                    ? await tx.supplier.findUnique({
                          where: { id: existingReturn.purchase.supplier_id },
                          select: { due_balance: true, store_id: true },
                      })
                    : null,
            };

            await this.settlePurchaseReturn(
                tx,
                tenantId,
                userId,
                { ...existingReturn, total_amount: total },
                // The return's own date, so the edit reposts in the period
                // the return was entered in rather than today's.
                { total, tenders, purchase, date: existingReturn.created_at },
            );

            return this.findEdited(tx, tenantId, id);
        });
    }

    async remove(tenantId: string, id: string, userId?: string) {
        return this.db.$transaction(async (tx) => {
            const existingReturn = await tx.purchaseReturn.findFirst({
                where: { id, tenant_id: tenantId },
                include: { items: true },
            });

            if (!existingReturn) {
                throw new NotFoundException('Purchase return not found');
            }

            // Vouchers and due first: a return in a closed period is refused
            // here, before any stock moves.
            await this.unwindPurchaseReturn(tx, tenantId, existingReturn, userId);

            const reversalWarehouseId = reversalWarehouseResolver(
                tx,
                tenantId,
                existingReturn.store_id,
                existingReturn.warehouse_id,
            );
            for (const item of existingReturn.items) {
                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: item.product_id,
                    warehouseId: await reversalWarehouseId(item.warehouse_id),
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

    /** The return as an edit answers with it. */
    private findEdited(tx: Prisma.TransactionClient, tenantId: string, id: string) {
        return tx.purchaseReturn.findFirst({
            where: { id, tenant_id: tenantId },
            include: this.returnInclude(true),
        });
    }

    /**
     * Whether external sync wrote this return. Either marker settles it,
     * because each alone has a gap:
     *
     * - a `PURCHASE_RETURN` mapping row pointing at it — the importer writes
     *   one for every return it creates, but mappings cascade away when the
     *   connection is deleted while the imported documents stay;
     * - a posting event for it from `external-sync` — written in the same
     *   transaction as the return whenever the import books its impacts, and
     *   never removed, but absent when impacts are off.
     */
    private async isImportedReturn(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<boolean> {
        const mapping = await tx.externalSyncMapping.findFirst({
            where: { tenant_id: tenantId, entity_type: 'PURCHASE_RETURN', internal_id: id },
            select: { id: true },
        });
        if (mapping) return true;
        const event = await tx.postingEvent.findFirst({
            where: { tenant_id: tenantId, source_module: 'external-sync', source_type: 'purchase_return', source_id: id },
            select: { id: true },
        });
        return Boolean(event);
    }

    /**
     * The client's tenders received, resolved at `storeId` (see
     * `resolveTenders`): each one's method, name, linked account and posting
     * mode. `stored` is the return's saved tenders on an edit, so the ones it
     * already carries keep what they were saved with.
     */
    private async receivedTenders(
        tx: Prisma.TransactionClient,
        tenantId: string,
        storeId: string,
        payments: ReturnPaymentDto[],
        stored: StoredTender[] = [],
    ): Promise<ReceivedTender[]> {
        const resolved = await resolveTenders(
            tx,
            tenantId,
            storeId,
            payments.map((payment) => ({
                paymentMethod: payment.paymentMethod,
                paymentMethodId: payment.paymentMethodId,
                amount: payment.amount,
            })),
            stored,
        );
        return resolved.map((tender, index) => ({ ...tender, instrument: paymentInstrumentData(payments[index]) }));
    }

    /**
     * A return's saved tenders, for an edit that sent none: each keeps its
     * method, name, account and instrument details.
     */
    private async storedReceivedTenders(
        tx: Prisma.TransactionClient,
        tenantId: string,
        storeId: string,
        rows: StoredReceivedRow[],
    ): Promise<ReceivedTender[]> {
        const resolved = await resolveTenders(tx, tenantId, storeId, storedToTenderInputs(rows), rows);
        return resolved.map((tender, index) => ({
            ...tender,
            instrument: {
                bank_name: rows[index].bank_name,
                bank_branch: rows[index].bank_branch,
                bank_account_number: rows[index].bank_account_number,
                reference_no: rows[index].reference_no,
                instrument_date: rows[index].instrument_date,
            },
        }));
    }

    /**
     * What a return does to its supplier and the ledger once its lines are
     * saved. Shared by create and by an edit (after `unwindPurchaseReturn`), so
     * an edited return settles exactly as if it had been entered that way.
     *
     * - `tenders === null` — the client sent no payments, or an edit of a
     *   return saved before tenders existed: settled exactly as it always has
     *   been (`settleUnrecordedReturn`).
     * - With tenders, `received` is what they add up to and the rest of the
     *   total comes off the supplier's due — the purchase's supplier, else the
     *   return's — not clamped to it, so any excess becomes an advance with the
     *   supplier. The bill posts as it always has (Dr Purchase Payable / Cr
     *   Purchases for the whole return); the money back posts on
     *   `legKey 'received'` under `supplier_payment` / `receive` (Dr each
     *   tender's account / Cr Purchase Payable), the purchase entry's paid leg
     *   turned round. Between them the payable falls by what the due does.
     *
     * Returns the bill's posting.
     */
    private async settlePurchaseReturn(
        tx: Prisma.TransactionClient,
        tenantId: string,
        userId: string | undefined,
        ret: SettledReturn,
        input: { total: number; tenders: ReceivedTender[] | null; purchase: ReturnPurchase | null; date?: Date },
    ): Promise<AutoPostResult> {
        const { tenders, purchase, date } = input;
        if (tenders === null) return this.settleUnrecordedReturn(tx, tenantId, userId, ret, input);

        const total = round2(input.total);
        const received = round2(tenders.reduce((sum, tender) => sum + tender.amount, 0));
        if (received - total > EPSILON) throw new BadRequestException(RECEIVED_ABOVE_TOTAL);
        const adjusted = round2(total - received);
        const supplierId = purchase?.supplier_id ?? ret.supplier_id ?? null;
        // With no supplier there is no payable for the rest to come off.
        if (adjusted > EPSILON && !supplierId) throw new BadRequestException(RECEIVED_NEEDS_SUPPLIER);

        if (supplierId && adjusted > EPSILON) {
            const supplier = await tx.supplier.findUnique({
                where: { id: supplierId },
                select: { due_balance: true, store_id: true },
            });
            const balanceAfter = round2(Number(supplier?.due_balance ?? 0) - adjusted);
            await tx.supplierCreditTransaction.create({
                data: {
                    tenant_id: tenantId,
                    supplier_id: supplierId,
                    // A credit row belongs to its supplier's branch.
                    store_id: supplier!.store_id,
                    type: 'ADJUSTMENT',
                    amount: -adjusted,
                    balance_after: balanceAfter,
                    reference_type: 'PURCHASE_RETURN',
                    reference_id: ret.id,
                    notes: `Purchase return ${ret.return_number} adjusted against payable`,
                    created_by: userId,
                },
            });
            await tx.supplier.update({
                where: { id: supplierId },
                data: { due_balance: balanceAfter },
            });
        }

        if (tenders.length) {
            await tx.purchaseReturnPayment.createMany({
                data: tenders.map((tender) => receivedPaymentRow(ret.id, tender)),
            });
        }
        if (!ret.tenders_recorded) {
            await tx.purchaseReturn.update({
                where: { id: ret.id },
                data: { tenders_recorded: true },
            });
        }

        const posting = {
            tx,
            tenantId,
            sourceModule: 'purchases',
            sourceType: 'purchase_return',
            sourceId: ret.id,
            referenceNumber: ret.return_number,
            storeId: purchase?.store_id ?? ret.store_id,
            partyType: 'SUPPLIER' as const,
            partyId: supplierId ?? undefined,
            ...(date && { date }),
        } satisfies Partial<AutoPostInput>;

        // Dr Purchase Payable / Cr Purchases for the whole return.
        const bill = await autoPostFromRules({
            ...posting,
            eventType: 'purchase_return',
            conditionKey: 'none',
            conditionValue: null,
            amount: total,
            description: `Auto-posted purchase return ${ret.return_number}`,
        });
        if (received > EPSILON) {
            // Dr each tender's account / Cr Purchase Payable for the money
            // back. An unlinked tender falls back to the receive rule's Cash in
            // Hand. The 'received' leg key keeps it off any other voucher's
            // idempotency key.
            await autoPostFromRules({
                ...posting,
                eventType: 'supplier_payment',
                conditionKey: 'payment_direction',
                conditionValue: 'receive',
                legKey: 'received',
                amount: received,
                description: `Auto-posted money received — purchase return ${ret.return_number}`,
                tenderLegs: { side: 'debit', lines: allocateTenders(tenders, received).lines },
            });
        }
        return bill;
    }

    /**
     * The return as it was settled before tenders existed, unchanged: the
     * purchase's supplier's due comes down by the return, never below zero,
     * and the bill posts the whole total.
     */
    private async settleUnrecordedReturn(
        tx: Prisma.TransactionClient,
        tenantId: string,
        userId: string | undefined,
        ret: SettledReturn,
        input: { total: number; purchase: ReturnPurchase | null; date?: Date },
    ): Promise<AutoPostResult> {
        const { total: totalAmount, purchase, date } = input;

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
                        // A credit row belongs to its supplier's branch.
                        store_id: purchase.supplier!.store_id,
                        type: 'ADJUSTMENT',
                        amount: -creditReduction,
                        balance_after: balanceAfter,
                        reference_type: 'PURCHASE_RETURN',
                        reference_id: ret.id,
                        notes: `Purchase return ${ret.return_number}`,
                        created_by: userId,
                    },
                });
                await tx.supplier.update({
                    where: { id: purchase.supplier_id },
                    data: { due_balance: balanceAfter },
                });
            }
        }

        return autoPostFromRules({
            tx,
            tenantId,
            eventType: 'purchase_return',
            conditionKey: 'none',
            conditionValue: null,
            sourceModule: 'purchases',
            sourceType: 'purchase_return',
            sourceId: ret.id,
            amount: Number(ret.total_amount),
            description: `Auto-posted purchase return ${ret.return_number}`,
            referenceNumber: ret.return_number,
            storeId: purchase?.store_id ?? ret.store_id,
            partyType: 'SUPPLIER',
            partyId: purchase?.supplier_id ?? undefined,
            ...(date && { date }),
        });
    }

    /**
     * Takes back what a return did to the books, before an edit re-settles it
     * or a delete removes it. It reads what was written, not what would be
     * posted now, so a return saved before tenders existed — or imported —
     * unwinds just the same:
     *
     * - its vouchers, the bill and the `'received'` money leg — voiding
     *   applies the fiscal-period lock, so a return in a closed month stops
     *   here;
     * - its net on each supplier's ledger (every row referencing it), reversed
     *   by an opposite ADJUSTMENT that references it too, so the rows always
     *   net to what the return currently holds;
     * - its tender rows.
     */
    private async unwindPurchaseReturn(
        tx: Prisma.TransactionClient,
        tenantId: string,
        ret: { id: string; return_number: string },
        userId?: string,
    ): Promise<void> {
        await voidAutoPostedVoucher(tx, tenantId, 'purchase_return', ret.id);
        await voidAutoPostedVoucher(tx, tenantId, 'supplier_payment', ret.id, 'received');

        const rows = await tx.supplierCreditTransaction.findMany({
            where: { tenant_id: tenantId, reference_type: 'PURCHASE_RETURN', reference_id: ret.id },
            select: { supplier_id: true, amount: true },
        });
        const netBySupplier = new Map<string, number>();
        for (const row of rows) {
            netBySupplier.set(row.supplier_id, (netBySupplier.get(row.supplier_id) ?? 0) + Number(row.amount));
        }
        for (const [supplierId, sum] of netBySupplier) {
            const net = round2(sum);
            if (Math.abs(net) <= EPSILON) continue;
            const supplier = await tx.supplier.findUnique({
                where: { id: supplierId },
                select: { due_balance: true, store_id: true },
            });
            if (!supplier) continue;
            const balanceAfter = round2(Number(supplier.due_balance) - net);
            await tx.supplierCreditTransaction.create({
                data: {
                    tenant_id: tenantId,
                    supplier_id: supplierId,
                    store_id: supplier.store_id,
                    type: 'ADJUSTMENT',
                    amount: -net,
                    balance_after: balanceAfter,
                    reference_type: 'PURCHASE_RETURN',
                    reference_id: ret.id,
                    notes: `Reversed purchase return ${ret.return_number}`,
                    created_by: userId,
                },
            });
            await tx.supplier.update({
                where: { id: supplierId },
                data: { due_balance: balanceAfter },
            });
        }

        await tx.purchaseReturnPayment.deleteMany({ where: { return_id: ret.id } });
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
        items: Array<{ productId?: string; quantity: number; unitCost?: number; warehouseId?: string }>,
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
                warehouse_id: item.warehouseId ?? null,
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
            warehouse_id?: string | null;
            returnItems?: Array<{ quantity: number; return_id: string }>;
        }>,
        items: Array<{ purchaseItemId?: string; quantity: number; warehouseId?: string }>,
        currentReturnId?: string,
        /**
         * Maps the purchase line's warehouse onto one the return may still use,
         * so a line nobody steered goes back out of where it came in. Returns
         * null where that warehouse is no longer usable, and the line then
         * follows the return's own.
         */
        inheritWarehouseId: (warehouseId?: string | null) => string | null = () => null,
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
                warehouse_id: item.warehouseId ?? inheritWarehouseId(purchaseItem.warehouse_id),
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
            payments: PAYMENTS_IN_ORDER,
        };
    }
}