import { BadRequestException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { classifyPaymentMode } from '../sales/classify-payment-mode';

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * Resolves the GL account a tenant configured for a payment method, so a posting
 * can send the cash leg there instead of the mode-derived default.
 *
 * This is what makes a custom method work: `classifyPaymentMode('Upay')` falls
 * back to 'cash' and the rule would post to Cash in Hand, but if the tenant set
 * `PaymentMethod.account_id` for "Upay", that account wins. Returns undefined when
 * the method is unknown or has no account, so the caller keeps the rule default.
 */
export async function resolvePaymentMethodAccountId(
    db: Client,
    tenantId: string,
    methodName?: string | null,
): Promise<string | undefined> {
    if (!methodName) return undefined;
    const method = await db.paymentMethod.findFirst({
        where: { tenant_id: tenantId, name: methodName, is_active: true },
        select: { account_id: true },
    });
    return method?.account_id ?? undefined;
}

/**
 * How a customer or supplier payment says the money moved: the method picked
 * on the form and, optionally, an explicit ledger account.
 */
export interface SettlementInput {
    paymentMethod?: string | null;
    accountId?: string | null;
}

export interface ResolvedSettlement {
    /** The method as recorded on the transaction, or null when none was given. */
    paymentMethod: string | null;
    /**
     * The account the cash/mode leg posts to, or undefined to keep the posting
     * rule's own account — which is exactly what happened before payments
     * recorded a method, so an older client that sends neither field posts as
     * it always did.
     */
    accountId: string | undefined;
}

/**
 * Picks the account a customer/supplier payment's cash leg posts to.
 *
 * The `customer_payment` / `supplier_payment` rules are keyed on direction,
 * not on payment mode, so on their own they always book to Cash in Hand —
 * which is how money collected by bKash ended up in the cash account. In order:
 *
 *  1. An explicit `accountId` wins. It must be one of the tenant's accounts; a
 *     foreign or unknown id is refused here rather than surfacing later as the
 *     rules engine's opaque AUTO_POSTING_ACCOUNT_INVALID.
 *  2. The tenant's PaymentMethod of that name, when it is linked to an account
 *     (the same lookup the sale and purchase postings use).
 *  3. The account the tenant's `sale` rules route that payment *mode* to
 *     (bKash → bKash Account, bank/card → Main Bank Account). That rule set
 *     already knows where each kind of money lands, so a default "bKash" method
 *     with no account of its own still reaches the bKash ledger. Classified
 *     from the method name first, then from its configured type, so a custom
 *     "Upay" wallet is not mistaken for cash.
 *  4. Otherwise — cash, or nothing given — undefined: the rule's default.
 */
export async function resolveSettlementAccount(
    db: Client,
    tenantId: string,
    input: SettlementInput,
): Promise<ResolvedSettlement> {
    const paymentMethod = input.paymentMethod?.trim() || null;
    const explicitAccountId = input.accountId?.trim() || null;

    if (explicitAccountId) {
        const account = await db.account.findFirst({
            where: { id: explicitAccountId, tenant_id: tenantId },
            select: { id: true },
        });
        if (!account) throw new BadRequestException('Payment account not found');
        return { paymentMethod, accountId: account.id };
    }

    if (!paymentMethod) return { paymentMethod: null, accountId: undefined };

    const method = await db.paymentMethod.findFirst({
        where: { tenant_id: tenantId, name: paymentMethod, is_active: true },
        select: { account_id: true, type: true },
    });
    if (method?.account_id) return { paymentMethod, accountId: method.account_id };

    let mode = classifyPaymentMode(paymentMethod);
    if (mode === 'cash' && method?.type) mode = classifyPaymentMode(method.type);
    // 'credit' moves no money, and cash is the rule's own default account.
    if (mode === 'cash' || mode === 'credit') return { paymentMethod, accountId: undefined };

    const modeRule = await db.postingRule.findFirst({
        where: {
            tenant_id: tenantId,
            event_type: 'sale',
            is_active: true,
            condition_key: 'payment_mode',
            condition_value: mode,
        },
        orderBy: [{ priority: 'asc' }, { updated_at: 'desc' }],
        select: { debit_account_id: true },
    });
    return { paymentMethod, accountId: modeRule?.debit_account_id ?? undefined };
}
