import { Prisma } from '@prisma/client';
import { applyInventoryMovement, resolveWarehouseId } from '../database/inventory.utils';
import { autoPostFromRules, postingIdempotencyKey } from '../accounting/posting.utils';
import { resolvePaymentMethodAccountId } from '../accounting/payment-account.util';
import { PaymentParty } from './external-sync.mapper';
import { customerBranchId } from '../customers/customer-branch.util';
import { supplierBranchId } from '../suppliers/supplier-branch.util';

/**
 * Makes an imported document produce the same effects a natively entered one
 * would — stock, party due balance and a dated ledger posting.
 *
 * Only reached when the connection has `post_impacts` on. Everything here is
 * dated at the *document's* date rather than import time, so a replayed history
 * lands in the right periods: `autoPostFromRules` takes `date` and
 * `applyInventoryMovement` takes `occurredAt`.
 *
 * Two properties make replay safe to re-run. `autoPostFromRules` is idempotent
 * on (tenant, eventType, sourceId, legKey), so a second run over the same
 * document is a no-op rather than a double post. And the caller only invokes
 * these on documents it has just created — a document that already posted is
 * treated as immutable and never rewritten. The exceptions —
 * `applySaleReturnCredit`, `applySaleOverpayment`, `applyPurchaseReturnCredit`
 * and `postPurchasePaid` — check for their own ledger row or posting first.
 */

type Tx = Prisma.TransactionClient;

export interface SaleImpactInput {
    tx: Tx;
    tenantId: string;
    storeId: string;
    saleId: string;
    serialNumber: string;
    customerId: string | null;
    totalAmount: number;
    amountPaid: number;
    paymentMode: 'cash' | 'bank';
    saleDate: Date;
    items: Array<{ product_id: string; quantity: number }>;
}

/** Anything below this is rounding noise, matching the native sale path. */
const EPSILON = 0.005;

export async function applySaleImpacts(input: SaleImpactInput): Promise<void> {
    const { tx, tenantId, storeId, saleId, saleDate } = input;
    const balanceDue = Math.max(0, input.totalAmount - input.amountPaid);

    const warehouseId = await resolveWarehouseId(tx, tenantId, storeId);
    for (const item of input.items) {
        await applyInventoryMovement(tx, {
            tenantId,
            productId: item.product_id,
            warehouseId,
            quantityDelta: -item.quantity,
            movementType: 'SALE',
            referenceType: 'SALE',
            referenceId: saleId,
            occurredAt: saleDate,
            // A replayed sale is a fact that already happened; its stocking
            // purchase may predate the window. Let the balance go negative
            // rather than drop the document and its revenue.
            allowNegative: true,
        });
    }

    // The unpaid part of a credit sale is a receivable: it raises the
    // customer's due and gets its own CREDIT_SALE ledger row, exactly as the
    // native path does.
    if (balanceDue > EPSILON && input.customerId) {
        const customer = await tx.customer.findUnique({
            where: { id: input.customerId },
            select: { due_balance: true, store_id: true },
        });
        const balanceAfter = Number(customer?.due_balance ?? 0) + balanceDue;

        await tx.customerCreditTransaction.create({
            data: {
                tenant_id: tenantId,
                customer_id: input.customerId,
                // A credit row belongs to its customer's branch.
                store_id: customer!.store_id,
                type: 'CREDIT_SALE',
                amount: balanceDue,
                balance_after: balanceAfter,
                reference_type: 'SALE',
                reference_id: saleId,
                created_at: saleDate,
            },
        });
        await tx.customer.update({
            where: { id: input.customerId },
            data: { due_balance: balanceAfter },
        });
    }

    if (input.customerId && input.amountPaid - input.totalAmount > EPSILON) {
        await applySaleOverpayment({
            tx,
            tenantId,
            storeId,
            saleId,
            serialNumber: input.serialNumber,
            customerId: input.customerId,
            excess: input.amountPaid - input.totalAmount,
            paymentMode: input.paymentMode,
            saleDate,
        });
    }

    const modeAccountId = await resolvePaymentMethodAccountId(tx, tenantId, input.paymentMode);

    if (balanceDue > EPSILON) {
        await autoPostFromRules({
            tx,
            tenantId,
            eventType: 'sale',
            conditionKey: 'payment_mode',
            conditionValue: 'credit',
            sourceModule: 'external-sync',
            sourceType: 'sale',
            sourceId: saleId,
            amount: balanceDue,
            description: `Imported sale ${input.serialNumber} — credit portion`,
            referenceNumber: input.serialNumber,
            date: saleDate,
            storeId,
            partyType: 'CUSTOMER',
            partyId: input.customerId ?? undefined,
        });

        // A down-payment on a credit sale is real cash and posts separately.
        // legKey keeps it off the credit leg's idempotency key, which would
        // otherwise swallow it.
        if (input.amountPaid > EPSILON) {
            await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'sale',
                conditionKey: 'payment_mode',
                conditionValue: input.paymentMode,
                sourceModule: 'external-sync',
                sourceType: 'sale',
                sourceId: saleId,
                legKey: 'paid',
                amount: input.amountPaid,
                description: `Imported sale ${input.serialNumber} — paid portion`,
                referenceNumber: input.serialNumber,
                date: saleDate,
                storeId,
                overrideDebitAccountId: modeAccountId,
            });
        }
        return;
    }

    await autoPostFromRules({
        tx,
        tenantId,
        eventType: 'sale',
        conditionKey: 'payment_mode',
        conditionValue: input.paymentMode,
        sourceModule: 'external-sync',
        sourceType: 'sale',
        sourceId: saleId,
        amount: input.totalAmount,
        description: `Imported sale ${input.serialNumber}`,
        referenceNumber: input.serialNumber,
        date: saleDate,
        storeId,
        overrideDebitAccountId: modeAccountId,
    });
}

