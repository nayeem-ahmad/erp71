import { StorePermission } from '@erp71/shared-types';

type SyncParams = {
    tenantId: string;
    userIds: string[];
    grantedBy: string;
};

/**
 * Rewrites the materialized `UserStorePermission` rows for the given members
 * from the roles they currently hold.
 *
 * A member's effective access is the **union** of every `TenantRole` in their
 * `TenantUserRole` set — hold Sales Manager and Accounting User and you get both
 * permission sets. The union is read per member rather than passed in, because
 * two members of the same role rarely hold the same *set* of roles: re-syncing
 * them from one role alone would silently strip everything their other roles
 * grant.
 *
 * Every permission the member had is deleted first, so this also revokes what a
 * removed role used to grant. Per-branch overrides made by hand
 * (`team.service.ts#setStorePermissions`) are deleted with them — reassigning
 * roles has always reset a member to what their roles say, and that stays true.
 *
 * Returns the number of members whose permissions were rewritten.
 */
export async function syncMemberPermissionsFromRoles(tx: any, params: SyncParams): Promise<number> {
    const { tenantId, userIds, grantedBy } = params;
    if (userIds.length === 0) return 0;

    const memberships = await tx.tenantUser.findMany({
        where: { tenant_id: tenantId, user_id: { in: userIds } },
        select: {
            user_id: true,
            roles: { select: { tenantRole: { select: { permissions: { select: { permission: true } } } } } },
        },
    });

    const permissionsByUser = new Map<string, StorePermission[]>();
    for (const membership of memberships) {
        const union = new Set<StorePermission>();
        for (const assignment of membership.roles) {
            for (const row of assignment.tenantRole.permissions) union.add(row.permission);
        }
        permissionsByUser.set(membership.user_id, [...union]);
    }

    const accessRows = await tx.userStoreAccess.findMany({
        where: { tenant_id: tenantId, user_id: { in: userIds } },
        select: { user_id: true, store_id: true },
    });

    await tx.userStorePermission.deleteMany({
        where: { tenant_id: tenantId, user_id: { in: userIds } },
    });

    const data = accessRows.flatMap((access: any) =>
        (permissionsByUser.get(access.user_id) ?? []).map((permission) => ({
            user_id: access.user_id,
            store_id: access.store_id,
            tenant_id: tenantId,
            permission,
            granted_by: grantedBy,
        })),
    );

    if (data.length > 0) {
        await tx.userStorePermission.createMany({ data, skipDuplicates: true });
    }

    return userIds.length;
}

/**
 * Replaces a member's role set and rewrites their permissions to match.
 *
 * `tenant_role_id` on `TenantUser` is kept pointing at the first role of the set:
 * it is still what every pre-multi-role read joins on, and it is the name the
 * caller derives the coarse `TenantUser.role` enum from.
 */
export async function setMemberRoles(
    tx: any,
    params: { tenantId: string; userId: string; tenantRoleIds: string[]; grantedBy: string },
): Promise<void> {
    const { tenantId, userId, tenantRoleIds, grantedBy } = params;

    const membership = await tx.tenantUser.findUnique({
        where: { tenant_id_user_id: { tenant_id: tenantId, user_id: userId } },
        select: { id: true },
    });
    if (!membership) return;

    await tx.tenantUserRole.deleteMany({
        where: { tenant_user_id: membership.id, tenant_role_id: { notIn: tenantRoleIds } },
    });
    await tx.tenantUserRole.createMany({
        data: tenantRoleIds.map((tenant_role_id) => ({ tenant_user_id: membership.id, tenant_role_id })),
        skipDuplicates: true,
    });

    await syncMemberPermissionsFromRoles(tx, { tenantId, userIds: [userId], grantedBy });
}
