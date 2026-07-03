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