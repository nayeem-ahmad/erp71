/**
 * Carries newly-added store permissions to the system roles — and the members
 * holding them — of tenants that already existed when the permission shipped.
 *
 * Why this is needed
 * ------------------
 * `ROLE_DEFAULT_PERMISSIONS` is read exactly twice: when a tenant is created
 * (`seedDefaultTenantRoles`) and when a member is assigned a role
 * (`syncMemberPermissionsFromRole`). A permission added to that table afterwards
 * therefore reaches **nobody who already exists** — their `TenantRole` rows were
 * written against the old list and their materialized `UserStorePermission`
 * copies against that. The code looks correct and the capability is simply
 * absent.
 *
 * It stays invisible because `StorePermissionGuard` short-circuits
 * `if (userRole === 'OWNER') return true`, so the tenant owner — the person who
 * tries a new module first — never touches the grant tables and sees everything
 * working. That is exactly how the Project Management module shipped with
 * **zero** `%PROJECT%` grants platform-wide and nobody noticed.
 *
 * Why not a migration
 * -------------------
 * Production never runs migrations. The backend container reconciles its schema
 * with `prisma db push` on boot (apps/backend/Dockerfile) and applies no
 * migration files, so a backfill living in `prisma/migrations/` reaches exactly
 * nobody. Same trap that caught the account-code rollout (commit 409234e).
 *
 * Explicit groups, not "grant anything missing"
 * ---------------------------------------------
 * An owner may edit a system role (`team.service.ts#updateRoleTemplate` has no
 * `is_system` guard), so a permission absent from a role can mean either "this
 * role predates the permission" or "the owner deliberately took it away". The
 * two are indistinguishable from the row's absence alone.
 *
 * Groups resolve that: a group is reconciled onto a role only when the role
 * holds **none** of its permissions. Holding even one means the group already
 * landed there once, so any later absence is a deliberate removal and is left
 * alone. That makes the script idempotent AND non-destructive on re-run, which
 * matters because it sits in the container start chain and runs on every deploy.
 *
 * Adding a group is therefore a deliberate act — list the permissions here once
 * they are in `ROLE_DEFAULT_PERMISSIONS`, and this carries them to existing
 * tenants. Which roles receive which permission is never decided here: it is
 * read from `ROLE_DEFAULT_PERMISSIONS`, so this file cannot drift from the
 * matrix it is backfilling.
 *
 * Note APPROVE_VOUCHER is NOT listed: it has its own script
 * (`sync-approve-voucher-permission.ts`, called from `sync-accounting.ts`) that
 * shipped before this one and is already deployed. Folding it in would change
 * its semantics on tenants where an owner has since removed it. See TODO.md.
 *
 * Usage:
 *   npx tsx prisma/sync-role-permissions.ts --dry-run
 *   npx tsx prisma/sync-role-permissions.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';
import {
    ROLE_DEFAULT_PERMISSIONS,
    StorePermission,
    SYSTEM_TENANT_ROLE_TO_USER_ROLE,
} from '@erp71/shared-types';

const prisma = new PrismaClient();

export interface PermissionGroup {
    /** Shown in the deploy log — name it after the module, not the permissions. */
    key: string;
    permissions: StorePermission[];
}

