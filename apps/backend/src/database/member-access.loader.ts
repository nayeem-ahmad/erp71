import { DatabaseService } from './database.service';
import { AuthCacheService } from './auth-cache.service';

/**
 * The rest of a member's per-request authorization context, next to the
 * membership row in `tenant-membership.loader.ts`: which branches they may use
 * in a workspace, what they may do in each, and whether a branch named in a
 * header belongs to the workspace at all.
 *
 * Each answer has exactly one loader, here, because each is cached under one
 * key in `AuthCacheService`: two callers reading the same key with different
 * `select`s would hand each other rows missing the fields they need.
 *
 * Each reads the whole answer for the member and workspace — every branch,
 * every permission — rather than only the slice one request asks about, so the
 * next request, which usually asks about a different branch or permission, is
 * answered from the same entry. The sets are small: a branch count bounded by
 * the plan, times the permissions a role grants.
 */

/** One branch the member may use. */
export interface MemberStoreAccess {
    store_id: string;
    access_level: string;
}

/** Store id → the permissions the member holds there. */
export type MemberStoreGrants = ReadonlyMap<string, ReadonlySet<string>>;

/** `storeAccess:{userId}:{tenantId}`. */
export function loadMemberStoreAccess(
    db: DatabaseService,
    authCache: AuthCacheService,
    userId: string,
    tenantId: string,
): Promise<readonly MemberStoreAccess[]> {
    return authCache.storeAccess(userId, tenantId, () =>
        db.userStoreAccess.findMany({
            where: { user_id: userId, tenant_id: tenantId },
            select: { store_id: true, access_level: true },
        }),
    );
}

/**
 * The single branch a member can use, when they can use exactly one — the
 * store a request without an `x-store-id` header is taken to mean.
 */
export function soleStoreId(access: readonly MemberStoreAccess[]): string | undefined {
    return access.length === 1 ? access[0].store_id : undefined;
}

/**
 * `grants:{userId}:{tenantId}`. Scoped to the workspace as well as the member:
 * a member can own a workspace — and a store with every permission — of their
 * own, and without `tenant_id` that store's grants would answer for a workspace
 * they merely belong to.
 */
export function loadMemberStoreGrants(
    db: DatabaseService,
    authCache: AuthCacheService,
    userId: string,
    tenantId: string,
): Promise<MemberStoreGrants> {
    return authCache.grants(userId, tenantId, async () => {
        const rows = await db.userStorePermission.findMany({
            where: { user_id: userId, tenant_id: tenantId },
            select: { store_id: true, permission: true },
        });

        const byStore = new Map<string, Set<string>>();
        for (const row of rows) {
            let held = byStore.get(row.store_id);
            if (!held) {
                held = new Set();
                byStore.set(row.store_id, held);
            }
            held.add(row.permission);
        }
        return byStore;
    });
}

/** `store:{tenantId}:{storeId}` — whether the branch belongs to the workspace. */
export async function storeBelongsToTenant(
    db: DatabaseService,
    authCache: AuthCacheService,
    tenantId: string,
    storeId: string,
): Promise<boolean> {
    const store = await authCache.tenantStore(tenantId, storeId, () =>
        db.store.findFirst({
            where: { id: storeId, tenant_id: tenantId },
            select: { id: true },
        }),
    );
    return store !== null && store !== undefined;
}