export interface PurchaseImpactInput {
    tx: Tx;
    tenantId: string;
    storeId: string;
    purchaseId: string;
    purchaseNumber: string;
    supplierId: string | null;
    totalAmount: number;
    paidAmount: number;
    purchaseDate: Date;
    items: Array<{ product_id: string; quantity: number; unit_cost: number }>;
}

export async function applyPurchaseImpacts(input: PurchaseImpactInput): Promise<void> {
    const { tx, tenantId, storeId, purchaseId, purchaseDate } = input;
    const balanceDue = Math.max(0, input.totalAmount - input.paidAmount);

    const warehouseId = await resolveWarehouseId(tx, tenantId, storeId);
    for (const item of input.items) {
        await applyInventoryMovement(tx, {
            tenantId,
            productId: item.product_id,
            warehouseId,
            quantityDelta: item.quantity,
            movementType: 'PURCHASE',
            referenceType: 'PURCHASE',
            referenceId: purchaseId,
            unitCost: item.unit_cost,
            occurredAt: purchaseDate,
        });
    }

    if (balanceDue > EPSILON && input.supplierId) {
        const supplier = await tx.supplier.findUnique({
            where: { id: input.supplierId },
            select: { due_balance: true, store_id: true },
        });
        const balanceAfter = Number(supplier?.due_balance ?? 0) + balanceDue;

        await tx.supplierCreditTransaction.create({
            data: {
                tenant_id: tenantId,
                supplier_id: input.supplierId,
                // A credit row belongs to its supplier's branch.
                store_id: supplier!.store_id,
                type: 'CREDIT_PURCHASE',
                amount: balanceDue,
                balance_after: balanceAfter,
                reference_type: 'PURCHASE',
                reference_id: purchaseId,
                created_at: purchaseDate,
            },
        });
        await tx.supplier.update({
            where: { id: input.supplierId },
            data: { due_balance: balanceAfter },
        });
    }

    const posting = await autoPostFromRules({
        tx,
        tenantId,
        eventType: 'purchase',
        conditionKey: 'payment_mode',
        conditionValue: 'credit',
        sourceModule: 'external-sync',
        sourceType: 'purchase',
        sourceId: purchaseId,
        amount: input.totalAmount,
        description: `Imported purchase ${input.purchaseNumber}`,
        referenceNumber: input.purchaseNumber,
        date: purchaseDate,
        storeId,
        ...(input.supplierId ? { partyType: 'SUPPLIER' as const, partyId: input.supplierId } : {}),
    });

    // The whole total went to payables; what was paid with the goods comes
    // back out — only once the purchase itself has posted, or the payment
    // would take out of payables what never went in.
    const paid = Math.min(input.paidAmount, input.totalAmount);
    if (posting.postingStatus === 'posted' && paid > EPSILON) {
        await postPurchasePaid({
            tx,
            tenantId,
            storeId,
            purchaseId,
            purchaseNumber: input.purchaseNumber,
            supplierId: input.supplierId,
            paid,
            purchaseDate,
        });
    }
}

