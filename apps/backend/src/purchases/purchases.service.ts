import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { createdAtRange } from '../common/created-range.util';
import { zonedDayRange } from '../common/tenant-time.util';
import { resolveOrderBy, type SortableMap } from '../common/sort.util';
import { DatabaseService } from '../database/database.service';
import { CreatePurchaseDto, CreatePurchasePaymentDto, PurchaseBillDto, UpdatePurchaseDto } from './purchase.dto';
import { applyInventoryMovement, resolveEntryWarehouses } from '../database/inventory.utils';
import { costBehaviourFor } from '../database/product-cost.utils';
import { allocateLandedCost } from '../database/landed-cost.utils';
import { autoPostFromRules, postingIdempotencyKey, voidAutoPostedVoucher } from '../accounting/posting.utils';
import { loadPostingSummaries, loadPostingSummary, NO_POSTING_EVENT } from '../accounting/posting-status.util';
import { resolveInlineSupplier } from '../suppliers/resolve-inline-supplier.util';
import { nextSupplierPaymentNumber } from '../suppliers/supplier-payment-number.util';
import { allocateTenders, resolveTenders, sameTenders, storedToTenderInputs, type ResolvedTender } from '../accounting/payment-account.util';
import { paymentInstrumentData } from '../common/payment-instrument.util';
import { purchasePaymentStatus } from './purchase-status';
import { loadPreparerNames, preparerOf } from '../sales/sale-preparer.util';

const PURCHASE_SORTABLE: SortableMap = {
    purchase_number: (dir) => ({ purchase_number: dir }),
    created_at: (dir) => ({ created_at: dir }),
    purchase_date: (dir) => ({ purchase_date: dir }),
    total_amount: (dir) => ({ total_amount: dir }),
};
const PURCHASE_DEFAULT_ORDER = { created_at: 'desc' as const };

const EPSILON = 0.005;

/** What the supplier's statement calls a tender: the method's own name. */
const tenderLabel = (tender: ResolvedTender) => tender.methodName ?? tender.paymentMethod;

/**
 * One row of a `PurchasePayment` as the tender it stands for. The method id,
 * name and account are the server's resolution (`resolveTenders`), never the
 * client's `accountId`.
 */
function purchasePaymentData(
    purchaseId: string,
    payment: CreatePurchasePaymentDto,
    tender: ResolvedTender,
) {
    return {
        purchase_id: purchaseId,
        payment_method: payment.paymentMethod,
        payment_method_id: tender.methodId,
        payment_method_name: tender.methodName,
        account_id: tender.accountId,
        amount: payment.amount,
        ...paymentInstrumentData(payment),
    };
}

/** What an allocation against a bill is read with, to tell the entry's own payment from later ones. */
const ALLOCATION_SELECT = {
    id: true,
    amount: true,
    transaction: {
        select: { id: true, type: true, amount: true, payment_number: true, reference_type: true, reference_id: true },
    },
} as const;

type BillAllocation = {
    id: string;
    amount: Prisma.Decimal | number;
    transaction: { id: string; type: string; amount: Prisma.Decimal | number; payment_number: string | null; reference_type: string | null; reference_id: string | null };
};

/**
 * The bill's own time. Omitted, that is the moment it is posted — not the
 * minute the screen was opened. A value that is not a date is refused rather
 * than stored as Invalid Date.
 */
function resolvePurchaseDate(raw?: string): Date {
    if (!raw) return new Date();
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
        throw new BadRequestException('Transaction date is not a valid date.');
    }
    return date;
}

/** A payment row the entry screen itself wrote for this bill — stamped with its id. */
function isEntryPayment(allocation: BillAllocation, purchaseId: string) {
    return allocation.transaction.type === 'PAYMENT'
        && allocation.transaction.reference_type === 'PURCHASE'
        && allocation.transaction.reference_id === purchaseId;
}

/**
 * The payment recorded with the bill, while it is still intact: one allocation,
 * to this bill, for the payment's whole amount. Anything else — a second
 * payment allocated here, or this one part-moved onto another bill from the
 * supplier-payments screen — was a separate decision about where that money
 * went, and neither cancelling nor editing the bill may second-guess it.
 */
function intactEntryAllocation(allocations: BillAllocation[], purchaseId: string) {
    return allocations.find((allocation) => isEntryPayment(allocation, purchaseId)
        && Math.abs(Number(allocation.amount) - Number(allocation.transaction.amount)) <= EPSILON);
}

/** How a supplier ledger row moves what is owed — the rule `SuppliersService` keeps. */
function supplierDueDelta(type: string, amount: number) {
    return type === 'PAYMENT' ? -amount : amount;
}

/** Goods a bill has put on the shelf, as the movements against it say. */
type Receipt = {
    productId: string;
    warehouseId: string;
    quantity: number;
    /** The landed cost the receipt carried; for an uncosted one, informational only. */
    unitCost: number | null;
    /** Whether it moved the weighted average (a REVALUE receipt) or only the quantity. */
    costed: boolean;
};

function receiptKey(receipt: Pick<Receipt, 'productId' | 'warehouseId' | 'unitCost' | 'costed'>) {
    // An uncosted receipt never touched the pool and is reversed at whatever
    // the pool stamps, so only its quantity has to pair up.
    return receipt.costed
        ? `${receipt.productId}|${receipt.warehouseId}|${(receipt.unitCost ?? 0).toFixed(2)}|costed`
        : `${receipt.productId}|${receipt.warehouseId}|uncosted`;
}

/**
 * What this bill still holds in stock: every receipt against it, less every
 * reversal an earlier edit wrote. Read back from the movements rather than
 * recomputed from the lines — `PurchaseItem.unit_cost` is the supplier's
 * price, the movement carries the *landed* figure `allocateLandedCost`
 * produced at the time, and recomputing it would silently disagree the moment
 * the allocation rules change.
 *
 * Not filtered to `PURCHASE_RECEIPT`: an externally-synced purchase writes
 * `PURCHASE` (see external-sync.impacts.ts), and pinning the type would leave
 * an imported bill's stock standing after it was cancelled.
 */
