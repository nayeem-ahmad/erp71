/**
 * Carries CANCEL_ENTRY to the Tenant Admin role of tenants that existed before
 * entry cancellation shipped, and to the members holding it.
 *
 * Why this needs its own script
 * ----------------------------
 * `sync-role-permissions.ts` is the general backfill, but it deliberately reads
 * `where: { is_system: true, template_key: null }` — it reconciles the three
 * legacy roles (Manager, Cashier, Accountant) against
 * `ROLE_DEFAULT_PERMISSIONS`, and template roles are excluded because their
 * permissions come from `TENANT_ROLE_TEMPLATES` instead. CANCEL_ENTRY belongs to
 * exactly one template role and to none of the three legacy ones, so it falls
 * through that script entirely.
 *
 * `sync-tenant-role-templates.ts` does not close the gap either: it *creates*
 * missing template roles and never reconciles the permissions of one that
 * already exists, on purpose — an owner may edit a system role, so a permission
 * absent from it can mean "the role predates the permission" or "the owner took
 * it away", and those two are indistinguishable from the row's absence.
 *
 * Why not a migration
 * -------------------
 * Production never runs migrations. The backend container reconciles its schema
 * with `prisma db push` on boot (apps/backend/Dockerfile) and applies no
 * migration files, so a backfill living in `prisma/migrations/` reaches exactly
 * nobody.
 *
 * Scope is deliberately narrow
 * ----------------------------
 * Only the `tenant_admin` template role, matched on `template_key` so a renamed
 * copy still gets it. OWNER bypasses every permission check and needs no grant.
 * No module role receives it: cancelling a posted entry reverses stock, party
 * balances and the ledger in one move, and the person who records entries must
 * not be the one who erases them.
 *
 * Additive and idempotent, so it is safe on every deploy.
 *
 * Usage:
 *   npx tsx prisma/sync-cancel-entry-permission.ts --dry-run
 *   npx tsx prisma/sync-cancel-entry-permission.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';
import { StorePermission } from '@erp71/shared-types';

const prisma = new PrismaClient();

/** `TenantRole.template_key` of the role this permission belongs to. */
const TENANT_ADMIN_TEMPLATE_KEY = 'tenant_admin';

export interface SyncResult {
    /** Roles that gained the permission. */
    roleGrants: number;
    /** user/store pairs that gained the materialized copy. */
    memberGrants: number;
}

export async function syncCancelEntryPermission(
    prisma: any,
    options: { dryRun?: boolean } = {},
): Promise<SyncResult> {
    const permission = StorePermission.CANCEL_ENTRY;

    const roles = await prisma.tenantRole.findMany({
        where: { template_key: TENANT_ADMIN_TEMPLATE_KEY },
        select: { id: true, tenant_id: true },
    });

    if (roles.length === 0) {
        return { roleGrants: 0, memberGrants: 0 };
    }

    const roleIds = roles.map((role: any) => role.id);
    const existing = await prisma.tenantRolePermission.findMany({
        where: { tenant_role_id: { in: roleIds }, permission },
        select: { tenant_role_id: true },
    });
    const alreadyGranted = new Set(existing.map((row: any) => row.tenant_role_id));
    const missingRoles = roles.filter((role: any) => !alreadyGranted.has(role.id));

    // Members carry their own materialized copy of every role permission,
    // written when the role was assigned — so granting the role alone leaves
    // every current Tenant Admin without the capability.
    //
    // Read through `TenantUserRole` rather than the legacy `tenant_role_id`
    // column: a member holds a set of roles, and Tenant Admin may be any of
    // them rather than their primary.
    const assignments = await prisma.tenantUserRole.findMany({
        where: { tenant_role_id: { in: roleIds } },
        select: { tenantUser: { select: { user_id: true, tenant_id: true } } },
    });
    const members = assignments.map((row: any) => row.tenantUser);

    const access = members.length === 0 ? [] : await prisma.userStoreAccess.findMany({
        where: { user_id: { in: [...new Set(members.map((member: any) => member.user_id))] } },
        select: { user_id: true, store_id: true, tenant_id: true },
    });

    // A user can belong to several tenants; only their stores in the tenant that
    // granted the role may receive the permission.
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
                // No human granted this; attribute it to the member's own row
                // rather than inventing an actor.
                granted_by: a.user_id,
            })),
            skipDuplicates: true,
        });
    }

    return { roleGrants: missingRoles.length, memberGrants: missingMembers.length };
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    console.log(`Sync CANCEL_ENTRY permission (${dryRun ? 'DRY RUN' : 'LIVE'})`);

    const result = await syncCancelEntryPermission(prisma, { dryRun });

    if (result.roleGrants === 0 && result.memberGrants === 0) {
        console.log('  Every Tenant Admin role already holds CANCEL_ENTRY. Nothing to do.');
        return;
    }

    console.log(
        `  ${dryRun ? 'would grant' : 'granted'} CANCEL_ENTRY to ${result.roleGrants} role(s) ` +
        `and ${result.memberGrants} member/store pair(s).`,
    );
    if (dryRun) console.log('DRY RUN — nothing was written.');
}

// Only run when invoked directly, so importing the reconciler from a test or
// another script does not fire a live sync.
if (require.main === module) {
    main()
        .catch((error) => {
            console.error(error);
            process.exit(1);
        })
        .finally(() => prisma.$disconnect());
}
