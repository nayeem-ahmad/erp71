export function hasPermission(permissions: string[] | undefined, perm: string): boolean {
    return Boolean(permissions?.includes(perm));
}

export function isOwner(role: string | null | undefined): boolean {
    return role === 'OWNER';
}

/**
 * The workspace row of an `/auth/me` payload — the one this tab is in, falling
 * back to the only one the account has.
 *
 * The pages that need a permission read it off this row; extracted because the
 * find-by-remembered-id idiom was being written out at every call site.
 */
export function tenantFromMe<T extends { id: string }>(
    me: { tenants?: T[] } | null | undefined,
    tenantId: string | null | undefined,
): T | undefined {
    const tenants = me?.tenants;
    if (!tenants || tenants.length === 0) return undefined;
    return tenants.find((tenant) => tenant.id === tenantId) ?? tenants[0];
}

/**
 * Whether this member reads only the records they are on — `record_scope`,
 * resolved server-side as the widest scope across the roles they hold.
 *
 * The server filters either way (`ProjectAccessService`); this is for not
 * offering a person filter whose every other option returns nothing. Owners are
 * never narrow, matching the server.
 */
export function readsOwnRecordsOnly(
    tenant: { role?: string | null; record_scope?: string | null } | null | undefined,
): boolean {
    if (!tenant || isOwner(tenant.role)) return false;
    return tenant.record_scope === 'OWN';
}
