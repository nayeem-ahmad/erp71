import { BadRequestException } from '@nestjs/common';
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

export interface CreditPaymentMethod {
    id: string;
    name: string;
    account_id: string | null;
}

/**
 * The tender a customer or supplier payment was taken by, checked against the
 * tenant. An unknown, foreign or switched-off method is a 400 rather than a
 * quiet fall back to Cash in Hand: the operator picked one, and the money has
 * to land where they think it did.
 */
export async function resolveCreditPaymentMethod(
    db: Client,
    tenantId: string,
    methodId: string,
): Promise<CreditPaymentMethod> {
    const method = await db.paymentMethod.findFirst({
        where: { id: methodId, tenant_id: tenantId, is_active: true },
        select: { id: true, name: true, account_id: true },
    });
    if (!method) {
        throw new BadRequestException('That payment method does not exist or is switched off.');
    }
    return method;
}

/**
 * The account a payment's stored method is linked to today, for reposting an
 * edit that left the method alone. Deliberately ignores `is_active`: switching
 * a method off stops new payments using it, not old ones posting where they
 * always did.
 */
export async function storedPaymentMethodAccountId(
    db: Client,
    tenantId: string,
    methodId: string | null | undefined,
): Promise<string | undefined> {
    if (!methodId) return undefined;
    const method = await db.paymentMethod.findFirst({
        where: { id: methodId, tenant_id: tenantId },
        select: { account_id: true },
    });
    return method?.account_id ?? undefined;
}

/**
 * Which side of a payment voucher is the cash leg. Every customer and supplier
 * payment rule pairs the party's account with Cash in Hand: money coming in
 * debits cash, money going out credits it. Without an account the rule's own
 * Cash in Hand stands.
 */
export function cashLegOverride(
    flow: 'in' | 'out',
    accountId: string | null | undefined,
): { overrideDebitAccountId?: string; overrideCreditAccountId?: string } {
    if (!accountId) return {};
    return flow === 'in' ? { overrideDebitAccountId: accountId } : { overrideCreditAccountId: accountId };
}
