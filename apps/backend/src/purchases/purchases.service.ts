import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { createdAtRange } from '../common/created-range.util';
import { resolveOrderBy, type SortableMap } from '../common/sort.util';
import { DatabaseService } from '../database/database.service';
import { CreatePurchaseDto } from './purchase.dto';
import { applyInventoryMovement, resolveEntryWarehouses } from '../database/inventory.utils';
import { costBehaviourFor } from '../database/product-cost.utils';
import { allocateLandedCost } from '../database/landed-cost.utils';
import { autoPostFromRules, voidAutoPostedVoucher } from '../accounting/posting.utils';
import { loadPostingSummaries, loadPostingSummary, NO_POSTING_EVENT } from '../accounting/posting-status.util';
import { resolveInlineSupplier } from '../suppliers/resolve-inline-supplier.util';
import { nextSupplierPaymentNumber } from '../suppliers/supplier-payment-number.util';
import { resolvePaymentMethodAccountId } from '../accounting/payment-account.util';
import { paymentInstrumentData } from '../common/payment-instrument.util';
import { purchasePaymentStatus } from './purchase-status';

const PURCHASE_SORTABLE: SortableMap = {
    purchase_number: (dir) => ({ purchase_number: dir }),
    created_at: (dir) => ({ created_at: dir }),
    total_amount: (dir) => ({ total_amount: dir }),
};
const PURCHASE_DEFAULT_ORDER = { created_at: 'desc' as const };

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
        // of the "which method paid this?" lookup below.
        const payments = (dto.payments ?? []).filter((payment) => payment.amount > 0.005);
        const paidAmount = payments.reduce((sum, payment) => sum + payment.amount, 0);

        if (paidAmount - totalAmount > 0.005) {
            throw new BadRequestException(
                `Payment (${paidAmount.toFixed(2)}) exceeds the purchase total (${totalAmount.toFixed(2)}).`,
            );
        }

        return this.db.$transaction(async (tx) => {
            const warehouses = await resolveEntryWarehouses(
                tx,
                tenantId,
                store.id,
                dto.warehouseId,
                dto.items.map((item) => item.warehouseId),
                'purchase',
            );
            let supplierId = dto.supplierId;

            if (dto.newSupplier) {
                supplierId = await resolveInlineSupplier(tx, tenantId, dto.newSupplier);
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
                    data: payments.map((payment) => ({
                        purchase_id: purchase.id,
                        payment_method: payment.paymentMethod,
                        amount: payment.amount,
                        ...paymentInstrumentData(payment),
                    })),
                });
            }

            if (supplierId) {
                const supplier = await tx.supplier.findFirst({
                    where: { id: supplierId, tenant_id: tenantId },
                    select: { due_balance: true },
                });
                let balanceAfter = Number(supplier!.due_balance) + totalAmount;

                await tx.supplierCreditTransaction.create({
                    data: {
                        tenant_id: tenantId,
                        supplier_id: supplierId,
                        type: 'CREDIT_PURCHASE',
                        amount: totalAmount,
                        balance_after: balanceAfter,
                        reference_type: 'PURCHASE',
                        reference_id: purchase.id,
                        created_by: userId,
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
                            type: 'PAYMENT',
                            amount: paidAmount,
                            balance_after: balanceAfter,
                            // Stamped with the bill it settled so `cancel` can
                            // find its own payment and take it back, and so the
                            // ledger says which purchase the cash was for.
                            reference_type: 'PURCHASE',
                            reference_id: purchase.id,
                            payment_number: await nextSupplierPaymentNumber(tenantId, tx, 'PAYMENT'),
                            notes: `Paid on purchase ${purchase.purchase_number} (${payments.map((p) => p.paymentMethod).join(', ')})`,
                            created_by: userId,
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

            // Still always 'credit', and still not a shortcut: the bill raises
            // the payable in full, exactly as the supplier's invoice does, and
            // anything paid at the counter is a second, separate event that
            // takes the payable back down (the leg below). Keeping the two
            // apart is what lets a part-payment work at all, and it is why
            // purchase/cash and purchase/bank rules still do not exist — they
            // would describe a netting this model does not do.
            const posting = await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'purchase',
                conditionKey: 'payment_mode',
                conditionValue: 'credit',
                sourceModule: 'purchases',
                sourceType: 'purchase',
                sourceId: purchase.id,
                amount: Number(purchase.total_amount),
                description: `Auto-posted purchase ${purchase.purchase_number}`,
                referenceNumber: purchase.purchase_number,
                storeId: dto.storeId,
                partyType: 'SUPPLIER',
                partyId: supplierId,
            });

            // The cash that actually left the till. Posted through the
            // supplier_payment rule (Dr Purchase Payable / Cr Cash in Hand)
            // rather than a purchase/<mode> rule, because that rule already
            // exists on every tenant and is the only thing that ever debits
            // Purchase Payable — a bill paid at the counter must not be the one
            // kind of payment that leaves the liability standing.
            //
            // `legKey: 'paid'` keeps it off the bill's own idempotency key, so
            // the two vouchers cannot overwrite each other and the purchase
            // stays the primary posting event for status reads.
            //
            // The mode account is the CREDIT leg here (money going out), the
            // mirror of the sale's paid leg, so a tenant-configured
            // PaymentMethod account overrides that side.
            //
            // One voucher for the whole tender, keyed on the first method, the
            // same simplification the sale screen makes: split a bill across
            // cash and bKash and the cash account carries both. Splitting the
            // leg per method is a change to the rules engine, not to this
            // caller, so it is not smuggled in here.
            if (paidAmount > 0.005) {
                const primaryPaymentMethod = payments[0].paymentMethod;

                await autoPostFromRules({
                    tx,
                    tenantId,
                    eventType: 'supplier_payment',
                    conditionKey: 'payment_direction',
                    conditionValue: 'pay',
                    sourceModule: 'purchases',
                    sourceType: 'purchase',
                    sourceId: purchase.id,
                    legKey: 'paid',
                    amount: paidAmount,
                    description: `Auto-posted paid portion — purchase ${purchase.purchase_number}`,
                    referenceNumber: purchase.purchase_number,
                    storeId: dto.storeId,
                    partyType: 'SUPPLIER',
                    partyId: supplierId,
                    overrideCreditAccountId: await resolvePaymentMethodAccountId(tx, tenantId, primaryPaymentMethod),
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

    async findAll(
        tenantId: string,
        page = 1,
        limit = 20,
        opts?: { createdFrom?: string; createdTo?: string; timezone: string; sortBy?: string; sortDir?: string },
    ): Promise<PaginatedResult<unknown>> {
        const created = createdAtRange(opts?.createdFrom, opts?.createdTo, opts?.timezone);
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
            where: { tenant_id: tenantId, ...(created ? { created_at: created } : {}) },
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
                    paymentAllocations: {
                        select: {
                            id: true,
                            amount: true,
                            transaction: {
                                select: { id: true, type: true, amount: true, payment_number: true, reference_type: true, reference_id: true },
                            },
                        },
                    },
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
            // Only while it is still intact, though: one allocation, to this
            // bill, for the payment's whole amount. Anything else — a second
            // payment allocated here, or this one part-moved onto another bill
            // from the supplier-payments screen — was a separate decision about
            // where that money went, and this method has no business guessing
            // at it.
            const entryAllocation = purchase.paymentAllocations.find((allocation) =>
                allocation.transaction.type === 'PAYMENT'
                && allocation.transaction.reference_type === 'PURCHASE'
                && allocation.transaction.reference_id === id
                && Math.abs(Number(allocation.amount) - Number(allocation.transaction.amount)) <= 0.005);

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

            // Reverse what this bill actually put into stock, read back from
            // the movements it wrote rather than recomputed from the lines.
            // `PurchaseItem.unit_cost` is the supplier's price; the movement
            // carries the *landed* figure `allocateLandedCost` produced at the
            // time, and recomputing it would silently disagree the moment the
            // allocation rules change.
            //
            // Not filtered to `PURCHASE_RECEIPT`: an externally-synced purchase
            // writes `PURCHASE` (see external-sync.impacts.ts), and pinning the
            // type here would leave an imported bill's stock standing after it
            // was cancelled. Every incoming movement against this purchase is
            // taken instead.
            const receipts = await tx.inventoryMovement.findMany({
                where: {
                    tenant_id: tenantId,
                    reference_type: 'PURCHASE',
                    reference_id: id,
                    quantity_delta: { gt: 0 },
                },
                select: { product_id: true, warehouse_id: true, quantity_delta: true, unit_cost: true, movement_type: true },
            });

            for (const receipt of receipts) {
                // The reversal has to mirror how the goods arrived, or the cost
                // pool ends up richer or poorer than before the bill existed. A
                // REVALUE receipt blended its own cost in, so the reversal must
                // pull that same cost back out (REVERSE_RECEIPT). A
                // QUANTITY_ONLY receipt — an imported `PURCHASE` — never moved
                // the average, so its reversal must not either.
                const revalued = costBehaviourFor(receipt.movement_type) === 'REVALUE';

                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: receipt.product_id,
                    // The receipt's own warehouse, not today's default: the
                    // tenant may have re-pointed `default_purchase_warehouse_id`
                    // since, and taking the goods out of a warehouse they never
                    // entered would leave both sides wrong.
                    warehouseId: receipt.warehouse_id,
                    quantityDelta: -receipt.quantity_delta,
                    movementType: revalued ? 'PURCHASE_CANCELLED' : 'PURCHASE_CANCELLED_UNCOSTED',
                    referenceType: 'PURCHASE',
                    referenceId: id,
                    unitCost: receipt.unit_cost === null ? undefined : Number(receipt.unit_cost),
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
                    select: { due_balance: true },
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

        return { purchase, tenant };
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
            },
        });

        if (!purchase) {
            throw new NotFoundException('Purchase not found');
        }

        return {
            ...purchase,
            ...(await loadPostingSummary(this.db, tenantId, 'purchases', 'purchase', purchase.id)),
        };
    }
}