export interface PurchaseReturnImpactInput {
    tx: Tx;
    tenantId: string;
    storeId: string;
    returnId: string;
    returnNumber: string;
    supplierId: string | null;
    totalAmount: number;
    returnDate: Date;
    items: Array<{ product_id: string; quantity: number; unit_cost: number }>;
    /**
     * What the return takes off the supplier's due, in full, below zero if
     * need be (see MappedPurchaseReturn.dueCredit). Left out, the due comes
     * down by the return but never below zero, as a return entered by hand.
     */
    dueCredit?: number;
}

/**
 * What a purchase return entered by hand does (purchase-returns.service.ts):
 * the goods leave stock, the supplier's due comes down by the return — never
 * below zero — with an ADJUSTMENT row, and the purchase-return rule posts it.
 */
export async function applyPurchaseReturnImpacts(input: PurchaseReturnImpactInput): Promise<void> {
    const { tx, tenantId, storeId, returnId, returnDate } = input;

    const warehouseId = await resolveWarehouseId(tx, tenantId, storeId);
    for (const item of input.items) {
        await applyInventoryMovement(tx, {
            tenantId,
            productId: item.product_id,
            warehouseId,
            quantityDelta: -item.quantity,
            movementType: 'PURCHASE_RETURN',
            referenceType: 'PURCHASE_RETURN',
            referenceId: returnId,
            unitCost: item.unit_cost,
            occurredAt: returnDate,
            // History replays in order of type, not date: a return can land
            // before stock it was taken from has been rebuilt.
            allowNegative: true,
        });
    }

    if (input.supplierId && input.dueCredit !== undefined) {
        await applyPurchaseReturnCredit({ ...input, supplierId: input.supplierId, dueCredit: input.dueCredit });
    } else if (input.supplierId) {
        const supplier = await tx.supplier.findUnique({
            where: { id: input.supplierId },
            select: { due_balance: true, store_id: true },
        });
        const currentDue = Number(supplier?.due_balance ?? 0);
        const reduction = Math.min(input.totalAmount, currentDue);
        if (reduction > EPSILON) {
            const balanceAfter = currentDue - reduction;
            await tx.supplierCreditTransaction.create({
                data: {
                    tenant_id: tenantId,
                    supplier_id: input.supplierId,
                    // A credit row belongs to its supplier's branch.
                    store_id: supplier!.store_id,
                    type: 'ADJUSTMENT',
                    amount: -reduction,
                    balance_after: balanceAfter,
                    reference_type: 'PURCHASE_RETURN',
                    reference_id: returnId,
                    notes: `Imported purchase return ${input.returnNumber}`,
                    created_at: returnDate,
                },
            });
            await tx.supplier.update({ where: { id: input.supplierId }, data: { due_balance: balanceAfter } });
        }
    }

    await autoPostFromRules({
        tx,
        tenantId,
        eventType: 'purchase_return',
        conditionKey: 'none',
        conditionValue: null,
        sourceModule: 'external-sync',
        sourceType: 'purchase_return',
        sourceId: returnId,
        amount: input.totalAmount,
        description: `Imported purchase return ${input.returnNumber}`,
        referenceNumber: input.returnNumber,
        date: returnDate,
        storeId,
        ...(input.supplierId ? { partyType: 'SUPPLIER' as const, partyId: input.supplierId } : {}),
    });
}

export interface PaymentImpactInput {
    tx: Tx;
    tenantId: string;
    party: PaymentParty;
    partyId: string;
    /** The party's branch: where its credit row was written, and where the voucher posts. */
    storeId: string;
    transactionId: string;
    paymentNumber: string;
    /** PAYMENT settles the party's due; PAYOUT moves it the other way. */
    type: 'PAYMENT' | 'PAYOUT';
    amount: number;
    method: string;
    date: Date;
}

/**
 * Moves the party's due and posts the cash leg. The `balance_after` written at
 * import time was the provider's figure; with impacts on we recompute it from
 * our own balance so the two cannot drift.
 */
