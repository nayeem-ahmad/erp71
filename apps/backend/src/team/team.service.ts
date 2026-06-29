import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { paginate, PaginatedResult } from '../common/pagination.dto';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { InvitationsService } from '../invitations/invitations.service';
import {
    ROLE_DEFAULT_PERMISSIONS,
    StorePermission,
    UserRole,
} from '@erp71/shared-types';
import { TenantContext } from '../database/tenant.decorator';

const VALID_PERMISSIONS = new Set<string>(Object.values(StorePermission));

@Injectable()
export class TeamService {
    constructor(
        private db: DatabaseService,
        private audit: AuditService,
        private invitations: InvitationsService,
    ) {}

    /* ----------------------------- Authorization ----------------------------- */

    /**
     * OWNER may always manage. Other roles need the given permission granted on the
     * branch they are currently operating from (the x-store-id context).
     *
     * Note: enforcement lives here rather than in StorePermissionGuard because the
     * tenant/store context is resolved by TenantInterceptor, which (being an
     * interceptor) runs after guards — so a guard cannot see request.storeId/userRole.
     */
    private async assertPermission(ctx: TenantContext, permission: StorePermission): Promise<void> {
        if (ctx.userRole === UserRole.OWNER) return;

        if (!ctx.storeId) {
            throw new ForbiddenException('Select a branch before managing team members.');
        }

        const grant = await this.db.userStorePermission.findFirst({
            where: { user_id: ctx.userId, store_id: ctx.storeId, permission: permission as any },
            select: { id: true },
        });

        if (!grant) {
            throw new ForbiddenException(`You do not have permission to ${permission}.`);
        }
    }

    private async getMembership(tenantId: string, userId: string) {
        const membership = await this.db.tenantUser.findUnique({
            where: { tenant_id_user_id: { tenant_id: tenantId, user_id: userId } },
        });
        if (!membership) throw new NotFoundException('User is not a member of this organization.');
        return membership;
    }

    private async countOwners(tenantId: string): Promise<number> {
        return this.db.tenantUser.count({ where: { tenant_id: tenantId, role: UserRole.OWNER } });
    }

    private auditCtx(ctx: TenantContext) {
        return { userId: ctx.userId, tenantId: ctx.tenantId };
    }

    /* -------------------------------- Reads ---------------------------------- */

    async listMembers(ctx: TenantContext, page = 1, limit = 100): Promise<PaginatedResult<unknown>> {
        await this.assertPermission(ctx, StorePermission.MANAGE_USERS);

        const where = { tenant_id: ctx.tenantId };
        const pageNum = Math.max(1, page ?? 1);
        const limitNum = Math.min(100, Math.max(1, limit ?? 100));
        const skip = (pageNum - 1) * limitNum;

        const [members, total, accessRows, permCounts] = await Promise.all([
            this.db.tenantUser.findMany({
                where,
                include: { user: { select: { id: true, email: true, name: true } } },
                orderBy: { user: { email: 'asc' } },
                skip,
                take: limitNum,
            }),
            this.db.tenantUser.count({ where }),
            this.db.userStoreAccess.findMany({
                where: { tenant_id: ctx.tenantId },
                include: { store: { select: { id: true, name: true } } },
            }),
            this.db.userStorePermission.groupBy({
                by: ['user_id', 'store_id'],
                where: { tenant_id: ctx.tenantId },
                _count: { _all: true },
            }),
        ]);

        const permCountMap = new Map<string, number>();
        for (const row of permCounts) {
            permCountMap.set(`${row.user_id}:${row.store_id}`, row._count._all);
        }

        const items = members.map((member) => ({
            userId: member.user_id,
            email: member.user.email,
            name: member.user.name,
            role: member.role,
            isSelf: member.user_id === ctx.userId,
            stores: accessRows
                .filter((a) => a.user_id === member.user_id)
                .map((a) => ({
                    storeId: a.store_id,
                    storeName: a.store.name,
                    accessLevel: a.access_level,
                    permissionCount: permCountMap.get(`${a.user_id}:${a.store_id}`) ?? 0,
                })),
        }));

        return paginate(items, total, pageNum, limitNum);
    }

    /** All branches in the tenant — used to render the access/permission matrix. */
    async listStores(ctx: TenantContext) {
        await this.assertPermission(ctx, StorePermission.MANAGE_USERS);
        const stores = await this.db.store.findMany({
            where: { tenant_id: ctx.tenantId },
            select: { id: true, name: true },
            orderBy: { created_at: 'asc' },
        });
        return stores.map((s) => ({ storeId: s.id, storeName: s.name }));
    }

