/**
 * Creates the per-module role templates for tenants that already existed when
 * `TENANT_ROLE_TEMPLATES` shipped, and backfills the multi-role join tables.
 *
 * Why this is needed
 * ------------------
 * `seedDefaultTenantRoles` runs exactly once per tenant, at signup. A template
 * added to `TENANT_ROLE_TEMPLATES` afterwards therefore reaches **no existing
 * workspace** — every one of them keeps only the three legacy roles and an owner
 * sees no Sales Manager to assign. Same trap `sync-role-permissions.ts` was
 * written for, and for the same reason: production never runs migrations. The
 * backend container reconciles its schema with `prisma db push` on boot
 * (apps/backend/Dockerfile) and applies no migration files, so a backfill living
 * in `prisma/migrations/` reaches nobody.
 *
 * What it does, and what it deliberately does not
 * -----------------------------------------------
 * Per tenant it creates the templates that are missing, matched on
 * `TenantRole.template_key` so an owner who renamed their copy does not get a
 * second one. An existing template role is then left completely alone — its
 * permissions are never reconciled against the template.
 *
 * That is the same non-destructive rule `sync-role-permissions.ts` follows, and
 * for the same reason: an owner may edit a system role, so a permission absent
 * from their copy can mean either "the template gained it after they were
 * seeded" or "they took it away on purpose", and the two are indistinguishable
 * from the row's absence. Widening a template later therefore needs its own
 * backfill group in `sync-role-permissions.ts`, not a change here.
 *
 * A name collision is skipped rather than renamed: `TenantRole` is unique on
 * (tenant, name), so a workspace that already has a hand-written "Sales Manager"
 * keeps theirs untouched and simply does not get the seeded one.
 *
 * The join backfill gives every member and every pending invitation a
 * `TenantUserRole` / `UserInvitationRole` row for the single role they already
 * hold, so multi-role reads see the access they have today rather than none.
 *
 * Idempotent, and safe to re-run: it sits in the container start chain and runs
 * on every deploy.
 *
 * Usage:
 *   npx tsx prisma/sync-tenant-role-templates.ts --dry-run
 *   npx tsx prisma/sync-tenant-role-templates.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';
import { TENANT_ROLE_TEMPLATES } from '@erp71/shared-types';

const prisma = new PrismaClient();

export interface TemplateSyncResult {
    /** Tenants examined. */
    tenants: number;
    /** `TenantRole` rows created. */
    rolesCreated: number;
    /** `TenantRolePermission` rows written for those roles. */
    permissionsCreated: number;
    /** Templates skipped because the tenant already has a role of that name. */
    nameCollisions: number;
    /** `TenantUserRole` rows backfilled from `TenantUser.tenant_role_id`. */
    memberRolesBackfilled: number;
    /** `UserInvitationRole` rows backfilled from `UserInvitation.tenant_role_id`. */
    invitationRolesBackfilled: number;
}

export async function syncTenantRoleTemplates(
    prisma: any,
    options: { dryRun?: boolean } = {},
): Promise<TemplateSyncResult> {
    const dryRun = options.dryRun ?? false;
    const result: TemplateSyncResult = {
        tenants: 0,
        rolesCreated: 0,
        permissionsCreated: 0,
        nameCollisions: 0,
        memberRolesBackfilled: 0,
        invitationRolesBackfilled: 0,
    };

    const tenants = await prisma.tenant.findMany({ select: { id: true } });
    result.tenants = tenants.length;

    for (const tenant of tenants) {
        const existing = await prisma.tenantRole.findMany({
            where: { tenant_id: tenant.id },
            select: { name: true, template_key: true },
        });
        const seededKeys = new Set(existing.map((role: any) => role.template_key).filter(Boolean));
        const takenNames = new Set(existing.map((role: any) => role.name.trim().toLowerCase()));

        for (const template of TENANT_ROLE_TEMPLATES) {
            if (seededKeys.has(template.key)) continue;
            if (takenNames.has(template.name.toLowerCase())) {
                result.nameCollisions += 1;
                continue;
            }

            result.rolesCreated += 1;
            result.permissionsCreated += template.permissions.length;
            if (dryRun) continue;

            const role = await prisma.tenantRole.create({
                data: {
                    tenant_id: tenant.id,
                    name: template.name,
                    description: template.description,
                    is_system: true,
                    template_key: template.key,
                },
            });
            if (template.permissions.length > 0) {
                await prisma.tenantRolePermission.createMany({
                    data: template.permissions.map((permission) => ({
                        tenant_role_id: role.id,
                        permission,
                    })),
                    skipDuplicates: true,
                });
            }
        }
    }

    // Members whose single role has no join row yet — everybody who existed before
    // multi-role, and anybody a legacy code path assigned since.
    const members = await prisma.tenantUser.findMany({
        where: { tenant_role_id: { not: null }, roles: { none: {} } },
        select: { id: true, tenant_role_id: true },
    });
    result.memberRolesBackfilled = members.length;
    if (!dryRun && members.length > 0) {
        await prisma.tenantUserRole.createMany({
            data: members.map((member: any) => ({
                tenant_user_id: member.id,
                tenant_role_id: member.tenant_role_id,
            })),
            skipDuplicates: true,
        });
    }

    const invitations = await prisma.userInvitation.findMany({
        where: { accepted_at: null, roles: { none: {} } },
        select: { id: true, tenant_role_id: true },
    });
    result.invitationRolesBackfilled = invitations.length;
    if (!dryRun && invitations.length > 0) {
        await prisma.userInvitationRole.createMany({
            data: invitations.map((invitation: any) => ({
                invitation_id: invitation.id,
                tenant_role_id: invitation.tenant_role_id,
            })),
            skipDuplicates: true,
        });
    }

    return result;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    console.log(`Sync tenant role templates (${dryRun ? 'DRY RUN' : 'LIVE'})`);

    const result = await syncTenantRoleTemplates(prisma, { dryRun });

    if (result.rolesCreated === 0) {
        console.log(`  ${result.tenants} tenant(s) already hold every role template. Nothing to create.`);
    } else {
        console.log(
            `  ${dryRun ? 'would create' : 'created'} ${result.rolesCreated} role(s) ` +
            `with ${result.permissionsCreated} permission(s) across ${result.tenants} tenant(s).`,
        );
    }
    if (result.nameCollisions > 0) {
        console.log(
            `  ${result.nameCollisions} template(s) skipped: the tenant already has a role of that name.`,
        );
    }
    if (result.memberRolesBackfilled > 0 || result.invitationRolesBackfilled > 0) {
        console.log(
            `  ${dryRun ? 'would backfill' : 'backfilled'} ${result.memberRolesBackfilled} member role ` +
            `assignment(s) and ${result.invitationRolesBackfilled} pending invitation role(s).`,
        );
    }

    if (dryRun) console.log('DRY RUN — nothing was written.');
}

// Only run when invoked directly, so importing the sync from a test or another
// script does not fire a live write.
if (require.main === module) {
    main()
        .catch((error) => {
            console.error(error);
            process.exit(1);
        })
        .finally(() => prisma.$disconnect());
}