export async function applyPaymentImpacts(input: PaymentImpactInput): Promise<void> {
    const { tx, tenantId, partyId, amount, type } = input;
    const isCustomer = input.party === 'CUSTOMER';

    // For both sides PAYMENT reduces the due and PAYOUT raises it; the two
    // dueDelta helpers in customers/suppliers agree on this.
    const delta = type === 'PAYMENT' ? -amount : amount;

    const current = isCustomer
        ? await tx.customer.findUnique({ where: { id: partyId }, select: { due_balance: true } })
        : await tx.supplier.findUnique({ where: { id: partyId }, select: { due_balance: true } });

    const balanceAfter = Number(current?.due_balance ?? 0) + delta;

    if (isCustomer) {
        await tx.customer.update({ where: { id: partyId }, data: { due_balance: balanceAfter } });
        await tx.customerCreditTransaction.update({
            where: { id: input.transactionId },
            data: { balance_after: balanceAfter },
        });
    } else {
        await tx.supplier.update({ where: { id: partyId }, data: { due_balance: balanceAfter } });
        await tx.supplierCreditTransaction.update({
            where: { id: input.transactionId },
            data: { balance_after: balanceAfter },
        });
    }

    // The rules key on which way the money went, and that depends on the party:
    // a customer PAYMENT brings money in, a supplier PAYMENT sends it out. The
    // payment method's account replaces the cash leg, which is the debit when
    // money comes in and the credit when it goes out — overriding the other leg
    // would swap out the receivable or payable instead.
    const moneyIn = isCustomer ? type === 'PAYMENT' : type === 'PAYOUT';
    const methodAccountId = await resolvePaymentMethodAccountId(tx, tenantId, input.method);

    await autoPostFromRules({
        tx,
        tenantId,
        eventType: isCustomer ? 'customer_payment' : 'supplier_payment',
        conditionKey: 'payment_direction',
        conditionValue: moneyIn ? 'receive' : 'pay',
        sourceModule: 'external-sync',
        sourceType: isCustomer ? 'customer_payment' : 'supplier_payment',
        sourceId: input.transactionId,
        storeId: input.storeId,
        amount,
        description: `Imported ${input.party.toLowerCase()} payment ${input.paymentNumber}`,
        referenceNumber: input.paymentNumber,
        date: input.date,
        partyType: isCustomer ? 'CUSTOMER' : 'SUPPLIER',
        partyId,
        ...(moneyIn
            ? { overrideDebitAccountId: methodAccountId }
            : { overrideCreditAccountId: methodAccountId }),
    });
}

/**
 * Brings a purchase return's credit on the supplier's account to `dueCredit`,
 * whatever the supplier owed at the time: the ADJUSTMENT row tied to the
 * return is written, or moved, and the due moves with it. Express takes a
 * return off in full, leaving the supplier owing the shop when nothing was
 * due; a return imported under the old cap gets the rest on a re-run.
 * Returns whether anything changed.
 */
export async function applyPurchaseReturnCredit(
    input: Pick<PurchaseReturnImpactInput, 'tx' | 'tenantId' | 'returnId' | 'returnNumber' | 'returnDate'> & {
        supplierId: string;
        dueCredit: number;
    },
): Promise<boolean> {
    const { tx, tenantId, supplierId, returnId } = input;
    const row = await tx.supplierCreditTransaction.findFirst({
        where: { tenant_id: tenantId, supplier_id: supplierId, type: 'ADJUSTMENT', reference_type: 'PURCHASE_RETURN', reference_id: returnId },
        select: { id: true, amount: true },
    });
    const change = -input.dueCredit - Number(row?.amount ?? 0);
    if (Math.abs(change) < EPSILON) return false;

    const supplier = await tx.supplier.findUnique({
        where: { id: supplierId },
        select: { due_balance: true, store_id: true },
    });
    const balanceAfter = Number(supplier?.due_balance ?? 0) + change;
    if (row) {
        await tx.supplierCreditTransaction.update({ where: { id: row.id }, data: { amount: -input.dueCredit } });
    } else {
        await tx.supplierCreditTransaction.create({
            data: {
                tenant_id: tenantId,
                supplier_id: supplierId,
                // A credit row belongs to its supplier's branch.
                store_id: supplier!.store_id,
                type: 'ADJUSTMENT',
                amount: -input.dueCredit,
                balance_after: balanceAfter,
                reference_type: 'PURCHASE_RETURN',
                reference_id: returnId,
                notes: `Imported purchase return ${input.returnNumber}`,
                created_at: input.returnDate,
            },
        });
    }
    await tx.supplier.update({ where: { id: supplierId }, data: { due_balance: balanceAfter } });
    return true;
}

