import { Prisma } from '@prisma/client';
import { applyInventoryMovement, resolveWarehouseId } from '../database/inventory.utils';
import { autoPostFromRules, postingIdempotencyKey } from '../accounting/posting.utils';
import { resolvePaymentMethodAccountId } from '../accounting/payment-account.util';
import { PaymentParty } from './external-sync.mapper';

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
 * treated as immutable and never rewritten.
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
        });
    }

    // The unpaid part of a credit sale is a receivable: it raises the
    // customer's due and gets its own CREDIT_SALE ledger row, exactly as the
    // native path does.
    if (balanceDue > EPSILON && input.customerId) {
        const customer = await tx.customer.findUnique({
            where: { id: input.customerId },
            select: { due_balance: true },
        });
        const balanceAfter = Number(customer?.due_balance ?? 0) + balanceDue;

        await tx.customerCreditTransaction.create({
            data: {
                tenant_id: tenantId,
                customer_id: input.customerId,
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
            select: { due_balance: true },
        });
        const balanceAfter = Number(supplier?.due_balance ?? 0) + balanceDue;

        await tx.supplierCreditTransaction.create({
            data: {
                tenant_id: tenantId,
                supplier_id: input.supplierId,
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

    await autoPostFromRules({
        tx,
        tenantId,
        eventType: 'purchase',
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
}

export interface PaymentImpactInput {
    tx: Tx;
    tenantId: string;
    party: PaymentParty;
    partyId: string;
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

    await autoPostFromRules({
        tx,
        tenantId,
        eventType: isCustomer ? 'customer_payment' : 'supplier_payment',
        conditionKey: 'payment_direction',
        conditionValue: type === 'PAYMENT' ? 'receive' : 'pay',
        sourceModule: 'external-sync',
        sourceType: isCustomer ? 'customer_payment' : 'supplier_payment',
        sourceId: input.transactionId,
        amount,
        description: `Imported ${input.party.toLowerCase()} payment ${input.paymentNumber}`,
        referenceNumber: input.paymentNumber,
        date: input.date,
        partyType: isCustomer ? 'CUSTOMER' : 'SUPPLIER',
        partyId,
        overrideDebitAccountId: await resolvePaymentMethodAccountId(tx, tenantId, input.method),
    });
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
