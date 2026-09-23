export interface CustomerCreditInfo {
    credit_limit?: number | string | null;
    due_balance?: number | string | null;
}

export function creditDueAmount(total: number, amountPaid: number): number {
    return Math.max(0, total - amountPaid);
}

export function availableCustomerCredit(customer: CustomerCreditInfo | null | undefined): number | null {
    if (!customer || customer.credit_limit == null || customer.credit_limit === '') return null;
    const limit = Number(customer.credit_limit);
    if (!Number.isFinite(limit) || limit <= 0) return null;
    const currentDue = Number(customer.due_balance ?? 0) || 0;
    return Math.max(0, limit - currentDue);
}

/** Why a balance may not stand, so a caller can word it in the active locale. */
export type KeepDueBlock = 'noCustomer' | 'noCreditLimit' | 'creditLimitExceeded';

export interface KeepDueCheck {
    allowed: boolean;
    /** English explanation, kept for callers that do not translate. */
    reason?: string;
    code?: KeepDueBlock;
    /** Set with `creditLimitExceeded`: the credit left, and the due the sale would add. */
    available?: number;
    creditDue?: number;
}

export function canKeepDue(
    customer: CustomerCreditInfo | null | undefined,
    creditDue: number,
): KeepDueCheck {
    if (creditDue <= 0.005) return { allowed: true };
    if (!customer) {
        return { allowed: false, code: 'noCustomer', reason: 'Select a customer to keep due on this sale.' };
    }

    const available = availableCustomerCredit(customer);
    if (available == null) {
        return {
            allowed: false,
            code: 'noCreditLimit',
            reason: 'This customer has no credit limit. Set a credit limit before selling on credit.',
        };
    }

    if (creditDue > available + 0.005) {
        return {
            allowed: false,
            code: 'creditLimitExceeded',
            available,
            creditDue,
            reason: `Credit limit exceeded. Available credit: ৳${available.toFixed(2)}; this sale would add ৳${creditDue.toFixed(2)} due.`,
        };
    }

    return { allowed: true };
}
/**
 * `check.reason` in the caller's language. `messages` is the catalog's
 * `sales.entry.credit` block; the amounts are formatted exactly as the English
 * reason formats them, so an English screen reads the same either way.
 */
export function keepDueReason(
    check: KeepDueCheck,
    messages: { selectCustomer: string; noLimit: string; exceeded: string },
    format: (template: string, values: Record<string, string | number>) => string,
): string | undefined {
    if (check.allowed) return undefined;
    switch (check.code) {
        case 'noCustomer':
            return messages.selectCustomer;
        case 'noCreditLimit':
            return messages.noLimit;
        case 'creditLimitExceeded':
            return format(messages.exceeded, {
                available: `৳${(check.available ?? 0).toFixed(2)}`,
                due: `৳${(check.creditDue ?? 0).toFixed(2)}`,
            });
        default:
            return check.reason;
    }
}