async function liveReceipts(tx: Prisma.TransactionClient, tenantId: string, purchaseId: string): Promise<Receipt[]> {
    const movements = await tx.inventoryMovement.findMany({
        where: { tenant_id: tenantId, reference_type: 'PURCHASE', reference_id: purchaseId },
        select: { product_id: true, warehouse_id: true, quantity_delta: true, unit_cost: true, movement_type: true },
    });

    const live = new Map<string, Receipt>();
    for (const movement of movements) {
        const behaviour = costBehaviourFor(movement.movement_type);
        const costed = movement.quantity_delta > 0 ? behaviour === 'REVALUE' : behaviour === 'REVERSE_RECEIPT';
        const unitCost = movement.unit_cost === null ? null : Number(movement.unit_cost);
        const key = receiptKey({ productId: movement.product_id, warehouseId: movement.warehouse_id, unitCost, costed });
        const receipt = live.get(key) ?? {
            productId: movement.product_id,
            warehouseId: movement.warehouse_id,
            quantity: 0,
            unitCost: movement.quantity_delta > 0 ? unitCost : null,
            costed,
        };
        receipt.quantity += movement.quantity_delta;
        if (receipt.unitCost === null && movement.quantity_delta > 0) receipt.unitCost = unitCost;
        live.set(key, receipt);
    }

    return [...live.values()].filter((receipt) => receipt.quantity > 0);
}

function sameReceipts(a: Receipt[], b: Receipt[]) {
    const tally = (receipts: Receipt[]) => {
        const totals = new Map<string, number>();
        for (const receipt of receipts) totals.set(receiptKey(receipt), (totals.get(receiptKey(receipt)) ?? 0) + receipt.quantity);
        return totals;
    };
    const left = tally(a);
    const right = tally(b);
    return left.size === right.size && [...left].every(([key, quantity]) => right.get(key) === quantity);
}

/** The date a posted voucher carries, so a re-post lands in the same period. */
async function postedVoucherDate(
    tx: Prisma.TransactionClient,
    tenantId: string,
    eventType: 'purchase' | 'supplier_payment',
    sourceId: string,
    legKey?: string,
) {
    const event = await tx.postingEvent.findUnique({
        where: {
            tenant_id_idempotency_key: {
                tenant_id: tenantId,
                idempotency_key: postingIdempotencyKey(tenantId, eventType, sourceId, legKey),
            },
        },
        select: { voucher: { select: { date: true } } },
    });
    return event?.voucher?.date ?? null;
}

@Injectable()
export class PurchasesService {
    constructor(private db: DatabaseService) {}

