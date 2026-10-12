/**
 * Which customers a member may see.
 *
 * Every customer belongs to one branch (`Customer.store_id`), and a member
 * limited to some branches sees only the customers of those branches — not
 * customers of another branch who happen to have bought here. Owners and
 * `VIEW_CONSOLIDATED_REPORTS` holders see every customer.
 *
 * A scope is either `null` — the whole tenant, no filter — or the branch ids a
 * customer must belong to one of. `CustomerScopeService` decides it per request;
 * everything here is pure so the service and its specs share one definition.
 */
export type CustomerScope = readonly string[] | null;

/** Prisma `where` fragment: the customer belongs to one of `storeIds`. */
export function customerInBranchesWhere(storeIds: readonly string[]) {
    return { store_id: { in: [...storeIds] } };
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