export const PERMISSION_BACKFILL_GROUPS: PermissionGroup[] = [
    {
        key: 'projects',
        permissions: [
            StorePermission.VIEW_PROJECTS,
            StorePermission.MANAGE_PROJECTS,
            StorePermission.MANAGE_PROJECT_TASKS,
            StorePermission.LOG_PROJECT_TIME,
            StorePermission.MANAGE_SPRINTS,
            StorePermission.MANAGE_PROJECT_SETTINGS,
        ],
    },
    {
        key: 'short-links',
        permissions: [
            StorePermission.MANAGE_SHORT_LINKS,
        ],
    },
    {
        // VIEW_PAYROLL is in the group but not in any role's defaults except
        // OWNER's, so this carries VIEW_HR to existing managers and leaves the
        // salary figures to a deliberate grant. Listing it anyway is what makes
        // the group's "already reconciled" test honest: a role that was given
        // VIEW_PAYROLL by hand must not then be handed VIEW_HR behind the
        // owner's back.
        key: 'hr',
        permissions: [
            StorePermission.VIEW_HR,
            StorePermission.VIEW_PAYROLL,
        ],
    },
    {
        // MANAGE_HR cannot join the `hr` group above: that group has already
        // reconciled onto every existing role, so the "holds none of its
        // permissions" test would skip it forever and the grant would reach
        // nobody. A permission added after a group has landed always needs a
        // new group — that is the cost of the non-destructive rule, not a bug
        // in it.
        //
        // Shipped with Phase 0 of the HRIS plan, which put `EmployeesController`
        // behind VIEW_HR/MANAGE_HR for the first time. Without this backfill a
        // manager keeps the employee list (VIEW_HR, carried by `hr`) but
        // silently loses the ability to add an employee.
        key: 'hr-manage',
        permissions: [
            StorePermission.MANAGE_HR,
        ],
    },
    {
        // The storefront blog ships dark: `TenantBlogSettings.enabled` defaults
        // to false, so this grant gives managers the module the moment an owner
        // switches it on rather than a screen they cannot open. PUBLISH_BLOG is
        // in the group but deliberately narrower in intent than MANAGE_BLOG —
        // writing a draft and putting it on the shop's public page are
        // different acts, and an owner may want them held by different people.
        key: 'blog',
        permissions: [
            StorePermission.VIEW_BLOG,
            StorePermission.MANAGE_BLOG,
            StorePermission.PUBLISH_BLOG,
        ],
    },
    {
        // Inventory > Demands. Both permissions in one group because they ship
        // together and no existing role holds either: `ROLE_DEFAULT_PERMISSIONS`
        // decides who actually gets what, which is Manager (both) and Cashier
        // (submit only).
        key: 'product-demands',
        permissions: [
            StorePermission.CREATE_PRODUCT_DEMAND,
            StorePermission.APPROVE_PRODUCT_DEMAND,
        ],
    },
];

export interface GroupResult {
    key: string;
    /** Role/permission pairs written to `TenantRolePermission`. */
    roleGrants: number;
    /** Roles that received at least one permission. */
    rolesTouched: number;
    /** user/store/permission triples written to `UserStorePermission`. */
    memberGrants: number;
    /** Roles skipped because they already hold part of the group. */
    rolesAlreadyReconciled: number;
    /** System roles whose name no longer maps to a base UserRole (renamed). */
    rolesUnmapped: number;
}

