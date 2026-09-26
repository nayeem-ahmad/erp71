export interface CustomerCreditInfo {
    credit_limit?: number | string | null;
    due_balance?: number | string | null;
}

export function creditDueAmount(total: number, amountPaid: number): number {
    return Math.max(0, total - amountPaid);
}

/**
 * The dues an invoice closes on, the way a memo does: what this invoice left
 * unpaid, what the customer owed before it, and the two together.
 */
export interface InvoiceDues {
    paid: number;
    /** This invoice's unpaid part. */
    invoiceDue: number;
    /** What the customer owed before this invoice. Negative is an advance. */
    previousDue: number;
    /** `previousDue + invoiceDue` — what they owe with this invoice standing. */
    totalDue: number;
}

const toPaisa = (value: number) => Math.round(value * 100) / 100;

/**
 * Null when there is nobody to owe anything — a walk-in sale, or a cancelled
 * one, comes with no previous due — and when nothing is owed either way, so a
 * settled invoice to a customer who owes nothing prints as it always has.
 */
export function invoiceDues(
    total: number,
    paid: number,
    previousDue: number | null | undefined,
): InvoiceDues | null {
    if (previousDue == null || ![previousDue, total, paid].every(Number.isFinite)) return null;

    const invoiceDue = toPaisa(creditDueAmount(total, paid));
    if (Math.abs(previousDue) <= 0.005 && invoiceDue <= 0.005) return null;

    return {
        paid,
        invoiceDue,
        previousDue,
        totalDue: toPaisa(previousDue + invoiceDue),
    };
}

export function availableCustomerCredit(customer: CustomerCreditInfo | null | undefined): number | null {
    if (!customer || customer.credit_limit == null || customer.credit_limit === '') return null;
    const limit = Number(customer.credit_limit);
    if (!Number.isFinite(limit) || limit <= 0) return null;
    const currentDue = Number(customer.due_balance ?? 0) || 0;
    return Math.max(0, limit - currentDue);
}

export function canKeepDue(
    customer: CustomerCreditInfo | null | undefined,
    creditDue: number,
): { allowed: boolean; reason?: string } {
    if (creditDue <= 0.005) return { allowed: true };
    if (!customer) {
        return { allowed: false, reason: 'Select a customer to keep due on this sale.' };
    }

    const available = availableCustomerCredit(customer);
    if (available == null) {
        return {
            allowed: false,
            reason: 'This customer has no credit limit. Set a credit limit before selling on credit.',
        };
    }

    if (creditDue > available + 0.005) {
        return {
            allowed: false,
            reason: `Credit limit exceeded. Available credit: ৳${available.toFixed(2)}; this sale would add ৳${creditDue.toFixed(2)} due.`,
        };
    }

    return { allowed: true };
}