    async getMember(ctx: TenantContext, userId: string) {
        await this.assertPermission(ctx, StorePermission.MANAGE_USERS);
        const membership = await this.getMembership(ctx.tenantId, userId);

        const [user, stores, access, perms] = await Promise.all([
            this.db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true } }),
            this.db.store.findMany({
                where: { tenant_id: ctx.tenantId },
                select: { id: true, name: true },
                orderBy: { created_at: 'asc' },
            }),
            this.db.userStoreAccess.findMany({ where: { tenant_id: ctx.tenantId, user_id: userId } }),
            this.db.userStorePermission.findMany({
                where: { tenant_id: ctx.tenantId, user_id: userId },
                select: { store_id: true, permission: true },
            }),
        ]);

        const accessMap = new Map(access.map((a) => [a.store_id, a.access_level]));
        const permsByStore = new Map<string, string[]>();
        for (const p of perms) {
            const list = permsByStore.get(p.store_id) ?? [];
            list.push(p.permission);
            permsByStore.set(p.store_id, list);
        }

        return {
            userId,
            email: user?.email,
            name: user?.name,
            role: membership.role,
            isSelf: userId === ctx.userId,
            stores: stores.map((s) => ({
                storeId: s.id,
                storeName: s.name,
                hasAccess: accessMap.has(s.id),
                accessLevel: accessMap.get(s.id) ?? 'STORE_ONLY',
                permissions: permsByStore.get(s.id) ?? [],
            })),
        };
    }

    /* ------------------------------- Mutations ------------------------------- */

    async updateRole(ctx: TenantContext, userId: string, role: UserRole, reseed: boolean) {
        await this.assertPermission(ctx, StorePermission.MANAGE_USERS);
        const membership = await this.getMembership(ctx.tenantId, userId);

        if (userId === ctx.userId) {
            throw new BadRequestException('You cannot change your own role.');
        }
        if (membership.role === UserRole.OWNER && role !== UserRole.OWNER && (await this.countOwners(ctx.tenantId)) <= 1) {
            throw new BadRequestException('Cannot change the role of the last owner.');
        }

        const defaults = (ROLE_DEFAULT_PERMISSIONS[role] ?? []).filter((p) => VALID_PERMISSIONS.has(p));

        await this.db.$transaction(async (tx) => {
            await tx.tenantUser.update({
                where: { tenant_id_user_id: { tenant_id: ctx.tenantId, user_id: userId } },
                data: { role },
            });

            if (reseed) {
                const access = await tx.userStoreAccess.findMany({
                    where: { tenant_id: ctx.tenantId, user_id: userId },
                    select: { store_id: true },
                });
                await tx.userStorePermission.deleteMany({ where: { tenant_id: ctx.tenantId, user_id: userId } });
                for (const { store_id } of access) {
                    if (defaults.length === 0) continue;
                    await tx.userStorePermission.createMany({
                        data: defaults.map((permission) => ({
                            user_id: userId,
                            store_id,
                            tenant_id: ctx.tenantId,
                            permission: permission as any,
                            granted_by: ctx.userId,
                        })),
                        skipDuplicates: true,
                    });
                }
            }
        });

        await this.audit.log('team.role_updated', 'TenantUser', this.auditCtx(ctx), userId, { role, reseed });
        return { message: 'Role updated.' };
    }

    async grantStoreAccess(
        ctx: TenantContext,
        userId: string,
        storeId: string,
        accessLevel: 'STORE_ONLY' | 'MULTI_STORE_CAPABLE',
        seedDefaults: boolean,
    ) {
        await this.assertPermission(ctx, StorePermission.MANAGE_USER_STORE_ACCESS);
        const membership = await this.getMembership(ctx.tenantId, userId);

        const store = await this.db.store.findFirst({
            where: { id: storeId, tenant_id: ctx.tenantId },
            select: { id: true },
        });
        if (!store) throw new NotFoundException('Branch not found in this organization.');

        const existing = await this.db.userStoreAccess.findUnique({
            where: { user_id_store_id: { user_id: userId, store_id: storeId } },
            select: { id: true },
        });

        await this.db.$transaction(async (tx) => {
            await tx.userStoreAccess.upsert({
                where: { user_id_store_id: { user_id: userId, store_id: storeId } },
                update: { access_level: accessLevel },
                create: { user_id: userId, store_id: storeId, tenant_id: ctx.tenantId, access_level: accessLevel },
            });

            if (!existing && seedDefaults) {
                const defaults = (ROLE_DEFAULT_PERMISSIONS[membership.role as UserRole] ?? []).filter((p) =>
                    VALID_PERMISSIONS.has(p),
                );
                if (defaults.length > 0) {
                    await tx.userStorePermission.createMany({
                        data: defaults.map((permission) => ({
                            user_id: userId,
                            store_id: storeId,
                            tenant_id: ctx.tenantId,
                            permission: permission as any,
                            granted_by: ctx.userId,
                        })),
                        skipDuplicates: true,
                    });
                }
            }
        });

        await this.audit.log('team.store_access_granted', 'UserStoreAccess', this.auditCtx(ctx), userId, {
            storeId,
            accessLevel,
        });
        return { message: 'Branch access updated.' };
    }

    async revokeStoreAccess(ctx: TenantContext, userId: string, storeId: string) {
        await this.assertPermission(ctx, StorePermission.MANAGE_USER_STORE_ACCESS);
        await this.getMembership(ctx.tenantId, userId);

        await this.db.$transaction([
            this.db.userStorePermission.deleteMany({
                where: { tenant_id: ctx.tenantId, user_id: userId, store_id: storeId },
            }),
            this.db.userStoreAccess.deleteMany({
                where: { tenant_id: ctx.tenantId, user_id: userId, store_id: storeId },
            }),
        ]);

        await this.audit.log('team.store_access_revoked', 'UserStoreAccess', this.auditCtx(ctx), userId, { storeId });
        return { message: 'Branch access revoked.' };
    }

    async setStorePermissions(ctx: TenantContext, userId: string, storeId: string, permissions: StorePermission[]) {
        await this.assertPermission(ctx, StorePermission.MANAGE_USERS);
        await this.getMembership(ctx.tenantId, userId);

        const access = await this.db.userStoreAccess.findUnique({
            where: { user_id_store_id: { user_id: userId, store_id: storeId } },
            select: { id: true, tenant_id: true },
        });
        if (!access || access.tenant_id !== ctx.tenantId) {
            throw new BadRequestException('Grant branch access before assigning permissions.');
        }

        const unique = Array.from(new Set(permissions)).filter((p) => VALID_PERMISSIONS.has(p));

        await this.db.$transaction(async (tx) => {
            await tx.userStorePermission.deleteMany({
                where: { tenant_id: ctx.tenantId, user_id: userId, store_id: storeId },
            });
            if (unique.length > 0) {
                await tx.userStorePermission.createMany({
                    data: unique.map((permission) => ({
                        user_id: userId,
                        store_id: storeId,
                        tenant_id: ctx.tenantId,
                        permission: permission as any,
                        granted_by: ctx.userId,
                    })),
                    skipDuplicates: true,
                });
            }
        });

        await this.audit.log('team.permissions_updated', 'UserStorePermission', this.auditCtx(ctx), userId, {
            storeId,
            permissions: unique,
        });
        return { message: 'Permissions updated.' };
    }

    async removeMember(ctx: TenantContext, userId: string) {
        await this.assertPermission(ctx, StorePermission.MANAGE_USERS);
        const membership = await this.getMembership(ctx.tenantId, userId);

        if (userId === ctx.userId) {
            throw new BadRequestException('You cannot remove yourself.');
        }
        if (membership.role === UserRole.OWNER) {
            if (ctx.userRole !== UserRole.OWNER) {
                throw new ForbiddenException('Only an owner can remove another owner.');
            }
            if ((await this.countOwners(ctx.tenantId)) <= 1) {
                throw new BadRequestException('Cannot remove the last owner.');
            }
        }

        await this.db.$transaction([
            this.db.userStorePermission.deleteMany({ where: { tenant_id: ctx.tenantId, user_id: userId } }),
            this.db.userStoreAccess.deleteMany({ where: { tenant_id: ctx.tenantId, user_id: userId } }),
            this.db.tenantUser.delete({
                where: { tenant_id_user_id: { tenant_id: ctx.tenantId, user_id: userId } },
            }),
        ]);

        await this.audit.log('team.member_removed', 'TenantUser', this.auditCtx(ctx), userId, {});
        return { message: 'Member removed.' };
    }

    /* ------------------------------ Invitations ------------------------------ */

    async listInvitations(ctx: TenantContext) {
        await this.assertPermission(ctx, StorePermission.MANAGE_USERS);
        const invites = await this.db.userInvitation.findMany({
            where: { tenant_id: ctx.tenantId, accepted_at: null, expires_at: { gt: new Date() } },
            orderBy: { created_at: 'desc' },
            select: { id: true, email: true, role: true, created_at: true, expires_at: true },
        });
        return invites.map((i) => ({
            id: i.id,
            email: i.email,
            role: i.role,
            invitedAt: i.created_at,
            expiresAt: i.expires_at,
        }));
    }

    async invite(ctx: TenantContext, email: string, role: UserRole) {
        await this.assertPermission(ctx, StorePermission.MANAGE_USERS);
        await this.invitations.invite(ctx.tenantId, ctx.userId, ctx.userRole ?? '', email, role);
        await this.audit.log('team.invitation_sent', 'UserInvitation', this.auditCtx(ctx), undefined, { email, role });
        return { message: 'Invitation sent.' };
    }

    async revokeInvitation(ctx: TenantContext, invitationId: string) {
        await this.assertPermission(ctx, StorePermission.MANAGE_USERS);
        const result = await this.db.userInvitation.deleteMany({
            where: { id: invitationId, tenant_id: ctx.tenantId, accepted_at: null },
        });
        if (result.count === 0) throw new NotFoundException('Invitation not found.');
        await this.audit.log('team.invitation_revoked', 'UserInvitation', this.auditCtx(ctx), invitationId, {});
        return { message: 'Invitation revoked.' };
    }
}
