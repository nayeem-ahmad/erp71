import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { platformAdminUserWhere } from '../auth/platform-admin.util';

export const PLATFORM_WORKSPACE_NAME = 'ERP71 Platform';

export interface PlatformWorkspaceSummary {
    id: string;
    name: string;
    timezone: string;
}

/**
 * The platform team's own workspace.
 *
 * Project management is tenant-scoped from the schema up: every project, task,
 * board, sprint and hour log carries a `tenant_id`, and `TenantInterceptor`
 * refuses a request that resolves to no tenant. Platform staff sign into the
 * admin console with no tenant at all, so the module was simply unreachable for
 * them — not disabled, absent.
 *
 * Teaching two dozen tables a second, tenant-less scope would have meant
 * touching every project query in the codebase for one internal use. Instead the
 * platform gets one real tenant, flagged `is_platform_workspace`, that every
 * platform admin belongs to as OWNER. The whole module then works unchanged, and
 * the flag is what keeps the row out of everything that means "customer":
 * tenant listings, platform metrics and the account chooser all exclude it.
 *
 * OWNER is deliberate rather than lazy. `StorePermissionGuard` and
 * `ProjectAccessService` both treat OWNER as holding every permission, which is
 * what lets the workspace work with no stores — and a platform admin already has
 * unrestricted reach over every workspace on the platform, so the membership
 * grants no access they did not have.
 */
@Injectable()
export class PlatformWorkspaceService {
    private readonly logger = new Logger(PlatformWorkspaceService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly platformSettings: PlatformSettingsService,
    ) {}

    /** The workspace, if it has ever been provisioned. Never creates one. */
    async find(): Promise<PlatformWorkspaceSummary | null> {
        return this.db.tenant.findFirst({
            where: { is_platform_workspace: true, deleted_at: null },
            select: { id: true, name: true, timezone: true },
        });
    }

    /**
     * The workspace the calling platform admin should act in, provisioning it on
     * first use and making sure they are a member of it.
     *
     * Lazy rather than seeded: most deployments never open the module, and a
     * tenant row that exists only because a migration ran is a row every
     * "how many workspaces are there" query has to remember to exclude.
     */
    async resolveForAdmin(userId: string): Promise<PlatformWorkspaceSummary> {
        if (!(await this.platformSettings.isFeatureEnabled('platformProjects'))) {
            throw new ForbiddenException(
                'The platform project workspace has been switched off by a platform administrator.',
            );
        }

        const existing = await this.find();
        const workspace = existing ?? (await this.provision(userId));

        // Keeps the assignee list level with the admin roster, so someone
        // promoted yesterday can be given a task today without having opened the
        // module themselves. `skipDuplicates` makes this a no-op once everyone is
        // in, which is every call after the first.
        await this.syncAdminMembers(workspace.id);
        // Belt and braces for the one invariant the whole feature rests on: the
        // caller must be a member, or every project page 403s. The roster query
        // above should already have covered them — it reads admins the same way
        // `PlatformAdminGuard` does — and this costs one upsert to guarantee it.
        await this.ensureMembership(workspace.id, userId);
        return workspace;
    }

    /**
     * Create the workspace, owned by whoever opened it first.
     *
     * `is_platform_workspace` carries a partial unique index, so two admins
     * racing here cannot both win: the loser's insert fails and it re-reads the
     * row the winner wrote, which is why the catch swallows only a failure that
     * a workspace now exists to explain.
     */
    private async provision(userId: string): Promise<PlatformWorkspaceSummary> {
        try {
            const tenant = await this.db.tenant.create({
                data: {
                    name: PLATFORM_WORKSPACE_NAME,
                    owner_id: userId,
                    is_platform_workspace: true,
                    // The module is internal tooling, not a subscription: it is
                    // reached from the admin console rather than through a plan,
                    // so this workspace deliberately has no subscription, no
                    // stores and no storefront. The override pins the project
                    // module on for it regardless of the tenant-facing switch,
                    // which is about what shops are sold, not what staff use.
                    feature_overrides: { projects: true },
                },
                select: { id: true, name: true, timezone: true },
            });

            this.logger.log(`Provisioned the platform project workspace (${tenant.id})`);
            return tenant;
        } catch (error) {
            const existing = await this.find();
            if (existing) return existing;
            throw error;
        }
    }

    /** Idempotent OWNER membership for one admin. */
    private async ensureMembership(tenantId: string, userId: string): Promise<void> {
        await this.db.tenantUser.upsert({
            where: { tenant_id_user_id: { tenant_id: tenantId, user_id: userId } },
            create: { tenant_id: tenantId, user_id: userId, role: 'OWNER' },
            // An existing row is left exactly as it is. Someone may have been
            // stepped down on purpose, and a login should not quietly undo that.
            update: {},
        });
    }

    /**
     * Add every current platform admin as a member.
     *
     * Only ever adds. Removing an admin from the workspace when their platform
     * flag is cleared would orphan their task assignments and hour logs, which is
     * a heavier consequence than a stale name in the assignee list.
     */
    private async syncAdminMembers(tenantId: string): Promise<number> {
        const admins = await this.db.user.findMany({
            where: platformAdminUserWhere(),
            select: { id: true },
        });

        if (admins.length === 0) return 0;

        const result = await this.db.tenantUser.createMany({
            data: admins.map((admin) => ({
                tenant_id: tenantId,
                user_id: admin.id,
                role: 'OWNER' as const,
            })),
            skipDuplicates: true,
        });

        return result.count;
    }
}