export async function syncRolePermissions(
    prisma: any,
    options: { dryRun?: boolean; groups?: PermissionGroup[] } = {},
): Promise<GroupResult[]> {
    const groups = options.groups ?? PERMISSION_BACKFILL_GROUPS;
    const dryRun = options.dryRun ?? false;

    const roles = await prisma.tenantRole.findMany({
        where: { is_system: true },
        select: { id: true, tenant_id: true, name: true },
    });
    if (roles.length === 0) {
        return groups.map((group) => emptyResult(group.key));
    }

    const roleIds = roles.map((role: any) => role.id);
    const results: GroupResult[] = [];

    for (const group of groups) {
        const result = emptyResult(group.key);

        const held = await prisma.tenantRolePermission.findMany({
            where: { tenant_role_id: { in: roleIds }, permission: { in: group.permissions } },
            select: { tenant_role_id: true },
        });
        const reconciled = new Set(held.map((row: any) => row.tenant_role_id));

        // roleId -> the group's permissions this role should gain
        const grantsByRole = new Map<string, StorePermission[]>();

        for (const role of roles) {
            if (reconciled.has(role.id)) {
                result.rolesAlreadyReconciled += 1;
                continue;
            }
            // Deliberately not `resolveBaseUserRole`, which falls back to CASHIER
            // for an unknown name: a renamed system role would then quietly be
            // reconciled as a cashier. Skip and report it instead.
            const baseRole = SYSTEM_TENANT_ROLE_TO_USER_ROLE[(role.name ?? '').trim()];
            if (!baseRole) {
                result.rolesUnmapped += 1;
                continue;
            }
            const defaults = ROLE_DEFAULT_PERMISSIONS[baseRole] ?? [];
            const wanted = group.permissions.filter((p) => defaults.includes(p));
            if (wanted.length === 0) continue;

            grantsByRole.set(role.id, wanted);
            result.roleGrants += wanted.length;
            result.rolesTouched += 1;
        }

        // Members carry their own materialized copy of every role permission,
        // written when the role was assigned — so granting the role alone leaves
        // every current member without the capability.
        const memberRows = grantsByRole.size === 0 ? [] : await prisma.tenantUser.findMany({
            where: { tenant_role_id: { in: [...grantsByRole.keys()] } },
            select: { user_id: true, tenant_id: true, tenant_role_id: true },
        });

        const access = memberRows.length === 0 ? [] : await prisma.userStoreAccess.findMany({
            where: { user_id: { in: [...new Set(memberRows.map((m: any) => m.user_id))] } },
            select: { user_id: true, store_id: true, tenant_id: true },
        });
        // A user can belong to several tenants; only their stores in the tenant
        // that granted the role may receive the permission.
        const accessByMember = new Map<string, { store_id: string; tenant_id: string }[]>();
        for (const row of access) {
            const key = `${row.tenant_id}:${row.user_id}`;
            const list = accessByMember.get(key) ?? [];
            list.push(row);
            accessByMember.set(key, list);
        }

        const memberData: {
            user_id: string;
            store_id: string;
            tenant_id: string;
            permission: StorePermission;
            granted_by: string;
        }[] = [];
        for (const member of memberRows) {
            const wanted = grantsByRole.get(member.tenant_role_id) ?? [];
            const stores = accessByMember.get(`${member.tenant_id}:${member.user_id}`) ?? [];
            for (const store of stores) {
                for (const permission of wanted) {
                    memberData.push({
                        user_id: member.user_id,
                        store_id: store.store_id,
                        tenant_id: member.tenant_id,
                        permission,
                        // No human granted this; attribute it to the member's own
                        // row rather than inventing an actor.
                        granted_by: member.user_id,
                    });
                }
            }
        }
        result.memberGrants = memberData.length;

        if (!dryRun && grantsByRole.size > 0) {
            await prisma.tenantRolePermission.createMany({
                data: [...grantsByRole.entries()].flatMap(([roleId, perms]) =>
                    perms.map((permission) => ({ tenant_role_id: roleId, permission })),
                ),
                skipDuplicates: true,
            });
            if (memberData.length > 0) {
                await prisma.userStorePermission.createMany({
                    data: memberData,
                    skipDuplicates: true,
                });
            }
        }

        results.push(result);
    }

    return results;
}

function emptyResult(key: string): GroupResult {
    return {
        key,
        roleGrants: 0,
        rolesTouched: 0,
        memberGrants: 0,
        rolesAlreadyReconciled: 0,
        rolesUnmapped: 0,
    };
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    console.log(`Sync role permissions (${dryRun ? 'DRY RUN' : 'LIVE'})`);

    const results = await syncRolePermissions(prisma, { dryRun });

    let wrote = false;
    for (const result of results) {
        if (result.roleGrants === 0 && result.memberGrants === 0) {
            console.log(`  ${result.key}: every system role already reconciled. Nothing to do.`);
        } else {
            wrote = true;
            console.log(
                `  ${result.key}: ${dryRun ? 'would grant' : 'granted'} ` +
                `${result.roleGrants} permission(s) across ${result.rolesTouched} role(s) ` +
                `and ${result.memberGrants} member/store pair(s).`,
            );
        }
        if (result.rolesUnmapped > 0) {
            // Loud but NOT a non-zero exit: this gates the backend's boot in the
            // Dockerfile && chain, and a renamed role must not take the app down.
            console.warn(
                `  WARNING: ${result.key}: ${result.rolesUnmapped} system role(s) have a name that no ` +
                `longer maps to a base role, so they were skipped. Grant them by hand in Team → Roles.`,
            );
        }
    }

    if (dryRun && wrote) console.log('DRY RUN — nothing was written.');
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
