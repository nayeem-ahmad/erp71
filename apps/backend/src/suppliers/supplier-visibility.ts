/**
 * Which suppliers a member may see.
 *
 * Every supplier belongs to one branch (`Supplier.store_id`), and a member
 * limited to some branches sees only the suppliers of those branches — in
 * lists, pickers, detail, ledgers, payments. Owners and
 * `VIEW_CONSOLIDATED_REPORTS` holders see every supplier. Mirrors
 * `customers/customer-visibility.ts`.
 *
 * A scope is either `null` — the whole tenant, no filter — or the branch ids a
 * supplier must belong to one of. `SupplierScopeService` decides it per request.
 */
export type SupplierScope = readonly string[] | null;

/** Prisma `where` fragment on a supplier. */
export function supplierScopeWhere(scope: SupplierScope): { store_id?: { in: string[] } } {
    return scope ? { store_id: { in: [...scope] } } : {};
}

/** Prisma `where` fragment on a row that belongs to a supplier (credit rows, allocations). */
export function supplierRowScopeWhere(scope: SupplierScope): { supplier?: { store_id: { in: string[] } } } {
    return scope ? { supplier: { store_id: { in: [...scope] } } } : {};
}