export interface PurchasePaidInput {
    tx: Tx;
    tenantId: string;
    storeId: string;
    purchaseId: string;
    purchaseNumber: string;
    supplierId: string | null;
    /** What was paid with the goods, up to the purchase total. */
    paid: number;
    purchaseDate: Date;
}

/**
 * Posts what was paid with the goods as a payment to the supplier. The
 * purchase itself posts its whole total as a credit purchase, so without
 * this every taka paid at the counter stayed in payables, and in cash, for
 * good: on Babu Bazar, ৳176M of payables the suppliers were never owed.
 * Idempotent on its own leg, so safe on a purchase imported before it.
 */
export async function postPurchasePaid(input: PurchasePaidInput) {
    const { tx, tenantId } = input;
    const methodAccountId = await resolvePaymentMethodAccountId(tx, tenantId, 'cash');
    return autoPostFromRules({
        tx,
        tenantId,
        eventType: 'supplier_payment',
        conditionKey: 'payment_direction',
        conditionValue: 'pay',
        sourceModule: 'external-sync',
        sourceType: 'purchase',
        sourceId: input.purchaseId,
        legKey: 'paid',
        amount: input.paid,
        description: `Imported purchase ${input.purchaseNumber} — paid with the goods`,
        referenceNumber: input.purchaseNumber,
        date: input.purchaseDate,
        storeId: input.storeId,
        ...(input.supplierId ? { partyType: 'SUPPLIER' as const, partyId: input.supplierId } : {}),
        overrideCreditAccountId: methodAccountId,
    });
}

export interface SaleOverpaymentInput {
    tx: Tx;
    tenantId: string;
    storeId: string;
    saleId: string;
    serialNumber: string;
    customerId: string;
    /** What was paid above the invoice total. */
    excess: number;
    paymentMode: SaleImpactInput['paymentMode'];
    saleDate: Date;
}

/**
 * What a customer paid at the counter above the invoice total. The provider
 * (Express) takes it off what they already owed, as its running balance on
 * their next document shows, so it is a payment of its own: a PAYMENT row
 * tied to the sale and a customer receipt in the ledger. The sale itself
 * posts its total.
 *
 * Once per sale, so it is safe on a sale imported before this existed.
 * Returns whether a row was written.
 */
export async function applySaleOverpayment(input: SaleOverpaymentInput): Promise<boolean> {
    const { tx, tenantId, saleId, customerId, excess } = input;

    const existing = await tx.customerCreditTransaction.findFirst({
        where: { tenant_id: tenantId, customer_id: customerId, type: 'PAYMENT', reference_type: 'SALE', reference_id: saleId },
        select: { id: true },
    });
    if (!existing) {
        const customer = await tx.customer.findUnique({
            where: { id: customerId },
            select: { due_balance: true, store_id: true },
        });
        const balanceAfter = Number(customer?.due_balance ?? 0) - excess;
        await tx.customerCreditTransaction.create({
            data: {
                tenant_id: tenantId,
                customer_id: customerId,
                // A credit row belongs to its customer's branch.
                store_id: customer!.store_id,
                type: 'PAYMENT',
                amount: excess,
                balance_after: balanceAfter,
                reference_type: 'SALE',
                reference_id: saleId,
                notes: `Paid above the total of imported sale ${input.serialNumber}`,
                created_at: input.saleDate,
            },
        });
        await tx.customer.update({ where: { id: customerId }, data: { due_balance: balanceAfter } });
    }

    const methodAccountId = await resolvePaymentMethodAccountId(tx, tenantId, input.paymentMode);
    await autoPostFromRules({
        tx,
        tenantId,
        eventType: 'customer_payment',
        conditionKey: 'payment_direction',
        conditionValue: 'receive',
        sourceModule: 'external-sync',
        sourceType: 'sale',
        sourceId: saleId,
        legKey: 'overpaid',
        amount: excess,
        description: `Imported sale ${input.serialNumber} — paid above its total`,
        referenceNumber: input.serialNumber,
        date: input.saleDate,
        storeId: input.storeId,
        partyType: 'CUSTOMER',
        partyId: customerId,
        overrideDebitAccountId: methodAccountId,
    });

    return !existing;
}

