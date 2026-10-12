import type { BillAllocationInput, OpenBill } from './types';

/** Bill id → the amount typed against it, as the inputs hold it. */
export type BillAllocations = Record<string, string>;

function paisa(value: number): number {
    return Math.round(value * 100) / 100;
}

function parsed(value: string | undefined): number {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Spreads a payment over open bills in the order given — the server lists them
 * oldest first — filling each before moving on. Whatever is left after the
 * last bill stays unallocated, as an advance.
 */
export function allocateOldestFirst(bills: OpenBill[], total: number): BillAllocations {
    let left = paisa(Math.max(0, total));
    const result: BillAllocations = {};
    for (const bill of bills) {
        const take = paisa(Math.min(left, Math.max(0, bill.balance_due)));
        result[bill.id] = take > 0 ? String(take) : '';
        left = paisa(left - take);
    }
    return result;
}

export function allocationTotal(allocations: BillAllocations): number {
    return paisa(Object.values(allocations).reduce((sum, value) => sum + parsed(value), 0));
}

export function allocationsToSend(allocations: BillAllocations): BillAllocationInput[] {
    return Object.entries(allocations)
        .map(([purchaseId, value]) => ({ purchaseId, amount: parsed(value) }))
        .filter((allocation) => allocation.amount > 0);
}
