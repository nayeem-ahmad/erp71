import { BadRequestException } from '@nestjs/common';

export interface CustomerCreditSnapshot {
    credit_limit: number | null;
    due_balance: number;
}

export function creditDueAmount(totalAmount: number, amountPaid: number): number {
    return Math.max(0, totalAmount - amountPaid);
}

export function assertCustomerCreditForSale(
    customer: CustomerCreditSnapshot | null | undefined,
    creditDue: number,
): void {
    if (creditDue <= 0.005) return;

    if (!customer) {
        throw new BadRequestException(
            'Select a customer to keep due on this sale.',
        );
    }

    const limit = customer.credit_limit;
    if (limit == null || limit <= 0) {
        throw new BadRequestException(
            'This customer has no credit limit. Set a credit limit before selling on credit.',
        );
    }

    const currentDue = Number(customer.due_balance) || 0;
    const projectedDue = currentDue + creditDue;
    if (projectedDue > limit + 0.005) {
        const available = Math.max(0, limit - currentDue);
        throw new BadRequestException(
            `Credit limit exceeded. Available credit: ৳${available.toFixed(2)}; `
            + `this sale would add ৳${creditDue.toFixed(2)} due.`,
        );
    }
}