export interface SaleReturnImpactInput {
    tx: Tx;
    tenantId: string;
    storeId: string;
    returnId: string;
    returnNumber: string;
    totalRefund: number;
    returnDate: Date;
    items: Array<{ product_id: string; quantity: number }>;
    /** The customer whose account a credited return lands on. */
    customerId?: string | null;
    /** What the return takes off that customer's due (see MappedSaleReturn.dueCredit). */
    dueCredit?: number;
}

export async function applySaleReturnImpacts(input: SaleReturnImpactInput): Promise<void> {
    const { tx, tenantId, storeId, returnId, returnDate } = input;

    const warehouseId = await resolveWarehouseId(tx, tenantId, storeId);
    for (const item of input.items) {
        await applyInventoryMovement(tx, {
            tenantId,
            productId: item.product_id,
            warehouseId,
            quantityDelta: item.quantity,
            movementType: 'SALES_RETURN',
            referenceType: 'SALES_RETURN',
            referenceId: returnId,
            occurredAt: returnDate,
        });
    }

    if (input.customerId && (input.dueCredit ?? 0) > EPSILON) {
        await applySaleReturnCredit({ ...input, customerId: input.customerId, dueCredit: input.dueCredit! });
        return;
    }

    await autoPostFromRules({
        tx,
        tenantId,
        eventType: 'sale_return',
        sourceModule: 'external-sync',
        sourceType: 'sale_return',
        sourceId: returnId,
        amount: input.totalRefund,
        description: `Imported sale return ${input.returnNumber}`,
        referenceNumber: input.returnNumber,
        date: returnDate,
        storeId,
    });
}

/**
 * Takes a credited return off its customer's due, with an ADJUSTMENT row
 * tied to the return as a native credit return writes, and posts it as a
 * credit return.
 *
 * Unlike the native path the credit is not capped at what the customer owes:
 * a provider that credits returns this way (Dizi) books any cash handed back
 * as a refund payment of its own, which raises the due again, so the two have
 * to net to zero.
 *
 * Safe to run again on a return already imported: one that has its row gets
 * no second one, and posting is idempotent. Returns whether a row was written.
 */
export async function applySaleReturnCredit(
    input: Omit<SaleReturnImpactInput, 'items'> & { customerId: string; dueCredit: number },
): Promise<boolean> {
    const { tx, tenantId, storeId, returnId, returnDate, customerId, dueCredit } = input;

    const existing = await tx.customerCreditTransaction.findFirst({
        where: { tenant_id: tenantId, customer_id: customerId, reference_type: 'SALES_RETURN', reference_id: returnId },
        select: { id: true },
    });
    if (!existing) {
        const customer = await tx.customer.findUnique({
            where: { id: customerId },
            select: { due_balance: true, store_id: true },
        });
        const balanceAfter = Number(customer?.due_balance ?? 0) - dueCredit;
        await tx.customerCreditTransaction.create({
            data: {
                tenant_id: tenantId,
                customer_id: customerId,
                // A credit row belongs to its customer's branch.
                store_id: customer!.store_id,
                type: 'ADJUSTMENT',
                amount: -dueCredit,
                balance_after: balanceAfter,
                reference_type: 'SALES_RETURN',
                reference_id: returnId,
                notes: `Imported sale return ${input.returnNumber}`,
                created_at: returnDate,
            },
        });
        await tx.customer.update({ where: { id: customerId }, data: { due_balance: balanceAfter } });
    }

    await autoPostFromRules({
        tx,
        tenantId,
        eventType: 'sale_return',
        conditionKey: 'payment_mode',
        conditionValue: 'credit',
        sourceModule: 'external-sync',
        sourceType: 'sale_return',
        sourceId: returnId,
        amount: input.totalRefund,
        description: `Imported sale return ${input.returnNumber}`,
        referenceNumber: input.returnNumber,
        date: returnDate,
        storeId,
        partyType: 'CUSTOMER',
        partyId: customerId,
    });

    return !existing;
}

/**
 * True once a document has posted. Posted documents are immutable to the
 * importer: a later re-pull skips them rather than rewriting rows whose ledger
 * effects have already landed.
 */
export async function isAlreadyPosted(
    db: { postingEvent: { findUnique: (args: any) => Promise<any> } },
    tenantId: string,
    eventType: string,
    sourceId: string,
): Promise<boolean> {
    const event = await db.postingEvent.findUnique({
        where: {
            tenant_id_idempotency_key: {
                tenant_id: tenantId,
                idempotency_key: postingIdempotencyKey(tenantId, eventType, sourceId),
            },
        },
        select: { status: true },
    });
    return event?.status === 'posted';
}

