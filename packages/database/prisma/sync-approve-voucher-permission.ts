import { StorePermission } from '@erp71/shared-types';

/**
 * Grants APPROVE_VOUCHER to every existing tenant's system "Accountant" role.
 *
 * Why this is not just a migration
 * --------------------------------
 * Production never runs migrations. The backend container reconciles its schema
 * with `prisma db push` on boot (see apps/backend/Dockerfile) and applies no
 * migration files, so a backfill that lives only in `prisma/migrations/` reaches
 * exactly nobody. Same trap that caught the account-code rollout (commit
 * 409234e) — the migration is kept for local `migrate deploy`, and this runs on
 * the path that actually exists.
 *
 * Scope is deliberately narrow: only the system Accountant role, matching
 * ROLE_DEFAULT_PERMISSIONS in packages/shared-types. Managers and cashiers are
 * left out on purpose — letting whoever entered a voucher also approve it
 * defeats the control. Owners bypass permission checks entirely and need no
 * grant. The permission is inert until an owner turns approval on in accounting
 * settings, so this grants no new capability on its own.
 *
 * Additive and idempotent, so it is safe on every deploy.
 */

const ACCOUNTANT_ROLE_NAME = 'Accountant';

type SyncResult = { roleGrants: number; memberGrants: number };

export async function syncApproveVoucherPermission(
    prisma: any,
    options: { dryRun?: boolean } = {},
): Promise<SyncResult> {
    const permission = StorePermission.APPROVE_VOUCHER;

    const roles = await prisma.tenantRole.findMany({
        where: { is_system: true, name: ACCOUNTANT_ROLE_NAME },
        select: { id: true, tenant_id: true },
    });

    if (roles.length === 0) {
        return { roleGrants: 0, memberGrants: 0 };
    }

    const existing = await prisma.tenantRolePermission.findMany({
        where: { tenant_role_id: { in: roles.map((role: any) => role.id) }, permission },
        select: { tenant_role_id: true },
    });
    const alreadyGranted = new Set(existing.map((row: any) => row.tenant_role_id));
    const missingRoles = roles.filter((role: any) => !alreadyGranted.has(role.id));

    // Members carrying the role hold their own materialized copy of each
    // permission (userStorePermission), written when the role is assigned — so
    // granting the role alone would leave every current Accountant without it.
    const members = await prisma.tenantUser.findMany({
        where: { tenant_role_id: { in: roles.map((role: any) => role.id) } },
        select: { user_id: true, tenant_id: true },
    });

    const access = members.length === 0 ? [] : await prisma.userStoreAccess.findMany({
        where: { user_id: { in: members.map((member: any) => member.user_id) } },
        select: { user_id: true, store_id: true, tenant_id: true },
    });

    const memberKeys = new Set(members.map((m: any) => `${m.tenant_id}:${m.user_id}`));
    const wanted = access.filter((a: any) => memberKeys.has(`${a.tenant_id}:${a.user_id}`));

    const heldRows = wanted.length === 0 ? [] : await prisma.userStorePermission.findMany({
        where: {
            permission,
            user_id: { in: [...new Set(wanted.map((a: any) => a.user_id))] },
        },
        select: { user_id: true, store_id: true },
    });
    const held = new Set(heldRows.map((row: any) => `${row.user_id}:${row.store_id}`));
    const missingMembers = wanted.filter((a: any) => !held.has(`${a.user_id}:${a.store_id}`));

    if (options.dryRun) {
        return { roleGrants: missingRoles.length, memberGrants: missingMembers.length };
    }

    if (missingRoles.length > 0) {
        await prisma.tenantRolePermission.createMany({
            data: missingRoles.map((role: any) => ({ tenant_role_id: role.id, permission })),
            skipDuplicates: true,
        });
    }

    if (missingMembers.length > 0) {
        await prisma.userStorePermission.createMany({
            data: missingMembers.map((a: any) => ({
                user_id: a.user_id,
                store_id: a.store_id,
                tenant_id: a.tenant_id,
                permission,
                // No human granted this; attribute it to the user's own row rather
                // than inventing an actor.
                granted_by: a.user_id,
            })),
            skipDuplicates: true,
        });
    }

    return { roleGrants: missingRoles.length, memberGrants: missingMembers.length };
}
