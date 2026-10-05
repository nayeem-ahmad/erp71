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
    /**
     * `previousDue + total - paid` — what they owe with this invoice standing.
     * Anything paid beyond the total comes off it, so it can go negative: the
     * customer is then in advance.
     */
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
    const totalDue = toPaisa(previousDue + total - paid);
    if (Math.abs(previousDue) <= 0.005 && Math.abs(totalDue) <= 0.005) return null;

    return {
        paid,
        invoiceDue,
        previousDue,
        totalDue: totalDue === 0 ? 0 : totalDue,
    };
}

/**
 * What becomes of money paid beyond a sale's total — the client-side mirror of
 * the server's `splitSaleOverpayment`, for the entry screen to warn with.
 *
 * On a customer's sale the excess settles their previous due first and stands
 * as an advance after that; neither is refused, but running past the previous
 * due is worth a warning, since it is as often a typo as a deposit. On a
 * walk-in sale there is no account to hold it, so it is change.
 */
export interface SaleOverpayment {
    /** Everything paid beyond the total. */
    excess: number;
    /** The part of it that settles what the customer already owed. */
    towardPreviousDue: number;
    /** The part past that, held on the customer's account. */
    advance: number;
    /** The part handed back — all of it on a walk-in sale. */
    change: number;
}

export function saleOverpayment(
    total: number,
    paid: number,
    customer: { previousDue: number | null | undefined } | null,
): SaleOverpayment | null {
    if (![total, paid].every(Number.isFinite) || paid - total <= 0.005) return null;
    const excess = toPaisa(paid - total);

    if (!customer) {
        return { excess, towardPreviousDue: 0, advance: 0, change: excess };
    }

    const owed = Math.max(0, Number(customer.previousDue ?? 0) || 0);
    const towardPreviousDue = toPaisa(Math.min(excess, owed));
    return {
        excess,
        towardPreviousDue,
        advance: toPaisa(excess - towardPreviousDue),
        change: 0,
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