export interface OpeningBalanceInput {
    tx: Tx;
    tenantId: string;
    party: PaymentParty;
    partyId: string;
    amount: number;
    /** Dated at the start of the imported range, before any document. */
    asOf: Date;
    label: string;
}

/**
 * Records what a party already owed before the provider's own history starts.
 *
 * Without it the balances cannot reconcile: the provider carries a
 * `previous_due` per party, and payments settling that older debt do get
 * imported, so the balance is reduced by money whose matching sale was never
 * in the source data at all.
 *
 * Written as an ADJUSTMENT rather than a posting: it is an opening position,
 * not an economic event of ours, and posting it would credit revenue that
 * belongs to the previous system.
 */
export async function applyOpeningBalance(input: OpeningBalanceInput): Promise<void> {
    const { tx, tenantId, partyId, amount, asOf } = input;
    if (Math.abs(amount) < EPSILON) return;

    const isCustomer = input.party === 'CUSTOMER';
    const data = {
        tenant_id: tenantId,
        type: 'ADJUSTMENT',
        amount,
        notes: openingBalanceNote(input.label),
        created_at: asOf,
    };

    // An opening balance belongs to its party's branch, like every credit row,
    // and adds to whatever the party already owes: a party imported earlier
    // keeps the effect of their documents.
    if (isCustomer) {
        const store_id = await customerBranchId(tx, partyId);
        const current = await tx.customer.findUnique({ where: { id: partyId }, select: { due_balance: true } });
        const balanceAfter = Number(current?.due_balance ?? 0) + amount;
        await tx.customerCreditTransaction.create({ data: { ...data, balance_after: balanceAfter, customer_id: partyId, store_id } });
        await tx.customer.update({ where: { id: partyId }, data: { due_balance: balanceAfter } });
    } else {
        const store_id = await supplierBranchId(tx, partyId);
        const current = await tx.supplier.findUnique({ where: { id: partyId }, select: { due_balance: true } });
        const balanceAfter = Number(current?.due_balance ?? 0) + amount;
        await tx.supplierCreditTransaction.create({ data: { ...data, balance_after: balanceAfter, supplier_id: partyId, store_id } });
        await tx.supplier.update({ where: { id: partyId }, data: { due_balance: balanceAfter } });
    }
}

/** The note every imported opening balance carries, so a later run can find it. */
export function openingBalanceNote(label: string): string {
    return `Opening balance imported from ${label}`;
}

export interface OpeningStockInput {
    tx: Tx;
    tenantId: string;
    storeId: string;
    connectionId: string;
    productId: string;
    /** Signed: a negative opening takes out what the provider no longer holds. */
    quantity: number;
    /** The provider's buying rate, which costs the stock coming in. */
    unitCost: number;
    /** Dated at the start of the imported range, before any document. */
    asOf: Date;
    label: string;
}

/**
 * Stock a product had before the imported range, as a backdated opening
 * movement in the branch's warehouse, tagged to the connection so a later
 * run can tell it is there. Like an opening balance it does not post.
 *
 * A positive opening arrives at the buying rate, as opening stock entered by
 * hand does. A negative one is quantity only, and may take the balance below
 * zero for a while, as a replayed sale may.
 */
export async function applyOpeningStock(input: OpeningStockInput): Promise<void> {
    const { tx, tenantId, quantity } = input;
    if (quantity === 0) return;

    const warehouseId = await resolveWarehouseId(tx, tenantId, input.storeId);
    await applyInventoryMovement(tx, {
        tenantId,
        productId: input.productId,
        warehouseId,
        quantityDelta: quantity,
        movementType: 'INITIAL_STOCK',
        referenceType: OPENING_STOCK_REFERENCE,
        referenceId: input.connectionId,
        unitCost: quantity > 0 && input.unitCost > 0 ? input.unitCost : undefined,
        note: `Opening stock imported from ${input.label}`,
        occurredAt: input.asOf,
        allowNegative: true,
    });
}

/** `InventoryMovement.reference_type` of an imported opening stock movement. */
export const OPENING_STOCK_REFERENCE = 'EXTERNAL_SYNC_OPENING';
