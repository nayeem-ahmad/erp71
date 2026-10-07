/**
 * Which customers a member may see.
 *
 * Customers are company-level records, but a member limited to some branches
 * sees only the customers that belong to those branches: the ones added there
 * (`Customer.store_id`) and the ones with a sale there that was not cancelled.
 * Owners and `VIEW_CONSOLIDATED_REPORTS` holders see every customer.
 *
 * A scope is either `null` — the whole tenant, no filter — or the branch ids a
 * customer must belong to one of. `CustomerScopeService` decides it per request;
 * everything here is pure so the service and its specs share one definition.
 */
export type CustomerScope = readonly string[] | null;

/** Prisma `where` fragment: the customer belongs to one of `storeIds`. */
export function customerInBranchesWhere(storeIds: readonly string[]) {
    const ids = [...storeIds];
    return {
        OR: [
            { store_id: { in: ids } },
            { sales: { some: { store_id: { in: ids }, status: { not: 'CANCELLED' } } } },
        ],
    };
}

/**
 * The scope as a `where` to merge into a customer query. Wrapped in `AND` so it
 * cannot collide with a query's own `OR` (the list's search uses one).
 */
export function customerScopeWhere(scope: CustomerScope): { AND?: unknown[] } {
    return scope ? { AND: [customerInBranchesWhere(scope)] } : {};
}

/** The scope as a `where` on a sale, for the sales listed on a customer's pages. */
export function saleScopeWhere(scope: CustomerScope): { store_id?: { in: string[] } } {
    return scope ? { store_id: { in: [...scope] } } : {};
}
