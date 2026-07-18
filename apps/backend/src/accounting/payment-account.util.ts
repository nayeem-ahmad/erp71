import { Prisma, PrismaClient } from '@prisma/client';

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