    async create(tenantId: string, userId: string, dto: CreatePurchaseDto) {
        const store = await this.db.store.findFirst({
            where: { id: dto.storeId, tenant_id: tenantId },
        });

        if (!store) {
            throw new NotFoundException('Store not found');
        }

        const { subtotal, taxAmount, discountAmount, freightAmount, totalAmount, payments, paidAmount } =
            await this.billFigures(tenantId, dto);

        return this.db.$transaction(async (tx) => {
            const warehouses = await resolveEntryWarehouses(
                tx,
                tenantId,
                store.id,
                dto.warehouseId,
                dto.items.map((item) => item.warehouseId),
                'purchase',
            );
            // Each tender's method, name and linked account, checked against
            // the bill's own branch before anything is written.
            const tenders = await resolveTenders(tx, tenantId, dto.storeId, payments);
            let supplierId = dto.supplierId;

            if (dto.newSupplier) {
                supplierId = await resolveInlineSupplier(tx, tenantId, dto.newSupplier, dto.storeId);
            } else if (supplierId) {
                const supplier = await tx.supplier.findFirst({
                    where: { id: supplierId, tenant_id: tenantId },
                });

                if (!supplier) {
                    throw new BadRequestException('Supplier not found for this tenant.');
                }
            }

            const count = await tx.purchase.count({ where: { tenant_id: tenantId } });
            const purchaseNumber = `PUR-${String(count + 1).padStart(5, '0')}`;
            // `created_at` is left to the database. This is the bill's own time.
            const purchaseDate = resolvePurchaseDate(dto.purchaseDate);

            const purchase = await tx.purchase.create({
                data: {
                    tenant_id: tenantId,
                    store_id: dto.storeId,
                    supplier_id: supplierId,
                    purchase_number: purchaseNumber,
                    subtotal_amount: subtotal,
                    tax_amount: taxAmount,
                    discount_amount: discountAmount,
                    freight_amount: freightAmount,
                    total_amount: totalAmount,
                    // Settled at the counter, so the bill is born part- or
                    // fully-paid instead of waiting for a separate supplier
                    // payment to catch up with it.
                    paid_amount: paidAmount,
                    payment_status: purchasePaymentStatus(paidAmount, totalAmount),
                    notes: dto.notes,
                    created_by: userId,
                    purchase_date: purchaseDate,
                    warehouse_id: warehouses.entryWarehouseId,
                },
            });

            // Freight is a real part of what these goods cost, so it has to
            // reach the weighted-average pool. Before this it was captured on
            // the bill, folded into total_amount, and then dropped: the receipt
            // passed the raw line cost, so avg_cost excluded freight and the
            // gross margin on every later sale of the product was overstated by
            // the freight share — silently, with a correct-looking bill.
            //
            // Allocated pro-rata on line value. `PurchaseItem.unit_cost` keeps
            // the supplier's price, because that is what the bill says and what
            // a purchase report must show; only the inventory movement carries
            // the landed figure.
            //
            // Tax and discount stay out of it deliberately. Bangladeshi VAT on
            // a local purchase is rebatable, so capitalising it would overstate
            // COGS; a trade discount is already reflected in the line prices a
            // supplier bills. Neither is a landed cost.
            const landed = allocateLandedCost({
                lines: dto.items.map((item, index) => ({
                    key: String(index),
                    quantity: item.quantity,
                    baseAmount: item.quantity * item.unitCost,
                })),
                charges: [{ label: 'freight', amount: freightAmount }],
            });

            for (const [index, item] of dto.items.entries()) {
                await tx.purchaseItem.create({
                    data: {
                        purchase_id: purchase.id,
                        product_id: item.productId,
                        quantity: item.quantity,
                        unit_cost: item.unitCost,
                        line_total: item.quantity * item.unitCost,
                        // Only a genuine override is stored; a line with none
                        // follows the bill, so changing the bill's warehouse
                        // does not have to rewrite every line.
                        warehouse_id: item.warehouseId ?? null,
                    },
                });

                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: item.productId,
                    warehouseId: warehouses.warehouseIdFor(item.warehouseId),
                    quantityDelta: item.quantity,
                    movementType: 'PURCHASE_RECEIPT',
                    referenceType: 'PURCHASE',
                    referenceId: purchase.id,
                    unitCost: landed.lines[index].landedUnitCost,
                    occurredAt: purchaseDate,
                });
            }

            // One row per tender, with the cheque, transfer or wallet details
            // typed against it. `paid_amount` above is only the total, and the
            // supplier ledger's PAYMENT line below lumps every method into one,
            // so without these a bill paid half by cheque and half by bKash
            // keeps no trace of either. Written for a supplier-less cash buy
            // too: there is no ledger line at all, and the bill is the only
            // record of what went out.
            if (payments.length > 0) {
                await tx.purchasePayment.createMany({
                    data: payments.map((payment, index) => purchasePaymentData(purchase.id, payment, tenders[index])),
                });
            }

            if (supplierId) {
                const supplier = await tx.supplier.findFirst({
                    where: { id: supplierId, tenant_id: tenantId },
                    select: { due_balance: true, store_id: true },
                });
                let balanceAfter = Number(supplier!.due_balance) + totalAmount;

                await tx.supplierCreditTransaction.create({
                    data: {
                        tenant_id: tenantId,
                        supplier_id: supplierId,
                        // A credit row belongs to its supplier's branch.
                        store_id: supplier!.store_id,
                        type: 'CREDIT_PURCHASE',
                        amount: totalAmount,
                        balance_after: balanceAfter,
                        reference_type: 'PURCHASE',
                        reference_id: purchase.id,
                        created_by: userId,
                        // The statement dates the bill, not the minute it was typed.
                        created_at: purchaseDate,
                    },
                });

                // The bill goes on the account in full first, then what was
                // handed over comes straight back off it. Booking the net
                // instead would be shorter and wrong: the supplier's statement
                // has to show the bill and its payment as two lines, because
                // that is what the supplier's own books show, and a single net
                // line cannot be reconciled against them.
                if (paidAmount > 0.005) {
                    balanceAfter -= paidAmount;

                    const payment = await tx.supplierCreditTransaction.create({
                        data: {
                            tenant_id: tenantId,
                            supplier_id: supplierId,
                            // A credit row belongs to its supplier's branch.
                            store_id: supplier!.store_id,
                            type: 'PAYMENT',
                            amount: paidAmount,
                            balance_after: balanceAfter,
                            // Stamped with the bill it settled so `cancel` can
                            // find its own payment and take it back, and so the
                            // ledger says which purchase the cash was for.
                            reference_type: 'PURCHASE',
                            reference_id: purchase.id,
                            payment_number: await nextSupplierPaymentNumber(tenantId, tx, 'PAYMENT'),
                            notes: `Paid on purchase ${purchase.purchase_number} (${tenders.map(tenderLabel).join(', ')})`,
                            created_by: userId,
                            created_at: purchaseDate,
                        },
                    });

                    // `Purchase.paid_amount` is derived from allocations
                    // everywhere else (see SuppliersService.removeAllocation),
                    // so an entry payment has to leave one behind too — without
                    // it the bill would report itself paid while the payment
                    // still looked unapplied on the supplier-payments screen.
                    await tx.supplierPaymentAllocation.create({
                        data: {
                            tenant_id: tenantId,
                            transaction_id: payment.id,
                            purchase_id: purchase.id,
                            amount: paidAmount,
                        },
                    });
                }

                await tx.supplier.update({
                    where: { id: supplierId },
                    data: { due_balance: balanceAfter },
                });
            }

            const posting = await this.postBillVoucher(tx, tenantId, {
                purchaseId: purchase.id,
                purchaseNumber: purchase.purchase_number,
                amount: Number(purchase.total_amount),
                storeId: dto.storeId,
                supplierId,
                date: purchaseDate,
            });

            if (paidAmount > 0.005) {
                await this.postPaidVoucher(tx, tenantId, {
                    purchaseId: purchase.id,
                    purchaseNumber: purchase.purchase_number,
                    amount: paidAmount,
                    storeId: dto.storeId,
                    supplierId,
                    tenders,
                    date: purchaseDate,
                });
            }

            const purchaseWithItems = await tx.purchase.findFirst({
                where: { id: purchase.id, tenant_id: tenantId },
                include: {
                    supplier: true,
                    items: {
                        include: { product: true, returnItems: true },
                    },
                    payments: true,
                },
            });

            return {
                ...purchaseWithItems,
                posting_status: posting.postingStatus,
                voucher_id: posting.voucherId ?? null,
                voucher_number: posting.voucherNumber ?? null,
                voucher_type: posting.voucherType ?? null,
            };
        });
    }

    /**
     * What a bill adds up to, once its products are known to be this tenant's.
     * Shared by recording and editing, so the two cannot price a bill apart.
     */
    private async billFigures(tenantId: string, dto: PurchaseBillDto) {
        const products = await this.db.product.findMany({
            where: {
                tenant_id: tenantId,
                id: { in: dto.items.map((item) => item.productId) },
            },
        });

        if (products.length !== dto.items.length) {
            throw new BadRequestException('One or more products do not exist for this tenant.');
        }

        const subtotal = dto.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
        const taxAmount = dto.taxAmount ?? 0;
        const discountAmount = dto.discountAmount ?? 0;
        const freightAmount = dto.freightAmount ?? 0;
        const totalAmount = subtotal + taxAmount + freightAmount - discountAmount;

        // A zero row is a payment method the user left blank on the entry form,
        // not a tender: dropping it here keeps it out of the ledger note and out
        // of the "which method paid this?" lookup.
        const payments = (dto.payments ?? []).filter((payment) => payment.amount > 0.005);
        const paidAmount = payments.reduce((sum, payment) => sum + payment.amount, 0);

        if (paidAmount - totalAmount > 0.005) {
            throw new BadRequestException(
                `Payment (${paidAmount.toFixed(2)}) exceeds the purchase total (${totalAmount.toFixed(2)}).`,
            );
        }

        return { products, subtotal, taxAmount, discountAmount, freightAmount, totalAmount, payments, paidAmount };
    }

    /**
     * The bill's own voucher. Still always 'credit', and still not a shortcut:
     * the bill raises the payable in full, exactly as the supplier's invoice
     * does, and anything paid at the counter is a second, separate event that
     * takes the payable back down (`postPaidVoucher`). Keeping the two apart is
     * what lets a part-payment work at all, and it is why purchase/cash and
     * purchase/bank rules still do not exist — they would describe a netting
     * this model does not do.
     */
    private postBillVoucher(
        tx: Prisma.TransactionClient,
        tenantId: string,
        bill: { purchaseId: string; purchaseNumber: string; amount: number; storeId: string; supplierId?: string | null; date?: Date },
    ) {
        return autoPostFromRules({
            tx,
            tenantId,
            eventType: 'purchase',
            conditionKey: 'payment_mode',
            conditionValue: 'credit',
            sourceModule: 'purchases',
            sourceType: 'purchase',
            sourceId: bill.purchaseId,
            amount: bill.amount,
            description: `Auto-posted purchase ${bill.purchaseNumber}`,
            referenceNumber: bill.purchaseNumber,
            storeId: bill.storeId,
            partyType: 'SUPPLIER',
            partyId: bill.supplierId ?? undefined,
            ...(bill.date ? { date: bill.date } : {}),
        });
    }

    /**
     * The cash that actually left the till. Posted through the supplier_payment
     * rule (Dr Purchase Payable / Cr Cash in Hand) rather than a
     * purchase/<mode> rule, because that rule already exists on every tenant
     * and is the only thing that ever debits Purchase Payable — a bill paid at
     * the counter must not be the one kind of payment that leaves the
     * liability standing.
     *
     * `legKey: 'paid'` keeps it off the bill's own idempotency key, so the two
     * vouchers cannot overwrite each other and the purchase stays the primary
     * posting event for status reads.
     *
     * The cash side is one credit line per tender account (`tenderLegs`,
     * money going out, the mirror of a sale's paid leg), so a bill paid half by
     * cash and half by bKash credits Cash in Hand and bKash Account by what
     * each carried. A tender whose method has no linked account falls back to
     * the supplier_payment rule's own Cash in Hand.
     */
    private async postPaidVoucher(
        tx: Prisma.TransactionClient,
        tenantId: string,
        paid: { purchaseId: string; purchaseNumber: string; amount: number; storeId: string; supplierId?: string | null; tenders: ResolvedTender[]; date?: Date },
    ) {
        return autoPostFromRules({
            tx,
            tenantId,
            eventType: 'supplier_payment',
            conditionKey: 'payment_direction',
            conditionValue: 'pay',
            sourceModule: 'purchases',
            sourceType: 'purchase',
            sourceId: paid.purchaseId,
            legKey: 'paid',
            amount: paid.amount,
            description: `Auto-posted paid portion — purchase ${paid.purchaseNumber}`,
            referenceNumber: paid.purchaseNumber,
            storeId: paid.storeId,
            partyType: 'SUPPLIER',
            partyId: paid.supplierId ?? undefined,
            tenderLegs: { side: 'credit', lines: allocateTenders(paid.tenders, paid.amount).lines },
            ...(paid.date ? { date: paid.date } : {}),
        });
    }

    async findAll(
        tenantId: string,
        page = 1,
        limit = 20,
        opts?: {
            createdFrom?: string;
            createdTo?: string;
            dateFrom?: string;
            dateTo?: string;
            timezone: string;
            storeId?: string;
            sortBy?: string;
            sortDir?: string;
        },
    ): Promise<PaginatedResult<unknown>> {
        const created = createdAtRange(opts?.createdFrom, opts?.createdTo, opts?.timezone);
        const transaction = zonedDayRange(opts?.dateFrom, opts?.dateTo, opts?.timezone);
        const result = await paginatedFindMany({
            findMany: (args) =>
                this.db.purchase.findMany({
                    ...(args as object),
                    include: {
                        supplier: true,
                        items: {
                            include: { product: true, returnItems: true },
                        },
                    },
                }),
            count: (args) => this.db.purchase.count(args as any),
            where: {
                tenant_id: tenantId,
                ...(opts?.storeId ? { store_id: opts.storeId } : {}),
                ...(created ? { created_at: created } : {}),
                ...(transaction ? { purchase_date: transaction } : {}),
            },
            orderBy: resolveOrderBy(opts?.sortBy, opts?.sortDir, PURCHASE_SORTABLE, PURCHASE_DEFAULT_ORDER),
            page,
            limit,
        });

        const summaries = await loadPostingSummaries(
            this.db,
            tenantId,
            'purchases',
            'purchase',
            result.items.map((purchase: { id: string }) => purchase.id),
        );

        return {
            ...result,
            items: result.items.map((purchase: Record<string, unknown> & { id: string }) => ({
                ...purchase,
                ...(summaries.get(purchase.id) ?? NO_POSTING_EVENT),
            })),
        };
    }

    /**
     * Cancel a purchase entry: reverse the goods receipt, the supplier payable
     * and the auto-posted voucher, then keep the document with
     * `status: 'CANCELLED'` and the admin's note on it.
     *
     * Cancelling rather than deleting, for the same reason as a sale: the bill
     * number stays put, the reversing stock movements keep something to point
     * at, and "why did our stock drop on the 3rd?" has an answer. Every money
     * query filters `status` (see `purchase-reports`, `purchase-dashboard`,
     * `suppliers`), so a cancelled purchase leaves the figures without being
     * erased from the ledger.
     *
     * Gated on `CANCEL_ENTRY` at the controller, which only OWNER and Tenant
     * Admin hold.
     */
    async cancel(tenantId: string, userId: string, id: string, note: string) {
        return this.db.$transaction(async (tx) => {
            const purchase = await tx.purchase.findFirst({
                where: { id, tenant_id: tenantId },
                include: {
                    items: { select: { id: true, jobCosts: { select: { id: true } } } },
                    returns: { select: { id: true } },
                    paymentAllocations: { select: ALLOCATION_SELECT },
                    importShipment: { select: { id: true } },
                },
            });

            if (!purchase) {
                throw new NotFoundException('Purchase not found');
            }

            if (purchase.status === 'CANCELLED') {
                throw new BadRequestException('This purchase is already cancelled.');
            }

            // Each of these carries impacts of its own that were computed
            // against this bill, so it has to be unwound on its own terms
            // first — exactly the rule the sales side applies to returns,
            // warranty claims and delivery orders.
            if (purchase.returns.length > 0) {
                throw new BadRequestException('This purchase has returns against it — reverse them first.');
            }
            // A bill settled at the counter carries a payment this very entry
            // wrote — stamped `reference_type: 'PURCHASE'` against this id — so
            // cancelling takes that back with it rather than sending the user
            // off to unpick it by hand. Without this, every cash purchase would
            // be uncancellable the moment it was recorded.
            //
            // Only while it is still intact, though (see intactEntryAllocation).
            const entryAllocation = intactEntryAllocation(purchase.paymentAllocations, id);

            if (purchase.paymentAllocations.some((allocation) => allocation.id !== entryAllocation?.id)) {
                throw new BadRequestException('This purchase has supplier payments allocated against it — unallocate or reverse them first.');
            }
            if (purchase.importShipment) {
                throw new BadRequestException('This purchase was raised from an import shipment — cancel it there instead.');
            }
            // A production job that costed one of these bill lines holds the
            // amount, not a live reference to it, so cancelling would leave the
            // job carrying a cost from a bill that no longer exists.
            if (purchase.items.some((item) => item.jobCosts.length > 0)) {
                throw new BadRequestException('Lines from this purchase have been costed into a production job — remove those cost lines first.');
            }

            // Reverse what this bill still holds in stock — after any edits —
            // at the cost each receipt came in at.
            for (const receipt of await liveReceipts(tx, tenantId, id)) {
                // The reversal has to mirror how the goods arrived, or the cost
                // pool ends up richer or poorer than before the bill existed. A
                // REVALUE receipt blended its own cost in, so the reversal must
                // pull that same cost back out (REVERSE_RECEIPT). A
                // QUANTITY_ONLY receipt — an imported `PURCHASE` — never moved
                // the average, so its reversal must not either.
                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: receipt.productId,
                    // The receipt's own warehouse, not today's default: the
                    // tenant may have re-pointed `default_purchase_warehouse_id`
                    // since, and taking the goods out of a warehouse they never
                    // entered would leave both sides wrong.
                    warehouseId: receipt.warehouseId,
                    quantityDelta: -receipt.quantity,
                    movementType: receipt.costed ? 'PURCHASE_CANCELLED' : 'PURCHASE_CANCELLED_UNCOSTED',
                    referenceType: 'PURCHASE',
                    referenceId: id,
                    unitCost: receipt.unitCost ?? undefined,
                });
            }

            // What we owed for these goods, taken back off the payable. Written
            // as a reversing ADJUSTMENT rather than by deleting the
            // CREDIT_PURCHASE row, matching `purchase-returns`: the supplier
            // ledger is a running statement, and a hole in it cannot be
            // reconciled against a supplier's own books.
            if (purchase.supplier_id) {
                const supplier = await tx.supplier.findFirst({
                    where: { id: purchase.supplier_id, tenant_id: tenantId },
                    select: { due_balance: true, store_id: true },
                });
                const currentDue = Number(supplier?.due_balance ?? 0);
                let runningDue = currentDue;

                const reversal = Number(purchase.total_amount);
                if (reversal > 0.005) {
                    runningDue -= reversal;
                    await tx.supplierCreditTransaction.create({
                        data: {
                            tenant_id: tenantId,
                            supplier_id: purchase.supplier_id,
                            // A credit row belongs to its supplier's branch.
                            store_id: supplier!.store_id,
                            type: 'ADJUSTMENT',
                            amount: -reversal,
                            balance_after: runningDue,
                            reference_type: 'PURCHASE',
                            reference_id: id,
                            notes: `Purchase ${purchase.purchase_number} cancelled: ${note}`,
                            created_by: userId,
                        },
                    });
                }

                // And the cash back into the till. Same reasoning as the
                // reversal above — a second line rather than deleting the
                // PAYMENT row, so the statement still shows that money moved
                // and then came back. The two ADJUSTMENTs together undo exactly
                // what `create` did to this supplier's balance: +total, −paid.
                if (entryAllocation) {
                    const refund = Number(entryAllocation.amount);
                    runningDue += refund;
                    await tx.supplierCreditTransaction.create({
                        data: {
                            tenant_id: tenantId,
                            supplier_id: purchase.supplier_id,
                            // A credit row belongs to its supplier's branch.
                            store_id: supplier!.store_id,
                            type: 'ADJUSTMENT',
                            amount: refund,
                            balance_after: runningDue,
                            reference_type: 'PURCHASE',
                            reference_id: id,
                            notes: `Payment ${entryAllocation.transaction.payment_number} on cancelled purchase ${purchase.purchase_number} reversed: ${note}`,
                            created_by: userId,
                        },
                    });
                }

                if (Math.abs(runningDue - currentDue) > 0.005) {
                    await tx.supplier.update({
                        where: { id: purchase.supplier_id },
                        data: { due_balance: runningDue },
                    });
                }
            }

            // The allocation is what `paid_amount` is read back from, so it goes
            // when the payment does; the PAYMENT row itself stays as history,
            // answered by the reversing ADJUSTMENT above.
            if (entryAllocation) {
                await tx.supplierPaymentAllocation.delete({ where: { id: entryAllocation.id } });
            }

            // `create` posts the bill under the 'credit' condition, plus — when
            // it was settled at the counter — a 'paid' leg under
            // supplier_payment, both keyed on this purchase's id.
            await voidAutoPostedVoucher(tx, tenantId, 'purchase', id);

            // The paid leg only comes out when the payment behind it did. A
            // supplier-less cash bill has no ledger row to reverse, so
            // `paid_amount` is the only record that it was paid; where the
            // payment survived this cancel (its allocation had been moved
            // elsewhere, so `entryAllocation` is undefined) the cash really did
            // leave the till and its voucher has to stand — as an advance to
            // the supplier, which is what the reversed payable now shows.
            const reversesPayment = Boolean(entryAllocation)
                || (!purchase.supplier_id && Number(purchase.paid_amount) > 0.005);
            if (reversesPayment) {
                await voidAutoPostedVoucher(tx, tenantId, 'supplier_payment', id, 'paid');
            }

            return tx.purchase.update({
                where: { id },
                data: {
                    status: 'CANCELLED',
                    // Only when the money came back. A payment left standing
                    // (see above) is still allocated to this bill, and
                    // `paid_amount` has to keep agreeing with its allocation.
                    ...(reversesPayment ? { paid_amount: 0, payment_status: 'UNPAID' } : {}),
                    cancelled_at: new Date(),
                    cancelled_by: userId,
                    cancellation_note: note,
                },
                include: {
                    supplier: true,
                    items: { include: { product: true } },
                },
            });
        });
    }

    /**
     * Correct a recorded purchase in place — same number, same branch, same
     * date — and carry the correction through everything the bill touched.
     *
     * The request is the whole bill again, as the entry screen holds it; what
     * changed is worked out here, and only that is re-applied, so saving an
     * unchanged bill writes nothing but the document:
     *
     *  - Stock: the corrected lines are received first and the old receipt is
     *    then taken back out at the cost it came in at — that order, so a bill
     *    whose goods have partly sold does not dip below zero half way through.
     *    Reducing a bill below what is still on the shelf is refused by the
     *    stock guard, which is the honest answer.
     *  - The supplier's account: the change in the bill is one ADJUSTMENT
     *    line, not a rewritten CREDIT_PURCHASE — the ledger is a running
     *    statement, as `cancel` explains. The payment recorded with the bill is
     *    corrected in place, the way the supplier-payments screen edits one.
     *    Payments recorded there later are left exactly where they are.
     *  - The books: whichever voucher no longer matches is voided and posted
     *    again on its original date, so it stays in the period it was in.
     *
     * Refused for the same dependents `cancel` refuses, for the same reasons.
     */
    async update(tenantId: string, userId: string, id: string, dto: UpdatePurchaseDto) {
        const bill = await this.billFigures(tenantId, dto);

        return this.db.$transaction(async (tx) => {
            const purchase = await tx.purchase.findFirst({
                where: { id, tenant_id: tenantId },
                include: {
                    items: { select: { id: true, jobCosts: { select: { id: true } } } },
                    returns: { select: { id: true } },
                    payments: true,
                    paymentAllocations: { select: ALLOCATION_SELECT },
                    importShipment: { select: { id: true } },
                },
            });

            if (!purchase) {
                throw new NotFoundException('Purchase not found');
            }
            // A cancelled bill has had every impact reversed; editing it would
            // replay stock and postings against a void document.
            if (purchase.status === 'CANCELLED') {
                throw new BadRequestException('This purchase is cancelled and can no longer be edited.');
            }
            if (purchase.returns.length > 0) {
                throw new BadRequestException('This purchase has returns against it — reverse them before editing it.');
            }
            if (purchase.importShipment) {
                throw new BadRequestException('This purchase was raised from an import shipment — edit the shipment instead.');
            }
            if (purchase.items.some((item) => item.jobCosts.length > 0)) {
                throw new BadRequestException('Lines from this purchase have been costed into a production job — remove those cost lines before editing it.');
            }

            const purchaseNumber = purchase.purchase_number;
            const oldTotal = Number(purchase.total_amount);
            const oldSupplierId = purchase.supplier_id;

            // What was paid with the bill, told apart from what was paid on it
            // later from the supplier-payments screen.
            const entryAllocation = intactEntryAllocation(purchase.paymentAllocations, id);
            const laterPaid = purchase.paymentAllocations
                .filter((allocation) => allocation.id !== entryAllocation?.id)
                .reduce((sum, allocation) => sum + Number(allocation.amount), 0);
            const oldEntryPaid = entryAllocation
                ? Number(entryAllocation.amount)
                : Math.max(0, Number(purchase.paid_amount) - laterPaid);
            // The entry's own payment, after it was part- or wholly moved to
            // another bill. Where that money went is no longer this bill's call.
            const detachedEntryPayment = !entryAllocation && (
                purchase.paymentAllocations.some((allocation) => isEntryPayment(allocation, id))
                || (oldSupplierId !== null && Boolean(await tx.supplierCreditTransaction.findFirst({
                    where: { tenant_id: tenantId, supplier_id: oldSupplierId, type: 'PAYMENT', reference_type: 'PURCHASE', reference_id: id },
                    select: { id: true },
                })))
            );
            // An imported bill carries what was paid with the goods netted into
            // its CREDIT_PURCHASE, with no payment row of its own; its edits keep
            // that shape.
            const offLedgerPaid = oldSupplierId && !entryAllocation && !detachedEntryPayment ? oldEntryPaid : 0;

            // The tender the screen showed. An imported bill has no tender rows,
            // and its paid-with-the-goods went out as cash.
            const oldTender = purchase.payments.length > 0
                ? storedToTenderInputs(purchase.payments)
                : oldEntryPaid > EPSILON ? [{ paymentMethod: 'Cash', amount: oldEntryPaid }] : [];
            const oldTenderPaid = oldTender.reduce((sum, payment) => sum + payment.amount, 0);
            const newPaid = bill.paidAmount;
            // The tenders, resolved against the bill's own branch before
            // anything is written. One the bill already carries keeps its
            // method and the account it was saved with, wherever the method
            // has moved since; a new one must be offered at the branch. The
            // old ones are resolved too, so the two sides are compared method
            // for method — a row saved before methods were linked carries no
            // id and must not look changed.
            const oldTenders = await resolveTenders(tx, tenantId, purchase.store_id, oldTender, purchase.payments);
            const tenders = await resolveTenders(tx, tenantId, purchase.store_id, bill.payments, purchase.payments);
            const paymentChanged = Math.abs(newPaid - oldTenderPaid) > EPSILON
                || (newPaid > EPSILON && !sameTenders(tenders, oldTenders));

            let supplierId: string | null = dto.supplierId ?? null;
            if (dto.newSupplier) {
                supplierId = await resolveInlineSupplier(tx, tenantId, dto.newSupplier, purchase.store_id);
            } else if (supplierId && supplierId !== oldSupplierId) {
                const supplier = await tx.supplier.findFirst({ where: { id: supplierId, tenant_id: tenantId } });
                if (!supplier) {
                    throw new BadRequestException('Supplier not found for this tenant.');
                }
            }
            const supplierChanged = supplierId !== oldSupplierId;
            // Moving the bill moves what was paid with it.
            const redoPayment = paymentChanged || (supplierChanged && (oldEntryPaid > EPSILON || newPaid > EPSILON));

            if (redoPayment && detachedEntryPayment) {
                throw new BadRequestException('The payment made with this purchase has since been moved on the supplier payments screen — change it there.');
            }
            if (supplierChanged && laterPaid > EPSILON) {
                throw new BadRequestException('This purchase has supplier payments allocated against it — unallocate them before moving it to another supplier.');
            }
            const paidAfter = laterPaid + (redoPayment ? newPaid : oldEntryPaid);
            if (paidAfter - bill.totalAmount > EPSILON) {
                throw new BadRequestException(
                    `This purchase already has ${paidAfter.toFixed(2)} paid against it, more than the new total (${bill.totalAmount.toFixed(2)}).`,
                );
            }

            // ── Stock ────────────────────────────────────────────────────────
            const warehouses = await resolveEntryWarehouses(
                tx,
                tenantId,
                purchase.store_id,
                dto.warehouseId ?? purchase.warehouse_id ?? undefined,
                dto.items.map((item) => item.warehouseId),
                'purchase',
            );
            const live = await liveReceipts(tx, tenantId, id);
            // An imported bill's receipt never moved the average, so its
            // correction does not either.
            const costed = !(live.length > 0 && live.every((receipt) => !receipt.costed));
            const landed = allocateLandedCost({
                lines: dto.items.map((item, index) => ({
                    key: String(index),
                    quantity: item.quantity,
                    baseAmount: item.quantity * item.unitCost,
                })),
                charges: [{ label: 'freight', amount: bill.freightAmount }],
            });
            // A service line is never stock-tracked and leaves no movement, so
            // it must not make an unchanged bill look changed.
            const services = new Set(bill.products.filter((product) => product.type === 'SERVICE').map((product) => product.id));
            const incoming: Receipt[] = dto.items
                .map((item, index) => ({
                    productId: item.productId,
                    warehouseId: warehouses.warehouseIdFor(item.warehouseId),
                    quantity: item.quantity,
                    unitCost: landed.lines[index].landedUnitCost,
                    costed,
                }))
                .filter((receipt) => !services.has(receipt.productId));

            if (!sameReceipts(live, incoming)) {
                for (const receipt of incoming) {
                    await applyInventoryMovement(tx, {
                        tenantId,
                        productId: receipt.productId,
                        warehouseId: receipt.warehouseId,
                        quantityDelta: receipt.quantity,
                        movementType: costed ? 'PURCHASE_EDIT' : 'PURCHASE_EDIT_UNCOSTED',
                        referenceType: 'PURCHASE',
                        referenceId: id,
                        unitCost: receipt.unitCost ?? undefined,
                    });
                }
                for (const receipt of live) {
                    await applyInventoryMovement(tx, {
                        tenantId,
                        productId: receipt.productId,
                        warehouseId: receipt.warehouseId,
                        quantityDelta: -receipt.quantity,
                        movementType: receipt.costed ? 'PURCHASE_EDIT_REVERSAL' : 'PURCHASE_EDIT_REVERSAL_UNCOSTED',
                        referenceType: 'PURCHASE',
                        referenceId: id,
                        unitCost: receipt.unitCost ?? undefined,
                    });
                }
            }

            await tx.purchaseItem.deleteMany({ where: { purchase_id: id } });
            for (const item of dto.items) {
                await tx.purchaseItem.create({
                    data: {
                        purchase_id: id,
                        product_id: item.productId,
                        quantity: item.quantity,
                        unit_cost: item.unitCost,
                        line_total: item.quantity * item.unitCost,
                        warehouse_id: item.warehouseId ?? null,
                    },
                });
            }

            // The tender rows carry no money of their own — `paid_amount` and
            // the ledger do — so they are simply rewritten, which is also what
            // keeps a corrected cheque number.
            await tx.purchasePayment.deleteMany({ where: { purchase_id: id } });
            if (bill.payments.length > 0) {
                await tx.purchasePayment.createMany({
                    data: bill.payments.map((payment, index) => purchasePaymentData(id, payment, tenders[index])),
                });
            }

            // ── The supplier's account ───────────────────────────────────────
            const accounts = new Map<string, { due: number; startDue: number; storeId: string; name: string }>();
            const account = async (accountId: string) => {
                let entry = accounts.get(accountId);
                if (!entry) {
                    const supplier = await tx.supplier.findFirst({
                        where: { id: accountId, tenant_id: tenantId },
                        select: { due_balance: true, store_id: true, name: true },
                    });
                    const due = Number(supplier!.due_balance);
                    entry = { due, startDue: due, storeId: supplier!.store_id, name: supplier!.name };
                    accounts.set(accountId, entry);
                }
                return entry;
            };
            const writeRow = async (
                onSupplierId: string,
                row: { type: 'CREDIT_PURCHASE' | 'PAYMENT' | 'ADJUSTMENT'; amount: number; notes?: string; paymentNumber?: string },
            ) => {
                const entry = await account(onSupplierId);
                entry.due += supplierDueDelta(row.type, row.amount);
                return tx.supplierCreditTransaction.create({
                    data: {
                        tenant_id: tenantId,
                        supplier_id: onSupplierId,
                        // A credit row belongs to its supplier's branch.
                        store_id: entry.storeId,
                        type: row.type,
                        amount: row.amount,
                        balance_after: entry.due,
                        reference_type: 'PURCHASE',
                        reference_id: id,
                        ...(row.paymentNumber ? { payment_number: row.paymentNumber } : {}),
                        ...(row.notes ? { notes: row.notes } : {}),
                        created_by: userId,
                    },
                });
            };
            const paidNote = `Paid on purchase ${purchaseNumber} (${tenders.map(tenderLabel).join(', ')})`;
            const recordEntryPayment = async (onSupplierId: string) => {
                const payment = await writeRow(onSupplierId, {
                    type: 'PAYMENT',
                    amount: newPaid,
                    paymentNumber: await nextSupplierPaymentNumber(tenantId, tx, 'PAYMENT'),
                    notes: paidNote,
                });
                await tx.supplierPaymentAllocation.create({
                    data: { tenant_id: tenantId, transaction_id: payment.id, purchase_id: id, amount: newPaid },
                });
            };
            const removeEntryPayment = async (fromSupplierId: string) => {
                const entry = await account(fromSupplierId);
                entry.due += oldEntryPaid;
                await tx.supplierPaymentAllocation.delete({ where: { id: entryAllocation!.id } });
                await tx.supplierCreditTransaction.delete({ where: { id: entryAllocation!.transaction.id } });
            };

            if (!supplierChanged && supplierId) {
                const billDelta = bill.totalAmount - oldTotal;
                if (Math.abs(billDelta) > EPSILON) {
                    await writeRow(supplierId, {
                        type: 'ADJUSTMENT',
                        amount: billDelta,
                        notes: `Purchase ${purchaseNumber} edited: ${oldTotal.toFixed(2)} → ${bill.totalAmount.toFixed(2)}`,
                    });
                }

                if (redoPayment && entryAllocation) {
                    if (newPaid > EPSILON) {
                        const entry = await account(supplierId);
                        entry.due += oldEntryPaid - newPaid;
                        await tx.supplierCreditTransaction.update({
                            where: { id: entryAllocation.transaction.id },
                            data: { amount: newPaid, balance_after: entry.due, notes: paidNote },
                        });
                        await tx.supplierPaymentAllocation.update({
                            where: { id: entryAllocation.id },
                            data: { amount: newPaid },
                        });
                    } else {
                        await removeEntryPayment(supplierId);
                    }
                } else if (redoPayment && offLedgerPaid > EPSILON) {
                    await writeRow(supplierId, {
                        type: 'ADJUSTMENT',
                        amount: offLedgerPaid - newPaid,
                        notes: `Paid with purchase ${purchaseNumber} changed: ${offLedgerPaid.toFixed(2)} → ${newPaid.toFixed(2)}`,
                    });
                } else if (redoPayment && newPaid > EPSILON) {
                    await recordEntryPayment(supplierId);
                }
            } else if (supplierChanged) {
                const newSupplierName = supplierId ? (await account(supplierId)).name : null;

                // Off the old account entirely: the bill's whole contribution
                // to it, and the payment that came with it.
                if (oldSupplierId) {
                    const contribution = oldTotal - offLedgerPaid;
                    if (Math.abs(contribution) > EPSILON) {
                        await writeRow(oldSupplierId, {
                            type: 'ADJUSTMENT',
                            amount: -contribution,
                            notes: newSupplierName
                                ? `Purchase ${purchaseNumber} moved to ${newSupplierName}`
                                : `Purchase ${purchaseNumber} taken off this account`,
                        });
                    }
                    if (entryAllocation) {
                        await removeEntryPayment(oldSupplierId);
                    }
                }

                // Onto the new one exactly as recording it there would have.
                if (supplierId) {
                    await writeRow(supplierId, { type: 'CREDIT_PURCHASE', amount: bill.totalAmount });
                    if (newPaid > EPSILON) {
                        await recordEntryPayment(supplierId);
                    }
                }
            }

            for (const [accountId, entry] of accounts) {
                if (Math.abs(entry.due - entry.startDue) > EPSILON) {
                    await tx.supplier.update({ where: { id: accountId }, data: { due_balance: entry.due } });
                }
            }

            // ── The books ────────────────────────────────────────────────────
            let posting: Awaited<ReturnType<PurchasesService['postBillVoucher']>> | null = null;
            if (Math.abs(bill.totalAmount - oldTotal) > EPSILON || supplierChanged) {
                const date = await postedVoucherDate(tx, tenantId, 'purchase', id) ?? purchase.purchase_date ?? purchase.created_at;
                await voidAutoPostedVoucher(tx, tenantId, 'purchase', id);
                posting = await this.postBillVoucher(tx, tenantId, {
                    purchaseId: id,
                    purchaseNumber,
                    amount: bill.totalAmount,
                    storeId: purchase.store_id,
                    supplierId,
                    date,
                });
            }
            if (redoPayment) {
                const date = await postedVoucherDate(tx, tenantId, 'supplier_payment', id, 'paid') ?? purchase.purchase_date ?? purchase.created_at;
                await voidAutoPostedVoucher(tx, tenantId, 'supplier_payment', id, 'paid');
                if (newPaid > EPSILON) {
                    await this.postPaidVoucher(tx, tenantId, {
                        purchaseId: id,
                        purchaseNumber,
                        amount: newPaid,
                        storeId: purchase.store_id,
                        supplierId,
                        tenders,
                        date,
                    });
                }
            }

            await tx.purchase.update({
                where: { id },
                data: {
                    supplier_id: supplierId,
                    subtotal_amount: bill.subtotal,
                    tax_amount: bill.taxAmount,
                    discount_amount: bill.discountAmount,
                    freight_amount: bill.freightAmount,
                    total_amount: bill.totalAmount,
                    paid_amount: paidAfter,
                    payment_status: purchasePaymentStatus(paidAfter, bill.totalAmount),
                    notes: dto.notes || null,
                    warehouse_id: warehouses.entryWarehouseId,
                },
            });

            const updated = await tx.purchase.findFirst({
                where: { id, tenant_id: tenantId },
                include: {
                    supplier: true,
                    items: { include: { product: true, returnItems: true } },
                    payments: true,
                },
            });

            return {
                ...updated,
                ...(posting
                    ? {
                        posting_status: posting.postingStatus,
                        voucher_id: posting.voucherId ?? null,
                        voucher_number: posting.voucherNumber ?? null,
                        voucher_type: posting.voucherType ?? null,
                    }
                    : {}),
            };
        });
    }

    async getInvoiceData(tenantId: string, id: string) {
        const [purchase, tenant] = await Promise.all([
            this.db.purchase.findFirst({
                where: { id, tenant_id: tenantId },
                include: {
                    supplier: true,
                    store: { select: { name: true } },
                    items: { include: { product: true } },
                    payments: true,
                },
            }),
            this.db.tenant.findUnique({
                where: { id: tenantId },
                select: {
                    name: true,
                    brand_primary_color: true,
                    brand_logo_url: true,
                    brand_business_name: true,
                    vat_registration_no: true,
                    business_tin: true,
                },
            }),
        ]);

        if (!purchase) throw new NotFoundException('Purchase not found');

        // Who entered it, by name — the detailed receipt's Entry By.
        const preparers = await loadPreparerNames(this.db, [purchase]);
        return { purchase: { ...purchase, prepared_by: preparerOf(preparers, purchase) }, tenant };
    }

    async findOne(tenantId: string, id: string) {
        const purchase = await this.db.purchase.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                supplier: true,
                items: {
                    include: { product: true, returnItems: true },
                },
                payments: true,
                paymentAllocations: { select: ALLOCATION_SELECT },
            },
        });

        if (!purchase) {
            throw new NotFoundException('Purchase not found');
        }

        // `paid_amount` split the way `update` splits it: what was paid with
        // the bill (what its edit screen's tender strip holds) and what was
        // paid on it later from the supplier-payments screen.
        const { paymentAllocations, ...bill } = purchase;
        const entryAllocation = intactEntryAllocation(paymentAllocations, id);
        const laterPaid = paymentAllocations
            .filter((allocation) => allocation.id !== entryAllocation?.id)
            .reduce((sum, allocation) => sum + Number(allocation.amount), 0);
        const entryPaid = entryAllocation
            ? Number(entryAllocation.amount)
            : Math.max(0, Number(purchase.paid_amount) - laterPaid);

        return {
            ...bill,
            entry_paid_amount: entryPaid,
            later_paid_amount: laterPaid,
            ...(await loadPostingSummary(this.db, tenantId, 'purchases', 'purchase', purchase.id)),
        };
    }
}